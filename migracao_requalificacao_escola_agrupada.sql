-- Requalificação também em escola agrupada (06/11/2026). Jataí não tem código próprio no Mercúrio
-- (usa a base de Rio Verde, filial_cobranca_id) e por isso nunca entrava na requalificação diária: 21
-- alunos ativos de Rio Verde/Jataí estavam no CRM de Jataí como lead ("Interesse a confirmar"), sem a
-- etiqueta "Ativo". Única mudança em relação à versão em produção: o filtro de escolas de "alvo".
-- A etiqueta sai "Ativo: Rio Verde" (a ficha deles está na unidade RVD); já basta para tirar de
-- campanhas, filas e indicadores de lead.
CREATE OR REPLACE FUNCTION public.crm_requalificar_leads(p_filial text DEFAULT NULL::text, p_aplicar boolean DEFAULT true, p_pessoa text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_res jsonb; v_total int;
begin
 drop table if exists _rq;
 create temp table _rq as
 with alvo as (
  select l."pessoaIdentificador" pessoa, l.filial, l.tags, l."pessoaNome" nome, lower(nullif(trim(l."pessoaEmail"),'')) email,
   crm_chave_telefone(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero") tel, l.motivo_saida, l.data_saida, l.matricula_mercurio matricula
  from leads_inscricoes l join filiais f on f.nome=l.filial and f.ativo
   and (nullif(trim(f.mercurio_unidade),'') is not null
        -- escola agrupada (ex.: Jataí usa a base de Rio Verde): também é requalificada
        or exists (select 1 from filiais fc where fc.id=f.filial_cobranca_id and nullif(trim(fc.mercurio_unidade),'') is not null))
  where l.lixeira_em is null and (p_filial is null or l.filial=p_filial) and (p_pessoa is null or l."pessoaIdentificador"=p_pessoa)
 ),
 propria as (
  select a.pessoa,
   bool_or(m.situacao='ATI' or m.baixa_codigo=29) ativo,
   (array_agg(m.baixa_em order by m.baixa_em desc nulls last) filter (where m.situacao='INA'))[1] baixa_em,
   (array_agg(m.baixa_codigo order by m.baixa_em desc nulls last) filter (where m.situacao='INA'))[1] baixa_codigo,
   bool_or(m.situacao='INA') inativo,
   (array_agg(m.baixa_motivo order by m.baixa_em desc nulls last) filter (where m.situacao='INA'))[1] baixa_motivo,
   -- nível atual: o da matrícula ativa; sem ativa, o da saída mais recente
   (array_agg(m.nivel order by (m.situacao='ATI') desc, m.baixa_em desc nulls last))[1] nivel
  -- vínculo pelo id do lead OU pelo número de matrícula (sobrevive a mesclagens antigas)
  from alvo a join mercurio_pessoas m on m.filial=a.filial and (m.pessoa_identificador=a.pessoa or (a.matricula is not null and m.matricula=a.matricula))
  group by a.pessoa
 ),
 outra as ( -- ativo em outra filial: e-mail OU telefone igual, sempre com o mesmo primeiro
  -- nome (e-mail e telefone da família são compartilhados com frequência)
  select a.pessoa, min(m.filial) filial_ativa
  from alvo a join mercurio_pessoas m on m.situacao='ATI' and m.filial<>a.filial
   and ((a.email is not null and m.email=a.email) or (a.tel is not null and m.tel_chave=a.tel))
   and crm_primeiro_nome(a.nome)=crm_primeiro_nome(m.nome)
  group by a.pessoa
 ),
 ev as (
  select el."pessoaIdentificador" pessoa,
   bool_or(e.data>=v_hoje and (el.resposta_convite='confirmado' or el.origem='ulisses')) futuro,
   max(e.data) filter (where e.data<v_hoje and (el.resposta_convite='confirmado' or el.origem='ulisses' or el.compareceu)) ultimo_passado,
   bool_or(el.compareceu and e.data>=v_hoje-30) compareceu_30d,
   max(e.data) filter (where el.resposta_convite='confirmado' or el.origem='ulisses' or el.compareceu) ultimo_qualquer
  from evento_leads el join eventos e on e.id=el.evento_id join alvo a on a.pessoa=el."pessoaIdentificador" group by 1
 ),
 wpp as (
  select m."pessoaIdentificador" pessoa, max(m.criado_em) ultima_entrada
  from mensagens_whatsapp m join alvo a on a.pessoa=m."pessoaIdentificador" where m.direcao='entrada' group by 1
 )
 select a.pessoa, a.filial, a.tags tags_antigas,
  case when coalesce(p.ativo,false) then a.filial when o.filial_ativa is not null then o.filial_ativa end filial_ativa,
  coalesce(p.inativo,false) and not coalesce(p.ativo,false) and o.filial_ativa is null inativo,
  p.baixa_em, p.baixa_codigo, p.baixa_motivo, crm_categoria_saida(p.baixa_codigo) categoria,
  p.pessoa is not null ligado, crm_tag_nivel_mercurio(p.nivel) tag_nivel,
  ev.futuro, ev.ultimo_passado, ev.compareceu_30d, ev.ultimo_qualquer, w.ultima_entrada,
  a.motivo_saida, a.data_saida
 from alvo a left join propria p on p.pessoa=a.pessoa left join outra o on o.pessoa=a.pessoa
 left join ev on ev.pessoa=a.pessoa left join wpp w on w.pessoa=a.pessoa;

 alter table _rq add column tags_novas jsonb, add column novo_motivo text, add column nova_data text;
 update _rq r set tags_novas = (
  select to_jsonb(coalesce(jsonb_agg(distinct t order by t),'[]'::jsonb)::text) from (
   select t from jsonb_array_elements_text(crm_tags_lista(r.tags_antigas)) t where not crm_tag_qualificacao_mercurio(t)
    -- quem tem vínculo com o Mercúrio fica só com o nível de lá (nunca dois níveis)
    and not (r.ligado and t in ('Merlin','TA','CA','JN','PP','N1','N2','N3','N4','N5','N6','N7','Membro'))
   union all select r.tag_nivel where r.ligado and r.tag_nivel is not null
   union all select 'Ativo: '||crm_filial_curta(r.filial_ativa) where r.filial_ativa is not null
   union all select 'Inativo' where r.inativo
   union all select 'Saída: '||r.categoria where r.inativo
   union all select case when r.baixa_em is null then 'Saída antiga' when r.baixa_em > v_hoje-90 then 'Saída recente'
                         when r.baixa_em >= v_hoje-730 then 'Janela de resgate' else 'Saída antiga' end where r.inativo
   union all select 'Não Contatar' where r.inativo and r.categoria in ('Não contatar','Mudou de cidade')
   -- Reaproximação é sinal do momento: evento depois da saída e nos últimos 6 meses.
   union all select 'Inativo reaproximando' where r.inativo and r.ultimo_qualquer >= v_hoje-180 and (r.baixa_em is null or r.ultimo_qualquer > r.baixa_em)
   union all select 'Temperatura: '||case
     when r.futuro or r.compareceu_30d or r.ultima_entrada > now()-interval '14 days' then 'Quente'
     when r.ultimo_qualquer >= v_hoje-180 or r.ultima_entrada > now()-interval '90 days' then 'Morna'
     else 'Fria' end where r.filial_ativa is null
  ) x),
  novo_motivo = case when r.inativo then coalesce(nullif(trim(r.baixa_motivo),''), r.categoria) end,
  nova_data = case when r.inativo and r.baixa_em is not null then to_char(r.baixa_em,'DD/MM/YYYY') end
 where true;

 delete from _rq where crm_tags_ordenadas(tags_novas) = crm_tags_ordenadas(tags_antigas)
  and (not inativo or (novo_motivo is not distinct from motivo_saida and coalesce(nova_data,nullif(data_saida,'00/00/0000')) is not distinct from data_saida));
 select count(*) into v_total from _rq;
 select jsonb_build_object('alterados',v_total,
  'ativos',count(*) filter (where filial_ativa is not null),
  'ativos_outra_filial',count(*) filter (where filial_ativa is not null and filial_ativa<>filial),
  'inativos',count(*) filter (where inativo),
  'reaproximando',count(*) filter (where tags_novas::text like '%Inativo reaproximando%'),
  'por_categoria',(select jsonb_object_agg(categoria,n) from (select categoria,count(*) n from _rq where inativo group by 1) c))
 into v_res from _rq;
 if p_aplicar and v_total > 0 then
  update leads_inscricoes l set tags = r.tags_novas,
   motivo_saida = case when r.inativo then r.novo_motivo else l.motivo_saida end,
   data_saida = case when r.inativo then coalesce(r.nova_data, nullif(l.data_saida,'00/00/0000')) else l.data_saida end
  from _rq r where l."pessoaIdentificador"=r.pessoa and l.filial=r.filial;
  insert into log_atividade(filial,acao,autor,pessoa_ids,detalhes)
  select filial,'requalificacao_mercurio','Requalificação automática',jsonb_agg(pessoa),jsonb_build_object('alterados',count(*)) from _rq group by filial;
 end if;
 drop table if exists _rq;
 return v_res || jsonb_build_object('aplicado', p_aplicar and v_total > 0);
end $function$;

select crm_requalificar_leads('Jataí', true);

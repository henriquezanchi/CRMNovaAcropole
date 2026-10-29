-- Requalificação dos leads pelo Mercúrio (2026-10-29, aprovado pelo usuário).
-- Quatro perguntas, cada uma com uma fonte só; esta migração cuida da 1ª
-- (relação com a escola) e dos fatos que a acompanham:
--   * "Ativo: <filial>"  — ativo hoje no banco do Mercúrio (cad_situacao='ATI'),
--     na própria filial ou, por e-mail/telefone+nome, em outra. Reservado: sai
--     do funil e de toda qualificação de conversa.
--   * "Inativo" + "Saída: <categoria>" + faixa de tempo — cad_situacao='INA',
--     motivo pelo código oficial (sig_motivo_baixa) e data (cad_baixa).
--   * "Inativo reaproximando" — inativo inscrito/confirmado em evento depois de sair.
--   * "Temperatura: Quente/Morna/Fria" — só para quem não é ativo; fatos de
--     evento e de resposta no WhatsApp, nunca opinião.
-- As etiquetas dessas famílias são recalculadas do zero (espelho, nunca soma);
-- etiquetas antigas e sem fonte confiável são apagadas. Etiquetas livres da
-- equipe, Recuperado, nível, Não Contatar e contato continuam intactas.
begin;

-- Situação de cada matrícula no Mercúrio (ativos e inativos), alimentada pela
-- Edge Function mercurio-db-sincronizar. mercurio_alunos continua sendo só a
-- base de cobrança (ativos); esta é a base de qualificação.
create table if not exists mercurio_pessoas (
 matricula bigint not null,
 unidade text not null,
 filial text not null,
 pessoa_identificador text,
 nome text,
 situacao text not null check (situacao in ('ATI','INA')),
 nivel text,
 baixa_em date,
 baixa_codigo int,
 baixa_motivo text,
 email text,
 tel_chave text,
 visto_em timestamptz not null default now(),
 primary key (matricula, unidade)
);
create index if not exists mercurio_pessoas_pessoa on mercurio_pessoas(pessoa_identificador, filial);
create index if not exists mercurio_pessoas_email on mercurio_pessoas(email) where situacao='ATI' and email is not null;
create index if not exists mercurio_pessoas_tel on mercurio_pessoas(tel_chave) where situacao='ATI' and tel_chave is not null;
alter table mercurio_pessoas enable row level security;
drop policy if exists mercurio_pessoas_leitura on mercurio_pessoas;
create policy mercurio_pessoas_leitura on mercurio_pessoas for select using (true);

-- Chave de telefone igual à do resto do CRM: DDD + número sem o 9º dígito.
create or replace function crm_chave_telefone(p_ddd text, p_numero text)
returns text language sql immutable as $$
 select case when length(n) >= 8 and length(regexp_replace(coalesce(p_ddd,''),'\D','','g')) = 2
  then regexp_replace(coalesce(p_ddd,''),'\D','','g') || right(n, 8) end
 from (select regexp_replace(coalesce(p_numero,''),'\D','','g') n) x;
$$;

-- Categoria do motivo de saída (códigos de sig_motivo_baixa no Mercúrio).
create or replace function crm_categoria_saida(p_codigo int)
returns text language sql immutable as $$
 select case
  when p_codigo = 21 then 'Pretende voltar'
  when p_codigo in (2,3,4,10,11,12,13,14,26,27,28) then 'Vida e agenda'
  when p_codigo = 6 then 'Saúde'
  when p_codigo in (1,5,16,18,19,20,22,24) then 'Insatisfeito'
  when p_codigo in (15,23,25) then 'Não contatar'
  when p_codigo = 9 then 'Mudou de cidade'
  when p_codigo = 29 then 'Círculo de Amigos'
  else 'Sem informação' end;
$$;

create or replace function crm_primeiro_nome(p_nome text)
returns text language sql immutable as $$
 select split_part(upper(translate(trim(coalesce(p_nome,'')),'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),' ',1)
$$;

create or replace function crm_tags_ordenadas(p_tags jsonb)
returns text language sql immutable as $$
 select coalesce(string_agg(t, '|' order by t), '') from (select distinct t from jsonb_array_elements_text(crm_tags_lista(p_tags)) t) x
$$;

create or replace function crm_filial_curta(p_filial text)
returns text language sql immutable as $$ select regexp_replace(coalesce(p_filial,''), '^Goiânia - ', '') $$;

-- Etiqueta que esta rotina controla (removida e recalculada a cada rodada).
create or replace function crm_tag_qualificacao_mercurio(t text)
returns boolean language sql immutable as $$
 select t in ('Ativo','Aluno Ativo','Inativo','Ex-Aluno (Inativo)','Saída recente','Janela de resgate','Saída antiga',
              'Inativo reaproximando','Interesse a confirmar','Interesse declarado','Interesse declarado: não',
              'Retorno: Só 1 Evento','Contribuição em Atraso')
  or t like 'Ativo: %' or t like 'Saída: %' or t like 'Temperatura: %' or t like 'Jornada:%' or t like 'Lead Forte%'
  or (t like 'Conversa: %' and t <> 'Conversa: Mudou de Cidade')
  or (t like 'Convite: %' and t not in ('Convite: Não Pode Ir','Convite: Sem Interesse'));
$$;

create or replace function crm_requalificar_leads(p_filial text default null, p_aplicar boolean default true)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_res jsonb; v_total int;
begin
 drop table if exists _rq;
 create temp table _rq as
 with alvo as (
  select l."pessoaIdentificador" pessoa, l.filial, l.tags, l."pessoaNome" nome, lower(nullif(trim(l."pessoaEmail"),'')) email,
   crm_chave_telefone(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero") tel, l.motivo_saida, l.data_saida
  from leads_inscricoes l join filiais f on f.nome=l.filial and f.ativo and nullif(trim(f.mercurio_unidade),'') is not null
  where l.lixeira_em is null and (p_filial is null or l.filial=p_filial)
 ),
 propria as (
  select a.pessoa,
   bool_or(m.situacao='ATI' or m.baixa_codigo=29) ativo,
   (array_agg(m.baixa_em order by m.baixa_em desc nulls last) filter (where m.situacao='INA'))[1] baixa_em,
   (array_agg(m.baixa_codigo order by m.baixa_em desc nulls last) filter (where m.situacao='INA'))[1] baixa_codigo,
   bool_or(m.situacao='INA') inativo,
   (array_agg(m.baixa_motivo order by m.baixa_em desc nulls last) filter (where m.situacao='INA'))[1] baixa_motivo
  from alvo a join mercurio_pessoas m on m.pessoa_identificador=a.pessoa and m.filial=a.filial group by a.pessoa
 ),
 outra as ( -- ativo em outra filial, pela mesma pessoa (e-mail, ou telefone com o mesmo primeiro nome)
  select a.pessoa, min(m.filial) filial_ativa
  from alvo a join mercurio_pessoas m on m.situacao='ATI' and m.filial<>a.filial
   and ((a.email is not null and m.email=a.email)
     or (a.tel is not null and m.tel_chave=a.tel and crm_primeiro_nome(a.nome)=crm_primeiro_nome(m.nome)))
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
  ev.futuro, ev.ultimo_passado, ev.compareceu_30d, ev.ultimo_qualquer, w.ultima_entrada,
  a.motivo_saida, a.data_saida
 from alvo a left join propria p on p.pessoa=a.pessoa left join outra o on o.pessoa=a.pessoa
 left join ev on ev.pessoa=a.pessoa left join wpp w on w.pessoa=a.pessoa;

 alter table _rq add column tags_novas jsonb, add column novo_motivo text, add column nova_data text;
 update _rq r set tags_novas = (
  select to_jsonb(coalesce(jsonb_agg(distinct t order by t),'[]'::jsonb)::text) from (
   select t from jsonb_array_elements_text(crm_tags_lista(r.tags_antigas)) t where not crm_tag_qualificacao_mercurio(t)
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
end $$;
revoke all on function crm_requalificar_leads(text,boolean) from public, anon, authenticated;

commit;

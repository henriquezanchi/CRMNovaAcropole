-- Ativos fora da atenção de vendas (2026-10-29, pedido do usuário): "Ativos
-- devem ser tirados das principais métricas (follow up, kanban que exige nossa
-- atenção, etc). Ficam no CRM somente para pedirmos ajuda para a divulgação de
-- eventos, e para darmos parabéns no aniversário. Só isso."
-- crm_eh_ativo() é a regra única: tag Ativo/Aluno Ativo OU ativo no banco do
-- Mercúrio (mercurio_alunos) na mesma filial. Usada pelas filas da IA
-- (sugestão, convite, reengajamento, qualificação, análise de funil, áudio),
-- pelo painel de especialistas e pelas views de conversa (coluna eh_ativo).
-- Consequência aceita: a IA não lê mais conversas de Ativos, então um pedido
-- de "não me contate" vindo de um Ativo só é visto por quem abrir a conversa.
begin;
create index if not exists idx_mercurio_alunos_pessoa_ativo on mercurio_alunos(pessoa_identificador, filial) where ativo;

create or replace function crm_eh_ativo(p_filial text, p_pessoa text, p_tags jsonb)
returns boolean language sql stable set search_path=public,pg_temp as $$
 select coalesce(crm_tags_lista(p_tags) ?| array['Ativo','Aluno Ativo'],false)
  or exists(select 1 from mercurio_alunos a where a.pessoa_identificador=p_pessoa and a.filial=p_filial and a.ativo);
$$;
grant execute on function crm_eh_ativo(text,text,jsonb) to anon, authenticated;

create or replace view vw_wpp_conversas as
select m."pessoaIdentificador",
    max(m.criado_em) as ultima_mensagem_em,
    (array_agg(m.corpo_texto order by m.criado_em desc))[1] as ultimo_texto,
    (array_agg(m.direcao order by m.criado_em desc))[1] as ultima_direcao,
    (array_agg(m.wa_status order by m.criado_em desc))[1] as ultimo_status,
    (array_agg(m.filial order by m.criado_em desc))[1] as filial,
    coalesce((select crm_eh_ativo(l.filial,l."pessoaIdentificador",l.tags) from leads_inscricoes l where l."pessoaIdentificador"=m."pessoaIdentificador" limit 1),false) as eh_ativo
from mensagens_whatsapp m
where m."pessoaIdentificador" is not null
group by m."pessoaIdentificador";

create or replace view crm_fila_especialistas as
 select q.filial, q.pessoa, q.versao, q.versao_analisada, q.estado, q.resultado, q.criterio, q.ultima_mensagem, q.lease, q.lease_ate,
    q.tentativas, q.proxima_em, q.erro, q.atualizado_em, q.analisado_em, l."pessoaNome" as nome, l.acompanhamento,
        case
            when crm_tags_lista(l.tags) ? 'Contato em conferência' or crm_tags_lista(l.tags) ? 'Histórico em conferência' then 'interno'
            when crm_tags_lista(l.tags) ? 'Não Contatar' or (l.acompanhamento ->> 'contato') = any (array['nao_contatar','pausado']) or (l.acompanhamento ->> 'intencao') = any (array['nao','depois']) or (q.resultado #>> '{restricao,tipo}') = any (array['nao_contatar','pausa']) then 'interno'
            when crm_retorno_futuro(l.acompanhamento) then 'interno'
            when (l.acompanhamento ->> 'proximo') = 'conferir' or (l.acompanhamento ->> 'inscricao') = 'aguardando_registro' then 'interno'
            when (l.acompanhamento ->> 'relacao') = 'ativo' or crm_tags_lista(l.tags) ? 'Ativo' or crm_tags_lista(l.tags) ? 'Aluno Ativo' then 'acolhimento'
            else coalesce(nullif(q.resultado ->> 'etapa', 'qualificacao'), q.resultado ->> 'etapa_provavel', q.resultado ->> 'etapa', 'qualificacao')
        end as agente,
    coalesce((l.acompanhamento ->> 'relacao') = 'ativo', false) or crm_eh_ativo(l.filial, l."pessoaIdentificador", l.tags) as eh_ativo
   from crm_qualificacoes q
     join leads_inscricoes l on l."pessoaIdentificador" = q.pessoa and l.filial = q.filial and l.lixeira_em is null;

CREATE OR REPLACE FUNCTION public.mensagens_candidatas_sugestao_resposta(p_limite integer DEFAULT 30)
 RETURNS TABLE(mensagem_id bigint, "pessoaIdentificador" text, corpo_texto text, filial text)
 LANGUAGE sql
 STABLE
AS $function$
    with candidatas as (
        select
            m.id as mensagem_id,
            m."pessoaIdentificador",
            m.corpo_texto,
            l.filial
        from mensagens_whatsapp m
        join leads_inscricoes l on l."pessoaIdentificador" = m."pessoaIdentificador" and l.filial=m.filial and l.lixeira_em is null
        left join filiais f on f.nome = l.filial
        left join sugestoes_resposta_wpp s on s.mensagem_origem_id = m.id
        where m.direcao = 'entrada'
          and m.tipo = 'texto'
          and m."pessoaIdentificador" is not null
          and m.filial is not null
          and not exists(select 1 from mensagens_whatsapp nova where nova."pessoaIdentificador"=m."pessoaIdentificador" and nova.filial=m.filial and nova.id>m.id)
          and not exists(select 1 from sugestoes_resposta_wpp ja where ja.mensagem_origem_id=m.id)
          and not exists(select 1 from classificacoes_resposta_convite ja where ja.mensagem_origem_id=m.id)
          and m.criado_em > now() - interval '2 hours'
          and s.id is null
          and coalesce(l.ia_sugestao_resposta, f.ia_sugestao_resposta_habilitada, true) = true
          and not crm_eh_ativo(l.filial,l."pessoaIdentificador",l.tags)
    ),
    ultima_por_lead as (
        select distinct on ("pessoaIdentificador") *
        from candidatas
        order by "pessoaIdentificador", mensagem_id desc
    )
    select mensagem_id, "pessoaIdentificador", corpo_texto, filial
    from ultima_por_lead
    order by mensagem_id desc
    limit p_limite;
$function$;


CREATE OR REPLACE FUNCTION public.mensagens_candidatas_classificacao_convite(p_limite integer DEFAULT 30)
 RETURNS TABLE(mensagem_id bigint, "pessoaIdentificador" text, corpo_texto text, evento_id bigint, evento_nome text, evento_data date)
 LANGUAGE sql
 STABLE
AS $function$
    with candidatas_por_mensagem as (
        select distinct on (m.id)
            m.id as mensagem_id,
            m."pessoaIdentificador",
            m.corpo_texto,
            el.evento_id,
            ev.nome as evento_nome,
            ev.data as evento_data
        from mensagens_whatsapp m
        join evento_leads el on el."pessoaIdentificador" = m."pessoaIdentificador" and el.resposta_convite = 'pendente'
        join eventos ev on ev.id = el.evento_id and ev.filial=m.filial
        join leads_inscricoes l on l."pessoaIdentificador"=m."pessoaIdentificador" and l.filial=m.filial and l.lixeira_em is null
        left join filiais f on f.nome=l.filial
        left join classificacoes_resposta_convite c on c.mensagem_origem_id = m.id
        where m.direcao = 'entrada'
          and m."pessoaIdentificador" is not null
          and m.filial is not null
          and not exists(select 1 from mensagens_whatsapp nova where nova."pessoaIdentificador"=m."pessoaIdentificador" and nova.filial=m.filial and nova.id>m.id)
          and not exists(select 1 from sugestoes_resposta_wpp ja where ja.mensagem_origem_id=m.id)
          and not exists(select 1 from classificacoes_resposta_convite ja where ja.mensagem_origem_id=m.id)
          and m.criado_em > now() - interval '3 hours'
          and c.id is null
          and coalesce(l.ia_sugestao_resposta,f.ia_sugestao_resposta_habilitada,true)=true
          and ev.data >= (current_date - 3)
          and not crm_eh_ativo(l.filial,l."pessoaIdentificador",l.tags)
        order by m.id, ev.data desc
    ),
    ultima_por_lead as (
        select distinct on ("pessoaIdentificador") *
        from candidatas_por_mensagem
        order by "pessoaIdentificador", mensagem_id desc
    )
    select mensagem_id, "pessoaIdentificador", corpo_texto, evento_id, evento_nome, evento_data
    from ultima_por_lead
    order by mensagem_id desc
    limit p_limite;
$function$;


CREATE OR REPLACE FUNCTION public.mensagens_candidatas_reengajamento_janela(p_limite integer DEFAULT 20)
 RETURNS TABLE(mensagem_id bigint, "pessoaIdentificador" text, filial text)
 LANGUAGE sql
 STABLE
AS $function$
    select
        m.id as mensagem_id,
        m."pessoaIdentificador",
        l.filial
    from mensagens_whatsapp m
    join leads_inscricoes l on l."pessoaIdentificador" = m."pessoaIdentificador" and l.filial = m.filial and l.lixeira_em is null
    left join filiais f on f.nome = l.filial
    left join sugestoes_resposta_wpp s on s.mensagem_origem_id = m.id
    where m.direcao = 'entrada'
      and m."pessoaIdentificador" is not null
      -- é mesmo a ÚLTIMA mensagem da conversa (ninguém respondeu depois) —
      -- sem isso, uma mensagem antiga de 12h+ atrás que JÁ foi respondida
      -- continuaria aparecendo pra sempre.
      and m.id = (
          select max(m2.id) from mensagens_whatsapp m2
          where m2."pessoaIdentificador" = m."pessoaIdentificador"
      )
      and m.criado_em <= now() - interval '12 hours'
      and m.criado_em > now() - interval '24 hours' -- depois de 24h a janela já fechou, não adianta mais
      and s.reengajamento_em is null
      and (s.id is null or s.status = 'pendente') -- já enviada/descartada pelo SDR = não mexe mais
      and coalesce(l.ia_sugestao_resposta, f.ia_reengajamento_janela_habilitado, true) = true
      and not crm_eh_ativo(l.filial,l."pessoaIdentificador",l.tags)
    order by m.criado_em asc
    limit p_limite;
$function$;


CREATE OR REPLACE FUNCTION public.crm_proxima_qualificacao()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select jsonb_build_object('filial',q.filial,'pessoa',q.pessoa,'ultima',coalesce((select max(id)from mensagens_whatsapp m where m.filial=q.filial and m."pessoaIdentificador"=q.pessoa),0))
 from crm_qualificacoes q join leads_inscricoes l on l.filial=q.filial and l."pessoaIdentificador"=q.pessoa and l.lixeira_em is null
 where (q.estado='pendente' or q.estado='erro' and q.proxima_em<=now() or q.estado='processando' and q.lease_ate<=now())
 and coalesce(q.lease_ate,now())<=now()
 and not crm_eh_ativo(l.filial,l."pessoaIdentificador",l.tags)
 order by exists(select 1 from mensagens_whatsapp m where m.filial=q.filial and m."pessoaIdentificador"=q.pessoa and m.direcao='entrada')desc,q.atualizado_em,q.filial,q.pessoa limit 1;
$function$;


CREATE OR REPLACE FUNCTION public.crm_assumir_audio()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t crm_audio_transcricoes; m mensagens_whatsapp; chave text; dia_local date=(now()at time zone'America/Sao_Paulo')::date;
begin
 if not(select transcricao_disponivel from crm_ia_config where id)then return null;end if;
 perform pg_advisory_xact_lock(193446);
 insert into crm_ia_orcamento(dia)values(dia_local)on conflict do nothing;
 if(select audios from crm_ia_orcamento where dia=dia_local)>=(select limite_audios_dia from crm_ia_config where id)then return null;end if;
 select a.* into t from crm_audio_transcricoes a join mensagens_whatsapp x on x.id=a.mensagem_id join leads_inscricoes l on l."pessoaIdentificador"=x."pessoaIdentificador" and l.filial=x.filial and l.lixeira_em is null
 where (a.estado='pendente' or a.estado='erro'and a.proxima_em<=now() or a.estado='processando'and a.lease_ate<=now())and coalesce(a.lease_ate,now())<=now()
 and not crm_eh_ativo(l.filial,l."pessoaIdentificador",l.tags)
 order by a.mensagem_id for update of a skip locked limit 1;
 if not found then return null;end if;
 select * into m from mensagens_whatsapp where id=t.mensagem_id;
 chave=gen_random_uuid()::text;
 update crm_audio_transcricoes set estado='processando',lease=chave,lease_ate=now()+interval'3 minutes',tentativas=tentativas+1 where mensagem_id=t.mensagem_id;
 update crm_ia_orcamento set audios=audios+1 where dia=dia_local;
 return jsonb_build_object('id',t.mensagem_id,'assinatura',t.assinatura,'lease',chave,'url',m.payload_bruto->>'audio_url','limite_bytes',(select limite_bytes_audio from crm_ia_config where id));
end;$function$;


CREATE OR REPLACE FUNCTION public.assumir_conversa_funil()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c funil_analises_conversa; mensagens jsonb; eventos_conversa jsonb;
begin
 select * into c from funil_analises_conversa where (estado='pendente' or (estado='processando' and atualizado_em<now()-interval '5 minutes') or (estado='erro' and atualizado_em<now()-interval '2 minutes'))
 and not exists(select 1 from leads_inscricoes l where l.filial=funil_analises_conversa.filial and l."pessoaIdentificador"=funil_analises_conversa.pessoa and crm_eh_ativo(l.filial,l."pessoaIdentificador",l.tags))
 order by exists(select 1 from mensagens_whatsapp m where m.filial=funil_analises_conversa.filial and m."pessoaIdentificador"=funil_analises_conversa.pessoa and m.direcao='entrada') desc,atualizado_em,filial,pessoa
 for update skip locked limit 1;
 if c.pessoa is null then return null; end if;
 update funil_analises_conversa set estado='processando',atualizado_em=now() where filial=c.filial and pessoa=c.pessoa;
 -- Histórico inteiro, inclusive importados, com fonte explícita. Nunca corta em 1000 linhas.
 select jsonb_agg(jsonb_build_object('id',id,'direcao',direcao,'tipo',tipo,'status',wa_status,'importada',coalesce(importado_manualmente,false),'texto',corpo_texto,'data',criado_em) order by criado_em,id) into mensagens
 from mensagens_whatsapp where filial=c.filial and "pessoaIdentificador"=c.pessoa;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'nome',e.nome,'data',e.data,'link',e.link_inscricao) order by e.data,e.id),'[]'::jsonb) into eventos_conversa
 from eventos e where e.filial=c.filial and e.data>=(select min(criado_em)::date-7 from mensagens_whatsapp where filial=c.filial and "pessoaIdentificador"=c.pessoa)
 and e.data<=(select max(criado_em)::date+180 from mensagens_whatsapp where filial=c.filial and "pessoaIdentificador"=c.pessoa);
 return jsonb_build_object('filial',c.filial,'pessoa',c.pessoa,'versao',c.versao,'mensagens',coalesce(mensagens,'[]'::jsonb),'eventos',eventos_conversa);
end $function$;


CREATE OR REPLACE FUNCTION public.painel_especialistas_crm(p_filial text, p_agente text DEFAULT NULL::text, p_apos text DEFAULT NULL::text, p_busca text DEFAULT ''::text, p_responsavel text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select jsonb_build_object(
 'resumo',(select coalesce(jsonb_object_agg(agente,n),'{}')from(select agente,count(*)n from crm_fila_especialistas where filial=p_filial and not eh_ativo group by agente)s),
 'processamento',(select jsonb_build_object('total',count(*),'concluidos',count(*)filter(where estado='concluido'),'sem_historico',count(*)filter(where resultado->>'sem_historico'='true'),'pendentes',count(*)filter(where estado in('pendente','processando')),'erros',count(*)filter(where estado in('erro','limite')))from crm_fila_especialistas where filial=p_filial and not eh_ativo),
 'audios',(select jsonb_build_object('total',count(*),'concluidos',count(*)filter(where a.estado='concluido'),'erros',count(*)filter(where a.estado in('erro','limite')))from crm_audio_transcricoes a join mensagens_whatsapp m on m.id=a.mensagem_id where m.filial=p_filial),
 'config',(select jsonb_build_object('caracteres_dia',limite_caracteres_dia,'audios_dia',limite_audios_dia,'transcricao_disponivel',transcricao_disponivel)from crm_ia_config where id),
 'orcamento',(select to_jsonb(b)from crm_ia_orcamento b where dia=(now()at time zone'America/Sao_Paulo')::date),
 'itens',(select coalesce(jsonb_agg(to_jsonb(s)order by s.pessoa),'[]')from(select filial,pessoa,nome,agente,estado,resultado,analisado_em,erro,acompanhamento from crm_fila_especialistas where filial=p_filial and not eh_ativo and(p_agente is null or agente=p_agente)and(p_apos is null or pessoa>p_apos)and(p_busca=''or strpos(lower(coalesce(nome,'')||' '||pessoa||' '||coalesce(acompanhamento->>'responsavel','')),lower(p_busca))>0)and(p_responsavel is null or acompanhamento->>'responsavel'=p_responsavel)order by pessoa limit 51)s));
$function$;

commit;

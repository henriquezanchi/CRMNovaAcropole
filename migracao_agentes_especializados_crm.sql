-- Aditiva: evidências e encaminhamento dos agentes junto ao rascunho existente.
begin;
alter table sugestoes_resposta_wpp add column if not exists agente_ia jsonb;
alter table classificacoes_resposta_convite add column if not exists agente_ia jsonb;
alter table sugestoes_resposta_wpp enable row level security;
alter table classificacoes_resposta_convite enable row level security;

-- Publicação atômica e exclusiva entre os dois produtores. Nenhuma mensagem é enviada.
create or replace function registrar_rascunho_agente(p_tipo text,p_pessoa text,p_mensagem bigint,p_dados jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare origem mensagens_whatsapp; cadastro leads_inscricoes; tags_atuais jsonb;
begin
 if p_tipo not in ('geral','convite') then raise exception 'Tipo inválido';end if;
 perform pg_advisory_xact_lock(hashtextextended('agentes-crm:'||p_pessoa,0));
 select * into origem from mensagens_whatsapp where id=p_mensagem and "pessoaIdentificador"=p_pessoa and direcao='entrada';
 if not found or origem.filial is null then return false;end if;
 select * into cadastro from leads_inscricoes where "pessoaIdentificador"=p_pessoa and filial=origem.filial and lixeira_em is null;
 if not found then return false;end if;
 if exists(select 1 from mensagens_whatsapp where "pessoaIdentificador"=p_pessoa and filial=origem.filial and id>p_mensagem) then return false;end if;
 if exists(select 1 from sugestoes_resposta_wpp where mensagem_origem_id=p_mensagem) or exists(select 1 from classificacoes_resposta_convite where mensagem_origem_id=p_mensagem) then return false;end if;
 if not coalesce(cadastro.ia_sugestao_resposta,(select ia_sugestao_resposta_habilitada from filiais where nome=origem.filial),true)then return false;end if;
 if p_dados #>> '{agente_ia,qualificacao,restricao,tipo}'='nao_contatar' then
  tags_atuais=case when jsonb_typeof(cadastro.tags)='string' then (cadastro.tags #>> '{}')::jsonb else coalesce(cadastro.tags,'[]'::jsonb) end;
  if jsonb_typeof(tags_atuais)='array' and not tags_atuais ? 'Não Contatar' then
   update leads_inscricoes set tags=to_jsonb((tags_atuais||jsonb_build_array('Não Contatar'))::text) where "pessoaIdentificador"=p_pessoa;
  end if;
 end if;
 if p_tipo='geral' then
  insert into sugestoes_resposta_wpp("pessoaIdentificador",mensagem_origem_id,sugestao_resposta,lembrete_sugerido_data,lembrete_sugerido_motivo,agente_ia)
  values(p_pessoa,p_mensagem,p_dados->>'sugestao_resposta',(p_dados->>'lembrete_sugerido_data')::date,p_dados->>'lembrete_sugerido_motivo',p_dados->'agente_ia');
 else
  if not exists(select 1 from eventos where id=(p_dados->>'evento_id')::bigint and filial=origem.filial)then return false;end if;
  insert into classificacoes_resposta_convite("pessoaIdentificador",mensagem_origem_id,evento_id,categoria,sugestao_resposta,lembrete_sugerido_data,lembrete_sugerido_motivo,agente_ia)
  values(p_pessoa,p_mensagem,(p_dados->>'evento_id')::bigint,p_dados->>'categoria',p_dados->>'sugestao_resposta',(p_dados->>'lembrete_sugerido_data')::date,p_dados->>'lembrete_sugerido_motivo',p_dados->'agente_ia');
 end if;
 update sugestoes_resposta_wpp set status='descartada' where "pessoaIdentificador"=p_pessoa and status='pendente' and mensagem_origem_id<>p_mensagem;
 update classificacoes_resposta_convite set status='descartada' where "pessoaIdentificador"=p_pessoa and status='pendente' and mensagem_origem_id<>p_mensagem;
 return true;
end;$$;
revoke all on function registrar_rascunho_agente(text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function registrar_rascunho_agente(text,text,bigint,jsonb) to service_role;


create or replace function mensagens_candidatas_classificacao_convite(p_limite int default 30)
returns table (
    mensagem_id bigint,
    "pessoaIdentificador" text,
    corpo_texto text,
    evento_id bigint,
    evento_nome text,
    evento_data date
)
language sql
stable
as $$
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
$$;

create or replace function mensagens_candidatas_sugestao_resposta(p_limite int default 30)
returns table (
    mensagem_id bigint,
    "pessoaIdentificador" text,
    corpo_texto text,
    filial text
)
language sql
stable
as $$
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
$$;

commit;

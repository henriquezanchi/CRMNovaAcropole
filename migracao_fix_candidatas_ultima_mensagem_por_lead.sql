-- Correção de bug real (2026-10-01, achado testando ao vivo — caso do
-- Dimilson): as 2 RPCs de candidatos pra IA de resposta
-- (mensagens_candidatas_classificacao_convite/
-- mensagens_candidatas_sugestao_resposta) tratavam CADA mensagem de
-- entrada não respondida como um candidato SEPARADO — se o lead manda 3
-- mensagens em sequência rápida ("Bom dia!!", "Tudo bem! E você?", "Pode
-- sim") antes de alguém responder, as 3 viravam 3 linhas candidatas
-- independentes, cada uma gerando sua PRÓPRIA sugestão de resposta "pra
-- aquela mensagem especificamente" — e como o histórico de conversa
-- (montarContexto) sempre busca as últimas N mensagens JÁ GRAVADAS no
-- banco (não só as anteriores à mensagem sendo processada), a sugestão
-- gerada pra uma mensagem do MEIO da rajada (ex: "Tudo bem! E você?")
-- ficava com histórico "do futuro" (já incluindo "Pode sim") só que sem
-- seu campo "última mensagem do lead" refletir isso — confundindo o
-- prompt e gerando respostas genéricas tipo "Como posso te ajudar?" que
-- ignoravam o "Pode sim" real.
--
-- Corrigido: agora só existe 1 candidato por LEAD por rodada — a
-- mensagem mais RECENTE ainda não classificada/sugerida. As mensagens
-- anteriores da mesma rajada continuam entrando no histórico (contexto),
-- só não geram cada uma sua própria sugestão solta.
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
        join eventos ev on ev.id = el.evento_id
        left join classificacoes_resposta_convite c on c.mensagem_origem_id = m.id
        where m.direcao = 'entrada'
          and m."pessoaIdentificador" is not null
          and m.criado_em > now() - interval '3 hours'
          and c.id is null
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
        join leads_inscricoes l on l."pessoaIdentificador" = m."pessoaIdentificador"
        left join filiais f on f.nome = l.filial
        left join sugestoes_resposta_wpp s on s.mensagem_origem_id = m.id
        where m.direcao = 'entrada'
          and m.tipo = 'texto'
          and m."pessoaIdentificador" is not null
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

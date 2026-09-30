-- RPC usada por whatsapp-reenviar-falhas — filtra por código de erro
-- DIRETO no banco (mesma lição já aprendida várias vezes neste projeto:
-- filtrar jsonb complexo via PostgREST client-side é frágil/lento; uma
-- função SQL resolve com cast/containment direto). Bug real achado
-- testando: sem isso, a Edge Function buscava as N falhas mais ANTIGAS
-- (sem olhar o código), quase nunca pegando as recentes/retriáveis reais
-- dentro do LIMIT.
create or replace function mensagens_falhas_retriaveis(p_limite int default 200)
returns table (
    id bigint,
    "pessoaIdentificador" text,
    tipo text,
    corpo_texto text,
    payload_bruto jsonb,
    wa_status_erro jsonb,
    atendente_nome text,
    tentativas_reenvio int
)
language sql
stable
as $$
    select
        m.id, m."pessoaIdentificador", m.tipo, m.corpo_texto, m.payload_bruto,
        m.wa_status_erro, m.atendente_nome, m.tentativas_reenvio
    from mensagens_whatsapp m
    where m.direcao = 'saida'
      and m.wa_status = 'falhou'
      and m.tentativas_reenvio < 5
      and m.criado_em > now() - interval '7 days'
      and m."pessoaIdentificador" is not null
      and (
        (m.wa_status_erro->0->>'code')::int in (131042, 130429, 131056)
        or (m.wa_status_erro->>'code')::int in (131042, 130429, 131056)
      )
    order by m.criado_em asc
    limit p_limite;
$$;

grant execute on function mensagens_falhas_retriaveis(int) to service_role;

-- RPC usada pela Edge Function `sugerir-resposta-whatsapp` (chamada por
-- pg_cron) pra achar mensagens candidatas a uma sugestão de resposta por
-- IA — QUALQUER lead que respondeu recentemente (não só quem tem convite
-- de evento pendente, ver mensagens_candidatas_classificacao_convite()),
-- respeitando o toggle habilitar/desabilitar por CONVERSA (override) e
-- por FILIAL (padrão) — ver migracao_sugestao_resposta_ia.sql.
--
-- Rodar manualmente: npx supabase db query --linked --file migracao_rpc_candidatas_sugestao_resposta.sql
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
    order by m.id desc
    limit p_limite;
$$;

grant execute on function mensagens_candidatas_sugestao_resposta(int) to service_role;

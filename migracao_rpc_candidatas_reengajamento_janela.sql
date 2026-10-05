-- RPC usada pela Edge Function `reengajar-janela-fechando` (pg_cron) pra
-- achar conversas onde o LEAD mandou a última mensagem há 12-24h e
-- NINGUÉM do nosso lado respondeu ainda — a janela de 24h da Meta está
-- perto de fechar sem interação nossa. Ver migracao_reengajamento_janela.sql
-- pra contexto completo (por que isso reaproveita sugestoes_resposta_wpp
-- em vez de uma tabela nova).
--
-- "Uma vez só por janela": `s.reengajamento_em is null` garante que a
-- MESMA mensagem do lead nunca é reprocessada 2x — uma vez marcada (na
-- Edge Function, sucesso OU falta de confiança, nunca em falha técnica),
-- some da lista de candidatas pra sempre, mesmo que a pessoa não
-- responda e a conversa continue "parada". Se o lead mandar uma
-- mensagem NOVA depois, é uma linha diferente (id diferente) — o
-- relógio reinicia pra ela, elegível de novo se também ficar 12h+ sem
-- resposta nossa.
--
-- Rodar manualmente: npx supabase db query --linked --file migracao_rpc_candidatas_reengajamento_janela.sql
create or replace function mensagens_candidatas_reengajamento_janela(p_limite int default 20)
returns table (
    mensagem_id bigint,
    "pessoaIdentificador" text,
    filial text
)
language sql
stable
as $$
    select
        m.id as mensagem_id,
        m."pessoaIdentificador",
        l.filial
    from mensagens_whatsapp m
    join leads_inscricoes l on l."pessoaIdentificador" = m."pessoaIdentificador"
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
    order by m.criado_em asc
    limit p_limite;
$$;

grant execute on function mensagens_candidatas_reengajamento_janela(int) to service_role;

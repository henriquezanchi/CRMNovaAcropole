-- ============================================================
-- Migração: Diagnóstico de Saúde (IA) — pedido do usuário (2026-09-21):
-- "quero que ela avalie a situação dos leads das filiais e perceba se há
-- algum erro de importação ou de sincronização antes de eu esbarrar nos
-- problemas". A DETECÇÃO em si é 100% determinística (contagens/limiares
-- em SQL/JS, mesmo princípio de "nunca inventar" já seguido no resto do
-- projeto) — a IA (Edge Function `ia-diagnostico-saude`) só transforma os
-- sinais brutos já calculados em um resumo/ação sugerida em português,
-- nunca decide os números nem o nível de severidade sozinha.
--
-- Esta tabela é o LOG dos diagnósticos já gerados (histórico, tipo
-- log_atividade) — alimentada pela Edge Function, tanto sob demanda
-- (botão "Analisar Agora") quanto automaticamente (chamada de dentro de
-- scraper/mercurio.js ao final da rodada diária).
-- ============================================================

create table if not exists diagnosticos_ia (
    id              bigint generated always as identity primary key,
    criado_em       timestamptz not null default now(),
    -- null = sinal GLOBAL (ex: sincronização do Mercúrio/Ulisses, que não
    -- é por filial — ver registrarStatusSincronizacao(), scraper/mercurio.js).
    filial          text,
    nivel           text not null check (nivel in ('ok', 'atencao', 'urgente')),
    resumo          text not null,
    acao_sugerida   text,
    -- Sinais brutos que geraram este diagnóstico (números/datas reais,
    -- nunca o texto da IA) — guardado pra auditoria, "de onde veio isso?".
    sinais          jsonb
);

create index if not exists idx_diagnosticos_ia_criado_em on diagnosticos_ia (criado_em desc);

alter table diagnosticos_ia enable row level security;

drop policy if exists "acesso publico diagnosticos_ia" on diagnosticos_ia;
create policy "acesso publico diagnosticos_ia"
    on diagnosticos_ia for all
    using (true)
    with check (true);

-- ------------------------------------------------------------
-- RPC 1: total de leads x quantos têm a tag Ativo/Inativo, por filial —
-- sinal de "o Mercúrio alguma vez importou com sucesso pra esta filial?"
-- Mesma técnica de cast jsonb de leads_ativos_inativos_da_filial()
-- (migracao_rpc_leads_ativos_inativos.sql) — só que aqui é uma CONTAGEM
-- (não as linhas inteiras), bem mais leve pra rodar em toda filial de
-- uma vez.
-- ------------------------------------------------------------
create or replace function contagem_status_mercurio_por_filial()
returns table (filial text, total_leads bigint, total_ativo_inativo bigint)
language sql
stable
as $$
    select
        filial,
        count(*) as total_leads,
        count(*) filter (
            where (tags #>> '{}')::jsonb @> '["Ativo"]'::jsonb
               or (tags #>> '{}')::jsonb @> '["Inativo"]'::jsonb
        ) as total_ativo_inativo
    from leads_inscricoes
    where lixeira_em is null
    group by filial;
$$;

grant execute on function contagem_status_mercurio_por_filial() to anon, authenticated;

-- ------------------------------------------------------------
-- RPC 2: eventos nos próximos 10 dias sem NENHUM inscrito com
-- origem='ulisses' (ver migracao_evento_leads_origem.sql) — sinal de que
-- a sincronização de Inscrições (API do Ulisses) pode não estar
-- alimentando aquele evento/filial.
-- ------------------------------------------------------------
create or replace function eventos_proximos_sem_inscricao_ulisses()
returns table (evento_id bigint, filial text, nome text, data date)
language sql
stable
as $$
    select e.id as evento_id, e.filial, e.nome, e.data
    from eventos e
    left join evento_leads el on el.evento_id = e.id and el.origem = 'ulisses'
    where e.ativo = true
      and e.data between current_date and current_date + interval '10 days'
    group by e.id, e.filial, e.nome, e.data
    having count(el.id) = 0;
$$;

grant execute on function eventos_proximos_sem_inscricao_ulisses() to anon, authenticated;

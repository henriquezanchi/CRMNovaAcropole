-- Migração: tabela ia_uso_tokens — log de uso real da Anthropic API
--
-- Pedido do usuário (2026-10-01): "o custo da api está mais alto... o
-- que estamos usando que está gastando tanta api do claude?" — hoje não
-- tínhamos NENHUMA visibilidade real de quantos tokens cada function
-- gasta (só dava pra estimar pelo tamanho do texto do prompt). Esta
-- tabela grava 1 linha por chamada real à Anthropic, com os números
-- EXATOS que a própria API devolve (usage.input_tokens/output_tokens/
-- cache_creation_input_tokens/cache_read_input_tokens) — a partir de
-- agora dá pra consultar, por function e por dia, quanto cada uma
-- realmente custa, e confirmar se o cache de prompt (ver
-- _shared/anthropic.ts) está sendo aproveitado de verdade.
--
-- RLS pública de sempre (mesmo padrão do resto do projeto) — é só um log
-- de uso, não tem dado sensível nenhum.
create table if not exists ia_uso_tokens (
    id bigint generated always as identity primary key,
    criado_em timestamptz not null default now(),
    function_name text not null,
    modelo text not null,
    input_tokens int not null default 0,
    output_tokens int not null default 0,
    cache_creation_input_tokens int not null default 0,
    cache_read_input_tokens int not null default 0
);

alter table ia_uso_tokens enable row level security;
drop policy if exists "ia_uso_tokens select" on ia_uso_tokens;
create policy "ia_uso_tokens select" on ia_uso_tokens for select using (true);
drop policy if exists "ia_uso_tokens insert" on ia_uso_tokens;
create policy "ia_uso_tokens insert" on ia_uso_tokens for insert with check (true);

create index if not exists idx_ia_uso_tokens_function_dia on ia_uso_tokens (function_name, criado_em);

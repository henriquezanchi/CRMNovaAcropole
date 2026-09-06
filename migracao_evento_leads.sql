-- ============================================================
-- Migração: associação evento <-> lead (quem está sendo trabalhado
-- pra cada evento, como respondeu ao convite, se compareceu)
-- Rodar manualmente no SQL Editor do Supabase, depois de
-- migracao_eventos.sql já ter rodado (esta tabela referencia "eventos").
-- ============================================================

create table if not exists evento_leads (
    id                    bigserial primary key,
    evento_id             bigint not null references eventos(id) on delete cascade,
    "pessoaIdentificador" text not null,
    resposta_convite      text not null default 'pendente'
                              check (resposta_convite in ('pendente','confirmado','recusado')),
    compareceu            boolean,               -- null = ainda não se sabe (evento não aconteceu, ou não registrado)
    nota                  text,
    criado_em             timestamptz not null default now(),
    atualizado_em         timestamptz not null default now(),
    unique (evento_id, "pessoaIdentificador")     -- mesmo lead não entra duas vezes no mesmo evento
);

create index if not exists idx_evento_leads_evento
    on evento_leads (evento_id);

create index if not exists idx_evento_leads_pessoa
    on evento_leads ("pessoaIdentificador");

-- Mesmo modelo de acesso do resto do app (chave publishable/anon lê e
-- escreve direto, sem login) — igual eventos/tipos_evento/tags_sugeridas.
alter table evento_leads enable row level security;

drop policy if exists "acesso publico evento_leads" on evento_leads;
create policy "acesso publico evento_leads"
    on evento_leads for all
    using (true)
    with check (true);

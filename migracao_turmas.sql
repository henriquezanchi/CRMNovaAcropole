-- ============================================================
-- Migração: tabela turmas — "Mapa de Turmas" (nova aba do CRM)
-- Rodar manualmente no SQL Editor do Supabase.
--
-- Guarda nome/dia/horário de cada turma por filial, sincronizado
-- automaticamente pelo scraper do Mercúrio (processarMatriculasRecentesTurmas()
-- em scraper/mercurio.js já visita cada turma pra procurar matrícula
-- recente — de brinde, também grava aqui o dia/horário de TODAS, tenham
-- matrícula nova ou não). Base do mapa visual (dia x horário, estilo
-- agenda semanal) que mostra horários livres pra novas turmas.
-- ============================================================

create table if not exists turmas (
    id            bigserial primary key,
    filial        text not null,
    nome          text not null,
    dia           text,
    horario       text,
    ativo         boolean not null default true,
    atualizado_em timestamptz not null default now(),
    unique (filial, nome)
);

create index if not exists idx_turmas_filial on turmas (filial);

-- Mesmo modelo de acesso do resto do app (chave publishable lê e escreve
-- direto, sem login) — igual eventos/tipos_evento/filiais.
alter table turmas enable row level security;

drop policy if exists "acesso publico turmas" on turmas;
create policy "acesso publico turmas"
    on turmas for all
    using (true)
    with check (true);

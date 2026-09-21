-- ============================================================
-- Migração: Equipes (Agência/Voluntários) — base do sistema de Tarefas
-- (ver migracao_tarefas.sql, rodar depois desta). Rodar manualmente no
-- SQL Editor do Supabase, ou via `supabase db query --linked --file`.
--
-- Pedido do usuário (2026-09-21): responsável de uma tarefa pode ser um
-- usuário OU uma equipe. Duas equipes de início — "Agência" (o time do
-- próprio usuário, atravessa qualquer filial) e "Voluntários" (cada
-- escola cadastra os próprios, via login NOMINAL completo — decisão
-- confirmada com o usuário: mesmo modelo de usuarios_crm de hoje, não um
-- cadastro mais leve sem senha). Editável em "Gerenciar Equipes"
-- (js/tarefas.js) — não fica hardcoded no código, mesmo padrão de
-- tags_sugeridas/tipos_evento (lista pequena, mas sem migração nova se
-- amanhã precisar de uma 3ª equipe).
-- ============================================================

create table if not exists equipes (
    id    bigint generated always as identity primary key,
    nome  text not null unique,
    ordem integer not null default 0
);

alter table equipes enable row level security;

-- Mesmo modelo de acesso público do resto do app (chave publishable
-- lê/escreve direto, sem login) — igual filiais/tags_sugeridas/tipos_evento.
drop policy if exists "acesso publico equipes" on equipes;
create policy "acesso publico equipes"
    on equipes for all
    using (true)
    with check (true);

insert into equipes (nome, ordem) values ('Agência', 0), ('Voluntários', 1)
on conflict (nome) do nothing;

-- Cada usuário (usuarios_crm) pode pertencer a 1 equipe — nullable, já
-- que nem todo usuário precisa estar numa equipe pra logar/usar o CRM
-- (comportamento de hoje continua funcionando sem isso preenchido).
alter table usuarios_crm add column if not exists equipe_id bigint references equipes(id) on delete set null;

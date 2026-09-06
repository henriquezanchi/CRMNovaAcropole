-- ============================================================
-- Migração: Agenda de Eventos (atividades/capacidade por filial)
-- Rodar manualmente no SQL Editor do Supabase (mesmo fluxo das migrações
-- anteriores). Tabela compartilhada (mesmo modelo de "filiais" e
-- "tags_sugeridas") — MVP de cadastro manual, sem integração com o site
-- institucional nem com o Ulisses (nenhum dos dois tem API externa
-- conhecida). "Confirmados" (quantos leads já vieram nesse evento) NÃO é
-- uma coluna aqui — é calculado no navegador cruzando historico_eventos
-- de leads_inscricoes, ver contarConfirmadosEvento() em js/eventos.js.
-- ============================================================

create table if not exists eventos (
    id          bigint generated always as identity primary key,
    filial      text not null,
    nome        text not null,
    tipo        text,
    data        date not null,
    hora        time,
    ingresso    text,
    capacidade  int,
    ativo       boolean not null default true,
    criado_em   timestamptz not null default now()
);

alter table eventos enable row level security;

-- Leitura e escrita públicas — mesmo modelo de acesso do resto do app
-- (chave publishable, sem login).
drop policy if exists "acesso publico eventos" on eventos;
create policy "acesso publico eventos"
    on eventos for all
    using (true)
    with check (true);

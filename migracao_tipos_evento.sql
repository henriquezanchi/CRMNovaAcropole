-- ============================================================
-- Migração: catálogo de tipos de evento (editável, Agenda de Eventos)
-- Rodar manualmente no SQL Editor do Supabase (mesmo fluxo das migrações
-- anteriores, depois de migracao_eventos.sql). Antes o <select> de tipo do
-- modal "Novo Evento" era uma lista fixa no HTML — virou uma tabela pra
-- dar pra editar/renomear/reordenar pelo próprio CRM ("Gerenciar Tipos"),
-- mesmo padrão de tags_sugeridas.
--
-- É um catálogo GLOBAL (compartilhado entre todas as filiais), não uma
-- coluna de eventos.tipo — renomear um tipo aqui não muda retroativamente
-- o texto já gravado em eventos já cadastrados (mesma lógica de
-- tags_sugeridas: o texto fica congelado no momento do cadastro).
-- ============================================================

create table if not exists tipos_evento (
    id     bigint generated always as identity primary key,
    nome   text not null unique,
    ordem  int not null default 0
);

insert into tipos_evento (nome, ordem) values
    ('Palestra', 0),
    ('Workshop', 1),
    ('Oficina', 2),
    ('Curso', 3),
    ('Aula Inaugural', 4),
    ('Leitura Comentada', 5),
    ('Filosofilme', 6),
    ('Café Cultural', 7),
    ('Abertura de Turma', 8),
    ('Outro', 9)
on conflict (nome) do nothing;

alter table tipos_evento enable row level security;

drop policy if exists "acesso publico tipos_evento" on tipos_evento;
create policy "acesso publico tipos_evento"
    on tipos_evento for all
    using (true)
    with check (true);

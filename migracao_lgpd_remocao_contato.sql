-- Remoção de contato a pedido do lead (LGPD) — pedido do usuário
-- (2026-09-17). Duas tabelas novas:
--
-- 1) contatos_removidos_lgpd: quem já pediu remoção, por filial. Consultada
--    por confirmarEnviarImportacao() (js/importador.js) ANTES de enviar
--    qualquer lead ao Supabase — quem bate aqui é pulado, pra nunca voltar
--    sozinho numa reimportação futura do Ulisses/Mercúrio.
-- 2) fila_desativacao_ulisses: tarefa pendente pra desativar o MESMO
--    contato no Ulisses (tela #/telemarketing, "Desativar contato") — não
--    é feita na hora (Ulisses só aceita automação assistida, ver
--    scraper/ulisses-local.js), é processada sozinha na próxima rodada
--    semanal do scraper daquela filial.
--
-- Mesmo padrão de acesso público (RLS `using(true) with check(true)`) do
-- resto do projeto — nenhuma das duas guarda senha/dado sensível de
-- terceiro (diferente de credenciais_scraper).

create table if not exists contatos_removidos_lgpd (
    id bigint generated always as identity primary key,
    criado_em timestamptz not null default now(),
    filial text not null,
    nome text not null,
    nome_normalizado text not null,
    telefone_normalizado text,
    email_normalizado text,
    motivo text,
    removido_por text
);
alter table contatos_removidos_lgpd enable row level security;
drop policy if exists "acesso publico contatos_removidos_lgpd" on contatos_removidos_lgpd;
create policy "acesso publico contatos_removidos_lgpd" on contatos_removidos_lgpd for all using (true) with check (true);
create index if not exists idx_contatos_removidos_lgpd_filial_nome on contatos_removidos_lgpd (filial, nome_normalizado);
create index if not exists idx_contatos_removidos_lgpd_filial_tel on contatos_removidos_lgpd (filial, telefone_normalizado);

create table if not exists fila_desativacao_ulisses (
    id bigint generated always as identity primary key,
    criado_em timestamptz not null default now(),
    processado_em timestamptz,
    filial text not null,
    nome text not null,
    telefone_busca text,
    status text not null default 'pendente', -- pendente | concluida | nao_encontrado | ambiguo | falha
    observacao text
);
alter table fila_desativacao_ulisses enable row level security;
drop policy if exists "acesso publico fila_desativacao_ulisses" on fila_desativacao_ulisses;
create policy "acesso publico fila_desativacao_ulisses" on fila_desativacao_ulisses for all using (true) with check (true);
create index if not exists idx_fila_desativacao_ulisses_filial_status on fila_desativacao_ulisses (filial, status);

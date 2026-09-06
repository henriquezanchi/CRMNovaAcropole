-- ============================================================
-- Migração: "Leads a Tratar" (antes "Possíveis Duplicados")
-- Rodar manualmente no SQL Editor do Supabase. Renomeia a tabela
-- duplicados_leads pra leads_a_tratar (se você já rodou
-- migracao_duplicados.sql antes) — a aba deixou de ser só sobre
-- duplicados: agora também lista leads sem telefone (3º critério,
-- `criterio = 'sem_telefone'`), substituindo a antiga coluna "Sem
-- Whatsapp" do Kanban como destino desses leads.
--
-- Se você NUNCA rodou migracao_duplicados.sql, este script cria a tabela
-- já com o nome novo, então pode rodar direto sem se preocupar com a
-- ordem.
-- ============================================================

do $$
begin
    if exists (select 1 from information_schema.tables where table_name = 'duplicados_leads') then
        alter table duplicados_leads rename to leads_a_tratar;
    end if;
end $$;

create table if not exists leads_a_tratar (
    id               bigint generated always as identity primary key,
    filial           text not null,
    grupo            text not null,   -- chave que agrupa os membros (ex: "tel:6299998888", "nome:MARIA:3" ou "semtel:123456")
    criterio         text not null,   -- 'telefone' | 'nome' | 'sem_telefone'
    pessoa_id        text not null,
    pessoa_nome      text,
    pessoa_telefone  text,
    detectado_em     timestamptz not null default now()
);

create index if not exists idx_leads_a_tratar_filial on leads_a_tratar(filial);

alter table leads_a_tratar enable row level security;

drop policy if exists "acesso publico duplicados_leads" on leads_a_tratar;
drop policy if exists "acesso publico leads_a_tratar" on leads_a_tratar;
create policy "acesso publico leads_a_tratar"
    on leads_a_tratar for all
    using (true)
    with check (true);

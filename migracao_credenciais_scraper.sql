-- ============================================================
-- Migração: Cofre de credenciais do scraper (Ulisses/Mercúrio) + log de
-- sincronização automática. Rodar manualmente no SQL Editor do Supabase.
--
-- IMPORTANTE — ÚNICA tabela deste projeto que NÃO segue o padrão "acesso
-- público" do resto do app: aqui guardamos senha de sistemas de
-- terceiros (Ulisses de cada filial, Mercúrio), então credenciais_scraper
-- fica com RLS ligado e SEM NENHUMA policy — isso nega acesso a
-- anon/authenticated por padrão no Postgres; só o service_role (usado
-- pelas Edge Functions e pelo futuro job de scraping, nunca pela chave
-- publishable do navegador) consegue ler ou escrever nela.
--
-- A senha nunca é gravada em texto puro — pgp_sym_encrypt() cifra com uma
-- chave que só existe como secret da Edge Function (CREDENCIAIS_SCRAPER_CHAVE,
-- setar com `supabase secrets set`, nunca no código). O frontend só ESCREVE
-- (via Edge Function gerenciar-credenciais) e nunca lê a senha de volta —
-- a view status_credenciais_scraper abaixo mostra só "configurado em
-- DD/MM", sem expor o valor cifrado nem decifrado.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists credenciais_scraper (
    id            bigint generated always as identity primary key,
    sistema       text not null check (sistema in ('ulisses', 'mercurio')),
    filial        text not null default 'GLOBAL', -- 'GLOBAL' pro Mercúrio (1 senha só, compartilhada); nome real da filial pro Ulisses
    usuario       text,
    senha_cifrada bytea not null,
    atualizado_em timestamptz not null default now(),
    unique (sistema, filial)
);

alter table credenciais_scraper enable row level security;
-- Sem "create policy" aqui — de propósito, ver comentário acima.

-- View pública só com metadados (nunca a senha) — pra tela de
-- configuração no CRM mostrar "já configurado / desde quando" sem
-- precisar de acesso privilegiado.
create or replace view status_credenciais_scraper as
    select sistema, filial, usuario, atualizado_em
    from credenciais_scraper;

-- Função que faz a cifragem — SECURITY DEFINER pra rodar com o dono da
-- função (não com o role de quem chama), mas o EXECUTE fica restrito ao
-- service_role, então só a Edge Function gerenciar-credenciais consegue
-- chamar (nunca o navegador direto).
create or replace function salvar_credencial_scraper(p_sistema text, p_filial text, p_usuario text, p_senha text, p_chave text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into credenciais_scraper (sistema, filial, usuario, senha_cifrada, atualizado_em)
    values (p_sistema, coalesce(p_filial, 'GLOBAL'), p_usuario, pgp_sym_encrypt(p_senha, p_chave), now())
    on conflict (sistema, filial) do update
        set usuario = excluded.usuario, senha_cifrada = excluded.senha_cifrada, atualizado_em = now();
end;
$$;

revoke all on function salvar_credencial_scraper(text, text, text, text, text) from public;
grant execute on function salvar_credencial_scraper(text, text, text, text, text) to service_role;

-- ============================================================
-- Log de sincronização automática — cada tentativa do futuro job de
-- scraping grava 1 linha aqui (sucesso ou falha). Alimenta o alerta
-- "sincronização travada" na Central de Notificações (js/notificacoes.js)
-- — segue o padrão público de acesso do resto do app (não é sensível,
-- só timestamps/mensagens de status).
-- ============================================================

create table if not exists status_sincronizacao_automatica (
    id            bigint generated always as identity primary key,
    sistema       text not null check (sistema in ('ulisses', 'mercurio')),
    filial        text not null default 'GLOBAL',
    sucesso       boolean not null,
    mensagem      text,
    executado_em  timestamptz not null default now()
);

create index if not exists idx_status_sync_sistema_filial_executado
    on status_sincronizacao_automatica (sistema, filial, executado_em desc);

alter table status_sincronizacao_automatica enable row level security;

drop policy if exists "acesso publico status_sincronizacao_automatica" on status_sincronizacao_automatica;
create policy "acesso publico status_sincronizacao_automatica"
    on status_sincronizacao_automatica for all
    using (true)
    with check (true);

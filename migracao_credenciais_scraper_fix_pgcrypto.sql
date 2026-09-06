-- ============================================================
-- Correção: "function pgp_sym_encrypt(text, text) does not exist"
-- Rodar manualmente no SQL Editor do Supabase, depois de
-- migracao_credenciais_scraper.sql e migracao_credenciais_scraper_leitura.sql.
--
-- Causa: no Supabase, a extensão pgcrypto é instalada no schema
-- "extensions", não no "public" (diferente de um Postgres genérico).
-- As duas funções (salvar_credencial_scraper/ler_credencial_scraper)
-- fixavam o search_path só em "public" por segurança (evita um ataque de
-- search_path em função SECURITY DEFINER), sem incluir "extensions" —
-- por isso pgp_sym_encrypt()/pgp_sym_decrypt() não eram encontradas.
-- Este script recria as duas funções com o search_path corrigido; o
-- resto (tabela, view, permissões) continua igual, não precisa recriar.
-- ============================================================

create or replace function salvar_credencial_scraper(p_sistema text, p_filial text, p_usuario text, p_senha text, p_chave text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    insert into credenciais_scraper (sistema, filial, usuario, senha_cifrada, atualizado_em)
    values (p_sistema, coalesce(p_filial, 'GLOBAL'), p_usuario, pgp_sym_encrypt(p_senha, p_chave), now())
    on conflict (sistema, filial) do update
        set usuario = excluded.usuario, senha_cifrada = excluded.senha_cifrada, atualizado_em = now();
end;
$$;

create or replace function ler_credencial_scraper(p_sistema text, p_filial text, p_chave text)
returns table(usuario text, senha text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    return query
        select c.usuario, pgp_sym_decrypt(c.senha_cifrada, p_chave)
        from credenciais_scraper c
        where c.sistema = p_sistema and c.filial = coalesce(p_filial, 'GLOBAL');
end;
$$;

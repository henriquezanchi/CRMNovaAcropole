-- ============================================================
-- Correção v2: "function pgp_sym_encrypt(text, text) does not exist"
-- ainda persistindo mesmo depois de migracao_credenciais_scraper_fix_pgcrypto.sql.
-- Rodar manualmente no SQL Editor do Supabase — pode rodar mesmo se a v1
-- nunca rodou, ela substitui a v1 por completo.
--
-- Em vez de confiar no search_path (frágil — depende de onde exatamente
-- o pgcrypto foi instalado neste projeto), esta versão referencia o
-- schema "extensions" DIRETO no nome da função
-- (extensions.pgp_sym_encrypt), que é onde o Supabase instala pgcrypto
-- por padrão. Também garante que a extensão está instalada nesse schema.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

create or replace function salvar_credencial_scraper(p_sistema text, p_filial text, p_usuario text, p_senha text, p_chave text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into credenciais_scraper (sistema, filial, usuario, senha_cifrada, atualizado_em)
    values (p_sistema, coalesce(p_filial, 'GLOBAL'), p_usuario, extensions.pgp_sym_encrypt(p_senha, p_chave), now())
    on conflict (sistema, filial) do update
        set usuario = excluded.usuario, senha_cifrada = excluded.senha_cifrada, atualizado_em = now();
end;
$$;

create or replace function ler_credencial_scraper(p_sistema text, p_filial text, p_chave text)
returns table(usuario text, senha text)
language plpgsql
security definer
set search_path = public
as $$
begin
    return query
        select c.usuario, extensions.pgp_sym_decrypt(c.senha_cifrada, p_chave)
        from credenciais_scraper c
        where c.sistema = p_sistema and c.filial = coalesce(p_filial, 'GLOBAL');
end;
$$;

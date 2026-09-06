-- ============================================================
-- Migração: leitura (decifragem) de credenciais do scraper.
-- Rodar manualmente no SQL Editor do Supabase, DEPOIS de
-- migracao_credenciais_scraper.sql.
--
-- A migração anterior só criava o caminho de ESCRITA (salvar_credencial_scraper,
-- chamada pela Edge Function gerenciar-credenciais a partir do CRM). Esta
-- adiciona o caminho de LEITURA, usado pelo job de scraping (GitHub
-- Actions, pasta scraper/ na raiz do projeto) — ele roda com a
-- SUPABASE_SERVICE_ROLE_KEY (nunca a chave publishable), então tem
-- permissão de chamar esta função mesmo com RLS negando tudo por padrão
-- em credenciais_scraper.
--
-- IMPORTANTE: ler_credencial_scraper() devolve a senha em TEXTO PURO —
-- só deve ser chamada pelo job de scraping (service_role), NUNCA por uma
-- Edge Function exposta ao navegador. Não criar uma rota HTTP pública que
-- chame esta função.
-- ============================================================

create or replace function ler_credencial_scraper(p_sistema text, p_filial text, p_chave text)
returns table(usuario text, senha text)
language plpgsql
security definer
set search_path = public
as $$
begin
    return query
        select c.usuario, pgp_sym_decrypt(c.senha_cifrada, p_chave)
        from credenciais_scraper c
        where c.sistema = p_sistema and c.filial = coalesce(p_filial, 'GLOBAL');
end;
$$;

revoke all on function ler_credencial_scraper(text, text, text) from public;
grant execute on function ler_credencial_scraper(text, text, text) to service_role;

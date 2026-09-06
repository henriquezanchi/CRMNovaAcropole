-- ============================================================
-- Migração: credencial extra do Mercúrio (autenticação HTTP básica)
-- Rodar manualmente no SQL Editor do Supabase, depois de
-- migracao_credenciais_scraper.sql.
--
-- Descoberto testando o scraper: o Mercúrio tem uma camada de login
-- ANTES da tela de Matrícula/Senha — uma autenticação HTTP básica do
-- navegador (aquela caixinha cinza nativa), com uma credencial ÚNICA
-- compartilhada por TODOS os usuários, que muda uma vez por ano. Como já
-- fica salva no navegador de quem usa no dia a dia, não aparece na tela
-- — mas o Playwright (sessão nova, sem nada salvo) precisa dela.
--
-- Novo valor permitido pra "sistema": 'mercurio_http' (guardado com
-- filial='GLOBAL', igual o 'mercurio' normal — usuario/senha são os da
-- caixinha de autenticação, não a Matrícula/Senha do site em si).
-- ============================================================

alter table credenciais_scraper drop constraint if exists credenciais_scraper_sistema_check;
alter table credenciais_scraper add constraint credenciais_scraper_sistema_check
    check (sistema in ('ulisses', 'mercurio', 'mercurio_http'));

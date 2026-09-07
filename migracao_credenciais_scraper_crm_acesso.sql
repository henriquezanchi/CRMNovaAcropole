-- ============================================================
-- Migração: credencial extra — senha do PORTÃO DE ACESSO do próprio CRM
-- publicado (js/acesso.js). Rodar manualmente no SQL Editor do Supabase,
-- depois de migracao_credenciais_scraper.sql.
--
-- Marco 3 do scraper: em vez de reimplementar em Node a lógica de
-- cruzamento/tags/Lead Forte que já existe em js/importador.js, o
-- Playwright abre o CRM PUBLICADO e pilota a tela de Importar como um
-- usuário faria (scraper/importar-no-crm.js) — pra isso, precisa passar
-- pelo portão de senha (sessão nova do navegador, sem nada salvo em
-- localStorage ainda).
--
-- Novo valor permitido pra "sistema": 'crm_acesso' (guardado com
-- filial='GLOBAL' — é 1 senha só, compartilhada pelo time inteiro, igual
-- 'mercurio'/'mercurio_http'; "usuario" não se aplica aqui, salvar como
-- '-' ou qualquer texto — só a senha importa).
-- ============================================================

alter table credenciais_scraper drop constraint if exists credenciais_scraper_sistema_check;
alter table credenciais_scraper add constraint credenciais_scraper_sistema_check
    check (sistema in ('ulisses', 'mercurio', 'mercurio_http', 'crm_acesso'));

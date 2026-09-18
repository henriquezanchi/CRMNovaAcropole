-- ============================================================
-- Migração: credencial da API oficial do Ulisses (OAuth2 Client
-- Credentials, via Auth0) — Rodar manualmente no SQL Editor do Supabase,
-- depois de migracao_credenciais_scraper.sql.
--
-- Contexto (2026-09-18): a Acrópole Brasil (Célio) confirmou que existe
-- uma API REST oficial (https://api.acropolebrasil.com.br/, documentada
-- em /v3/api-docs) por trás do Ulisses, com autenticação machine-to-
-- machine via Auth0 (tenant acropolebrasil.us.auth0.com,
-- grant_type=client_credentials) — em vez de reaproveitar o navegador
-- automatizado (Playwright, sempre sujeito ao Cloudflare e a login
-- manual), o objetivo é chamar essa API direto.
--
-- 1 client_id/client_secret só, compartilhado (não é por filial — é 1
-- aplicação M2M cadastrada no Auth0 deles), por isso filial='GLOBAL',
-- mesmo padrão de 'mercurio'/'mercurio_http'/'crm_acesso'. Guardado como
-- usuario=client_id, senha_cifrada=client_secret (cifrado, mesmo pgcrypto
-- de sempre) — client_secret é, na prática, uma senha.
--
-- IMPORTANTE: até o momento desta migração, o client ainda NÃO tem
-- nenhum scope/permission autorizado do lado da Acrópole Brasil — o
-- token é emitido normalmente mas só acessa os endpoints públicos da API
-- (/tiposEvento, /proximosEventos, /evento/{id}, /eventos/{filialId}).
-- Os endpoints que a integração de verdade precisa (csvInscricoes,
-- participantes, compareceu, filiaisAtivas, filial, listarTodosEventos)
-- retornam 401 até o Célio autorizar esse client pra essas permissões no
-- painel do Auth0 (ver CLAUDE.md, seção "API oficial do Ulisses").
-- ============================================================

alter table credenciais_scraper drop constraint if exists credenciais_scraper_sistema_check;
alter table credenciais_scraper add constraint credenciais_scraper_sistema_check
    check (sistema in ('ulisses', 'mercurio', 'mercurio_http', 'crm_acesso', 'ulisses_api'));

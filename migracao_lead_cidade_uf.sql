-- Cidade/UF (residência) + telefone alternativo, capturados pelo scraper
-- do Mercúrio na página "ENDEREÇOS" da ficha do aluno (só no Modo
-- Completo — ver scraper/mercurio.js) — antes não existia lugar nenhum
-- pra guardar esses 3 dados no CRM.
alter table leads_inscricoes add column if not exists cidade text;
alter table leads_inscricoes add column if not exists uf text;
alter table leads_inscricoes add column if not exists telefone_alternativo text;

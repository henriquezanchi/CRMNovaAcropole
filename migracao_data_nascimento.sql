-- ============================================================
-- Migração: Data de Nascimento (Aniversariantes do Mês)
-- Rodar manualmente no SQL Editor do Supabase.
--
-- Coluna nova em leads_inscricoes: data_nascimento (date, nullable).
-- Nenhuma das 3 planilhas atuais (Ativos/Inativos/Inscrições) traz essa
-- informação, então por enquanto é preenchida manualmente na gaveta do
-- lead (bloco "Contato") — fica pronta pra ser alimentada automaticamente
-- no futuro, se o scraper do Mercúrio (ver CLAUDE.md, seção "Scraper
-- Ulisses/Mercúrio") conseguir extrair essa data da tela de CADASTRO.
-- ============================================================

alter table leads_inscricoes add column if not exists data_nascimento date;

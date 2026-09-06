-- ============================================================
-- Migração: coluna motivo_saida em leads_inscricoes
-- Guarda o motivo de saída (coluna "Motivo" da planilha de Inativos) pra
-- ex-alunos, exibido na gaveta do lead. Rodar manualmente no SQL Editor
-- do Supabase (mesmo fluxo das migrações anteriores).
-- ============================================================

alter table leads_inscricoes add column if not exists motivo_saida text;

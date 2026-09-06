-- ============================================================
-- Migração: data da baixa (saída) do ex-aluno
-- Rodar manualmente no SQL Editor do Supabase (mesmo fluxo das migrações
-- anteriores). Adiciona a coluna data_saida em leads_inscricoes, vinda da
-- coluna "Data" da planilha de Inativos — guardada como texto (mesmo
-- padrão de motivo_saida e eventoData), sem tentar validar/converter o
-- formato de data que vier da planilha.
-- ============================================================

alter table leads_inscricoes add column if not exists data_saida text;

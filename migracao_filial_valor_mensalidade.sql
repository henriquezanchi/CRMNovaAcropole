-- ============================================================
-- Migração: coluna valor_mensalidade em filiais
-- Rodar manualmente no SQL Editor do Supabase.
--
-- Valor da contribuição/mensalidade cobrada pela filial (em reais) —
-- editável em "Gerenciar Filiais". Base do cálculo de receita e comissão
-- de SDR no relatório "Matrículas por Mês" (aba Relatórios): receita do
-- mês = matrículas x valor_mensalidade; comissão do SDR = 30% disso
-- (comissão só sobre a contribuição do 1º mês de cada matrícula nova).
-- Nullable: sem valor configurado, o relatório mostra a contagem de
-- matrículas normalmente, só sem a seção de receita/comissão.
-- ============================================================

alter table filiais add column if not exists valor_mensalidade numeric(10,2);

-- ============================================================
-- Migração: data de matrícula por lead (leads_inscricoes)
-- Rodar manualmente no SQL Editor do Supabase.
--
-- Alimentada por dois caminhos: (1) marcar "Matriculado: Sim" num
-- participante de evento (js/eventos.js, efetivarMatriculasEmMassa() —
-- grava a data de hoje, só se o lead ainda não tiver uma) e (2) a
-- importação de matrícula (js/matricula-importar.js, texto colado da tela
-- do Mercúrio — grava a data exata que aparece na coluna "Ingresso").
-- Usada nos Relatórios pra medir matrículas por período.
-- ============================================================

alter table leads_inscricoes add column if not exists data_matricula date;

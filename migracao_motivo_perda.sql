-- ============================================================
-- Migração: Motivos de Perda (loss reasons)
-- Rodar manualmente no SQL Editor do Supabase.
--
-- Colunas novas em leads_inscricoes, mesmo espírito de motivo_saida/
-- data_saida (ex-aluno inativo), só que pro lado de quem NUNCA chegou a
-- matricular: motivo_perda (texto, um dos valores de MOTIVOS_PERDA em
-- js/app.js — Preço/Horário/Distância/Sem Retorno/Não se Interessou
-- Mais/Já Matriculado em Outro Lugar/Outro — opcionalmente com uma
-- observação livre anexada) e data_perda (date, dia em que foi marcado).
--
-- Preenchidas por registrarMotivoPerda() (js/app.js), disparada
-- automaticamente sempre que um lead é movido pra uma coluna cujo nome
-- contém "perdid" ou "lixeira" (ehColunaPerdido() — mesma heurística por
-- substring já usada pra achar Matriculados/Ativos/Recontato); o card só
-- se move de fato depois que o modal de motivo é confirmado.
-- ============================================================

alter table leads_inscricoes add column if not exists motivo_perda text;
alter table leads_inscricoes add column if not exists data_perda date;

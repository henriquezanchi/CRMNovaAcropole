-- ============================================================
-- Migração: SLA de atendimento (borda vermelha em lead frio esquecido)
-- Rodar manualmente no SQL Editor do Supabase.
--
-- Coluna nova em leads_inscricoes: funil_agencia_atualizado_em (quando o
-- lead entrou na coluna ATUAL do Kanban). Gravada por moverLeadsParaColuna()
-- (js/app.js) toda vez que um lead muda de coluna — arrastando, pelo botão
-- "Mover" da seleção em massa, pela efetivação de matrícula, etc. Leads
-- recém-importados ganham o valor padrão (now()) na hora do insert; leads
-- já existentes preservam o valor atual num reimport (a importação nunca
-- inclui esse campo no payload de upsert, então o Postgres não mexe nele
-- em cima de uma linha que já existe).
--
-- Usada só pela PRIMEIRA coluna do funil (a "fria", ainda não abordada):
-- se um lead está lá há mais de SLA_HORAS_COLUNA_FRIA (js/app.js, hoje 2h)
-- desde a última troca de coluna, o card ganha borda vermelha no Kanban —
-- pra chamar atenção de longe antes que o lead esfrie de vez.
-- ============================================================

alter table leads_inscricoes add column if not exists funil_agencia_atualizado_em timestamptz default now();

-- Leads que já existem antes desta migração não têm como saber a data real
-- de entrada na coluna atual — usamos "agora" como ponto de partida (fica
-- sem SLA vencido no dia em que a migração roda, e passa a contar dali).
update leads_inscricoes set funil_agencia_atualizado_em = now() where funil_agencia_atualizado_em is null;

-- ============================================================
-- Migração: data limite de inscrição por evento (Agenda de Eventos)
-- Rodar manualmente no SQL Editor do Supabase, depois de
-- migracao_eventos.sql já ter rodado.
--
-- Pensado pra eventos como "Abertura de Turma": a turma dura cerca de 6
-- meses a partir da data do evento, então não faz sentido o evento virar
-- "passado" (sumir da lista padrão da Agenda, ficar indisponível pra
-- convidar leads na gaveta) no dia seguinte à data marcada — só depois
-- dessa data limite, que fica em branco pra qualquer evento comum
-- (nesse caso o critério de "passado" continua sendo a própria data).
-- ============================================================

alter table eventos add column if not exists data_limite_inscricao date;

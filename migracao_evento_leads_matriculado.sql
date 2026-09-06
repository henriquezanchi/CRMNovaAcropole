-- ============================================================
-- Migração: coluna "matriculado" em evento_leads
-- Rodar manualmente no SQL Editor do Supabase, depois de
-- migracao_evento_leads.sql já ter rodado.
--
-- Terceira dimensão de acompanhamento de um participante de evento, além
-- de resposta_convite (RSVP) e compareceu (presença): marcar "Matriculado:
-- Sim" no modal de Participantes (js/eventos.js) não é só informativo — a
-- própria tela já move o lead pra coluna de Matriculados e registra
-- data_matricula, ver efetivarMatriculasEmMassa() em js/eventos.js.
-- ============================================================

alter table evento_leads add column if not exists matriculado boolean;

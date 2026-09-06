-- ============================================================
-- Migração: lembrete de follow-up por lead (snooze)
-- Rodar manualmente no SQL Editor do Supabase (mesmo fluxo das migrações
-- anteriores). Adiciona 2 colunas em leads_inscricoes: a data em que o
-- time deve voltar a falar com o lead e uma nota curta opcional.
--
-- Sem tabela separada de propósito: é um único lembrete ATIVO por lead,
-- não um histórico de vários lembretes. Se no futuro for preciso guardar
-- histórico de lembretes por lead, aí sim vale migrar pra uma tabela
-- própria — por enquanto isso seria complexidade sem uso real.
-- ============================================================

alter table leads_inscricoes add column if not exists lembrete_em date;
alter table leads_inscricoes add column if not exists lembrete_nota text;

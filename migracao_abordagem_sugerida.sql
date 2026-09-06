-- ============================================================
-- Migração: sugestão de abordagem editável por lead (bloco "Como Abordar"
-- na gaveta do lead). Antes era um texto fixo no HTML (mesma frase pra
-- todo mundo, não salvava em lugar nenhum); agora fica por lead, editável
-- do mesmo jeito que o "Resumo da Conversa (IA)".
-- Rodar manualmente no SQL Editor do Supabase.
-- ============================================================

alter table leads_inscricoes add column if not exists abordagem_sugerida text;

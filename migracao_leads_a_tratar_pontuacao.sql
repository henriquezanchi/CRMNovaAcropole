-- ============================================================
-- Migração: e-mail e pontuação em leads_a_tratar
-- Rodar manualmente no SQL Editor do Supabase (depois de
-- migracao_leads_a_tratar.sql). Suporta duas melhorias no critério "nome
-- parecido":
--   - pessoa_email: exibido no card e usado como sinal de bônus (e-mails
--     parecidos entre 2 candidatos reforça a suspeita de duplicata).
--   - pontuacao: % de compatibilidade calculado pra cada grupo "nome"
--     (null pros critérios telefone/email/sem_telefone), usado pra
--     ordenar os grupos do mais provável pro menos provável.
-- ============================================================

alter table leads_a_tratar add column if not exists pessoa_email text;
alter table leads_a_tratar add column if not exists pontuacao numeric;

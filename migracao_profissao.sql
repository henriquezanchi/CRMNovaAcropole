-- Profissão do lead, capturada pelo scraper do Mercúrio na aba PESSOAIS da
-- ficha do aluno (mesma navegação de HISTÓRICO/ENDEREÇOS) -- só no Modo
-- Completo, mesmo princípio de cidade/uf (migracao_lead_cidade_uf.sql).
alter table public.leads_inscricoes add column if not exists profissao text;

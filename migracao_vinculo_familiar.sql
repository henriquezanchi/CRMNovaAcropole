-- ============================================================
-- Migração: Radar de Acompanhantes (vínculo familiar)
-- Rodar manualmente no SQL Editor do Supabase.
--
-- Coluna nova em leads_inscricoes: grupo_familiar_id (uuid, nullable).
-- Todo lead com o MESMO valor faz parte do mesmo "grupo" (cônjuge, amigos,
-- quem veio junto) — não é uma tabela de vínculo própria, é o mesmo padrão
-- já usado por eventos.grupo_evento_id (eventos multi-filial). Um lead
-- pertence a NO MÁXIMO 1 grupo por vez. Gerado no navegador
-- (crypto.randomUUID()) por vincularLeadFamiliar() (js/app.js) na gaveta
-- do lead, seção "Vínculo Familiar".
-- ============================================================

alter table leads_inscricoes add column if not exists grupo_familiar_id uuid;

create index if not exists idx_leads_inscricoes_grupo_familiar_id
    on leads_inscricoes (grupo_familiar_id)
    where grupo_familiar_id is not null;

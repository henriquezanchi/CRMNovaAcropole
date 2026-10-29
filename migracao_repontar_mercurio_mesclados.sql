-- Fichas do Mercúrio que ainda apontavam para cadastros já mesclados (mesclagens
-- feitas antes de 2026-10-29 não repontavam mercurio_pessoas) passam a apontar
-- para o cadastro que ficou.
update mercurio_pessoas m set pessoa_identificador=d.destino from crm_leads_mesclados d where m.pessoa_identificador=d.original;
update mercurio_alunos m set pessoa_identificador=d.destino from crm_leads_mesclados d where m.pessoa_identificador=d.original;

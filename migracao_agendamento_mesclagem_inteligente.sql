-- Aplicar somente depois da migração principal e da simulação revisada.
-- Roda mesmo com o CRM fechado. O lock transacional impede duas rodadas simultâneas.
select cron.schedule('crm-mesclagem-inteligente','*/2 * * * *',
 $$select processar_mesclagens_inteligentes(true,100);$$);

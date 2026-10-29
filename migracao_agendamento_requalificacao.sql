-- Requalificação diária extra (2026-10-29): a leitura do Mercúrio (03:00-03:30)
-- já requalifica cada filial; esta rodada às 06:30 Brasília (09:30 UTC) pega os
-- leads que a importação do Ulisses (05:30) trouxe e atualiza a temperatura do dia.
select cron.unschedule('crm-requalificar-leads') where exists (select 1 from cron.job where jobname='crm-requalificar-leads');
select cron.schedule('crm-requalificar-leads', '30 9 * * *', $$select crm_requalificar_leads(null, true)$$);

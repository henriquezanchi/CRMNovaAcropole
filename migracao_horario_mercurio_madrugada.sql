-- Pedido do usuário (2026-10-18): o Mercúrio roda de madrugada, longe do
-- horário em que as escolas usam o sistema (a credencial do scraper é
-- compartilhada e o servidor tem limite de requisições).
--   - Scraper do Mercúrio (GitHub Actions): 03:00 Brasília = 06:00 UTC (antes 05:00)
--   - Banco de consulta do Mercúrio:          03:00 Brasília = 06:00 UTC (antes 06:30)
-- Os dois no mesmo horário não conflitam: o banco de consulta é uma cópia
-- separada (phpMyAdmin), não o Mercúrio que as escolas usam. Ele é
-- atualizado por volta das 23h, então às 03:00 já tem os dados do dia.
select cron.alter_job((select jobid from cron.job where jobname = 'disparar-scraper-mercurio-diario'), schedule := '0 6 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'mercurio-db-sincronizar-diario'), schedule := '0 6 * * *');

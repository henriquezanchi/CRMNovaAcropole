-- Limpeza semanal do histórico de execuções do pg_cron (cron.job_run_details), que cresce sem parar com as tarefas
-- de minuto em minuto (56 MB em 18/11/2026). Guarda os últimos 7 dias. Domingo 04:00 Brasília (07:00 UTC).
select cron.schedule('limpar-historico-cron', '0 7 * * 0',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$);

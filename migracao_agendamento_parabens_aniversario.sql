-- Parabéns automático no dia do aniversário (2026-10-29, pedido do usuário:
-- "vai pra todo mundo, somente no seu dia"). Todo dia às 09:00 Brasília
-- (12:00 UTC) chama a Edge Function parabenizar-aniversariantes, que manda o
-- modelo `aniversario` pra quem faz aniversário hoje. Mesmo molde dos outros
-- crons (pg_cron + pg_net, chave publishable só pra passar no JWT padrão).
select cron.unschedule('parabens-aniversario-diario') where exists (select 1 from cron.job where jobname = 'parabens-aniversario-diario');
select cron.schedule('parabens-aniversario-diario', '0 12 * * *', $$
  select net.http_post(
    url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/parabenizar-aniversariantes',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);

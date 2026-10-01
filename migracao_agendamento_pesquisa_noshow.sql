-- Migração: cron job que roda pesquisa-noshow-evento 1x/dia
--
-- 11h Brasília = 14h UTC — depois do lembrete-evento-confirmado (10h),
-- num horário diferente de propósito (são 2 jobs independentes).
select cron.schedule(
    'pesquisa-noshow-evento-diaria',
    '0 14 * * *',
    $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/pesquisa-noshow-evento',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb
    );
    $$
);

-- Migração: cron job que roda lembrete-evento-confirmado 1x/dia
--
-- 10h Brasília = 13h UTC (Brasil não observa horário de verão desde
-- 2019, mesmo raciocínio de fuso já usado nos outros crons do projeto).
select cron.schedule(
    'lembrete-evento-confirmado-diario',
    '0 13 * * *',
    $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/lembrete-evento-confirmado',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb
    );
    $$
);

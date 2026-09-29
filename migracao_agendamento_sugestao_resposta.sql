-- Agenda sugerir-resposta-whatsapp a cada 15 minutos — mesmo padrão de
-- migracao_agendamento_classificacao_respostas.sql (pg_cron/pg_net já
-- habilitados, chave publishable como Bearer).
select cron.schedule(
    'sugerir-resposta-whatsapp',
    '*/15 * * * *',
    $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/sugerir-resposta-whatsapp',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb
    );
    $$
);

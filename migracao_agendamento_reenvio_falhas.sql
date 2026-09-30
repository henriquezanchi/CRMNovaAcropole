-- Agenda whatsapp-reenviar-falhas a cada 3h (pedido do usuário,
-- 2026-09-29/30) — mesmo padrão de net.http_post + chave publishable já
-- usado pelos outros cron jobs deste projeto (pg_cron/pg_net já
-- habilitados por migracao_agendamento_mercurio_pgcron.sql).
select cron.schedule(
    'whatsapp-reenviar-falhas',
    '0 */3 * * *',
    $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/whatsapp-reenviar-falhas',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb
    );
    $$
);

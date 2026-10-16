-- Agenda o envio do Resumo Diário pro WhatsApp do admin, TODO DIA às
-- 08:00 em Brasília (11:00 UTC — Brasil não observa horário de verão
-- desde 2019, mesmo raciocínio de migracao_agendamento_mercurio_pgcron.sql),
-- horário em que o Mercúrio automático (cron 05:00 Brasília) tipicamente
-- já terminou. pg_cron/pg_net já estão habilitados por aquela migração;
-- aqui só cria mais um job, chamando a Edge Function resumo-diario-admin
-- (pedido do usuário, 2026-10-08: relatório diário no WhatsApp com
-- status de Mercúrio/Ulisses, mensagens novas, janelas de 24h fechando,
-- sugestões de IA pendentes e o que não pode esperar hoje).
select cron.schedule(
    'resumo-diario-admin',
    '0 11 * * *',
    $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/resumo-diario-admin',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb
    );
    $$
);

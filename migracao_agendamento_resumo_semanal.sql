-- Agenda o envio do resumo semanal (agregado) pro chefe de cada filial,
-- toda SEGUNDA-FEIRA às 08:00 em Brasília (11:00 UTC — Brasil não
-- observa horário de verão desde 2019, mesmo raciocínio já usado em
-- migracao_agendamento_mercurio_pgcron.sql). pg_cron/pg_net já estão
-- habilitados por aquela migração; aqui só cria mais um job, chamando a
-- Edge Function resumo-semanal-chefe SEM `filial` no corpo — nesse modo
-- ela mesma varre todas as filiais com whatsapp_chefe_numero configurado.
select cron.schedule(
    'resumo-semanal-chefe-todas-filiais',
    '0 11 * * 1',
    $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/resumo-semanal-chefe',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb
    );
    $$
);

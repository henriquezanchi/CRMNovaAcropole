-- Agenda a classificação de respostas de convite a cada 15 minutos —
-- pg_cron/pg_net já habilitados por migracao_agendamento_mercurio_pgcron.sql.
-- Mesmo padrão de migracao_agendamento_resumo_semanal.sql (net.http_post
-- com a chave publishable como Bearer — já é pública, embutida no
-- index.html, só precisa ser um JWT válido pra passar da verificação
-- padrão da function).
select cron.schedule(
    'classificar-respostas-convite',
    '*/15 * * * *',
    $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/classificar-resposta-convite',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb
    );
    $$
);

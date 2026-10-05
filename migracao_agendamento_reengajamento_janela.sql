-- Agenda reengajar-janela-fechando a cada 15 minutos — mesmo padrão de
-- migracao_agendamento_sugestao_resposta.sql (pg_cron/pg_net já
-- habilitados, chave publishable como Bearer). A janela de elegibilidade
-- em si é de 12h (ver migracao_rpc_candidatas_reengajamento_janela.sql),
-- então rodar a cada 15 min é mais que suficiente pra pegar qualquer
-- candidata logo depois de cruzar o limiar.
select cron.schedule(
    'reengajar-janela-fechando',
    '*/15 * * * *',
    $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/reengajar-janela-fechando',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb
    );
    $$
);

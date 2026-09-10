-- ============================================================
-- Migração: move o disparo diário do Mercúrio do `schedule:` do GitHub
-- Actions (comprovadamente pouco confiável — ver CLAUDE.md, seção
-- "Agendamento do Mercúrio") pra um cron job DENTRO do Supabase
-- (pg_cron + pg_net), que chama a Edge Function `scraper-disparar` já
-- existente. O GitHub Actions continua rodando o scraper de verdade
-- (workflow_dispatch) — só o GATILHO de horário muda de lugar.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove um agendamento anterior com o mesmo nome, se já existir (torna
-- este script seguro de rodar de novo).
select cron.unschedule('disparar-scraper-mercurio-diario')
where exists (select 1 from cron.job where jobname = 'disparar-scraper-mercurio-diario');

-- 08:00 UTC = 05:00 em Brasília (Brasil não observa horário de verão
-- desde 2019 — mesmo horário de sempre, só o agendador que muda).
-- A chave usada no Authorization é a publishable/anon (já pública, embutida
-- no index.html) — só precisa ser um JWT válido pra passar da verificação
-- padrão da Edge Function, não precisa ser a service role.
select cron.schedule(
    'disparar-scraper-mercurio-diario',
    '0 8 * * *',
    $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/scraper-disparar',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'
        ),
        body := '{}'::jsonb
    );
    $$
);

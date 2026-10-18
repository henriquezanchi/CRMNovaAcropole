-- Desliga o scraper antigo do Mercúrio (Playwright no GitHub Actions, ~3h por
-- rodada, logado no Mercúrio que as escolas usam). Substituído por:
--   - mercurio-db-sincronizar (03:00): banco de consulta — ativos, turmas,
--     ingresso/reingresso, contatos, conciliação, coluna Matriculados.
--   - mercury-sincronizar (03:10 a 03:30, 1 filial a cada 5 min): API do
--     Mercury — inativos, motivo/data de saída e Rede de Ativos/Inativos.
--   - ia-diagnostico-saude (06:30): antes disparado no fim do scraper.
--   - avisar-aniversario-ativos (08:00): antes dentro do scraper (às 5h).
-- O código do scraper (scraper/mercurio.js) continua no repositório e o
-- workflow pode ser disparado à mão no GitHub, se um dia precisar.
select cron.unschedule('disparar-scraper-mercurio-diario')
where exists (select 1 from cron.job where jobname = 'disparar-scraper-mercurio-diario');

do $$
declare
    alvo record;
    minuto int := 10;
begin
    for alvo in select nome from filiais where ativo and mercurio_unidade is not null order by ordem loop
        perform cron.unschedule(j.jobname) from cron.job j where j.jobname = 'mercury-sincronizar-' || alvo.nome;
        perform cron.schedule(
            'mercury-sincronizar-' || alvo.nome,
            minuto || ' 6 * * *',
            format($cmd$select net.http_post(
                url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/mercury-sincronizar',
                headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
                body := jsonb_build_object('filial', %L),
                timeout_milliseconds := 150000
            );$cmd$, alvo.nome)
        );
        minuto := minuto + 5;
    end loop;
end $$;

select cron.unschedule('ia-diagnostico-saude-diario') where exists (select 1 from cron.job where jobname = 'ia-diagnostico-saude-diario');
select cron.schedule('ia-diagnostico-saude-diario', '30 9 * * *', $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/ia-diagnostico-saude',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb, timeout_milliseconds := 120000);
$$);

select cron.unschedule('avisar-aniversario-ativos-diario') where exists (select 1 from cron.job where jobname = 'avisar-aniversario-ativos-diario');
select cron.schedule('avisar-aniversario-ativos-diario', '0 11 * * *', $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/avisar-aniversario-ativos',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb, timeout_milliseconds := 120000);
$$);

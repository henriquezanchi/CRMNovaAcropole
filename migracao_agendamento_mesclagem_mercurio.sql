-- Mesclagem automática pelo Mercúrio toda madrugada, 03:45 Brasília (06:45 UTC),
-- depois da leitura do banco do Mercúrio (03:00-03:30) que liga as fichas aos leads.
select cron.unschedule('crm-mesclar-pelo-mercurio') where exists (select 1 from cron.job where jobname='crm-mesclar-pelo-mercurio');
select cron.schedule('crm-mesclar-pelo-mercurio', '45 6 * * *', $$select crm_mesclar_pelo_mercurio(true, 500)$$);

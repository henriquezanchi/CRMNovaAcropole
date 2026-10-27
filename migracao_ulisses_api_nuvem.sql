-- Ulisses pela nuvem (pedido do usuário 2026-10-26: "levar essas três rotinas para a nuvem"). Substitui as três
-- Tarefas Agendadas do Windows (CRM - Ulisses Diario / 6h Semana Evento / 3h Reta Final), que só rodavam com o
-- computador do usuário ligado e abriam uma janela preta a cada disparo.
--
-- Por que agora funciona: a API do Ulisses passa pela ponte da Cloudflare do Portal do Membro (PONTE_URL/PONTE_CHAVE
-- nos segredos do GitHub; ver urlDaApi() em scraper/ulisses-api.js). O 403 do Cloudflare no Actions era o que
-- mantinha `ulisses-api-diario` desligado (migracao_ulisses_api_diario.sql).
--
-- Mesmas regras dos scripts locais, agora no próprio agendador (não precisa disparar o Actions para descobrir que
-- não há nada a fazer):
--   * ulisses-api-diario         05:00 Brasília, todo dia (religado);
--   * ulisses-api-semana-evento  a cada 6 h, só se houver evento ativo de hoje a 7 dias;
--   * ulisses-api-reta-final     a cada 3 h, só se houver evento ativo hoje ou amanhã.
-- O workflow tem fila própria para o Ulisses (não cancela o Mercúrio; disparos próximos esperam a vez).
-- Reaproveita o comando autenticado do `ulisses-api-diario` (mesma Edge Function scraper-disparar, modo ulisses_api).
begin;
do $$
declare
    cmd text;
    chamada text;
    hoje constant text := '(now() at time zone ''America/Sao_Paulo'')::date';
begin
    select command into cmd from cron.job where jobname = 'ulisses-api-diario';
    if cmd is null then raise exception 'Agendamento ulisses-api-diario ausente (rodar migracao_ulisses_api_diario.sql antes)'; end if;
    -- Dentro de um bloco PL/pgSQL, "select net.http_post(...)" precisa virar "perform".
    chamada := regexp_replace(rtrim(trim(cmd), ';'), '^select', 'perform');

    perform cron.schedule('ulisses-api-semana-evento', '0 1,7,13,19 * * *',
        'do $j$ begin if exists (select 1 from public.eventos where ativo and data between ' || hoje || ' and ' || hoje || ' + 7) then '
        || chamada || '; end if; end $j$;');

    perform cron.schedule('ulisses-api-reta-final', '30 2,5,8,11,14,17,20,23 * * *',
        'do $j$ begin if exists (select 1 from public.eventos where ativo and data between ' || hoje || ' and ' || hoje || ' + 1) then '
        || chamada || '; end if; end $j$;');

    perform cron.alter_job(jobid, active := true) from cron.job where jobname = 'ulisses-api-diario';
end;
$$;
commit;

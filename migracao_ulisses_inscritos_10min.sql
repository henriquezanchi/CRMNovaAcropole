-- Inscritos do Ulisses a cada 10 minutos para o painel dos diretores (pedido do usuário, 13/11/2026).
-- Dispara o workflow no modo leve `ulisses_inscritos` (scraper/sincronizar-inscritos-campanhas.mjs, ~1 min):
-- só a lista de inscritos dos eventos das campanhas ativas. Das 06:00 às 23:50 de Brasília e só enquanto
-- houver campanha ativa com evento por vir. Reaproveita o comando autenticado do `ulisses-api-diario`.
do $$
declare
    cmd text;
    chamada text;
begin
    select command into cmd from cron.job where jobname = 'ulisses-api-diario';
    if cmd is null then raise exception 'Agendamento ulisses-api-diario ausente'; end if;
    chamada := regexp_replace(regexp_replace(cmd, '[\s;]+$', ''), '^\s*select', 'perform');
    chamada := replace(chamada, '"modo":"ulisses_api"', '"modo":"ulisses_inscritos"');
    if chamada not like '%ulisses_inscritos%' then raise exception 'Não achei o modo no comando: %', chamada; end if;
    perform cron.schedule('ulisses-inscritos-campanhas', '*/10 0-2,9-23 * * *',
        'do $j$ begin if exists (select 1 from public.campanhas_whatsapp c join public.eventos e on e.id = c.evento_id '
        || 'where c.ativa and e.evento_id_ulisses is not null and e.data >= (now() at time zone ''America/Sao_Paulo'')::date) then '
        || chamada || '; end if; end $j$;');
end;
$$;
select jobname, schedule, active, command like '%ulisses_inscritos%' ok from cron.job where jobname = 'ulisses-inscritos-campanhas';

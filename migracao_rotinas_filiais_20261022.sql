-- Distribui as sincronizações por escola para evitar o limite de execução
-- ao ampliar a operação. Reutiliza os headers já configurados sem expô-los.
begin;
do $$
declare
    modelo_db text;
    modelo_api text;
    f record;
    n integer := 0;
    minuto integer;
    horario text;
begin
    select command into modelo_db from cron.job where jobname='mercurio-db-sincronizar-diario';
    select command into modelo_api from cron.job where jobname='mercury-sincronizar-Goiânia - Jardim América';
    if modelo_db is null or modelo_api is null then
        raise exception 'Modelos dos agendamentos não encontrados';
    end if;
    for f in select nome from public.filiais where ativo=true and mercurio_unidade is not null order by ordem,id loop
        minuto := 360+n*3; -- 03:00 Brasília, uma filial a cada três minutos
        horario := (minuto%60)::text || ' ' || (minuto/60)::text || ' * * *';
        perform cron.schedule('mercurio-db-sincronizar-'||f.nome, horario,
            split_part(modelo_db,'body :=',1) || format('body := jsonb_build_object(''filial'', %L), timeout_milliseconds := 150000);', f.nome));
        minuto := 405+n*5; -- 03:45 Brasília, preserva margem da API
        horario := (minuto%60)::text || ' ' || (minuto/60)::text || ' * * *';
        perform cron.schedule('mercury-sincronizar-'||f.nome, horario,
            split_part(modelo_api,'body :=',1) || format('body := jsonb_build_object(''filial'', %L), timeout_milliseconds := 150000);', f.nome));
        n := n+1;
    end loop;
    perform cron.alter_job(jobid, active:=false) from cron.job where jobname='mercurio-db-sincronizar-diario';
end;
$$;
commit;

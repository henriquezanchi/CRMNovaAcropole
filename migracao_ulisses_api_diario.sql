-- Usa o mesmo mecanismo autenticado dos demais agendamentos; credenciais
-- continuam no Supabase/Actions. Importa sem enviar campanhas WhatsApp.
begin;
do $$
declare modelo text;
begin
    select command into modelo from cron.job where jobname='cobranca-mensal-diario';
    if modelo is null then raise exception 'Modelo autenticado de agendamento ausente'; end if;
    modelo := replace(split_part(modelo,'body :=',1),'/functions/v1/cobranca-mensal','/functions/v1/scraper-disparar');
    perform cron.schedule('ulisses-api-diario','0 8 * * *',
        modelo || 'body := ''{"modo":"ulisses_api","filial":""}''::jsonb, timeout_milliseconds := 15000);');
    -- O teste real em Actions recebeu 403 do Cloudflare, mesmo com os
    -- headers oficiais. Só habilitar após a liberação/teste da origem.
    perform cron.alter_job(jobid,active:=false) from cron.job where jobname='ulisses-api-diario';
end;
$$;
commit;

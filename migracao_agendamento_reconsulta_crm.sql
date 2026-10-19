create or replace function executar_reconsulta_crm() returns bigint language sql security definer set search_path=public,extensions as $$
 select case when exists(select 1 from auditoria_crm_reconsultas where estado='pendente' or (estado in ('erro','processando') and solicitado_em<now()-interval '5 minutes')) then net.http_post(
 url:='https://eovgljcowblwoxmobeno.supabase.co/functions/v1/auditar-base-crm',headers:=jsonb_build_object('Content-Type','application/json','x-funil-token',(select decrypted_secret from vault.decrypted_secrets where name='funil_analise_token' limit 1)),body:='{"fonte":"mercurio","etapa":"reconsultar"}'::jsonb,timeout_milliseconds:=120000) else null end;
$$;
revoke all on function executar_reconsulta_crm() from public,anon,authenticated;
select cron.schedule('reconsultar-ativos-pos-mesclagem','* * * * *','select executar_reconsulta_crm();');

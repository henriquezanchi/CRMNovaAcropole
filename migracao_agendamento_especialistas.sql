-- Reutiliza token já existente no Vault, sem segredo no frontend.
begin;
create or replace function executar_especialistas_crm()returns bigint language sql security definer set search_path=public,extensions as $$
 select net.http_post(url:='https://eovgljcowblwoxmobeno.supabase.co/functions/v1/processar-especialistas',headers:=jsonb_build_object('Content-Type','application/json','x-funil-token',(select decrypted_secret from vault.decrypted_secrets where name='funil_analise_token'limit 1)),body:='{}'::jsonb,timeout_milliseconds:=100000);
$$;
create or replace function executar_transcricoes_crm()returns bigint language sql security definer set search_path=public,extensions as $$
 select net.http_post(url:='https://eovgljcowblwoxmobeno.supabase.co/functions/v1/transcrever-audios-crm',headers:=jsonb_build_object('Content-Type','application/json','x-funil-token',(select decrypted_secret from vault.decrypted_secrets where name='funil_analise_token'limit 1)),body:='{}'::jsonb,timeout_milliseconds:=100000);
$$;
revoke all on function executar_especialistas_crm(),executar_transcricoes_crm()from public,anon,authenticated;
select cron.schedule('processar-especialistas-crm','*/2 * * * *','select executar_especialistas_crm();');
select cron.schedule('transcrever-audios-crm','1-59/2 * * * *','select executar_transcricoes_crm();');
commit;

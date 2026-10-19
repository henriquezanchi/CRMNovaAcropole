-- Token gerado no provisionamento: Vault + secret FUNIL_ANALISE_TOKEN, nunca no frontend.
create or replace function executar_analise_funil() returns bigint language sql security definer set search_path=public,extensions as $$
 select net.http_post(
 url:='https://eovgljcowblwoxmobeno.supabase.co/functions/v1/analisar-funil-conversas',
 headers:=jsonb_build_object('Content-Type','application/json','x-funil-token',(select decrypted_secret from vault.decrypted_secrets where name='funil_analise_token' limit 1)),body:='{}'::jsonb,timeout_milliseconds:=180000);
$$;
revoke all on function executar_analise_funil() from public,anon,authenticated;
select cron.schedule('analisar-funil-conversas','* * * * *','select executar_analise_funil();');

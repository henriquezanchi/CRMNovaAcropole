-- Desativação no Ulisses a cada 10 min (18/11/2026): processa fila_desativacao_ulisses pendente com código do contato
-- (botão de remoção LGPD da gaveta). Só chama a Edge Function quando há item pendente.
select cron.unschedule('ulisses-nao-perturbe') where exists (select 1 from cron.job where jobname = 'ulisses-nao-perturbe');
select cron.schedule('ulisses-nao-perturbe', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/ulisses-nao-perturbe',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-funil-token', (select decrypted_secret from vault.decrypted_secrets where name = 'funil_analise_token')),
    body := '{}'::jsonb)
  where exists (select 1 from public.fila_desativacao_ulisses where status = 'pendente' and ulisses_email_id is not null);
$$);

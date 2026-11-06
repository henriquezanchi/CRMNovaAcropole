-- Rotinas que gastam IA ou mandam mensagem só aceitam chamada com o token interno
-- (x-funil-token, guardado no Vault). Antes bastava a chave pública do site
-- (varredura de 06/11/2026). As funções conferem o token.
do $$
declare j record; fn text;
begin
  for j in select jobname, schedule from cron.job where jobname in
    ('classificar-respostas-convite','reengajar-janela-fechando','sugerir-resposta-whatsapp','whatsapp-saude-conta')
  loop
    fn := case j.jobname when 'classificar-respostas-convite' then 'classificar-resposta-convite' else j.jobname end;
    perform cron.alter_job(
      job_id := (select jobid from cron.job where jobname = j.jobname),
      command := format($c$select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/%s',
        headers := jsonb_build_object('Content-Type','application/json',
          'x-funil-token',(select decrypted_secret from vault.decrypted_secrets where name='funil_analise_token')),
        body := '{}'::jsonb, timeout_milliseconds := 150000);$c$, fn));
  end loop;
end $$;

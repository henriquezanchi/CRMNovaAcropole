-- Rotinas da campanha de WhatsApp (04/11/2026). Ver migracao_campanha_whatsapp.sql.
grant execute on function campanha_assumir_envios(int) to service_role;
grant execute on function campanha_candidatos(bigint, int) to service_role;
grant execute on function campanha_conversas_aguardando(int, int) to service_role;
grant execute on function executar_campanha_responder(jsonb) to service_role;

-- 2ª tentativa (24h sem resposta) com o "Contato inicial", já aprovado e de texto
-- diferente do convite; textos dos modelos para a prévia gravada no histórico.
update campanhas_whatsapp set template_followup = 'contato_inicial',
    config = config || jsonb_build_object('corpos', jsonb_build_object(
        'convite_palestra', E'Olá, {{1}}!\n\nAqui quem fala é {{2}}, da Nova Acrópole {{3}}. Tudo bem?\n\nEstou entrando em contato para te convidar para {{4}} que deve acontecer no próximo dia {{5}}.\n\nPosso enviar mais detalhes sobre isso?',
        'contato_inicial', E'Olá, {{1}}! Aqui quem fala é {{2}}, da Nova Acrópole {{3}}. Tudo bem?\n\nEstou entrando em contato pois você sempre demonstrou interesse na Filosofia, nas ideias que a Nova Acrópole tenta trazer através do curso de filosofia, das palestras, dos nossos vídeos no YouTube.'))
where slug = 'dmf-2026';

select cron.schedule('campanha-whatsapp-enviar', '* * * * *', $$select executar_campanha_whatsapp('{"acao":"enviar"}'::jsonb)$$);
select cron.schedule('campanha-whatsapp-planejar', '25 11 * * *', $$select executar_campanha_whatsapp('{"acao":"planejar"}'::jsonb)$$);
select cron.schedule('campanha-whatsapp-responder', '* * * * *', $$select executar_campanha_responder('{}'::jsonb)$$);
-- Robô de reengajamento (janela de 24h) religado a pedido do usuário.
select cron.alter_job((select jobid from cron.job where jobname = 'reengajar-janela-fechando'), active := true);

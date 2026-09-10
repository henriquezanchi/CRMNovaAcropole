-- Nome do usuário logado (js/usuarios.js) que ENVIOU cada mensagem de
-- WhatsApp — pedido do usuário: "no whatsapp precisa aparecer o nome do
-- usuário que está logado". Preenchida pela Edge Function whatsapp-send
-- (recebe atendenteNome no corpo da chamada) só em mensagens de saída;
-- mensagens de entrada (recebidas do lead) ficam null.
alter table mensagens_whatsapp add column if not exists atendente_nome text;

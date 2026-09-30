-- Reenvio automático de mensagens de WhatsApp que falharam por motivo
-- TEMPORÁRIO (pendência de pagamento na Meta, limite de taxa) — pedido
-- do usuário (2026-09-29/30), depois de um lote de 453 falhas, 312 delas
-- por "Business eligibility payment issue" (fatura em aberto).
--
-- Deliberadamente NÃO reenvia falhas permanentes (ex: "Message
-- Undeliverable", número sem WhatsApp de verdade) — ver whitelist de
-- códigos em supabase/functions/whatsapp-reenviar-falhas/index.ts.
--
-- Rodar manualmente: npx supabase db query --linked --file migracao_whatsapp_reenvio_automatico.sql

alter table mensagens_whatsapp
  add column if not exists tentativas_reenvio integer not null default 0;
alter table mensagens_whatsapp
  add column if not exists ultima_tentativa_reenvio_em timestamptz;

-- 'reenviada' = esta linha (a tentativa ORIGINAL que falhou) foi
-- superada por um reenvio automático bem-sucedido — a mensagem de
-- verdade é a linha NOVA (whatsapp-send sempre insere uma linha própria
-- por chamada); esta fica só como histórico de que houve uma falha e
-- ela foi corrigida sozinha, sem duplicar em wa_status='falhou' pra sempre.
alter table mensagens_whatsapp drop constraint if exists mensagens_whatsapp_wa_status_check;
alter table mensagens_whatsapp add constraint mensagens_whatsapp_wa_status_check
  check (wa_status in ('enviando','enviado','entregue','lido','falhou','reenviada'));

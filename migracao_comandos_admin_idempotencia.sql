-- Comando do admin pelo WhatsApp ("SIM"): a Meta reentrega o mesmo webhook quando a
-- resposta demora, e cada reentrega mandava um NOVO lote de 12 sugestões. Cada mensagem
-- de comando agora só é tratada uma vez (varredura de 06/11/2026).
create table if not exists whatsapp_comandos_admin (
    wa_message_id text primary key,
    criado_em timestamptz not null default now()
);
alter table whatsapp_comandos_admin enable row level security; -- sem policy: só service_role

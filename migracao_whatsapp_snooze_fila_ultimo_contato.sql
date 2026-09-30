-- 3 colunas novas em leads_inscricoes, pedidas na mesma leva (2026-09-30):
--
-- 1) wpp_silenciado_ate — "silenciar" uma conversa específica (snooze de
--    NOTIFICAÇÃO, diferente de arquivar): enquanto no futuro, o sino/popup
--    de "mensagem recebida" não dispara pra esse lead, mas o indicador de
--    "não lida" continua normal (mesmo comportamento do WhatsApp real —
--    silenciado não é a mesma coisa que lido).
--
-- 2) wpp_atendente_responsavel — distribuição automática de conversas
--    novas entre atendentes (fila por menor carga, ver whatsapp-webhook) —
--    guarda o NOME do atendente (usuarios_crm.nome), não um id, mesmo
--    padrão já usado em mensagens_whatsapp.atendente_nome.
--
-- 3) ultimo_contato_em — "último contato" com o lead, carimbado
--    automaticamente a cada envio de WhatsApp de verdade (whatsapp-send)
--    e manualmente pelo botão "Registrar Contato" na gaveta (cobre
--    contato feito por fora do WhatsApp — ligação, presencial). Alimenta
--    a priorização de "quem contatar hoje" (não insistir em quem já foi
--    contatado hoje).
--
-- Rodar manualmente: npx supabase db query --linked --file migracao_whatsapp_snooze_fila_ultimo_contato.sql
alter table leads_inscricoes add column if not exists wpp_silenciado_ate timestamptz;
alter table leads_inscricoes add column if not exists wpp_atendente_responsavel text;
alter table leads_inscricoes add column if not exists ultimo_contato_em timestamptz;

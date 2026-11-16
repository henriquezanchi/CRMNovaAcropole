-- WhatsApp por função na escola (16/11/2026, pedido do usuário): além do chefe da filial,
-- o secretário de economia (recebe a cobrança da Cora e os lembretes) e o de abertura de turma.
alter table filiais add column if not exists whatsapp_economia text;
alter table filiais add column if not exists whatsapp_abertura_turma text;

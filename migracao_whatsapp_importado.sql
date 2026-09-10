-- ============================================================
-- Migração: marca mensagens importadas de conversas feitas "por fora"
-- do CRM (enquanto a API do Meta está bloqueada) — ver seção "Importar
-- Conversa de WhatsApp" no CLAUDE.md.
-- ============================================================

alter table mensagens_whatsapp
    add column if not exists importado_manualmente boolean not null default false;

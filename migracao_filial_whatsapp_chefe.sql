-- ============================================================
-- Migração: coluna whatsapp_chefe_numero em filiais
-- Rodar manualmente no SQL Editor do Supabase.
--
-- Número de WhatsApp (E.164, sem "+", ex: 5562991234567) do chefe da
-- filial ou professor responsável — destinatário de 2 avisos novos:
-- (1) aniversário de aluno ATIVO no dia (verificação diária, dentro do
-- job automático do Mercúrio); (2) resumo de um lead específico,
-- disparado manualmente pelo SDR na gaveta do lead ("Enviar resumo das
-- interações para o chefe de filial"). Editável em "Gerenciar Filiais"
-- (mesmo padrão de nome_com_preposicao/whatsapp_phone_number_id).
-- Nullable: sem número configurado, os 2 avisos acima simplesmente não
-- disparam pra aquela filial (não é erro, só não configurado ainda).
-- ============================================================

alter table filiais add column if not exists whatsapp_chefe_numero text;

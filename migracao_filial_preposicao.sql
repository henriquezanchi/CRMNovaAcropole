-- ============================================================
-- Migração: forma natural de falar o nome da filial (com preposição)
-- Rodar manualmente no SQL Editor do Supabase.
--
-- Coluna nova em filiais: nome_com_preposicao (text, nullable) — ex:
-- "do Jardim América", "de Barra do Garças". É uma propriedade da FILIAL
-- (igual pra qualquer atendente que a mencionar), não uma preferência
-- pessoal — por isso fica no banco, compartilhada, editável em
-- "Gerenciar Filiais", em vez de perguntar pra cada atendente.
--
-- Usada pra pré-preencher a variável "filial" nos modelos de WhatsApp
-- (js/whatsapp.js) sem precisar digitar toda vez. Sem preencher, o
-- código usa "de {nome}" como aproximação — funciona na maioria dos
-- casos, mas não é gramaticalmente perfeito pra todo nome de filial.
-- ============================================================

alter table filiais add column if not exists nome_com_preposicao text;

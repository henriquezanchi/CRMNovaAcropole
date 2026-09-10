-- ============================================================
-- Migração: coluna endereço em filiais — mostrado na gaveta de qualquer
-- lead daquela filial (bloco "Filial", junto com a mensalidade já
-- existente), pra responder "onde fica?"/"qual o valor?" sem trocar de
-- aba. Editável em "Gerenciar Filiais".
-- ============================================================

alter table filiais add column if not exists endereco text;

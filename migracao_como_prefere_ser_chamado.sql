-- Coluna livre, editável na gaveta do lead — pedido do usuário
-- (2026-09-17): "incluir 'como prefere ser chamado' para pessoas que não
-- gostam de ser chamadas por um dos nomes, ou outra situação similar".
-- Quando preenchida, tem PRIORIDADE sobre o primeiro nome em qualquer
-- lugar que hoje monta um {nome} automático (convite de WhatsApp, etc.) —
-- ver montarTextoConviteEvento()/preencherValorAutomatico() em
-- js/whatsapp.js. Vazia/nula = comportamento de sempre (primeiro nome do
-- cadastro).
alter table leads_inscricoes add column if not exists como_prefere_ser_chamado text;

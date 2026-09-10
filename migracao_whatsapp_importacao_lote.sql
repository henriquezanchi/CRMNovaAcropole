-- Base da "Importação em Lote de Conversas" (.zip) — ver seção própria
-- no CLAUDE.md. Uma conversa importada em lote pode não ter lead
-- identificado ainda (nome ambíguo/sem match) — precisa de 2 ajustes em
-- mensagens_whatsapp:
--   1) telefone_whatsapp deixa de ser NOT NULL — o .txt exportado só
--      mostra um número de telefone quando o contato NÃO estava salvo no
--      celular; quando estava salvo, mostra o NOME (sem telefone algum).
--   2) nome_bruto_importado guarda esse nome/rótulo (só preenchido pra
--      conversas em lote SEM lead vinculado ainda) — é o que a tela
--      "Leads a Tratar" > "Conversas Importadas" mostra pra pessoa
--      conseguir reconhecer de quem é a conversa e vincular na mão.
alter table mensagens_whatsapp alter column telefone_whatsapp drop not null;
alter table mensagens_whatsapp add column if not exists nome_bruto_importado text;

-- Identifica de qual ARQUIVO .zip (1 conversa exportada) cada linha veio,
-- gerado no navegador (crypto.randomUUID(), mesmo padrão de
-- grupo_familiar_id/grupo_evento_id) — só preenchido em conversas SEM
-- lead vinculado ainda. Sem isso, agrupar/vincular pela combinação
-- nome_bruto_importado+filial arriscaria juntar 2 conversas de pessoas
-- DIFERENTES que por coincidência exportaram com o mesmo nome salvo
-- (ex: "Maria") — o id do lote garante que "vincular" afeta exatamente
-- as linhas de UM arquivo, nunca mais que isso.
alter table mensagens_whatsapp add column if not exists lote_importacao_id uuid;

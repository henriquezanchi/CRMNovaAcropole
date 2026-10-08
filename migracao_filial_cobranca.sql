-- Pedido do usuário (2026-10-08): "veja os valores fixos que cobramos de
-- cada filial; coloque um ativador de comissões em cada filial. Barra do
-- Garças, por exemplo, está sendo trabalhada, mas não será cobrada."
--
-- 2 colunas novas em `filiais`, editáveis em "Gerenciar Filiais" (mesmo
-- padrão de `valor_mensalidade`, `migracao_filial_valor_mensalidade.sql`):
--
-- `valor_fixo_mensal_agencia` — taxa fixa mensal que a AGÊNCIA cobra da
-- escola pelo serviço do CRM/prospecção, independente de quantas
-- matrículas aconteceram no mês. Diferente de `valor_mensalidade`, que é
-- a mensalidade do ALUNO (base do cálculo de comissão de 30% sobre
-- matrícula nova) — os dois valores são somados na tela "Comissão do SDR
-- — Todas as Filiais" pra formar o total a cobrar da filial no mês.
--
-- `cobra_comissao` — "ativador de comissões": quando false, a filial
-- continua aparecendo no relatório (matrículas/receita calculados
-- normalmente, pra não esconder dado real), mas fica marcada como "não
-- cobrada" e sai do TOTAL a cobrar — pensado pro caso de uma filial em
-- fase de teste/trabalho que ainda não entrou na cobrança oficial (ex:
-- Barra do Garças/MT, ligada explicitamente nesta migração).

alter table filiais add column if not exists valor_fixo_mensal_agencia numeric(10,2);
alter table filiais add column if not exists cobra_comissao boolean not null default true;

update filiais set cobra_comissao = false where nome = 'Barra do Garças/MT';

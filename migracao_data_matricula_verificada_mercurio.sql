-- Bug real, confirmado pelo usuário (2026-10-08, print do Mercúrio real):
-- JANICE MORAIS OLIVEIRA (matr. 6372, Jardim América) está desde 2012 na
-- escola (Ingresso 05/01/2012, Reingresso também 05/01/2012), mas
-- apareceu com data_matricula = 2026-10-06 na coluna "Matriculados em
-- Outubro" — mais de 10 anos de diferença.
--
-- Causa raiz: a tag "Recuperado" (permanente, aplicada por
-- aplicarTagRecuperado() em scraper/mercurio.js) serve de sinal pro
-- código pular a correção de data_matricula pra quem já tem a tag —
-- assumindo que ela SÓ existe porque a correção já rodou junto, na MESMA
-- rodada. Essa suposição é falsa pra qualquer lead que ganhou a tag
-- "Recuperado" ANTES do mecanismo de correção de data_matricula existir
-- (criado em 2026-10-08) — pra esses, a ficha nunca mais é revisitada, e
-- a data_matricula errada (geralmente "hoje" no dia em que a pessoa virou
-- "Ativo" pela 1ª vez na nossa base) fica presa pra sempre.
--
-- Esta coluna separa os dois conceitos: "tem a tag Recuperado" (permanente,
-- nunca muda) de "já conferimos o Ingresso/Reingresso REAL desta pessoa
-- no Mercúrio desde que o mecanismo de correção existe" (null = nunca
-- verificado, mesmo que a tag já exista há anos) — usada por
-- processarTurmas() pra decidir quem precisa ter a ficha reaberta.
alter table leads_inscricoes
    add column if not exists data_matricula_verificada_mercurio_em timestamptz;

comment on column leads_inscricoes.data_matricula_verificada_mercurio_em is
    'Quando o scraper conferiu pela última vez o Ingresso/Reingresso REAL desta pessoa direto na ficha do Mercúrio (HISTÓRICO), pra corrigir data_matricula. Nulo = nunca verificado por este mecanismo — mesmo que já tenha a tag "Recuperado" de uma rodada anterior a ele existir.';

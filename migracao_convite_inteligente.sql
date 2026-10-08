-- Pedido do usuário (2026-10-08): "Convidar (API)" não filtrava sinais já
-- conhecidos de recusa/opt-out/contato recente antes de disparar ("não
-- quero ficar robotizado"), e não existia como priorizar quem precisa de
-- convite (Abertura de Turma > Aula Inaugural > lembrete de quem já
-- confirmou) nem distribuir a cota diária de contatos entre filiais.
--
-- Única coluna nova necessária: `resumo_ia_atualizado_em` — marca quando
-- resumo_ia foi escrito pela última vez (manual, "Sugerir com IA", ou a
-- nova leitura automática de conversa do "Convidar (API) — Prioridade
-- Inteligente"). Sem isso, não dava pra saber se um resumo já existente
-- ainda reflete a conversa atual (e economizar a leitura por IA) ou está
-- desatualizado.
--
-- A cota diária NÃO é um número fixo salvo no banco (pedido do usuário,
-- correção no meio da sessão: "cota diária por filial limita demais...
-- quero que faça esse cálculo com base nos leads frios e divida
-- proporcionalmente") — é calculada em tempo real (contagem de leads na
-- 1ª coluna do funil de cada filial), editável na hora do disparo manual,
-- sem precisar de coluna nenhuma pra isso.

alter table leads_inscricoes add column if not exists resumo_ia_atualizado_em timestamptz;

comment on column leads_inscricoes.resumo_ia_atualizado_em is 'Quando resumo_ia foi escrito pela última vez (manual, "Sugerir com IA", ou leitura automática do "Convidar (API) — Prioridade Inteligente") — usado pra saber se o resumo ainda está "fresco" (não precisa reler a conversa por IA de novo) ou está desatualizado.';

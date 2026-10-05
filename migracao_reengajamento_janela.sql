-- Migração: reengajamento automático antes da janela de 24h fechar
--
-- Pedido do usuário (2026-10-05): "vamos rodar um bot para as pessoas que
-- estão com menos de 12h para fechar a janela sem interação nossa...
-- usando IA vamos ler a conversa toda e interagir estrategicamente" —
-- depois ajustado pra "uma vez só de reengajamento por janela" e
-- esclarecido o objetivo real: "evitar a nossa demora em responder, e
-- não incomodar o lead". Ou seja: não é pra ficar insistindo com o lead —
-- é pra COMPENSAR a demora do time preparando, com antecedência e lendo a
-- conversa INTEIRA (não só as últimas mensagens), a melhor resposta
-- possível, pronta pra revisão humana assim que alguém abrir o CRM.
--
-- Decisão confirmada com o usuário antes de codificar (mesmo princípio de
-- segurança de TODA function de IA do projeto): nunca envia sozinho — só
-- prepara e deixa visível pra 1 clique de aprovação, igual
-- "Sugestão de Resposta" já existente (sugerir-resposta-whatsapp).
--
-- Por isso REAPROVEITA a mesma tabela `sugestoes_resposta_wpp` e a MESMA
-- UI (card de revisão no WhatsApp Unificado) em vez de criar uma 2ª
-- estrutura paralela — só adiciona a coluna abaixo, que serve tanto pra
-- marcar "já recebeu o reforço de 12h" quanto pra garantir "uma vez só
-- por janela" (a mesma mensagem do lead nunca é reprocessada 2x).

-- Padrão por filial — true = já nasce ligado. Separado do toggle de
-- "Sugestão de Resposta" (ia_sugestao_resposta_habilitada) de propósito:
-- são comportamentos diferentes (1 sugere ao receber mensagem nova, o
-- outro reforça quando a resposta está demorando) — uma filial pode
-- querer só um dos dois. O override por CONVERSA (leads_inscricoes.
-- ia_sugestao_resposta) continua sendo o MESMO campo pros dois, já que
-- semanticamente é a mesma pergunta ("quero sugestão de IA nesta
-- conversa?"), independente do gatilho que gerou a sugestão.
alter table filiais
  add column if not exists ia_reengajamento_janela_habilitado boolean not null default true;

-- Marca quando a sugestão desta mensagem já passou pelo reforço de 12h —
-- null = ainda não passou (pode ser candidata); preenchido = já passou,
-- nunca mais reprocessada pra essa MESMA mensagem (se o lead mandar uma
-- mensagem nova depois, é uma mensagem/linha diferente, com seu próprio
-- "reengajamento_em" zerado — a janela "reabriu", o reforço pode rodar
-- de novo pra ELA).
alter table sugestoes_resposta_wpp
  add column if not exists reengajamento_em timestamptz;

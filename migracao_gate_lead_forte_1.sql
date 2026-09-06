-- ============================================================
-- Migração: trava de recência pro Lead Forte nível 1
-- Rodar manualmente no SQL Editor do Supabase (depois de
-- migracao_pontuacao_lead_forte.sql). Adiciona a coluna dias_gate_nivel_1
-- em config_pontuacao_lead_forte: nível 1 (o mais propenso a matricular)
-- passa a exigir, além da pontuação mínima, ter vindo em algum evento
-- dentro dessa janela de dias — senão cai pro nível 2, mesmo com
-- pontuação de nível 1. Sem essa trava, alguém com muitos eventos só que
-- faz tempo (sem sinal de que ainda está engajado agora) ficava marcado
-- como "mais propenso a matricular", o que não fazia sentido.
--
-- É um campo SEPARADO de pontos_evento_recente_dias (que só dá um bônus
-- de pontuação, não barra nível nenhum) — os dois continuam editáveis
-- independentemente na tela "Critérios de Lead Forte".
-- ============================================================

alter table config_pontuacao_lead_forte add column if not exists dias_gate_nivel_1 int not null default 30;

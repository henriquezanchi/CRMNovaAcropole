-- Pedido do usuário (2026-10-01): "resumo da conversa (aluno disse que
-- não pode agora, mas que devemos entrar em contato em julho de 2027.
-- Quero que a IA já crie um snooze para essa data, e registre o motivo
-- no resumo". Mesmo princípio de sempre: a IA só SUGERE (detecta a data
-- mencionada e escreve o motivo) — quem efetivamente cria o lembrete e
-- grava no resumo é o SDR, clicando "Criar Lembrete" no painel (nunca
-- automático).
alter table sugestoes_resposta_wpp add column if not exists lembrete_sugerido_data date;
alter table sugestoes_resposta_wpp add column if not exists lembrete_sugerido_motivo text;

-- Reações com emoji nas mensagens do WhatsApp (pedido do usuário,
-- 2026-09-28: "quero poder 'reagir' às mensagens com emojis, como numa
-- mensagem normal do whatsapp"). Guarda no MÁXIMO 1 reação por lado
-- ({"lead": "❤️", "atendente": "👍"}) — mesmo comportamento do WhatsApp
-- real: reagir de novo troca a própria reação, mandar emoji vazio remove.
-- null = nenhuma reação de nenhum lado.
alter table mensagens_whatsapp add column if not exists reacoes jsonb;

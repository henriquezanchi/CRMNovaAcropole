-- Migração: colunas persona_tom/persona_notas em usuarios_crm
--
-- Pedido do usuário (2026-10-01): "cada SDR teria a sua persona... Para
-- não ficar uma coisa interminável" — versão ENXUTA da ideia maior (chat
-- de treino lendo conversas/site institucional, com janela de tokens).
-- Em vez de um chat aberto (custo/complexidade maiores, resultado menos
-- previsível), cada atendente configura um perfil ESTRUTURADO — tom de
-- voz + observações livres — que entra no prompt das IAs de sugestão de
-- resposta (sugerir-resposta-whatsapp/classificar-resposta-convite),
-- junto com o que já existe (exemplos_resposta_ia). Resolvido por
-- `leads_inscricoes.wpp_atendente_responsavel` (quem está de fato
-- respondendo aquela conversa) — ver _shared/persona.ts.
--
-- Custo de API: ESSA versão não adiciona NENHUMA chamada nova à
-- Anthropic — é só mais um bloco de texto curto dentro dos prompts que
-- já rodam hoje (poucas centenas de tokens extras por chamada, custo
-- desprezível no preço do Haiku).
alter table usuarios_crm add column if not exists persona_tom text
    check (persona_tom is null or persona_tom in ('formal', 'descontraido', 'neutro'));
alter table usuarios_crm add column if not exists persona_notas text;

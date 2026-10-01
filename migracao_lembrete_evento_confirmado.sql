-- Migração: coluna lembrete_enviado_em em evento_leads
--
-- Pedido do usuário (2026-10-01, avaliação de conversão): achamos que
-- 66,4% de quem CONFIRMA presença num evento gratuito não aparece — a
-- hipótese mais provável não é desinteresse (a pessoa já disse "sim"),
-- é esquecimento/fricção de agenda. Um lembrete automático no dia
-- anterior ataca exatamente isso.
--
-- `lembrete_enviado_em` marca quando o lembrete foi disparado pra este
-- vínculo específico — evita reenviar o mesmo lembrete se o cron rodar
-- mais de uma vez no mesmo dia, e dá uma trilha auditável de quando
-- cada lembrete saiu.
alter table evento_leads add column if not exists lembrete_enviado_em timestamptz;

-- `pesquisa_noshow_enviada_em` — mesma ideia, mas pra outra pergunta do
-- usuário na mesma avaliação: "perguntar o motivo quando alguém confirma
-- e não aparece, sem constranger". Marca quando a pesquisa curta de
-- múltipla escolha (ver supabase/functions/pesquisa-noshow-evento/) foi
-- mandada pra este vínculo — evita reenviar, e a resposta do lead cai no
-- fluxo normal de conversa (sem classificador novo, de propósito — ver
-- comentário na Edge Function).
alter table evento_leads add column if not exists pesquisa_noshow_enviada_em timestamptz;


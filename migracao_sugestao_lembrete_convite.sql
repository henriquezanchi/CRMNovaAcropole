-- Mesma feature de migracao_sugestao_lembrete_ia.sql, só que pro OUTRO
-- fluxo de IA (classificacoes_resposta_convite) — muita gente que
-- responde "não posso ir, mas me chama em [data]" vem justamente de uma
-- resposta a CONVITE DE EVENTO, que passa por esta tabela, não pela
-- genérica.
alter table classificacoes_resposta_convite add column if not exists lembrete_sugerido_data date;
alter table classificacoes_resposta_convite add column if not exists lembrete_sugerido_motivo text;

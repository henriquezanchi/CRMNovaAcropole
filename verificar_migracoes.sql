-- ============================================================
-- VERIFICAR MIGRAÇÕES — só leitura, não muda nada no banco.
-- Cole isso inteiro no SQL Editor do Supabase e rode — mostra uma linha
-- por migração com "aplicada = true/false". Rode de novo depois de
-- aplicar as que faltarem, pra conferir.
--
-- Todas as migrações deste projeto são seguras de rodar MAIS DE UMA VEZ
-- (usam "create table if not exists" / "add column if not exists" /
-- "on conflict do nothing") — pode rodar tudo de novo sem medo de
-- duplicar dado ou dar erro, mesmo as que você não lembra se já rodou.
-- ============================================================

select 'migracao_eventos.sql' as migracao,
    (to_regclass('public.eventos') is not null) as aplicada
union all
select 'migracao_tipos_evento.sql',
    (to_regclass('public.tipos_evento') is not null)
union all
select 'migracao_tipos_evento_trilha.sql (trilha/palavras_chave)',
    exists(select 1 from information_schema.columns where table_name = 'tipos_evento' and column_name = 'trilha')
union all
select 'migracao_evento_data_limite.sql',
    exists(select 1 from information_schema.columns where table_name = 'eventos' and column_name = 'data_limite_inscricao')
union all
select 'migracao_eventos_multifilial.sql',
    exists(select 1 from information_schema.columns where table_name = 'eventos' and column_name = 'grupo_evento_id')
union all
select 'migracao_evento_leads.sql',
    (to_regclass('public.evento_leads') is not null)
union all
select 'migracao_evento_leads_matriculado.sql',
    exists(select 1 from information_schema.columns where table_name = 'evento_leads' and column_name = 'matriculado')
union all
select 'migracao_abordagem_sugerida.sql',
    exists(select 1 from information_schema.columns where table_name = 'leads_inscricoes' and column_name = 'abordagem_sugerida')
union all
select 'migracao_data_matricula.sql',
    exists(select 1 from information_schema.columns where table_name = 'leads_inscricoes' and column_name = 'data_matricula')
union all
select 'migracao_data_saida.sql',
    exists(select 1 from information_schema.columns where table_name = 'leads_inscricoes' and column_name = 'data_saida')
union all
select 'migracao_motivo_saida.sql',
    exists(select 1 from information_schema.columns where table_name = 'leads_inscricoes' and column_name = 'motivo_saida')
union all
select 'migracao_motivo_perda.sql',
    exists(select 1 from information_schema.columns where table_name = 'leads_inscricoes' and column_name = 'motivo_perda')
union all
select 'migracao_lembrete_lead.sql',
    exists(select 1 from information_schema.columns where table_name = 'leads_inscricoes' and column_name = 'lembrete_em')
union all
select 'migracao_matricula_mercurio.sql',
    exists(select 1 from information_schema.columns where table_name = 'leads_inscricoes' and column_name = 'matricula_mercurio')
union all
select 'migracao_sla_funil.sql',
    exists(select 1 from information_schema.columns where table_name = 'leads_inscricoes' and column_name = 'funil_agencia_atualizado_em')
union all
select 'migracao_vinculo_familiar.sql',
    exists(select 1 from information_schema.columns where table_name = 'leads_inscricoes' and column_name = 'grupo_familiar_id')
union all
select 'migracao_leads_a_tratar.sql',
    (to_regclass('public.leads_a_tratar') is not null)
union all
select 'migracao_leads_a_tratar_ignorados.sql',
    (to_regclass('public.leads_a_tratar_ignorados') is not null)
union all
select 'migracao_leads_a_tratar_pontuacao.sql',
    exists(select 1 from information_schema.columns where table_name = 'leads_a_tratar' and column_name = 'pontuacao')
union all
select 'migracao_pontuacao_lead_forte.sql',
    (to_regclass('public.config_pontuacao_lead_forte') is not null)
union all
select 'migracao_gate_lead_forte_1.sql',
    exists(select 1 from information_schema.columns where table_name = 'config_pontuacao_lead_forte' and column_name = 'dias_gate_nivel_1')
union all
select 'migracao_tags_sugeridas.sql',
    (to_regclass('public.tags_sugeridas') is not null)
union all
select 'migracao_tags_familia.sql',
    exists(select 1 from information_schema.columns where table_name = 'tags_sugeridas' and column_name = 'familia')
union all
select 'migracao_temas_eventos.sql',
    (to_regclass('public.temas_eventos') is not null)
union all
select 'migracao_whatsapp.sql',
    (to_regclass('public.mensagens_whatsapp') is not null)
order by 2 asc, 1; -- mostra as FALTANDO (false) primeiro

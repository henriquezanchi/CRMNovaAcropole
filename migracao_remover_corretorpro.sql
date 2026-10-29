-- Corretor Pro migrou para outro projeto Supabase (confirmado pelo usuário em 29/10/2026:
-- "já migramos o corretor pro para outro projeto. Pode apagar tudo. O Trader mantenha.").
-- Remove os dois esquemas dele deste banco. O Trade Lab (esquema trade_lab) fica.
-- Antes: 'corretorpro' saiu dos esquemas publicados pela API (db_schema=public,graphql_public)
-- e os dados foram copiados localmente (69 tabelas, 507 linhas, sem tabelas de segredos).
drop schema if exists cp_private cascade;
drop schema if exists corretorpro cascade;

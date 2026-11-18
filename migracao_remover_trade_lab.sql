-- Remove o Trade Lab deste banco (pedido do usuário, 18/11/2026: "não vou usar mais o trade lab", apagar sem
-- cópia). Ele ocupava ~1,45 GB dos 1,7 GB e encheu o disco (banco em somente leitura em 17-18/11).
-- A 1ª linha libera a gravação só nesta sessão (procedimento do Supabase para liberar espaço em modo leitura).
set transaction read write;

do $$ begin perform cron.unschedule('trade-lab-two-minute'); exception when others then null; end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'trade\_lab\_%' loop
    execute 'drop function ' || f.assinatura::text;
  end loop;
end $$;

drop schema if exists trade_lab cascade;

select pg_size_pretty(pg_database_size(current_database())) banco_depois,
       (select count(*) from pg_namespace where nspname = 'trade_lab') schema_restante,
       (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'trade\_lab\_%') funcoes_restantes,
       (select count(*) from cron.job where jobname like 'trade%') crons_restantes;

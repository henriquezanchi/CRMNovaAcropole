-- Cache do painel de resultados (04/11/2026). Incidente: cada abertura do
-- painel rodava painel_campanha/painel_escolas na hora; a consulta passou de
-- 150s, a página desistia, mas a consulta continuava no banco, e cada recarga
-- (e o auto-refresh de 5 min) empilhava mais uma — o servidor travou junto com
-- o CRM. Agora a Edge Function só LÊ esta tabela; o cálculo roda num job do
-- pg_cron, um de cada vez, com limite de 60s por consulta.

create table if not exists painel_resultados_cache (
    chave text primary key,              -- 'campanha:<slug>' ou 'escolas:<filiais|todas>:<dias>'
    tipo text not null check (tipo in ('campanha', 'escolas')),
    slug text,
    filiais text[],
    dias int,
    dados jsonb,
    gerado_em timestamptz,
    erro text,
    pedido_em timestamptz not null default now()
);
alter table painel_resultados_cache enable row level security;
-- sem policy: só service_role

-- Recalcula UMA chave por chamada (sorteada entre as desatualizadas pedidas
-- nas últimas 3 horas). Uma por vez porque o limite de tempo cancela a
-- chamada inteira: com sorteio, uma chave lenta não trava as outras.
create or replace function painel_cache_atualizar() returns text
language plpgsql security definer set search_path = public as $$
declare r record; v jsonb; v_desde date;
begin
    select * into r from painel_resultados_cache
    where pedido_em > now() - interval '3 hours'
      and (gerado_em is null or gerado_em < now() - interval '4 minutes')
    order by random() limit 1;
    if not found then return null; end if;
    if r.tipo = 'campanha' then
        v := painel_campanha(r.slug);
    else
        v_desde := case when r.dias = 0 then date '2026-09-01' else current_date - r.dias end;
        v := painel_escolas(r.filiais, v_desde);
    end if;
    update painel_resultados_cache set dados = v, gerado_em = now(), erro = null where chave = r.chave;
    return r.chave;
end $$;
revoke all on function painel_cache_atualizar() from public, anon, authenticated;

do $$ begin
    perform cron.unschedule('painel-resultados-cache') where exists (select 1 from cron.job where jobname = 'painel-resultados-cache');
end $$;
select cron.schedule('painel-resultados-cache', '* * * * *',
    $c$set statement_timeout = '50s'; select painel_cache_atualizar();$c$);

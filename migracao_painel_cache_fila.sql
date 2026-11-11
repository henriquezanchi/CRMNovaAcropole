-- Painel de resultados (11/11/2026): o job recalculava UMA chave sorteada por minuto.
-- Com ~11 chaves em uso, um painel aberto pela 1ª vez podia esperar 10+ minutos
-- ("Os números estão sendo preparados..." sem fim). Cada cálculo leva menos de 1 s,
-- então agora o job processa várias chaves por rodada, dentro de 30 s, começando
-- pelas que nunca foram calculadas e depois pelas mais antigas.
create or replace function painel_cache_atualizar() returns text
language plpgsql security definer set search_path = public as $$
declare r record; v jsonb; v_desde date; inicio timestamptz := clock_timestamp(); n int := 0;
begin
    for r in select * from painel_resultados_cache
             where pedido_em > now() - interval '3 hours'
               and (gerado_em is null or gerado_em < now() - interval '4 minutes')
             order by (dados is null) desc, gerado_em nulls first
    loop
        exit when clock_timestamp() - inicio > interval '30 seconds';
        begin
            if r.tipo = 'campanha' then
                v := painel_campanha(r.slug);
            else
                v_desde := case when r.dias = 0 then date '2026-09-01' else current_date - r.dias end;
                v := painel_escolas(r.filiais, v_desde);
            end if;
            update painel_resultados_cache set dados = v, gerado_em = now(), erro = null where chave = r.chave;
            n := n + 1;
        exception when others then
            update painel_resultados_cache set erro = left(sqlerrm, 500), gerado_em = now() where chave = r.chave;
        end;
    end loop;
    return n || ' chave(s)';
end $$;
revoke all on function painel_cache_atualizar() from public, anon, authenticated;

-- Painel dos diretores (13/11/2026): os inscritos do Ulisses passam a vir a cada 10 min, mas o cache recalculava
-- só 1 chave sorteada por minuto (com ~15 chaves, cada uma demorava ~15 min). As chaves de campanha custam menos
-- de 1 s cada (medido: dmf-2026 0,5 s, demais < 0,1 s), então todas as desatualizadas são recalculadas a cada
-- rodada; as de escolas (mais pesadas) continuam uma sorteada por vez.
create or replace function painel_cache_atualizar() returns text
language plpgsql security definer set search_path = public as $$
declare r record; v jsonb; v_desde date; feitas text := '';
begin
    for r in select * from painel_resultados_cache
        where tipo = 'campanha' and pedido_em > now() - interval '3 hours'
          and (gerado_em is null or gerado_em < now() - interval '2 minutes')
    loop
        v := painel_campanha(r.slug);
        update painel_resultados_cache set dados = v, gerado_em = now(), erro = null where chave = r.chave;
        feitas := feitas || r.chave || ' ';
    end loop;
    select * into r from painel_resultados_cache
    where tipo <> 'campanha' and pedido_em > now() - interval '3 hours'
      and (gerado_em is null or gerado_em < now() - interval '4 minutes')
    order by random() limit 1;
    if found then
        v_desde := case when r.dias = 0 then date '2026-09-01' else current_date - r.dias end;
        v := painel_escolas(r.filiais, v_desde);
        update painel_resultados_cache set dados = v, gerado_em = now(), erro = null where chave = r.chave;
        feitas := feitas || r.chave;
    end if;
    return nullif(trim(feitas), '');
end $$;
revoke all on function painel_cache_atualizar() from public, anon, authenticated;
select painel_cache_atualizar() feitas;

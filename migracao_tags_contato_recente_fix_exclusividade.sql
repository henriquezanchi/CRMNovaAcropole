-- Correção: "Contato Recente: 7 dias" e "Contato Recente: 30 dias" eram
-- tratadas como independentes (podiam coexistir) — pedido do usuário
-- (2026-10-06, logo depois de ver o resultado ao vivo): "não pode ter as
-- duas ao mesmo tempo... se entramos em contato nos últimos 7 dias,
-- significa que entramos em contato nos últimos 30 dias, então é
-- redundância". Agora são MUTUAMENTE EXCLUSIVAS: dentro de 7 dias, só a
-- tag de 7 dias aparece (a de 30 nunca aparece junto); entre 7 e 30
-- dias, só a de 30.
create or replace function sincronizar_tags_contato_recente()
returns void
language plpgsql
as $$
declare
  rec record;
  arr jsonb;
  nova_arr jsonb;
  tem_7 boolean;
  tem_30 boolean;
  deve_ter_7 boolean;
  deve_ter_30 boolean;
  total_atualizados int := 0;
begin
  for rec in
    select "pessoaIdentificador", tags, ultimo_contato_em
    from leads_inscricoes
    where lixeira_em is null
  loop
    begin
      arr := coalesce((rec.tags #>> '{}')::jsonb, '[]'::jsonb);
      if jsonb_typeof(arr) <> 'array' then arr := '[]'::jsonb; end if;
    exception when others then
      arr := '[]'::jsonb;
    end;

    deve_ter_7 := rec.ultimo_contato_em is not null and rec.ultimo_contato_em >= now() - interval '7 days';
    -- "30 dias" só vale quando NÃO vale a de 7 (mutuamente exclusivas)
    deve_ter_30 := (not deve_ter_7) and rec.ultimo_contato_em is not null and rec.ultimo_contato_em >= now() - interval '30 days';
    tem_7 := arr @> '["Contato Recente: 7 dias"]'::jsonb;
    tem_30 := arr @> '["Contato Recente: 30 dias"]'::jsonb;

    if deve_ter_7 = tem_7 and deve_ter_30 = tem_30 then
      continue; -- já está em dia
    end if;

    -- Remove as 2 tags primeiro, depois reaplica só a que vale (nunca as 2 juntas)
    select coalesce(jsonb_agg(v), '[]'::jsonb) into nova_arr
    from jsonb_array_elements(arr) v
    where v <> '"Contato Recente: 7 dias"'::jsonb and v <> '"Contato Recente: 30 dias"'::jsonb;

    if deve_ter_7 then
      nova_arr := nova_arr || '["Contato Recente: 7 dias"]'::jsonb;
    elsif deve_ter_30 then
      nova_arr := nova_arr || '["Contato Recente: 30 dias"]'::jsonb;
    end if;

    update leads_inscricoes
    set tags = to_jsonb(nova_arr::text)
    where "pessoaIdentificador" = rec."pessoaIdentificador";
    total_atualizados := total_atualizados + 1;
  end loop;

  raise notice 'sincronizar_tags_contato_recente: % lead(s) atualizados', total_atualizados;
end;
$$;

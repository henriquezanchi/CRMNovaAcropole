-- Mesclagem de duplicados com o mesmo telefone ou e-mail e o mesmo nome (06/11/2026).
-- Lista revisada a partir de uma varredura só de leitura das 12 escolas ativas: nome igual, abreviado ou com
-- erro de digitação (ex.: "RAFEL"/"RAFAEL", "MARTA"/"MARTHA"). Ficaram FORA: nomes que podem ser irmãos
-- (gênero trocado: Israela/Israel, Bruna/Bruno...), família que só bateu por inicial, nome solto ambíguo,
-- cadastros de teste e grupos com 2 matrículas diferentes no Mercúrio. Fica o cadastro com matrícula do
-- Mercúrio; sem matrícula, o do Ulisses; depois o nome mais completo.
-- Usa mesclar_leads_preservando_vinculos (backup, vínculos, conversas e requalificação preservados).

create or replace function crm_mesclar_cadastros(p_principal text, p_outros text[], p_autor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare principal leads_inscricoes; ids text[]; ts jsonb; hs jsonb; resumo text; campos jsonb;
begin
  ids := array_append(p_outros, p_principal);
  perform 1 from leads_inscricoes where "pessoaIdentificador" = any(ids) order by "pessoaIdentificador" for update;
  if (select count(*) from leads_inscricoes where "pessoaIdentificador" = any(ids)) <> cardinality(ids) then
    return jsonb_build_object('ok', false, 'motivo', 'cadastro já não existe');
  end if;
  if (select count(distinct filial) from leads_inscricoes where "pessoaIdentificador" = any(ids)) > 1 then
    return jsonb_build_object('ok', false, 'motivo', 'escolas diferentes');
  end if;
  select * into principal from leads_inscricoes where "pessoaIdentificador" = p_principal;
  select coalesce(jsonb_agg(distinct t), '[]') into ts from leads_inscricoes l cross join lateral jsonb_array_elements_text(tags_seguras_mesclagem(l.tags)) t where l."pessoaIdentificador" = any(ids);
  select coalesce(jsonb_agg(t order by t::text), '[]') into hs from (select distinct t from leads_inscricoes l cross join lateral jsonb_array_elements(coalesce(l.historico_eventos, '[]')) t where l."pessoaIdentificador" = any(ids)) e;
  select string_agg(distinct trim(t), E'
---
' order by trim(t)) into resumo from (
    select regexp_split_to_table(coalesce(l.resumo_ia, ''), E'
---
') t from leads_inscricoes l where l."pessoaIdentificador" = any(ids)
    union all select 'E-mail alternativo (de ' || l."pessoaNome" || '): ' || l."pessoaEmail" from leads_inscricoes l where l."pessoaIdentificador" = any(p_outros) and nullif(trim(l."pessoaEmail"), '') is not null and lower(l."pessoaEmail") is distinct from lower(principal."pessoaEmail")
    union all select 'Telefone alternativo (de ' || l."pessoaNome" || '): ' || concat_ws(' ', l."pessoaTelefoneDDD", l."pessoaTelefoneNumero") from leads_inscricoes l where l."pessoaIdentificador" = any(p_outros) and nullif(trim(l."pessoaTelefoneNumero"), '') is not null and concat_ws(' ', l."pessoaTelefoneDDD", l."pessoaTelefoneNumero") <> concat_ws(' ', principal."pessoaTelefoneDDD", principal."pessoaTelefoneNumero")
  ) notas where trim(t) <> '';
  campos := jsonb_build_object('tags', ts::text, 'historico_eventos', hs,
    'eventoNome', (select string_agg(t->>'evento', ' | ') from jsonb_array_elements(hs) t),
    'eventoData', (select string_agg(t->>'data', ' | ') from jsonb_array_elements(hs) t),
    'resumo_ia', resumo,
    'pessoaEmail', coalesce(nullif(trim(principal."pessoaEmail"), ''), (select "pessoaEmail" from leads_inscricoes where "pessoaIdentificador" = any(p_outros) and email_seguro_mesclagem("pessoaEmail") is not null order by "pessoaIdentificador" limit 1)),
    'pessoaTelefoneDDD', case when nullif(trim(principal."pessoaTelefoneNumero"), '') is not null then principal."pessoaTelefoneDDD" else (select "pessoaTelefoneDDD" from leads_inscricoes where "pessoaIdentificador" = any(p_outros) and nullif(trim("pessoaTelefoneNumero"), '') is not null order by "pessoaIdentificador" limit 1) end,
    'pessoaTelefoneNumero', coalesce(nullif(trim(principal."pessoaTelefoneNumero"), ''), (select "pessoaTelefoneNumero" from leads_inscricoes where "pessoaIdentificador" = any(p_outros) and nullif(trim("pessoaTelefoneNumero"), '') is not null order by "pessoaIdentificador" limit 1)));
  perform mesclar_leads_preservando_vinculos(p_principal, p_outros, campos, p_autor);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function crm_mesclar_cadastros(text, text[], text) from public, anon, authenticated;

do $$
declare g record; r jsonb; ok int := 0; falhas jsonb := '[]';
begin
  for g in select * from (values
  ('1042041142', array['442075']::text[]),
  ('375299', array['375541']::text[]),
  ('437319', array['448297']::text[]),
  ('535157', array['531153']::text[]),
  ('1042033491', array['418316']::text[]),
  ('525662', array['428268']::text[]),
  ('1038049993', array['534082']::text[]),
  ('1038049994', array['531831']::text[]),
  ('418302', array['418312']::text[]),
  ('1039042413', array['478751', '430489']::text[]),
  ('515398', array['508319']::text[]),
  ('347896', array['313933']::text[]),
  ('317103', array['301005']::text[]),
  ('242213', array['951001733']::text[]),
  ('554385', array['554403']::text[]),
  ('951000126', array['436723']::text[]),
  ('240464', array['242077']::text[]),
  ('321060', array['951000162']::text[]),
  ('951001191', array['343437']::text[]),
  ('951001263', array['324031']::text[]),
  ('997024847', array['363863']::text[]),
  ('306774', array['319194']::text[]),
  ('278992', array['280824']::text[]),
  ('951001378', array['308295']::text[]),
  ('997015318', array['276991']::text[]),
  ('554404', array['554384', '555359']::text[]),
  ('509471', array['230887']::text[]),
  ('951001214', array['278769']::text[]),
  ('324608', array['317940']::text[]),
  ('951001130', array['324037']::text[]),
  ('512742', array['335104']::text[]),
  ('951001738', array['238936']::text[]),
  ('901000075', array['466075']::text[]),
  ('307964', array['308771']::text[]),
  ('319847', array['326913']::text[]),
  ('997046120', array['284819']::text[]),
  ('306502', array['308414']::text[]),
  ('523691', array['519614']::text[]),
  ('901000108', array['515812']::text[]),
  ('455609', array['524526']::text[]),
  ('535816', array['537874']::text[]),
  ('951002391', array['300666']::text[]),
  ('279375', array['261023']::text[]),
  ('951001227', array['279571']::text[]),
  ('531751', array['447262']::text[]),
  ('997053390', array['559877']::text[]),
  ('1533', array['901000135']::text[]),
  ('13903', array['901000141']::text[]),
  ('951000900', array['375644']::text[]),
  ('951000019', array['538655']::text[]),
  ('951001307', array['325039']::text[]),
  ('58', array['318562']::text[]),
  ('257283', array['104011']::text[]),
  ('951001036', array['360897']::text[]),
  ('951000266', array['471838']::text[]),
  ('517491', array['517972']::text[]),
  ('951001163', array['360905']::text[]),
  ('313534', array['530757']::text[]),
  ('951001247', array['329920']::text[]),
  ('951001387', array['308772']::text[]),
  ('951000229', array['447942']::text[]),
  ('901000205', array['524239']::text[]),
  ('951000903', array['360651']::text[]),
  ('234157', array['240596']::text[]),
  ('951002447', array['343290']::text[]),
  ('1543', array['303125']::text[]),
  ('901000226', array['414445']::text[]),
  ('323550', array['323574']::text[]),
  ('951000848', array['371452']::text[]),
  ('257370', array['240599']::text[]),
  ('951000823', array['400388']::text[]),
  ('951000944', array['378579']::text[]),
  ('951000706', array['345538']::text[]),
  ('951001101', array['360918']::text[]),
  ('951001527', array['15706']::text[]),
  ('951002390', array['31516']::text[]),
  ('951002068', array['328433']::text[]),
  ('240583', array['232236']::text[]),
  ('503111', array['508524']::text[]),
  ('351952', array['343167']::text[]),
  ('1041023909', array['360118']::text[]),
  ('1041019956', array['325141']::text[]),
  ('1041027712', array['353292']::text[]),
  ('1041019955', array['325140', '326390']::text[]),
  ('322258', array['353558']::text[]),
  ('303485', array['344331']::text[]),
  ('1041019693', array['322273']::text[]),
  ('464421', array['446399']::text[]),
  ('1041047463', array['528558']::text[]),
  ('370048', array['348599']::text[]),
  ('353512', array['345411']::text[]),
  ('280904', array['280905']::text[]),
  ('505079', array['505086']::text[]),
  ('263318', array['298907']::text[]),
  ('342180', array['355552']::text[]),
  ('524234', array['517412', '525799']::text[]),
  ('260371', array['264012']::text[]),
  ('1041017277', array['330830', '303721']::text[]),
  ('1041019662', array['325349']::text[]),
  ('370650', array['370956']::text[]),
  ('374011', array['400239']::text[]),
  ('1041046629', array['488196']::text[]),
  ('528449', array['532343']::text[]),
  ('233671', array['491331']::text[]),
  ('1041019687', array['343521']::text[]),
  ('1041021203', array['353291']::text[]),
  ('340449', array['351055']::text[]),
  ('1041022937', array['318093']::text[]),
  ('1041033010', array['414700']::text[]),
  ('990000089', array['448610']::text[]),
  ('509517', array['522435']::text[]),
  ('467752', array['468327']::text[]),
  ('990000087', array['467605']::text[]),
  ('990000064', array['465922']::text[]),
  ('538843', array['537896']::text[]),
  ('352027', array['410409']::text[]),
  ('1048027705', array['361161']::text[]),
  ('352058', array['360779']::text[]),
  ('448495', array['375222']::text[]),
  ('1048024883', array['398270']::text[]),
  ('449768', array['449767']::text[]),
  ('1048051227', array['540558']::text[]),
  ('436443', array['449016']::text[])
  ) v(principal, outros) loop
    begin
      r := crm_mesclar_cadastros(g.principal, g.outros, 'Claude (varredura de duplicados, 06/11/2026)');
      if (r->>'ok')::boolean then ok := ok + 1; else falhas := falhas || jsonb_build_object('principal', g.principal, 'motivo', r->>'motivo'); end if;
    exception when others then
      falhas := falhas || jsonb_build_object('principal', g.principal, 'motivo', sqlerrm);
    end;
  end loop;
  insert into log_atividade (filial, acao, autor, detalhes)
  values ('GLOBAL', 'mesclagem_varredura_duplicados', 'Claude (varredura de duplicados, 06/11/2026)',
          jsonb_build_object('grupos_mesclados', ok, 'falhas', falhas));
end $$;

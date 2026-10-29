-- Mesclagem automática pelo Mercúrio (2026-10-29, aprovada pelo usuário depois do
-- caso Andressa Alves/Andressa Sousa: mesma pessoa, sobrenome diferente no Ulisses).
-- Par elegível, sempre na mesma filial:
--   A = cadastro ligado a uma ficha do Mercúrio (ativo ou inativo);
--   B = outro cadastro, sem matrícula e sem ficha própria, com o MESMO e-mail ou o
--       MESMO telefone da ficha E o mesmo primeiro nome (família divide contato:
--       com primeiro nome diferente nunca mescla).
-- B que bate com mais de um A fica de fora (ambíguo). Quem fica é sempre A, com o
-- nome oficial do Mercúrio. Usa mesclar_leads_preservando_vinculos (backup,
-- redirecionamento de ids, vínculos preservados e requalificação na hora).
begin;
create or replace function crm_mesclar_pelo_mercurio(p_aplicar boolean default false, p_limite int default 500)
returns jsonb language plpgsql security definer set search_path=public as $$
declare g record; ids text[]; principal leads_inscricoes; ts jsonb; hs jsonb; resumo text; campos jsonb;
 feitos jsonb := '[]'; falhas jsonb := '[]'; erro text;
begin
 perform pg_advisory_xact_lock(20261019,42); -- mesma trava da mesclagem inteligente
 for g in
  with lk as materialized (
   select l.filial, l."pessoaIdentificador" p, l."pessoaNome" nome, lower(nullif(trim(l."pessoaEmail"),'')) email,
    crm_chave_telefone(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero") tel, l.matricula_mercurio matr
   from leads_inscricoes l join filiais f on f.nome=l.filial and f.ativo and nullif(trim(f.mercurio_unidade),'') is not null
   where l.lixeira_em is null
  ),
  fichas as materialized (
   select m.filial, m.email, m.tel_chave, m.nome mnome, a.p a
   from mercurio_pessoas m join lk a on a.filial=m.filial and (a.p=m.pessoa_identificador or a.matr=m.matricula)
  ),
  ligados as materialized (select distinct a from fichas),
  pares as (
   select distinct f.a, b.p b, f.filial from fichas f join lk b on b.filial=f.filial and b.p<>f.a
    and ((f.email is not null and b.email=f.email) or (f.tel_chave is not null and b.tel=f.tel_chave))
    and crm_primeiro_nome(b.nome)=crm_primeiro_nome(f.mnome)
   where b.matr is null and not exists(select 1 from ligados x where x.a=b.p)
  ),
  unicos as (select * from pares where b in (select b from pares group by b having count(distinct a)=1))
  select a, filial, array_agg(b order by b) bs from unicos group by a, filial order by filial, a limit greatest(p_limite,1)
 loop
  begin
   ids := array_append(g.bs, g.a);
   perform 1 from leads_inscricoes where "pessoaIdentificador"=any(ids) order by "pessoaIdentificador" for update;
   select * into principal from leads_inscricoes where "pessoaIdentificador"=g.a;
   if not p_aplicar then
    feitos := feitos || jsonb_build_object('filial',g.filial,'fica',principal."pessoaNome",
     'sai',(select jsonb_agg("pessoaNome") from leads_inscricoes where "pessoaIdentificador"=any(g.bs)));
    continue;
   end if;
   select coalesce(jsonb_agg(distinct t),'[]') into ts from leads_inscricoes l cross join lateral jsonb_array_elements_text(tags_seguras_mesclagem(l.tags)) t where l."pessoaIdentificador"=any(ids);
   select coalesce(jsonb_agg(t order by t::text),'[]') into hs from (select distinct t from leads_inscricoes l cross join lateral jsonb_array_elements(coalesce(l.historico_eventos,'[]')) t where l."pessoaIdentificador"=any(ids)) e;
   select string_agg(distinct trim(t),E'\n---\n' order by trim(t)) into resumo from (
    select regexp_split_to_table(coalesce(l.resumo_ia,''),E'\n---\n') t from leads_inscricoes l where l."pessoaIdentificador"=any(ids)
    union all select 'E-mail alternativo (de '||l."pessoaNome"||'): '||l."pessoaEmail" from leads_inscricoes l where l."pessoaIdentificador"=any(g.bs) and nullif(trim(l."pessoaEmail"),'') is not null and l."pessoaEmail" is distinct from principal."pessoaEmail"
    union all select 'Telefone alternativo (de '||l."pessoaNome"||'): '||concat_ws(' ',l."pessoaTelefoneDDD",l."pessoaTelefoneNumero") from leads_inscricoes l where l."pessoaIdentificador"=any(g.bs) and nullif(trim(l."pessoaTelefoneNumero"),'') is not null and concat_ws(' ',l."pessoaTelefoneDDD",l."pessoaTelefoneNumero")<>concat_ws(' ',principal."pessoaTelefoneDDD",principal."pessoaTelefoneNumero")
   ) notas where trim(t)<>'';
   campos := jsonb_build_object('tags',ts::text,'historico_eventos',hs,
    'eventoNome',(select string_agg(t->>'evento',' | ') from jsonb_array_elements(hs) t),'eventoData',(select string_agg(t->>'data',' | ') from jsonb_array_elements(hs) t),
    'resumo_ia',resumo,
    'pessoaEmail',coalesce(nullif(trim(principal."pessoaEmail"),''),(select "pessoaEmail" from leads_inscricoes where "pessoaIdentificador"=any(g.bs) and email_seguro_mesclagem("pessoaEmail") is not null order by "pessoaIdentificador" limit 1)),
    'pessoaTelefoneDDD',case when nullif(trim(principal."pessoaTelefoneNumero"),'') is not null then principal."pessoaTelefoneDDD" else (select "pessoaTelefoneDDD" from leads_inscricoes where "pessoaIdentificador"=any(g.bs) and nullif(trim("pessoaTelefoneNumero"),'') is not null order by "pessoaIdentificador" limit 1) end,
    'pessoaTelefoneNumero',coalesce(nullif(trim(principal."pessoaTelefoneNumero"),''),(select "pessoaTelefoneNumero" from leads_inscricoes where "pessoaIdentificador"=any(g.bs) and nullif(trim("pessoaTelefoneNumero"),'') is not null order by "pessoaIdentificador" limit 1)));
   perform mesclar_leads_preservando_vinculos(g.a, g.bs, campos, 'Mesclagem automática pelo Mercúrio (mesmo contato e primeiro nome)');
   feitos := feitos || jsonb_build_object('filial',g.filial,'fica',g.a,'sai',to_jsonb(g.bs));
  exception when others then
   get stacked diagnostics erro = message_text;
   falhas := falhas || jsonb_build_object('fica',g.a,'sai',to_jsonb(g.bs),'erro',erro);
  end;
 end loop;
 return jsonb_build_object('aplicado',p_aplicar,'grupos',jsonb_array_length(feitos),'cadastros_removidos',
  (select coalesce(sum(jsonb_array_length(coalesce(e.value->'sai','[]'::jsonb))),0) from jsonb_array_elements(feitos) e),'falhas',falhas,'amostra',
  (select coalesce(jsonb_agg(e.value),'[]') from (select value from jsonb_array_elements(feitos) limit 40) e));
end $$;
revoke all on function crm_mesclar_pelo_mercurio(boolean,int) from public, anon, authenticated;
commit;

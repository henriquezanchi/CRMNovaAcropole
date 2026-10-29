-- Mesclagem e Kanban respeitando a requalificação (2026-10-29, pedido do usuário
-- depois de mesclar dois cadastros da mesma aluna e ela ficar com PP e N1, com
-- temperatura e em "Vai à Palestra" ao mesmo tempo).
--  * mesclar_leads_preservando_vinculos: passa adiante o vínculo em
--    mercurio_pessoas e chama crm_requalificar_leads() para o sobrevivente.
--  * crm_reorganizar_kanban: aluno ativo / matrícula do mês / Não Contatar vão
--    para a coluna certa mesmo se o card foi movido à mão há menos de 3 dias.
begin;
CREATE OR REPLACE FUNCTION public.mesclar_leads_preservando_vinculos(p_principal text, p_outros text[], p_campos jsonb, p_autor text DEFAULT 'Equipe CRM'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ids text[];b jsonb;v jsonb;par text[];matriculas jsonb;faltantes int;nova_matricula int;restricao text;atual leads_inscricoes;edicao leads_inscricoes;
begin
 select array_agg(distinct x order by x) into ids from unnest(array_append(p_outros,p_principal)) x;
 if cardinality(ids)<2 or cardinality(ids)>100 or p_principal is null or p_principal=any(p_outros) then raise exception 'Selecione cadastros distintos para mesclar.';end if;
 perform 1 from leads_inscricoes where "pessoaIdentificador"=any(ids) order by "pessoaIdentificador" for update;
 select cardinality(ids)-count(*) into faltantes from leads_inscricoes where "pessoaIdentificador"=any(ids);
 if faltantes<>0 then raise exception 'Um cadastro mudou ou já foi mesclado. Atualize antes de continuar.';end if;
 select * into atual from leads_inscricoes where "pessoaIdentificador"=p_principal;
 select jsonb_build_object('leads',jsonb_agg(to_jsonb(l))) into b from leads_inscricoes l where "pessoaIdentificador"=any(ids);
 select coalesce(jsonb_agg(distinct m) filter(where m is not null),'[]'::jsonb) into matriculas from (select matricula_mercurio m from leads_inscricoes where "pessoaIdentificador"=any(ids) union select (x#>>'{}')::bigint from auditoria_crm_reconsultas q cross join lateral jsonb_array_elements(q.matriculas) x where q.pessoa=any(ids)) t;
 -- Captura registros vinculados antes de qualquer mudança. Backup sem leitura pública.
 foreach par slice 1 in array array[
 ['mensagens_whatsapp','pessoaIdentificador'],['evento_leads','pessoaIdentificador'],['tarefa_leads','pessoaIdentificador'],['classificacoes_resposta_convite','pessoaIdentificador'],['sugestoes_resposta_wpp','pessoaIdentificador'],['mencoes_resumo','pessoaIdentificador'],['mercurio_alunos','pessoa_identificador'],['cobranca_itens','pessoa_identificador'],['funil_analises_conversa','pessoa'],['auditoria_crm_reconsultas','pessoa']
 ] loop
  if to_regclass('public.'||par[1]) is not null then
   execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from %I t where %I=any($1)',par[1],par[2]) into v using ids;
   b=b||jsonb_build_object(par[1],v);
  end if;
 end loop;
 insert into auditoria_crm_backup(sobrevivente,origem,registros) values(p_principal,'mesclagem_com_vinculos',b);
 -- Consolida todos os cadastros do mesmo evento (inclusive grupos de três ou mais).
 for v in
  select jsonb_build_object('evento',evento_id,'manter',coalesce(min(id) filter(where "pessoaIdentificador"=p_principal),min(id)),
   'compareceu',bool_or(compareceu),'matriculado',bool_or(matriculado),'ulisses',bool_or(origem='ulisses'),
   'resposta',(array_agg(resposta_convite order by atualizado_em desc nulls last,id desc))[1],
   'nota',string_agg(distinct nullif(nota,''),E'\n'))
  from evento_leads where "pessoaIdentificador"=any(ids) group by evento_id
 loop
  delete from evento_leads where "pessoaIdentificador"=any(ids) and evento_id=(v->>'evento')::bigint and id<>(v->>'manter')::bigint;
  update evento_leads set "pessoaIdentificador"=p_principal,compareceu=(v->>'compareceu')::boolean,matriculado=(v->>'matriculado')::boolean,
   origem=case when (v->>'ulisses')::boolean then 'ulisses' else origem end,resposta_convite=v->>'resposta',nota=v->>'nota' where id=(v->>'manter')::bigint;
 end loop;
 if to_regclass('public.tarefa_leads') is not null then
  for v in select jsonb_build_object('tarefa',tarefa_id,'manter',coalesce(min(id) filter(where "pessoaIdentificador"=p_principal),min(id)),
   'concluida',bool_or(concluida),'concluida_em',max(concluida_em)) from tarefa_leads where "pessoaIdentificador"=any(ids) group by tarefa_id
  loop
   delete from tarefa_leads where "pessoaIdentificador"=any(ids) and tarefa_id=(v->>'tarefa')::bigint and id<>(v->>'manter')::bigint;
   update tarefa_leads set "pessoaIdentificador"=p_principal,concluida=(v->>'concluida')::boolean,concluida_em=(v->>'concluida_em')::timestamptz where id=(v->>'manter')::bigint;
  end loop;
 end if;
 foreach par slice 1 in array array[
 ['mensagens_whatsapp','pessoaIdentificador'],['tarefa_leads','pessoaIdentificador'],['classificacoes_resposta_convite','pessoaIdentificador'],['sugestoes_resposta_wpp','pessoaIdentificador'],['mencoes_resumo','pessoaIdentificador'],['mercurio_alunos','pessoa_identificador'],['mercurio_pessoas','pessoa_identificador'],['cobranca_itens','pessoa_identificador']
 ] loop
  if to_regclass('public.'||par[1]) is not null then execute format('update %I set %I=$1 where %I=any($2)',par[1],par[2],par[2]) using p_principal,p_outros;end if;
 end loop;
 delete from funil_analises_conversa where pessoa=any(p_outros);
 insert into funil_analises_conversa(filial,pessoa) select distinct filial,p_principal from mensagens_whatsapp where "pessoaIdentificador"=p_principal and filial is not null
 on conflict(filial,pessoa) do update set versao=funil_analises_conversa.versao+1,estado='pendente',atualizado_em=now();
 -- Lista branca de campos do formulário: nunca aceita trocar filial, identidade ou valores financeiros.
 select * into edicao from jsonb_populate_record(atual,(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(p_campos) where key in ('tags','historico_eventos','eventoNome','eventoData','pessoaTelefoneDDD','pessoaTelefoneNumero','pessoaEmail','resumo_ia')));
 select case when count(distinct matricula_mercurio)=1 then min(matricula_mercurio) else atual.matricula_mercurio end into nova_matricula from leads_inscricoes where "pessoaIdentificador"=any(ids);
 update leads_inscricoes set matricula_mercurio=null where "pessoaIdentificador"=any(p_outros);
 if exists(select 1 from leads_inscricoes where "pessoaIdentificador"=any(ids) and acompanhamento->>'contato'='nao_contatar') then restricao='nao_contatar';
 elsif exists(select 1 from leads_inscricoes where "pessoaIdentificador"=any(ids) and acompanhamento->>'contato'='pausado') then restricao='pausado';end if;
 update leads_inscricoes set tags=edicao.tags,historico_eventos=edicao.historico_eventos,"eventoNome"=edicao."eventoNome","eventoData"=edicao."eventoData","pessoaTelefoneDDD"=edicao."pessoaTelefoneDDD","pessoaTelefoneNumero"=edicao."pessoaTelefoneNumero","pessoaEmail"=edicao."pessoaEmail",resumo_ia=edicao.resumo_ia,matricula_mercurio=coalesce(atual.matricula_mercurio,nova_matricula),acompanhamento=case when restricao is not null then coalesce(atual.acompanhamento,'{}'::jsonb)||jsonb_build_object('contato',restricao,'pausa_ate','') else atual.acompanhamento end where "pessoaIdentificador"=p_principal;
 update crm_leads_mesclados set destino=p_principal where destino=any(p_outros);
 insert into crm_leads_mesclados(original,destino) select unnest(p_outros),p_principal on conflict(original) do update set destino=excluded.destino;
 delete from leads_a_tratar where pessoa_id=any(p_outros);
 delete from leads_inscricoes where "pessoaIdentificador"=any(p_outros);
 delete from auditoria_crm_reconsultas where pessoa=any(p_outros);
 update auditoria_crm_pendencias set sobrevivente=p_principal,estado='reconsultar' where sobrevivente=any(p_outros);
 insert into auditoria_crm_reconsultas(pessoa,matriculas) values(p_principal,matriculas)
 on conflict(pessoa) do update set estado='pendente',solicitado_em=now(),matriculas=excluded.matriculas,erro=null;
 update auditoria_crm_pendencias p set sobrevivente=p_principal,estado='reconsultar' where p.pessoas_ids ?| ids and not exists(select 1 from jsonb_array_elements_text(p.pessoas_ids) x left join crm_leads_mesclados a on a.original=x join leads_inscricoes l on l."pessoaIdentificador"=coalesce(a.destino,x) where l."pessoaIdentificador"<>p_principal);
 -- Etiquetas de situação/nível recalculadas pelo Mercúrio: a união das etiquetas
 -- dos cadastros nunca deixa dois níveis, Ativo com temperatura etc. (2026-10-29)
 perform crm_requalificar_leads(atual.filial, true, p_principal);
 insert into log_atividade(filial,acao,autor,pessoa_ids,detalhes) values(atual.filial,'mesclar_leads',p_autor,to_jsonb(ids),jsonb_build_object('principal',p_principal,'apagados',p_outros,'vinculos_preservados',true,'reconsulta_ativos','pendente'));
 return jsonb_build_object('ok',true,'principal',p_principal,'reconsulta','pendente');
end $function$;

create or replace function crm_reorganizar_kanban(p_forcar boolean default false, p_aplicar boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_lote uuid := gen_random_uuid(); v_mov jsonb; v_total int;
begin
 drop table if exists _crm_kanban_mov;
 create temp table _crm_kanban_mov as
 select a.* from crm_kanban_alvos() a
 where a.alvo is distinct from a.atual
  and (p_forcar or a.alvo in ('Alunos','Matriculados','Truncados') or not (a.atualizado_em > now()-interval '3 days'
   and (a.auto_em is null or a.atualizado_em > a.auto_em + interval '5 seconds')));
 select count(*) into v_total from _crm_kanban_mov;
 select coalesce(jsonb_object_agg(k,n),'{}'::jsonb) into v_mov
 from (select coalesce(atual,'(vazio)')||' → '||alvo k, count(*) n from _crm_kanban_mov group by 1) x;
 if p_aplicar and v_total>0 then
  insert into crm_kanban_movimentos(lote,filial,pessoa,de,para,motivo,forcado)
  select v_lote,filial,pessoa,atual,alvo,motivo,p_forcar from _crm_kanban_mov;
  update leads_inscricoes l set funil_agencia=m.alvo, funil_agencia_atualizado_em=now(), funil_auto_em=now()
  from _crm_kanban_mov m where l."pessoaIdentificador"=m.pessoa and l.filial=m.filial;
  insert into log_atividade(filial,acao,autor,pessoa_ids,detalhes)
  select filial,'kanban_reorganizado','Kanban automático',jsonb_agg(pessoa),
   jsonb_build_object('lote',v_lote,'forcado',p_forcar,'movimentos',count(*))
  from _crm_kanban_mov group by filial;
 end if;
 drop table if exists _crm_kanban_mov;
 return jsonb_build_object('lote',v_lote,'aplicado',p_aplicar and v_total>0,'total',v_total,'movimentos',v_mov);
end $$;
commit;

create or replace function painel_auditoria_crm(p_filial text default null,p_tipo text default 'duplicidade',p_apos bigint default null,p_busca text default '') returns jsonb language sql stable set search_path=public as $$
with ultima as (select * from auditoria_crm_execucoes order by criado_em desc limit 1),
 casos as (
 select p.* from auditoria_crm_pendencias p join ultima u on p.execucao=u.id
 where p.estado='pendente' and (p_tipo='todos' or (p_tipo='duplicidade' and jsonb_array_length(p.pessoas_ids)>1) or (p_tipo='identidade' and jsonb_array_length(p.pessoas_ids)=1))
 and (p_filial is null or p.filial=p_filial or exists(select 1 from jsonb_array_elements_text(p.pessoas_ids) x left join crm_leads_mesclados a on a.original=x join leads_inscricoes l on l."pessoaIdentificador"=coalesce(a.destino,x) where l.filial=p_filial))
 and (nullif(trim(p_busca),'') is null or exists(select 1 from jsonb_array_elements_text(p.pessoas_ids) x left join crm_leads_mesclados a on a.original=x join leads_inscricoes l on l."pessoaIdentificador"=coalesce(a.destino,x) where l."pessoaNome" ilike '%'||left(p_busca,100)||'%' or x ilike '%'||left(p_busca,100)||'%'))
), pagina as (
 select p.*,(select jsonb_agg(jsonb_build_object('pessoa',l."pessoaIdentificador",'nome',l."pessoaNome",'filial',l.filial,'matricula',l.matricula_mercurio,'tags',l.tags,'telefone',concat_ws(' ',l."pessoaTelefoneDDD",l."pessoaTelefoneNumero"),'email',l."pessoaEmail") order by l."pessoaIdentificador") from jsonb_array_elements_text(p.pessoas_ids) x left join crm_leads_mesclados a on a.original=x join leads_inscricoes l on l."pessoaIdentificador"=coalesce(a.destino,x)) leads
 from casos p where p_apos is null or p.id>p_apos order by p.id limit 50
), resumo as (
 select count(*) leads,count(*) filter(where resultado in ('conferido','corrigido')) confirmados,count(*) filter(where resultado='corrigido') corrigidos,count(*) filter(where resultado='sem_correspondencia') sem_registro,count(*) filter(where resultado not in ('conferido','corrigido','sem_correspondencia')) conferir
 from auditoria_crm_resultados r join ultima u on r.execucao=u.id where p_filial is null or r.filial=p_filial
)
select jsonb_build_object('execucao',(select to_jsonb(u) from ultima u),'resumo',(select to_jsonb(r) from resumo r),'total_casos',(select count(*) from casos),'casos',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from pagina p),'reconsultas',(select coalesce(jsonb_agg(t),'[]'::jsonb) from (select q.pessoa,l."pessoaNome" nome,q.estado,q.resultado,q.conferido_em from auditoria_crm_reconsultas q join leads_inscricoes l on l."pessoaIdentificador"=q.pessoa where p_filial is null or l.filial=p_filial order by q.solicitado_em desc limit 20) t));
$$;

create or replace function assumir_reconsulta_auditoria() returns jsonb language plpgsql security definer set search_path=public as $$
declare q auditoria_crm_reconsultas;l jsonb;
begin
 select * into q from auditoria_crm_reconsultas where estado='pendente' or (estado='processando' and solicitado_em<now()-interval '5 minutes') or (estado='erro' and solicitado_em<now()-interval '2 minutes') order by solicitado_em for update skip locked limit 1;
 if q.pessoa is null then return null;end if;
 update auditoria_crm_reconsultas set estado='processando',solicitado_em=now(),erro=null where pessoa=q.pessoa;
 select to_jsonb(t) into l from (select "pessoaIdentificador" pessoa,"pessoaNome" nome,"pessoaTelefoneDDD" ddd,"pessoaTelefoneNumero" telefone,"pessoaEmail" email,matricula_mercurio,tags from leads_inscricoes where "pessoaIdentificador"=q.pessoa) t;
 return jsonb_build_object('pessoa',q.pessoa,'matriculas',q.matriculas,'lead',l);
end $$;
revoke all on function assumir_reconsulta_auditoria() from public,anon,authenticated;
grant execute on function assumir_reconsulta_auditoria() to service_role;
create or replace function concluir_reconsulta_auditoria(p_pessoa text,p_ativo boolean,p_antes jsonb,p_matricula bigint default null,p_nivel text default null,p_erro text default null) returns void language plpgsql security definer set search_path=public as $$
declare l leads_inscricoes;ts jsonb;antes jsonb;nivel text;
begin
 select * into l from leads_inscricoes where "pessoaIdentificador"=p_pessoa for update;
 if l."pessoaIdentificador" is null then update auditoria_crm_reconsultas set estado='erro',erro='Cadastro não disponível' where pessoa=p_pessoa;return;end if;
 if p_erro is not null then update auditoria_crm_reconsultas set estado='erro',erro=left(p_erro,300),solicitado_em=now() where pessoa=p_pessoa;return;end if;
 antes=jsonb_build_object('pessoa',l."pessoaIdentificador",'nome',l."pessoaNome",'ddd',l."pessoaTelefoneDDD",'telefone',l."pessoaTelefoneNumero",'email',l."pessoaEmail",'matricula_mercurio',l.matricula_mercurio,'tags',l.tags);
 if antes is distinct from p_antes then update auditoria_crm_reconsultas set estado='pendente' where pessoa=p_pessoa;return;end if;
 if p_ativo then
  ts=case when jsonb_typeof(l.tags)='string' then (l.tags#>>'{}')::jsonb when jsonb_typeof(l.tags)='array' then l.tags else '[]'::jsonb end;
  select coalesce(jsonb_agg(t),'[]') into ts from jsonb_array_elements_text(ts) t where t not in ('Ativo','Aluno Ativo','Inativo','Ex-Aluno (Inativo)');
  nivel=case when trim(upper(p_nivel)) in ('TA','CO') then 'Merlin' when trim(upper(p_nivel)) in ('CA','JN','PP','N1') then trim(upper(p_nivel)) when trim(upper(p_nivel)) ~ '^N[2-7]$' then 'Membro' else null end;
  if nivel is not null then select coalesce(jsonb_agg(t),'[]') into ts from jsonb_array_elements_text(ts) t where t not in ('Merlin','CA','JN','PP','N1','Membro','TA') and t !~ '^N[2-7]$';ts=ts||to_jsonb(nivel);end if;
  ts=ts||'"Ativo"'::jsonb;
  update leads_inscricoes set tags=to_jsonb(ts::text),matricula_mercurio=coalesce(case when exists(select 1 from leads_inscricoes outro where outro.filial=l.filial and outro.matricula_mercurio=p_matricula and outro."pessoaIdentificador"<>p_pessoa) then null else p_matricula end,matricula_mercurio) where "pessoaIdentificador"=p_pessoa;
 end if;
 update auditoria_crm_reconsultas set estado='concluido',conferido_em=now(),resultado=case when p_ativo then 'Ativo confirmado no Mercúrio' else 'Não confirmado entre os ativos; nenhuma inativação por ausência' end,erro=null where pessoa=p_pessoa;
 update auditoria_crm_pendencias set estado='resolvida',reconsultado_em=now() where sobrevivente=p_pessoa and estado='reconsultar';
 insert into log_atividade(filial,acao,autor,pessoa_ids,detalhes) values(l.filial,'reconsulta_ativos_pos_mesclagem','Auditoria automática',jsonb_build_array(p_pessoa),jsonb_build_object('ativo_confirmado',p_ativo,'matricula',p_matricula,'tags_antes',l.tags,'consulta_restrita',true));
end $$;
revoke all on function concluir_reconsulta_auditoria(text,boolean,jsonb,bigint,text,text) from public,anon,authenticated;
grant execute on function concluir_reconsulta_auditoria(text,boolean,jsonb,bigint,text,text) to service_role;
create or replace function descartar_caso_auditoria(p_id bigint,p_autor text) returns void language plpgsql security definer set search_path=public as $$
declare p auditoria_crm_pendencias;
begin
 select * into p from auditoria_crm_pendencias where id=p_id for update;
 if p.id is null then raise exception 'Caso não encontrado';end if;
 update auditoria_crm_pendencias set estado='descartada' where id=p_id;
 insert into log_atividade(filial,acao,autor,pessoa_ids,detalhes) values(p.filial,'auditoria_caso_descartado',p_autor,p.pessoas_ids,jsonb_build_object('caso',p.id,'motivo',p.motivo));
end $$;

-- Recuperação conservadora: fonte privada recente, comparação concorrente e cópia integral.
create table if not exists auditoria_contatos_correcoes (
 id bigint generated always as identity primary key,pessoa text not null,criado_em timestamptz not null default now(),modo text not null,
 antes jsonb not null,depois jsonb not null,fonte jsonb not null,historico_em_conferencia jsonb not null default '[]',vinculos_em_conferencia jsonb not null default '[]',backup_id bigint
);
alter table auditoria_contatos_correcoes enable row level security;
drop policy if exists leitura_recuperacao_contatos on auditoria_contatos_correcoes;
create policy leitura_recuperacao_contatos on auditoria_contatos_correcoes for select using(true);
create or replace function recuperar_contato_crm(p_pessoa text,p_modo text) returns jsonb language plpgsql security definer set search_path=public as $$
declare l leads_inscricoes;e auditoria_contatos_fontes;f jsonb;d leads_inscricoes;alvo_filial text;fone text;ddd text;ts jsonb;depois jsonb;ev jsonb;hist jsonb;bid bigint;cid bigint;ids jsonb;quant int;
begin
 if p_modo not in ('mistura','ddd') then raise exception 'Modo inválido';end if;
 select * into l from leads_inscricoes where "pessoaIdentificador"=p_pessoa for update;
 select * into e from auditoria_contatos_fontes where pessoa=p_pessoa;
 if l."pessoaIdentificador" is null or e.pessoa is null or e.consultado_em<now()-interval '2 days' then raise exception 'Falta evidência recente';end if;
 if exists(select 1 from auditoria_contatos_correcoes where pessoa=p_pessoa and modo=p_modo) then return jsonb_build_object('estado','ja_recuperado');end if;
 if jsonb_build_object('pessoaIdentificador',l."pessoaIdentificador",'pessoaNome',l."pessoaNome",'filial',l.filial,'pessoaTelefoneDDD',l."pessoaTelefoneDDD",'pessoaTelefoneNumero',l."pessoaTelefoneNumero",'pessoaEmail',l."pessoaEmail",'matricula_mercurio',l.matricula_mercurio) is distinct from e.cadastro_antes then raise exception 'Cadastro alterado após a consulta; conferir novamente';end if;
 select count(*),min(x::text)::jsonb into quant,f from jsonb_array_elements(e.fontes) x where upper(trim(x->>'cad_nome'))=upper(trim(l."pessoaNome"));
 if quant<>1 or (l.matricula_mercurio is not null and l.matricula_mercurio<>(f->>'cad_matr')::bigint) then raise exception 'Identidade não confirmada de forma única';end if;
 if coalesce(f->>'cad_cel_ddd','') ~ '^[1-9][0-9]$' and coalesce(f->>'cad_cel_fone','') ~ '^[0-9]{8,9}$' then ddd=f->>'cad_cel_ddd';fone=f->>'cad_cel_fone';
 elsif coalesce(f->>'cad_res_ddd','') ~ '^[1-9][0-9]$' and coalesce(f->>'cad_res_fone','') ~ '^[0-9]{8,9}$' then ddd=f->>'cad_res_ddd';fone=f->>'cad_res_fone';end if;
 if p_modo='ddd' then
  if fone is null or right(fone,8)<>right(regexp_replace(coalesce(l."pessoaTelefoneNumero",''),'[^0-9]','','g'),8) or l."pessoaTelefoneDDD"=ddd or not (l.matricula_mercurio=(f->>'cad_matr')::bigint or (nullif(l."pessoaEmail",'') is not null and lower(l."pessoaEmail")=lower(f->>'cad_email'))) then raise exception 'DDD sem confirmação independente';end if;
  alvo_filial=l.filial;
 else
  if p_pessoa !~ '^990000[0-9]{3}$' or coalesce(f->>'cad_email','') !~ '^[^ @]+@[^ @]+\.[^ @]+$' or lower(coalesce(l."pessoaEmail",''))=lower(f->>'cad_email') then raise exception 'Fora do lote comprovado de contatos misturados';end if;
  -- Telefone + e-mail pertencem a outro cadastro de nome distinto e confirmado na fonte.
  select outro.* into d from leads_inscricoes outro where outro."pessoaIdentificador"<>p_pessoa
   and lower(outro."pessoaEmail")=lower(l."pessoaEmail") and outro."pessoaTelefoneDDD"=l."pessoaTelefoneDDD" and right(outro."pessoaTelefoneNumero",8)=right(l."pessoaTelefoneNumero",8)
   and upper(split_part(outro."pessoaNome",' ',1))<>upper(split_part(l."pessoaNome",' ',1))
   and (exists(select 1 from auditoria_crm_fonte s where upper(trim(s.nome))=upper(trim(outro."pessoaNome")) and lower(s.email)=lower(outro."pessoaEmail"))
    or exists(select 1 from auditoria_contatos_fontes de cross join lateral jsonb_array_elements(de.fontes) ds where de.pessoa=outro."pessoaIdentificador" and de.consultado_em>now()-interval '2 days' and upper(trim(ds->>'cad_nome'))=upper(trim(outro."pessoaNome")) and ((ds->>'cad_res_ddd'=outro."pessoaTelefoneDDD" and right(ds->>'cad_res_fone',8)=right(outro."pessoaTelefoneNumero",8)) or (ds->>'cad_cel_ddd'=outro."pessoaTelefoneDDD" and right(ds->>'cad_cel_fone',8)=right(outro."pessoaTelefoneNumero",8)))))
   and (l.matricula_mercurio=(f->>'cad_matr')::bigint or (jsonb_typeof(l.historico_eventos)='array' and jsonb_array_length(l.historico_eventos)>0 and l.historico_eventos=outro.historico_eventos))
   order by outro."pessoaIdentificador" limit 1;
  if d."pessoaIdentificador" is null then raise exception 'Sem prova independente da mistura';end if;
  if exists(select 1 from mensagens_whatsapp where "pessoaIdentificador"=p_pessoa) or exists(select 1 from tarefa_leads where "pessoaIdentificador"=p_pessoa) or exists(select 1 from cobranca_itens where pessoa_identificador=p_pessoa) then raise exception 'Há trabalho ou cobrança vinculada: preservar para conferência individual';end if;
  select nome into alvo_filial from filiais where mercurio_unidade=f->>'cad_unidade';
  if alvo_filial is null then raise exception 'Unidade oficial sem mapeamento';end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into ev from evento_leads t where "pessoaIdentificador"=p_pessoa;
 hist=coalesce(l.historico_eventos,'[]');
 insert into auditoria_crm_backup(sobrevivente,origem,registros) values(p_pessoa,'recuperacao_contato_'||p_modo,jsonb_build_object('lead',to_jsonb(l),'evento_leads',ev,'fonte',f)) returning id into bid;
 ts=case when jsonb_typeof(l.tags)='string' then (l.tags#>>'{}')::jsonb when jsonb_typeof(l.tags)='array' then l.tags else '[]'::jsonb end;
 if p_modo='mistura' then
  -- Histórico sem procedência permanece na auditoria, fora da medição e da união em mesclagens.
  select coalesce(jsonb_agg(t),'[]') into ts from jsonb_array_elements_text(ts) t where t not like 'Trilha:%' and t not like 'Jornada:%' and t not like 'Retorno:%' and t not like 'Lead Forte%' and t not in ('Inscrito: Abertura de Turma','Sem Telefone','Sem E-mail','Telefone sem DDD confirmado','Histórico em conferência');
  ts=ts||'"Histórico em conferência"'::jsonb;
  if fone is null then ts=ts||'"Sem Telefone"'::jsonb;end if;
  update leads_inscricoes set filial=alvo_filial,"pessoaTelefoneDDD"=ddd,"pessoaTelefoneNumero"=fone,"pessoaEmail"=lower(trim(f->>'cad_email')),historico_eventos='[]',"eventoNome"='',"eventoData"='',tags=to_jsonb(ts::text),matricula_mercurio=case when exists(select 1 from leads_inscricoes z where z.filial=alvo_filial and z.matricula_mercurio=(f->>'cad_matr')::bigint and z."pessoaIdentificador"<>p_pessoa) then null else (f->>'cad_matr')::bigint end where "pessoaIdentificador"=p_pessoa;
  delete from evento_leads where "pessoaIdentificador"=p_pessoa;
  -- Os pares de nomes distintos deixaram de ser candidatos por contato.
  update auditoria_crm_pendencias set estado='corrigida_origem' where estado='pendente' and pessoas_ids ? p_pessoa and pessoas_ids ? d."pessoaIdentificador" and (motivo ilike '%telefone%' or motivo ilike '%email%' or motivo ilike '%e-mail%');
 else
  update leads_inscricoes set "pessoaTelefoneDDD"=ddd where "pessoaIdentificador"=p_pessoa;
 end if;
 select to_jsonb(t) into depois from leads_inscricoes t where "pessoaIdentificador"=p_pessoa;
 insert into auditoria_contatos_correcoes(pessoa,modo,antes,depois,fonte,historico_em_conferencia,vinculos_em_conferencia,backup_id) values(p_pessoa,p_modo,to_jsonb(l),depois,f,case when p_modo='mistura' then hist else '[]'::jsonb end,case when p_modo='mistura' then ev else '[]'::jsonb end,bid) returning id into cid;
 select coalesce(jsonb_agg("pessoaIdentificador"),'[]') into ids from leads_inscricoes z where z.filial=alvo_filial and upper(trim(z."pessoaNome"))=upper(trim(l."pessoaNome"));
 insert into auditoria_crm_pendencias(execucao,filial,pessoas_ids,motivo,evidencias) select id,alvo_filial,ids,case when p_modo='mistura' then 'Contato e escola recuperados da fonte; histórico anterior separado para conferência (recuperação '||cid||')' else 'DDD recuperado da fonte, sem trocar o número local (recuperação '||cid||')' end,jsonb_build_array(jsonb_build_object('matricula',f->>'cad_matr','unidade',f->>'cad_unidade','nome',f->>'cad_nome','situacao',f->>'cad_situacao')) from auditoria_crm_execucoes order by criado_em desc limit 1;
 insert into log_atividade(acao,autor,filial,pessoa_ids,detalhes) values('recuperacao_contato_fonte','Auditoria de integridade',alvo_filial,jsonb_build_array(p_pessoa),jsonb_build_object('correcao',cid,'modo',p_modo,'backup',bid,'filial_antes',l.filial,'filial_depois',alvo_filial,'matricula',f->>'cad_matr','historico_em_conferencia',p_modo='mistura'));
 return jsonb_build_object('estado','recuperado','correcao',cid,'modo',p_modo,'filial_corrigida',l.filial<>alvo_filial);
end $$;
revoke all on function recuperar_contato_crm(text,text) from public,anon,authenticated;
grant execute on function recuperar_contato_crm(text,text) to service_role;

create or replace function painel_recuperacao_contatos(p_filial text default null,p_busca text default '',p_apos bigint default null) returns jsonb language sql stable set search_path=public as $$
with base as (
 select c.*,l."pessoaIdentificador" destino,l."pessoaNome" nome,l.filial,l."pessoaTelefoneDDD" ddd,l."pessoaTelefoneNumero" telefone,l."pessoaEmail" email
 from auditoria_contatos_correcoes c left join crm_leads_mesclados a on a.original=c.pessoa join leads_inscricoes l on l."pessoaIdentificador"=coalesce(a.destino,c.pessoa)
 where (p_filial is null or l.filial=p_filial or c.antes->>'filial'=p_filial)
 and (nullif(trim(p_busca),'') is null or l."pessoaNome" ilike '%'||left(p_busca,100)||'%' or c.pessoa ilike '%'||left(p_busca,100)||'%')
), pagina as (
 select id,pessoa,destino,nome,filial,ddd,telefone,email,modo,criado_em,fonte->>'cad_matr' matricula,fonte->>'cad_unidade' unidade,antes->>'filial' filial_antes,
 concat_ws(' ',antes->>'pessoaTelefoneDDD',antes->>'pessoaTelefoneNumero') telefone_antes,antes->>'pessoaEmail' email_antes,historico_em_conferencia,jsonb_array_length(vinculos_em_conferencia) vinculos_separados
 from base where p_apos is null or id>p_apos order by id limit 50
)
select jsonb_build_object('total',(select count(*) from base),'ddd',(select count(*) from base where modo='ddd'),'contatos',(select count(*) from base where modo='mistura'),'filiais',(select count(*) from base where antes->>'filial'<>depois->>'filial'),'vinculos',(select coalesce(sum(jsonb_array_length(vinculos_em_conferencia)),0) from base),'casos',(select coalesce(jsonb_agg(p),'[]'::jsonb) from pagina p));
$$;

create or replace function sinalizar_contato_suspeito(p_pessoa text) returns void language plpgsql security definer set search_path=public as $$
declare l leads_inscricoes;e auditoria_contatos_fontes;ts jsonb;provas jsonb;
begin
 select * into l from leads_inscricoes where "pessoaIdentificador"=p_pessoa for update;
 select * into e from auditoria_contatos_fontes where pessoa=p_pessoa;
 if l."pessoaIdentificador" is null or e.pessoa is null or p_pessoa !~ '^990000[0-9]{3}$' or exists(select 1 from auditoria_contatos_correcoes where pessoa=p_pessoa) then raise exception 'Caso não elegível';end if;
 if exists(select 1 from auditoria_crm_pendencias where estado='pendente' and pessoas_ids=jsonb_build_array(p_pessoa) and motivo like 'Contato suspeito:%') then return;end if;
 ts=case when jsonb_typeof(l.tags)='string' then (l.tags#>>'{}')::jsonb when jsonb_typeof(l.tags)='array' then l.tags else '[]'::jsonb end;
 insert into auditoria_crm_backup(sobrevivente,origem,registros) values(p_pessoa,'contato_suspeito_sinalizado',jsonb_build_object('lead',to_jsonb(l),'fonte',e.fontes));
 if not ts ? 'Contato em conferência' then ts=ts||'"Contato em conferência"'::jsonb;end if;
 update leads_inscricoes set tags=to_jsonb(ts::text) where "pessoaIdentificador"=p_pessoa;
 select coalesce(jsonb_agg(jsonb_build_object('matricula',x->>'cad_matr','unidade',x->>'cad_unidade','nome',x->>'cad_nome','situacao',x->>'cad_situacao','telefone',concat_ws(' ',nullif(x->>'cad_res_ddd','0'),x->>'cad_res_fone'),'email',x->>'cad_email')),'[]') into provas from jsonb_array_elements(e.fontes) x;
 insert into auditoria_crm_pendencias(execucao,filial,pessoas_ids,motivo,evidencias) select id,l.filial,jsonb_build_array(p_pessoa),'Contato suspeito: telefone e e-mail coincidem com outro nome; a identidade ou a procedência do histórico precisa de conferência antes de corrigir ou mesclar',provas from auditoria_crm_execucoes order by criado_em desc limit 1;
 insert into log_atividade(acao,autor,filial,pessoa_ids,detalhes) values('contato_suspeito_sinalizado','Auditoria de integridade',l.filial,jsonb_build_array(p_pessoa),jsonb_build_object('originais_preservados',true,'envio_bloqueado',true));
end $$;
revoke all on function sinalizar_contato_suspeito(text) from public,anon,authenticated;
grant execute on function sinalizar_contato_suspeito(text) to service_role;

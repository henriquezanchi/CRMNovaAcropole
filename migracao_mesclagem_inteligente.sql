-- Decisão explicável, baseada em contatos atuais e fonte oficial; nunca por nome sozinho.
create or replace function nome_tokens_mesclagem(p_nome text) returns text[] language sql immutable as $$
 select coalesce(array_agg(t order by n),'{}') from unnest(regexp_split_to_array(trim(regexp_replace(translate(upper(coalesce(p_nome,'')),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','AAAAAEEEEIIIIOOOOOUUUUC'),'[^A-Z ]',' ','g')),'\s+')) with ordinality x(t,n) where t<>'' and t not in ('DE','DA','DO','DAS','DOS','E');
$$;
create or replace function nomes_seguros_mesclagem(a text,b text) returns boolean language plpgsql immutable as $$
declare x text[]:=nome_tokens_mesclagem(a);y text[]:=nome_tokens_mesclagem(b);tmp text[];i int;j int:=1;
begin
 if cardinality(x)<2 or cardinality(y)<2 then return false;end if;
 -- Primeiro nome e último sobrenome por extenso; iniciais internas são permitidas.
 if x[1]<>y[1] or x[cardinality(x)]<>y[cardinality(y)] or length(x[1])<2 or length(x[cardinality(x)])<2 then return false;end if;
 if cardinality(x)>cardinality(y) then tmp=x;x=y;y=tmp;end if;
 for i in 1..cardinality(x) loop
  while j<=cardinality(y) and not (x[i]=y[j] or (length(x[i])=1 and y[j] like x[i]||'%') or (length(y[j])=1 and x[i] like y[j]||'%')) loop j=j+1;end loop;
  if j>cardinality(y) then return false;end if;j=j+1;
 end loop;
 return true;
end $$;
create or replace function telefone_seguro_mesclagem(ddd text,numero text) returns text language plpgsql immutable as $$
declare d text:=regexp_replace(coalesce(ddd,''),'\D','','g');n text:=regexp_replace(coalesce(numero,''),'\D','','g');
begin
 if d !~ '^[1-9][0-9]$' then return null;end if;
 if length(n)=9 and left(n,1)='9' then n=substr(n,2);end if;
 if n !~ '^[2-9][0-9]{7}$' or n ~ '^(.)\1{7}$' then return null;end if;
 return d||n;
end $$;
create or replace function email_seguro_mesclagem(v text) returns text language sql immutable as $$
 select case when lower(trim(v)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then lower(trim(v)) end;
$$;
create or replace function tags_seguras_mesclagem(v jsonb) returns jsonb language plpgsql immutable as $$
begin
 if v is null then return '[]';end if;
 if jsonb_typeof(v)='string' then v=(v#>>'{}')::jsonb;end if;
 if jsonb_typeof(v)<>'array' then return null;end if;
 if exists(select 1 from jsonb_array_elements(v) t where jsonb_typeof(t)<>'string') then return null;end if;
 return v;
exception when others then return null;
end $$;

-- As expressões também são usadas nas consultas de conflito em toda a rede.
create index if not exists leads_email_mesclagem_idx on leads_inscricoes(email_seguro_mesclagem("pessoaEmail"));
create index if not exists leads_telefone_mesclagem_idx on leads_inscricoes(telefone_seguro_mesclagem("pessoaTelefoneDDD","pessoaTelefoneNumero"));
create index if not exists fonte_email_mesclagem_idx on auditoria_crm_fonte(execucao,email_seguro_mesclagem(email));
create index if not exists fonte_telefone_mesclagem_idx on auditoria_crm_fonte(execucao,telefone_seguro_mesclagem(telefone_ddd,telefone));

-- Somente serviço: a fonte e os snapshots não são expostos no navegador.
create or replace function avaliar_mesclagem_inteligente(p_ids text[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare a leads_inscricoes;b leads_inscricoes;ids text[];exec uuid;f auditoria_crm_fonte;mat bigint;uni text;identidades int;provas text[]:='{}';tel text;em text;regra text;ts jsonb;
begin
 select array_agg(distinct t order by t) into ids from unnest(p_ids) t;
 if cardinality(ids)<2 or cardinality(ids)>20 then return jsonb_build_object('elegivel',false,'motivo','Grupo inválido');end if;
 if (select count(*) from leads_inscricoes where "pessoaIdentificador"=any(ids))<>cardinality(ids) then return jsonb_build_object('elegivel',false,'motivo','Cadastro alterado ou já mesclado');end if;
 if (select count(distinct filial) from leads_inscricoes where "pessoaIdentificador"=any(ids))<>1 or exists(select 1 from leads_inscricoes where "pessoaIdentificador"=any(ids) and (filial is null or lixeira_em is not null)) then return jsonb_build_object('elegivel',false,'motivo','Escolas diferentes ou cadastro na lixeira');end if;
 if (select count(distinct matricula_mercurio) from leads_inscricoes where "pessoaIdentificador"=any(ids) and matricula_mercurio>0)>1 then return jsonb_build_object('elegivel',false,'motivo','Matrículas oficiais diferentes');end if;
 if exists(select 1 from auditoria_crm_pendencias p where p.estado='descartada' and (select count(*) from jsonb_array_elements_text(p.pessoas_ids) t where t=any(ids))>=2) then return jsonb_build_object('elegivel',false,'motivo','Grupo já descartado pela equipe');end if;
 for a in select * from leads_inscricoes where "pessoaIdentificador"=any(ids) loop
  ts=tags_seguras_mesclagem(a.tags);
  if ts is null or ts ?| array['Histórico em conferência','Contato em conferência'] then return jsonb_build_object('elegivel',false,'motivo','Contato ou histórico em conferência');end if;
  for b in select * from leads_inscricoes where "pessoaIdentificador"=any(ids) and "pessoaIdentificador">a."pessoaIdentificador" loop
   if not nomes_seguros_mesclagem(a."pessoaNome",b."pessoaNome") then return jsonb_build_object('elegivel',false,'motivo','Nomes sem compatibilidade suficiente');end if;
   if a.data_nascimento is not null and b.data_nascimento is not null and a.data_nascimento<>b.data_nascimento then return jsonb_build_object('elegivel',false,'motivo','Datas de nascimento diferentes');end if;
  end loop;
  tel=telefone_seguro_mesclagem(a."pessoaTelefoneDDD",a."pessoaTelefoneNumero");em=email_seguro_mesclagem(a."pessoaEmail");
  if exists(select 1 from leads_inscricoes outro where not outro."pessoaIdentificador"=any(ids) and outro.lixeira_em is null and not nomes_seguros_mesclagem(a."pessoaNome",outro."pessoaNome") and ((tel is not null and tel=telefone_seguro_mesclagem(outro."pessoaTelefoneDDD",outro."pessoaTelefoneNumero")) or (em is not null and em=email_seguro_mesclagem(outro."pessoaEmail")))) then return jsonb_build_object('elegivel',false,'motivo','Contato compartilhado com outra identidade');end if;
 end loop;
 -- Telefones e e-mails iguais nos dois cadastros, além dos nomes compatíveis.
 if (select count(distinct telefone_seguro_mesclagem("pessoaTelefoneDDD","pessoaTelefoneNumero"))=1 and count(telefone_seguro_mesclagem("pessoaTelefoneDDD","pessoaTelefoneNumero"))=count(*) and count(distinct email_seguro_mesclagem("pessoaEmail"))=1 and count(email_seguro_mesclagem("pessoaEmail"))=count(*) from leads_inscricoes where "pessoaIdentificador"=any(ids)) then regra='nome_telefone_email';end if;
 select id into exec from auditoria_crm_execucoes where fonte_completa and criado_em>now()-interval '7 days' order by criado_em desc limit 1;
 if exec is not null then
  for a in select * from leads_inscricoes where "pessoaIdentificador"=any(ids) loop
   tel=telefone_seguro_mesclagem(a."pessoaTelefoneDDD",a."pessoaTelefoneNumero");em=email_seguro_mesclagem(a."pessoaEmail");
   -- Revalida os contatos atuais: não reutiliza cegamente uma conclusão antiga da auditoria.
   if exists(select 1 from auditoria_crm_fonte s where s.execucao=exec and not nomes_seguros_mesclagem(a."pessoaNome",s.nome) and ((tel is not null and tel=telefone_seguro_mesclagem(s.telefone_ddd,s.telefone)) or (em is not null and em=email_seguro_mesclagem(s.email)))) then return jsonb_build_object('elegivel',false,'motivo','Contato compartilhado na fonte oficial');end if;
   select count(*) into identidades from auditoria_crm_fonte s where s.execucao=exec and nomes_seguros_mesclagem(a."pessoaNome",s.nome) and (a.matricula_mercurio=s.matricula or (tel is not null and tel=telefone_seguro_mesclagem(s.telefone_ddd,s.telefone)) or (em is not null and em=email_seguro_mesclagem(s.email)));
   if identidades<>1 then
    if a.matricula_mercurio is not null or identidades>1 then return jsonb_build_object('elegivel',false,'motivo','Identidade oficial ambígua ou divergente');end if;
    continue;
   end if;
   select * into f from auditoria_crm_fonte s where s.execucao=exec and nomes_seguros_mesclagem(a."pessoaNome",s.nome) and (a.matricula_mercurio=s.matricula or (tel is not null and tel=telefone_seguro_mesclagem(s.telefone_ddd,s.telefone)) or (em is not null and em=email_seguro_mesclagem(s.email)));
   if a.matricula_mercurio is not null and a.matricula_mercurio<>f.matricula then return jsonb_build_object('elegivel',false,'motivo','Matrícula diverge do contato confirmado');end if;
   if mat is not null and (mat<>f.matricula or uni<>f.unidade) then return jsonb_build_object('elegivel',false,'motivo','Contatos apontam para identidades oficiais diferentes');end if;
   mat=f.matricula;uni=f.unidade;provas=array_append(provas,a."pessoaIdentificador");
  end loop;
 end if;
 if cardinality(provas)=cardinality(ids) then regra='identidade_oficial_confirmada';end if;
 if regra is null then return jsonb_build_object('elegivel',false,'motivo','Falta prova independente além do nome');end if;
 return jsonb_build_object('elegivel',true,'regra',regra,'matricula',mat,'unidade',uni,'fonte',exec,'ids',ids);
end $$;
revoke all on function avaliar_mesclagem_inteligente(text[]) from public,anon,authenticated;
grant execute on function avaliar_mesclagem_inteligente(text[]) to service_role;

alter table auditoria_crm_pendencias add column if not exists auto_avaliado_em timestamptz;
alter table auditoria_crm_pendencias add column if not exists auto_motivo text;

create or replace function processar_mesclagens_inteligentes(p_aplicar boolean default false,p_limite int default 100) returns jsonb language plpgsql security definer set search_path=public as $$
declare caso record;ids text[];d jsonb;principal leads_inscricoes;completo leads_inscricoes;ts jsonb;hs jsonb;resumo text;outros text[];campos jsonb;feitos jsonb:='[]';recusados jsonb:='[]';erro text;resultado jsonb;nome_completo text;
begin
 -- Também serializa as rodadas de simulação e execução; mesclagem manual continua usando locks por cadastro.
 perform pg_advisory_xact_lock(20261019,42);
 for caso in select min(p.id) id,p.pessoas_ids from auditoria_crm_pendencias p where p.estado='pendente' and jsonb_array_length(p.pessoas_ids) between 2 and 20 group by p.pessoas_ids order by min(p.auto_avaliado_em) nulls first,min(p.id) limit least(greatest(p_limite,1),5000) loop
  begin
   select array_agg(t order by t) into ids from jsonb_array_elements_text(caso.pessoas_ids) t;
   perform 1 from leads_inscricoes where "pessoaIdentificador"=any(ids) order by "pessoaIdentificador" for update;
   d=avaliar_mesclagem_inteligente(ids);
   if p_aplicar then update auditoria_crm_pendencias set auto_avaliado_em=now(),auto_motivo=coalesce(d->>'regra',d->>'motivo') where estado='pendente' and pessoas_ids=caso.pessoas_ids;end if;
   if not (d->>'elegivel')::boolean then recusados=recusados||jsonb_build_object('caso',caso.id,'motivo',d->>'motivo');continue;end if;
   select * into principal from leads_inscricoes where "pessoaIdentificador"=any(ids) order by ("pessoaIdentificador"::numeric>=900000000),length("pessoaNome") desc,"pessoaIdentificador" limit 1;
   if not p_aplicar then feitos=feitos||jsonb_build_object('caso',caso.id,'principal',principal."pessoaIdentificador",'decisao',d);continue;end if;
   select "pessoaNome" into nome_completo from leads_inscricoes where "pessoaIdentificador"=any(ids) order by length("pessoaNome") desc,"pessoaIdentificador" limit 1;
   select * into completo from leads_inscricoes where "pessoaIdentificador"=any(ids) order by (matricula_mercurio is not null) desc,length("pessoaNome") desc,"pessoaIdentificador" limit 1;
   select coalesce(jsonb_agg(distinct t),'[]') into ts from leads_inscricoes l cross join lateral jsonb_array_elements_text(tags_seguras_mesclagem(l.tags)) t where l."pessoaIdentificador"=any(ids);
   select coalesce(jsonb_agg(t order by t::text),'[]') into hs from (select distinct t from leads_inscricoes l cross join lateral jsonb_array_elements(coalesce(l.historico_eventos,'[]')) t where l."pessoaIdentificador"=any(ids)) e;
   select coalesce(jsonb_agg(t),'[]') into ts from jsonb_array_elements_text(ts) t where not ((t='Retorno: Só 1 Evento' and (jsonb_array_length(hs)<>1 or ts ?| array['Ativo','Aluno Ativo','Inativo','Ex-Aluno (Inativo)'])) or (ts ?| array['Ativo','Aluno Ativo','Inativo','Ex-Aluno (Inativo)'] and (t like 'Lead Forte%' or t like 'Jornada:%')));
   -- E-mails/telefones alternativos continuam consultáveis; o contato do cadastro real é mantido.
   select string_agg(distinct trim(t),E'\n---\n' order by trim(t)) into resumo from (
    select regexp_split_to_table(coalesce(l.resumo_ia,''),E'\n---\n') t from leads_inscricoes l where l."pessoaIdentificador"=any(ids)
    union all select 'E-mail alternativo (de '||l."pessoaNome"||'): '||l."pessoaEmail" from leads_inscricoes l where l."pessoaIdentificador"=any(ids) and nullif(trim(l."pessoaEmail"),'') is not null and l."pessoaEmail" is distinct from principal."pessoaEmail"
    union all select 'Telefone alternativo (de '||l."pessoaNome"||'): '||concat_ws(' ',l."pessoaTelefoneDDD",l."pessoaTelefoneNumero") from leads_inscricoes l where l."pessoaIdentificador"=any(ids) and nullif(trim(l."pessoaTelefoneNumero"),'') is not null and concat_ws(' ',l."pessoaTelefoneDDD",l."pessoaTelefoneNumero")<>concat_ws(' ',principal."pessoaTelefoneDDD",principal."pessoaTelefoneNumero")
   ) notas where trim(t)<>'';
   select array_agg(t) into outros from unnest(ids) t where t<>principal."pessoaIdentificador";
   campos=jsonb_build_object('tags',ts::text,'historico_eventos',hs,'eventoNome',(select string_agg(t->>'evento',' | ') from jsonb_array_elements(hs) t),'eventoData',(select string_agg(t->>'data',' | ') from jsonb_array_elements(hs) t),'resumo_ia',resumo,
    'pessoaEmail',coalesce(nullif(trim(principal."pessoaEmail"),''),(select "pessoaEmail" from leads_inscricoes where "pessoaIdentificador"=any(ids) and email_seguro_mesclagem("pessoaEmail") is not null order by "pessoaIdentificador" limit 1)),
    'pessoaTelefoneDDD',case when nullif(trim(principal."pessoaTelefoneNumero"),'') is not null then principal."pessoaTelefoneDDD" else completo."pessoaTelefoneDDD" end,
    'pessoaTelefoneNumero',coalesce(nullif(trim(principal."pessoaTelefoneNumero"),''),completo."pessoaTelefoneNumero"));
   resultado=mesclar_leads_preservando_vinculos(principal."pessoaIdentificador",outros,campos,'Mesclagem automática: '||(d->>'regra'));
   -- Valores do próprio grupo, preservados também na cópia integral. Não transfere status de aluno para matrícula nova.
   update leads_inscricoes set "pessoaNome"=nome_completo,data_nascimento=coalesce(principal.data_nascimento,completo.data_nascimento),data_matricula=coalesce(principal.data_matricula,completo.data_matricula),data_saida=coalesce(principal.data_saida,completo.data_saida),motivo_saida=coalesce(principal.motivo_saida,completo.motivo_saida) where "pessoaIdentificador"=principal."pessoaIdentificador";
   insert into log_atividade(filial,acao,autor,pessoa_ids,detalhes) values(principal.filial,'mesclagem_automatica_evidencias','Mesclagem automática',to_jsonb(ids),d||jsonb_build_object('caso',caso.id,'principal',principal."pessoaIdentificador"));
   feitos=feitos||jsonb_build_object('caso',caso.id,'principal',principal."pessoaIdentificador",'decisao',d);
  exception when others then
   get stacked diagnostics erro=message_text;
   if p_aplicar then update auditoria_crm_pendencias set auto_avaliado_em=now(),auto_motivo='Falha; alterações do grupo desfeitas' where estado='pendente' and pessoas_ids=caso.pessoas_ids;end if;
   recusados=recusados||jsonb_build_object('caso',caso.id,'motivo','Falha; alterações do grupo desfeitas','erro',erro);
  end;
 end loop;
 return jsonb_build_object('aplicado',p_aplicar,'grupos',feitos,'total',jsonb_array_length(feitos),'recusados',recusados);
end $$;
revoke all on function processar_mesclagens_inteligentes(boolean,int) from public,anon,authenticated;
grant execute on function processar_mesclagens_inteligentes(boolean,int) to service_role;

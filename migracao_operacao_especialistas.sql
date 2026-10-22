begin;
create table if not exists crm_qualificacoes (
 filial text not null,pessoa text not null,versao bigint not null default 1,versao_analisada bigint not null default 0,
 estado text not null default 'pendente',resultado jsonb,criterio text,ultima_mensagem bigint not null default 0,
 lease text,lease_ate timestamptz,tentativas int not null default 0,proxima_em timestamptz default now(),erro text,
 atualizado_em timestamptz not null default now(),analisado_em timestamptz,primary key(filial,pessoa)
);
create table if not exists crm_passagens_agente (
 id bigint generated always as identity primary key,filial text not null,pessoa text not null,versao bigint not null,
 anterior text,atual text not null,evidencia jsonb,motivo text,criado_em timestamptz not null default now(),unique(filial,pessoa,versao)
);
create table if not exists crm_audio_transcricoes (
 mensagem_id bigint primary key references mensagens_whatsapp(id) on delete cascade,assinatura text not null,
 estado text not null default 'pendente',texto text,modelo text,lease text,lease_ate timestamptz,
 tentativas int not null default 0,proxima_em timestamptz default now(),erro text,bytes bigint,duracao_segundos numeric,
 atualizado_em timestamptz not null default now()
);
create table if not exists crm_ia_orcamento (
 dia date primary key,caracteres bigint not null default 0,audios int not null default 0,bytes_audio bigint not null default 0
);
create table if not exists crm_ia_config (
 id boolean primary key default true check(id),limite_caracteres_dia int not null default 300000 check(limite_caracteres_dia>=0),
 limite_audios_dia int not null default 20 check(limite_audios_dia>=0),limite_bytes_audio int not null default 12000000,
 transcricao_disponivel boolean not null default false
);
insert into crm_ia_config(id)values(true)on conflict do nothing;
alter table crm_qualificacoes enable row level security;
alter table crm_passagens_agente enable row level security;
alter table crm_audio_transcricoes enable row level security;
alter table crm_ia_orcamento enable row level security;
alter table crm_ia_config enable row level security;
drop policy if exists crm_qualificacoes_leitura on crm_qualificacoes;
create policy crm_qualificacoes_leitura on crm_qualificacoes for select using(true);
drop policy if exists crm_passagens_leitura on crm_passagens_agente;
create policy crm_passagens_leitura on crm_passagens_agente for select using(true);
drop policy if exists crm_audio_leitura on crm_audio_transcricoes;
create policy crm_audio_leitura on crm_audio_transcricoes for select using(true);

create or replace function crm_enfileirar_especialistas()returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare m mensagens_whatsapp;
begin
 if tg_op='UPDATE' and (new.filial,new."pessoaIdentificador",new.corpo_texto,new.tipo,new.payload_bruto->>'audio_url') is not distinct from (old.filial,old."pessoaIdentificador",old.corpo_texto,old.tipo,old.payload_bruto->>'audio_url') then return new;end if;
 if tg_op in ('DELETE','UPDATE') and old.filial is not null then
  insert into crm_qualificacoes(filial,pessoa)select old.filial,old."pessoaIdentificador" where old."pessoaIdentificador" is not null
  on conflict(filial,pessoa)do update set versao=crm_qualificacoes.versao+1,estado='pendente',proxima_em=now(),erro=null,tentativas=0,atualizado_em=now();
 end if;
 if tg_op='DELETE' then return old;end if;
 m=new;
 if m.filial is not null and m."pessoaIdentificador" is not null and (tg_op='INSERT' or (new.filial,new."pessoaIdentificador") is distinct from (old.filial,old."pessoaIdentificador")) then
  insert into crm_qualificacoes(filial,pessoa)values(m.filial,m."pessoaIdentificador")
  on conflict(filial,pessoa)do update set versao=crm_qualificacoes.versao+1,estado='pendente',proxima_em=now(),erro=null,tentativas=0,atualizado_em=now();
 end if;
 if m.tipo='audio' and m.direcao='entrada' and m.payload_bruto->>'audio_url' is not null then
  insert into crm_audio_transcricoes(mensagem_id,assinatura)values(m.id,md5(m.payload_bruto->>'audio_url'))
  on conflict(mensagem_id)do update set assinatura=excluded.assinatura,estado='pendente',texto=null,lease=null,lease_ate=null,tentativas=0,proxima_em=now()
  where crm_audio_transcricoes.assinatura<>excluded.assinatura;
 end if;
 return new;
end;$$;
drop trigger if exists crm_especialistas_mensagem on mensagens_whatsapp;
create trigger crm_especialistas_mensagem after insert or update or delete on mensagens_whatsapp for each row execute function crm_enfileirar_especialistas();
insert into crm_qualificacoes(filial,pessoa)
 select distinct l.filial,l."pessoaIdentificador" from leads_inscricoes l where l.filial is not null and l.lixeira_em is null on conflict do nothing;
-- Cadastros sem conversa não precisam de chamadas ao provedor nem de uma rodada por pessoa.
update crm_qualificacoes q set estado='concluido',versao_analisada=versao,criterio='agentes-crm-v2',resultado='{"etapa":"qualificacao","evidencia":null,"restricao":null,"sem_historico":true}'::jsonb,ultima_mensagem=0,analisado_em=now()
where resultado is null and not exists(select 1 from mensagens_whatsapp m where m.filial=q.filial and m."pessoaIdentificador"=q.pessoa);
insert into crm_audio_transcricoes(mensagem_id,assinatura)
 select id,md5(payload_bruto->>'audio_url')from mensagens_whatsapp where tipo='audio' and direcao='entrada' and payload_bruto->>'audio_url' is not null on conflict do nothing;

create or replace function crm_assumir_qualificacao(p_filial text,p_pessoa text,p_ate bigint,p_caracteres int,p_criterio text)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q crm_qualificacoes; chave text; dia_local date=(now()at time zone'America/Sao_Paulo')::date;
begin
 insert into crm_qualificacoes(filial,pessoa)values(p_filial,p_pessoa)on conflict do nothing;
 select * into q from crm_qualificacoes where filial=p_filial and pessoa=p_pessoa for update;
 if p_ate<>coalesce((select max(id)from mensagens_whatsapp where filial=p_filial and "pessoaIdentificador"=p_pessoa),0)then return jsonb_build_object('estado','obsoleto');end if;
 if q.versao=q.versao_analisada and q.criterio=p_criterio and q.estado='concluido' then return jsonb_build_object('estado','cache','resultado',q.resultado);end if;
 if q.lease_ate>now()then return jsonb_build_object('estado','ocupado');end if;
 if q.estado='erro' and q.proxima_em>now()then return jsonb_build_object('estado','aguardar');end if;
 perform pg_advisory_xact_lock(193445);
 insert into crm_ia_orcamento(dia)values(dia_local)on conflict do nothing;
 if p_caracteres<0 or p_caracteres>180000 then
  update crm_qualificacoes set estado='limite',erro='Histórico acima do limite integral.' where filial=p_filial and pessoa=p_pessoa;
  return jsonb_build_object('estado','limite');end if;
 if (select caracteres+p_caracteres from crm_ia_orcamento where dia=dia_local)>(select limite_caracteres_dia from crm_ia_config where id)then return jsonb_build_object('estado','orcamento');end if;
 update crm_ia_orcamento set caracteres=caracteres+p_caracteres where dia=dia_local;
 chave=gen_random_uuid()::text;
 update crm_qualificacoes set estado='processando',lease=chave,lease_ate=now()+interval'3 minutes',tentativas=tentativas+1 where filial=p_filial and pessoa=p_pessoa;
 return jsonb_build_object('estado','assumido','versao',q.versao,'lease',chave);
end;$$;
create or replace function crm_concluir_qualificacao(p_filial text,p_pessoa text,p_versao bigint,p_lease text,p_ate bigint,p_criterio text,p_resultado jsonb,p_erro text default null)returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare q crm_qualificacoes;
begin
 select * into q from crm_qualificacoes where filial=p_filial and pessoa=p_pessoa for update;
 if not found or q.lease is distinct from p_lease then return false;end if;
 if q.versao<>p_versao then update crm_qualificacoes set estado='pendente',lease=null,lease_ate=null where filial=p_filial and pessoa=p_pessoa;return false;end if;
 if p_erro is not null then update crm_qualificacoes set estado='erro',erro=left(p_erro,200),proxima_em=now()+least(interval'1 day',interval'5 minutes'*power(2,least(tentativas,8))),lease=null,lease_ate=null where filial=p_filial and pessoa=p_pessoa;return false;end if;
 if p_resultado is null or p_resultado->>'etapa' is null or p_resultado->>'etapa' not in ('qualificacao','informacoes','eventos','pos_evento','matricula','antigos_alunos','acolhimento')then raise exception 'Etapa inválida';end if;
 if p_resultado#>>'{restricao,tipo}'='nao_contatar'then
  update leads_inscricoes set tags=to_jsonb((crm_tags_lista(tags)||jsonb_build_array('Não Contatar'))::text)
  where filial=p_filial and "pessoaIdentificador"=p_pessoa and not crm_tags_lista(tags)?'Não Contatar';
 end if;
 insert into crm_passagens_agente(filial,pessoa,versao,anterior,atual,evidencia,motivo)values(p_filial,p_pessoa,p_versao,coalesce(q.resultado->>'agente_efetivo',q.resultado->>'etapa'),coalesce(p_resultado->>'agente_efetivo',p_resultado->>'etapa'),p_resultado->'evidencia',p_resultado->>'motivo')on conflict do nothing;
 update crm_qualificacoes set estado='concluido',versao_analisada=p_versao,resultado=p_resultado,criterio=p_criterio,ultima_mensagem=p_ate,lease=null,lease_ate=null,erro=null,analisado_em=now(),atualizado_em=now()where filial=p_filial and pessoa=p_pessoa;
 return true;
end;$$;
create or replace function crm_proxima_qualificacao()returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('filial',q.filial,'pessoa',q.pessoa,'ultima',coalesce((select max(id)from mensagens_whatsapp m where m.filial=q.filial and m."pessoaIdentificador"=q.pessoa),0))
 from crm_qualificacoes q join leads_inscricoes l on l.filial=q.filial and l."pessoaIdentificador"=q.pessoa and l.lixeira_em is null
 where (q.estado='pendente' or q.estado='erro' and q.proxima_em<=now() or q.estado='processando' and q.lease_ate<=now())
 and coalesce(q.lease_ate,now())<=now()
 order by exists(select 1 from mensagens_whatsapp m where m.filial=q.filial and m."pessoaIdentificador"=q.pessoa and m.direcao='entrada')desc,q.atualizado_em,q.filial,q.pessoa limit 1;
$$;
create or replace function crm_transcricoes_validas(p_ids bigint[])returns table(id bigint,texto text)language sql stable security definer set search_path=public,pg_temp as $$
 select t.mensagem_id,t.texto from crm_audio_transcricoes t join mensagens_whatsapp m on m.id=t.mensagem_id
 where t.mensagem_id=any(p_ids)and t.estado='concluido'and t.assinatura=md5(m.payload_bruto->>'audio_url')and m.tipo='audio';
$$;
create or replace function crm_assumir_audio()returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t crm_audio_transcricoes; m mensagens_whatsapp; chave text; dia_local date=(now()at time zone'America/Sao_Paulo')::date;
begin
 if not(select transcricao_disponivel from crm_ia_config where id)then return null;end if;
 perform pg_advisory_xact_lock(193446);
 insert into crm_ia_orcamento(dia)values(dia_local)on conflict do nothing;
 if(select audios from crm_ia_orcamento where dia=dia_local)>=(select limite_audios_dia from crm_ia_config where id)then return null;end if;
 select a.* into t from crm_audio_transcricoes a join mensagens_whatsapp x on x.id=a.mensagem_id join leads_inscricoes l on l."pessoaIdentificador"=x."pessoaIdentificador" and l.filial=x.filial and l.lixeira_em is null
 where (a.estado='pendente' or a.estado='erro'and a.proxima_em<=now() or a.estado='processando'and a.lease_ate<=now())and coalesce(a.lease_ate,now())<=now()
 order by a.mensagem_id for update of a skip locked limit 1;
 if not found then return null;end if;
 select * into m from mensagens_whatsapp where id=t.mensagem_id;
 chave=gen_random_uuid()::text;
 update crm_audio_transcricoes set estado='processando',lease=chave,lease_ate=now()+interval'3 minutes',tentativas=tentativas+1 where mensagem_id=t.mensagem_id;
 update crm_ia_orcamento set audios=audios+1 where dia=dia_local;
 return jsonb_build_object('id',t.mensagem_id,'assinatura',t.assinatura,'lease',chave,'url',m.payload_bruto->>'audio_url','limite_bytes',(select limite_bytes_audio from crm_ia_config where id));
end;$$;
create or replace function crm_concluir_audio(p_id bigint,p_assinatura text,p_lease text,p_texto text,p_modelo text,p_bytes bigint,p_erro text default null)returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare m mensagens_whatsapp; t crm_audio_transcricoes;
begin
 select * into t from crm_audio_transcricoes where mensagem_id=p_id for update;
 if not found or t.lease is distinct from p_lease or t.assinatura<>p_assinatura then return false;end if;
 if p_erro is not null then update crm_audio_transcricoes set estado=case when p_erro in('audio_acima_limite','origem_audio_invalida','audio_vazio')then'limite'else'erro'end,erro=left(p_erro,200),proxima_em=now()+least(interval'1 day',interval'10 minutes'*power(2,least(tentativas,8))),lease=null,lease_ate=null where mensagem_id=p_id;return false;end if;
 if nullif(trim(p_texto),'')is null or length(p_texto)>60000 then raise exception 'Transcrição inválida';end if;
 select * into m from mensagens_whatsapp where id=p_id;
 if md5(m.payload_bruto->>'audio_url')is distinct from p_assinatura then return false;end if;
 update crm_audio_transcricoes set estado='concluido',texto=p_texto,modelo=p_modelo,bytes=p_bytes,lease=null,lease_ate=null,erro=null,atualizado_em=now()where mensagem_id=p_id;
 update crm_ia_orcamento set bytes_audio=bytes_audio+greatest(coalesce(p_bytes,0),0)where dia=(now()at time zone'America/Sao_Paulo')::date;
 update crm_qualificacoes set versao=versao+1,estado='pendente',proxima_em=now(),atualizado_em=now()where filial=m.filial and pessoa=m."pessoaIdentificador";
 update funil_analises_conversa set versao=versao+1,estado='pendente',atualizado_em=now()where filial=m.filial and pessoa=m."pessoaIdentificador";
 return true;
end;$$;

-- Leitura operacional: a classificação pode ser antiga; pendência e bloqueios ficam explícitos.
create or replace function crm_tags_lista(valor jsonb)returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare t jsonb;
begin
 t=case when jsonb_typeof(valor)='string'then(valor#>>'{}')::jsonb else coalesce(valor,'[]'::jsonb)end;
 if jsonb_typeof(t)<>'array'then return '["Contato em conferência"]'::jsonb;end if;
 return t;
exception when others then return '["Contato em conferência"]'::jsonb;
end;$$;
create or replace function crm_retorno_futuro(valor jsonb)returns boolean language plpgsql stable set search_path=public,pg_temp as $$
begin return coalesce(nullif(valor->>'proxima_em','')::timestamptz>now(),false);exception when others then return true;end;$$;
create or replace view crm_fila_especialistas as
select q.*,l."pessoaNome" as nome,l.acompanhamento,
 case
 when (crm_tags_lista(l.tags)?'Contato em conferência'or crm_tags_lista(l.tags)?'Histórico em conferência')then'interno'
 when crm_tags_lista(l.tags)?'Não Contatar'or l.acompanhamento->>'contato'in('nao_contatar','pausado')or l.acompanhamento->>'intencao'in('nao','depois')or q.resultado#>>'{restricao,tipo}'in('nao_contatar','pausa')then'interno'
 when crm_retorno_futuro(l.acompanhamento)then'interno'
 when l.acompanhamento->>'proximo'='conferir'or l.acompanhamento->>'inscricao'='aguardando_registro'then'interno'
 when l.acompanhamento->>'relacao'='ativo'or crm_tags_lista(l.tags)?'Ativo'or crm_tags_lista(l.tags)?'Aluno Ativo'then'acolhimento'
 else coalesce(q.resultado->>'etapa','qualificacao')end as agente
from crm_qualificacoes q join leads_inscricoes l on l."pessoaIdentificador"=q.pessoa and l.filial=q.filial and l.lixeira_em is null;
create or replace function painel_especialistas_crm(p_filial text,p_agente text default null,p_apos text default null,p_busca text default '',p_responsavel text default null)returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
 'resumo',(select coalesce(jsonb_object_agg(agente,n),'{}')from(select agente,count(*)n from crm_fila_especialistas where filial=p_filial group by agente)s),
 'processamento',(select jsonb_build_object('total',count(*),'concluidos',count(*)filter(where estado='concluido'),'sem_historico',count(*)filter(where resultado->>'sem_historico'='true'),'pendentes',count(*)filter(where estado in('pendente','processando')),'erros',count(*)filter(where estado in('erro','limite')))from crm_fila_especialistas where filial=p_filial),
 'audios',(select jsonb_build_object('total',count(*),'concluidos',count(*)filter(where a.estado='concluido'),'erros',count(*)filter(where a.estado in('erro','limite')))from crm_audio_transcricoes a join mensagens_whatsapp m on m.id=a.mensagem_id where m.filial=p_filial),
 'config',(select jsonb_build_object('caracteres_dia',limite_caracteres_dia,'audios_dia',limite_audios_dia,'transcricao_disponivel',transcricao_disponivel)from crm_ia_config where id),
 'orcamento',(select to_jsonb(b)from crm_ia_orcamento b where dia=(now()at time zone'America/Sao_Paulo')::date),
 'itens',(select coalesce(jsonb_agg(to_jsonb(s)order by s.pessoa),'[]')from(select filial,pessoa,nome,agente,estado,resultado,analisado_em,erro,acompanhamento from crm_fila_especialistas where filial=p_filial and(p_agente is null or agente=p_agente)and(p_apos is null or pessoa>p_apos)and(p_busca=''or strpos(lower(coalesce(nome,'')||' '||pessoa||' '||coalesce(acompanhamento->>'responsavel','')),lower(p_busca))>0)and(p_responsavel is null or acompanhamento->>'responsavel'=p_responsavel)order by pessoa limit 51)s));
$$;
create or replace function historico_especialistas_crm(p_filial text,p_pessoa text)returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(s)order by s.id desc),'[]')from(select id,anterior,atual,evidencia,motivo,criado_em from crm_passagens_agente where filial=p_filial and pessoa=p_pessoa order by id desc limit 30)s;
$$;
create or replace function consumo_especialistas_crm(p_dias int default 30)returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(s)),'[]')from(select function_name,count(*) chamadas,sum(input_tokens) entrada,sum(output_tokens) saida,sum(coalesce(cache_read_input_tokens,0)) cache_lido,sum(coalesce(cache_creation_input_tokens,0)) cache_criado,round(sum(case when modelo='claude-haiku-4-5-20251001'then(input_tokens+5::numeric*output_tokens+1.25*coalesce(cache_creation_input_tokens,0)+0.10*coalesce(cache_read_input_tokens,0))/1000000 else null end),6)usd_estimado,count(*)filter(where modelo<>'claude-haiku-4-5-20251001')sem_tarifa
 from ia_uso_tokens where criado_em>=now()-make_interval(days=>least(greatest(p_dias,1),90))and(function_name like'agente-%')group by function_name order by function_name)s;
$$;
create index if not exists crm_qualificacoes_fila on crm_qualificacoes(estado,proxima_em,atualizado_em);
create index if not exists crm_passagens_pessoa on crm_passagens_agente(filial,pessoa,id desc);
create index if not exists crm_audio_fila on crm_audio_transcricoes(estado,proxima_em);
-- Escrita e orçamento exclusivos do serviço. Nenhuma nova política pública de escrita.
revoke all on function crm_assumir_qualificacao(text,text,bigint,int,text),crm_concluir_qualificacao(text,text,bigint,text,bigint,text,jsonb,text),crm_proxima_qualificacao(),crm_assumir_audio(),crm_concluir_audio(bigint,text,text,text,text,bigint,text),crm_transcricoes_validas(bigint[])from public,anon,authenticated;
grant execute on function crm_assumir_qualificacao(text,text,bigint,int,text),crm_concluir_qualificacao(text,text,bigint,text,bigint,text,jsonb,text),crm_proxima_qualificacao(),crm_assumir_audio(),crm_concluir_audio(bigint,text,text,text,text,bigint,text),crm_transcricoes_validas(bigint[])to service_role;
revoke all on crm_fila_especialistas from public,anon,authenticated;
grant execute on function painel_especialistas_crm(text,text,text,text,text),historico_especialistas_crm(text,text),consumo_especialistas_crm(int)to anon,authenticated;
grant execute on function crm_transcricoes_validas(bigint[])to anon,authenticated;
create or replace function resultados_especialistas_crm(p_filial text,p_inicio timestamptz,p_fim timestamptz)returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(s)),'[]')from(select q.agente,count(distinct f.pessoa)contatados,count(distinct f.pessoa)filter(where f.inscricao)inscricoes,count(distinct f.pessoa)filter(where f.presenca)presencas,count(distinct f.pessoa)filter(where f.matricula)matriculas
 from crm_fila_especialistas q join fatos_funil_interacoes(p_inicio,p_fim,p_filial)f on f.filial=q.filial and f.pessoa=q.pessoa where q.filial=p_filial group by q.agente order by q.agente)s;
$$;
grant execute on function resultados_especialistas_crm(text,timestamptz,timestamptz)to anon,authenticated;
commit;

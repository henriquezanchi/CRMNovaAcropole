-- Uma análise por conversa; mensagens novas invalidam o snapshot até a próxima rodada.
create table if not exists funil_analises_conversa (
 filial text not null,pessoa text not null,versao bigint not null default 1,
 versao_analisada bigint,estado text not null default 'pendente' check(estado in ('pendente','processando','concluido','erro')),
 atualizado_em timestamptz not null default now(),analisado_em timestamptz,erro text,
 ultima_mensagem bigint,quantidade_mensagens int,resultado jsonb,modelo text,
 primary key(filial,pessoa)
);
alter table funil_analises_conversa enable row level security;
drop policy if exists leitura_funil_analises on funil_analises_conversa;
create policy leitura_funil_analises on funil_analises_conversa for select using(true);
create or replace function enfileirar_analise_funil() returns trigger language plpgsql security definer set search_path=public as $$
begin
 -- Confirmação de entrega/leitura não é nova fala: evita gastar IA outra vez à toa.
 if tg_op='UPDATE' and new.corpo_texto is not distinct from old.corpo_texto
 and (new.wa_status is not distinct from old.wa_status or (new.wa_status in ('enviado','entregue','lido') and old.wa_status in ('enviado','entregue','lido'))) then return new; end if;
 if new.filial is not null and new."pessoaIdentificador" is not null then
 insert into funil_analises_conversa(filial,pessoa) values(new.filial,new."pessoaIdentificador")
 on conflict(filial,pessoa) do update set versao=funil_analises_conversa.versao+1,estado='pendente',atualizado_em=now(),erro=null;
 end if;
 return new;
end $$;
drop trigger if exists mensagens_enfileiram_funil on mensagens_whatsapp;
create trigger mensagens_enfileiram_funil after insert or update of corpo_texto,wa_status on mensagens_whatsapp for each row
when (new."pessoaIdentificador" is not null) execute function enfileirar_analise_funil();
insert into funil_analises_conversa(filial,pessoa)
select distinct filial,"pessoaIdentificador" from mensagens_whatsapp where filial is not null and "pessoaIdentificador" is not null on conflict do nothing;

create or replace function assumir_conversa_funil() returns jsonb language plpgsql security definer set search_path=public as $$
declare c funil_analises_conversa; mensagens jsonb; eventos_conversa jsonb;
begin
 select * into c from funil_analises_conversa where estado='pendente' or (estado='processando' and atualizado_em<now()-interval '5 minutes') or (estado='erro' and atualizado_em<now()-interval '2 minutes')
 order by exists(select 1 from mensagens_whatsapp m where m.filial=funil_analises_conversa.filial and m."pessoaIdentificador"=funil_analises_conversa.pessoa and m.direcao='entrada') desc,atualizado_em,filial,pessoa
 for update skip locked limit 1;
 if c.pessoa is null then return null; end if;
 update funil_analises_conversa set estado='processando',atualizado_em=now() where filial=c.filial and pessoa=c.pessoa;
 -- Histórico inteiro, inclusive importados, com fonte explícita. Nunca corta em 1000 linhas.
 select jsonb_agg(jsonb_build_object('id',id,'direcao',direcao,'tipo',tipo,'status',wa_status,'importada',coalesce(importado_manualmente,false),'texto',corpo_texto,'data',criado_em) order by criado_em,id) into mensagens
 from mensagens_whatsapp where filial=c.filial and "pessoaIdentificador"=c.pessoa;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'nome',e.nome,'data',e.data,'link',e.link_inscricao) order by e.data,e.id),'[]'::jsonb) into eventos_conversa
 from eventos e where e.filial=c.filial and e.data>=(select min(criado_em)::date-7 from mensagens_whatsapp where filial=c.filial and "pessoaIdentificador"=c.pessoa)
 and e.data<=(select max(criado_em)::date+180 from mensagens_whatsapp where filial=c.filial and "pessoaIdentificador"=c.pessoa);
 return jsonb_build_object('filial',c.filial,'pessoa',c.pessoa,'versao',c.versao,'mensagens',coalesce(mensagens,'[]'::jsonb),'eventos',eventos_conversa);
end $$;
revoke all on function assumir_conversa_funil() from public,anon,authenticated;
grant execute on function assumir_conversa_funil() to service_role;

create or replace function concluir_conversa_funil(p_filial text,p_pessoa text,p_versao bigint,p_resultado jsonb,p_modelo text,p_erro text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare c funil_analises_conversa;
begin
 select * into c from funil_analises_conversa where filial=p_filial and pessoa=p_pessoa for update;
 if c.estado='concluido' and c.versao_analisada=p_versao then return true; end if;
 if c.versao<>p_versao then update funil_analises_conversa set estado='pendente',atualizado_em=now() where filial=p_filial and pessoa=p_pessoa;return false;end if;
 if p_erro is not null then update funil_analises_conversa set estado='erro',erro=left(p_erro,500),atualizado_em=now() where filial=p_filial and pessoa=p_pessoa;return false;end if;
 update funil_analises_conversa set resultado=p_resultado,versao_analisada=p_versao,estado='concluido',analisado_em=now(),atualizado_em=now(),erro=null,modelo=p_modelo,
 quantidade_mensagens=(select count(*) from mensagens_whatsapp where filial=p_filial and "pessoaIdentificador"=p_pessoa),
 ultima_mensagem=(select max(id) from mensagens_whatsapp where filial=p_filial and "pessoaIdentificador"=p_pessoa)
 where filial=p_filial and pessoa=p_pessoa;
 insert into log_atividade(filial,acao,autor,pessoa_ids,detalhes) values(p_filial,'analise_automatica_funil','Análise automática',jsonb_build_array(p_pessoa),jsonb_build_object('versao',p_versao,'modelo',p_modelo,'anterior',c.resultado,'resultado',p_resultado));
 return true;
end $$;
revoke all on function concluir_conversa_funil(text,text,bigint,jsonb,text,text) from public,anon,authenticated;
grant execute on function concluir_conversa_funil(text,text,bigint,jsonb,text,text) to service_role;

begin;
-- Caches derivados acompanham criação e remoção do cadastro, inclusive exclusão LGPD.
create or replace function crm_ciclo_lead_especialistas()returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE'then
  delete from crm_audio_transcricoes where mensagem_id in(select id from mensagens_whatsapp where "pessoaIdentificador"=old."pessoaIdentificador");
  delete from crm_passagens_agente where pessoa=old."pessoaIdentificador";
  delete from crm_qualificacoes where pessoa=old."pessoaIdentificador";
  return old;
 end if;
 if new.filial is null or new.lixeira_em is not null then return new;end if;
 insert into crm_qualificacoes(filial,pessoa,estado,versao_analisada,criterio,resultado,analisado_em)
 select new.filial,new."pessoaIdentificador",'concluido',1,'agentes-crm-v2','{"etapa":"qualificacao","evidencia":null,"restricao":null,"sem_historico":true}'::jsonb,now()
 where not exists(select 1 from mensagens_whatsapp m where m.filial=new.filial and m."pessoaIdentificador"=new."pessoaIdentificador")
 on conflict do nothing;
 insert into crm_qualificacoes(filial,pessoa)values(new.filial,new."pessoaIdentificador")on conflict do nothing;
 return new;
end;$$;
drop trigger if exists crm_lead_especialistas on leads_inscricoes;
create trigger crm_lead_especialistas after insert or delete or update of filial on leads_inscricoes for each row execute function crm_ciclo_lead_especialistas();
revoke all on function crm_ciclo_lead_especialistas()from public,anon,authenticated;
-- Remove apenas caches de identificadores que já não existem; não apaga cadastro nem conversa.
delete from crm_qualificacoes q where not exists(select 1 from leads_inscricoes l where l."pessoaIdentificador"=q.pessoa);
delete from crm_passagens_agente q where not exists(select 1 from leads_inscricoes l where l."pessoaIdentificador"=q.pessoa);
commit;

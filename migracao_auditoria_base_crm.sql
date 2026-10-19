create table if not exists auditoria_crm_execucoes (
 id uuid primary key default gen_random_uuid(),criado_em timestamptz not null default now(),estado text not null default 'coletando',fonte text not null default 'Mercúrio / banco nacional',cursor_matricula bigint not null default 0,cursor_unidade text not null default '',fonte_completa boolean not null default false,resumo jsonb not null default '{}'
);
create table if not exists auditoria_crm_fonte (
 execucao uuid references auditoria_crm_execucoes(id),matricula bigint not null,unidade text not null,nome text,telefone_ddd text,telefone text,email text,nivel text,situacao text,baixa text,ingresso text,primary key(execucao,matricula,unidade)
);
create table if not exists auditoria_crm_resultados (
 execucao uuid references auditoria_crm_execucoes(id),pessoa text not null,filial text,resultado text not null,metodo text,matricula bigint,unidade text,observacao text,tags_antes jsonb,tags_depois jsonb,conferido_em timestamptz not null default now(),primary key(execucao,pessoa)
);
create table if not exists auditoria_crm_pendencias (
 id bigint generated always as identity primary key,execucao uuid references auditoria_crm_execucoes(id),filial text,pessoas_ids jsonb not null,motivo text not null,estado text not null default 'pendente',sobrevivente text,reconsultado_em timestamptz
);
create table if not exists auditoria_crm_backup (
 id bigint generated always as identity primary key,criado_em timestamptz not null default now(),sobrevivente text,origem text,registros jsonb not null
);
alter table auditoria_crm_execucoes enable row level security;
alter table auditoria_crm_fonte enable row level security;
alter table auditoria_crm_resultados enable row level security;
alter table auditoria_crm_pendencias enable row level security;
alter table auditoria_crm_backup enable row level security;
drop policy if exists leitura_auditoria_execucoes on auditoria_crm_execucoes;
create policy leitura_auditoria_execucoes on auditoria_crm_execucoes for select using(true);
drop policy if exists leitura_auditoria_resultados on auditoria_crm_resultados;
create policy leitura_auditoria_resultados on auditoria_crm_resultados for select using(true);
drop policy if exists leitura_auditoria_pendencias on auditoria_crm_pendencias;
create policy leitura_auditoria_pendencias on auditoria_crm_pendencias for select using(true);
-- Fonte nacional e cópias integrais acessíveis somente pelo serviço, sem política pública.
alter table auditoria_crm_pendencias add column if not exists evidencias jsonb not null default '[]';
create or replace function aplicar_lote_auditoria_crm(p_itens jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;l leads_inscricoes;estado text;feitos int:=0;alterados int:=0;mudou boolean;
begin
 if jsonb_array_length(p_itens)>500 then raise exception 'Lote excessivo';end if;
 for r in select * from jsonb_array_elements(p_itens) loop
  if not exists(select 1 from auditoria_crm_execucoes where id=(r->>'execucao')::uuid and fonte_completa) then raise exception 'Fonte incompleta';end if;
  select * into l from leads_inscricoes where "pessoaIdentificador"=r->>'pessoa' for update;
  if l."pessoaIdentificador" is null then continue;end if;
  estado=r->>'resultado';
  mudou=l.tags is distinct from nullif(r->'tags_antes','null'::jsonb) or jsonb_build_object('nome',l."pessoaNome",'ddd',l."pessoaTelefoneDDD",'telefone',l."pessoaTelefoneNumero",'email',l."pessoaEmail",'matricula',l.matricula_mercurio) is distinct from r->'identidade_antes';
  if mudou then estado='alterado_durante_auditoria';
  elsif estado in ('conferido','corrigir_tags') then
   if not exists(select 1 from auditoria_crm_fonte where execucao=(r->>'execucao')::uuid and matricula=(r->>'matricula')::bigint and unidade=r->>'unidade') then raise exception 'Prova da fonte não encontrada';end if;
   update leads_inscricoes set tags=r->'tags_depois',matricula_mercurio=case when exists(select 1 from leads_inscricoes outro where outro.filial=l.filial and outro.matricula_mercurio=(r->>'matricula')::int and outro."pessoaIdentificador"<>l."pessoaIdentificador") then matricula_mercurio else coalesce(matricula_mercurio,(r->>'matricula')::int) end where "pessoaIdentificador"=l."pessoaIdentificador";
   insert into auditoria_crm_pendencias(execucao,filial,pessoas_ids,motivo,evidencias)
   select (r->>'execucao')::uuid,l.filial,jsonb_build_array(l."pessoaIdentificador",outro."pessoaIdentificador"),'Mesma matrícula oficial relacionada a dois cadastros do CRM; conferir e unificar manualmente',jsonb_build_array(jsonb_build_object('matricula',(r->>'matricula')::int,'unidade',r->>'unidade'))
   from leads_inscricoes outro where outro.filial=l.filial and outro.matricula_mercurio=(r->>'matricula')::int and outro."pessoaIdentificador"<>l."pessoaIdentificador";
   if estado='corrigir_tags' then estado='corrigido';alterados=alterados+1;end if;
  end if;
  insert into auditoria_crm_resultados(execucao,pessoa,filial,resultado,metodo,matricula,unidade,observacao,tags_antes,tags_depois)
  values((r->>'execucao')::uuid,r->>'pessoa',l.filial,estado,r->>'metodo',(r->>'matricula')::bigint,r->>'unidade',r->>'observacao',l.tags,(select tags from leads_inscricoes where "pessoaIdentificador"=l."pessoaIdentificador"))
  on conflict(execucao,pessoa) do nothing;
  feitos=feitos+1;
 end loop;
 return jsonb_build_object('conferidos',feitos,'tags_alteradas',alterados);
end $$;
revoke all on function aplicar_lote_auditoria_crm(jsonb) from public,anon,authenticated;
grant execute on function aplicar_lote_auditoria_crm(jsonb) to service_role;

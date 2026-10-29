-- Kanban por TAREFA (2026-10-29). Pedido do usuário: as colunas passam a dizer
-- o que fazer com cada lead, e o CRM move os cards sozinho (pode avançar ou
-- voltar) conforme a conversa e as inscrições no Ulisses.
--   Frios        → Convidar p/ Palestra (sem conversa)
--   VaiPalestra  → confirmou ou está inscrito no Ulisses num evento futuro
--   ComoFoi      → evento já passou (até 30 dias) e ainda não conversamos depois
--   FalarCurso   → respondeu e não está em outra etapa
--   QuerEntrar   → a IA confirmou, com a fala do contato, que quer se matricular
--   Matriculados → matrícula do mês no Mercúrio
--   Alunos       → aluno ativo que conversou com a gente
--   Truncados    → Não Contatar
-- Nunca tira ninguém de Matriculados/Truncados. Sem p_forcar, não mexe em card
-- movido à mão nos últimos 3 dias.
begin;
alter table leads_inscricoes add column if not exists funil_auto_em timestamptz;

create table if not exists crm_kanban_movimentos (
 id bigserial primary key,
 lote uuid not null,
 filial text not null,
 pessoa text not null,
 de text,
 para text not null,
 motivo text,
 forcado boolean not null default false,
 em timestamptz not null default now()
);
create index if not exists crm_kanban_movimentos_lote on crm_kanban_movimentos(lote);
create index if not exists crm_kanban_movimentos_pessoa on crm_kanban_movimentos(pessoa, em desc);
alter table crm_kanban_movimentos enable row level security;
drop policy if exists crm_kanban_movimentos_leitura on crm_kanban_movimentos;
create policy crm_kanban_movimentos_leitura on crm_kanban_movimentos for select using (true);

create or replace function crm_kanban_alvos()
returns table(filial text, pessoa text, atual text, alvo text, motivo text, atualizado_em timestamptz, auto_em timestamptz)
language sql stable set search_path=public as $$
with hoje as (select (now() at time zone 'America/Sao_Paulo')::date d),
base as (
 select l.filial, l."pessoaIdentificador" pessoa, l.funil_agencia atual, l.tags, l.acompanhamento,
  l.funil_agencia_atualizado_em, l.funil_auto_em
 from leads_inscricoes l join filiais f on f.nome=l.filial and f.ativo
 where l.lixeira_em is null
  and (coalesce(l.funil_agencia,'')<>'Frios'
   or exists(select 1 from mensagens_whatsapp m where m."pessoaIdentificador"=l."pessoaIdentificador" and m.filial=l.filial and m.direcao='entrada')
   or exists(select 1 from evento_leads el where el."pessoaIdentificador"=l."pessoaIdentificador"))
),
s as (
 select b.*, q.resultado, crm_tags_lista(b.tags) tl,
  (select max(m.criado_em) from mensagens_whatsapp m where m."pessoaIdentificador"=b.pessoa and m.filial=b.filial and m.direcao='entrada') ultima_entrada,
  exists(select 1 from mercurio_alunos a where a.pessoa_identificador=b.pessoa and a.filial=b.filial and a.ativo and a.conta_remuneracao and a.competencia=to_char(h.d,'YYYY-MM')) matric_mes,
  exists(select 1 from mercurio_alunos a where a.pessoa_identificador=b.pessoa and a.filial=b.filial and a.ativo) ativo_merc,
  exists(select 1 from evento_leads el join eventos e on e.id=el.evento_id
   where el."pessoaIdentificador"=b.pessoa and e.ativo and e.data>=h.d and (el.resposta_convite='confirmado' or el.origem='ulisses')) evento_futuro,
  (select max(e.data) from evento_leads el join eventos e on e.id=el.evento_id
   where el."pessoaIdentificador"=b.pessoa and e.data<h.d and e.data>=h.d-30 and (el.resposta_convite='confirmado' or el.origem='ulisses')) evento_passado
 from base b cross join hoje h
 left join crm_qualificacoes q on q.filial=b.filial and q.pessoa=b.pessoa
),
r as (
 select s.*, s.ultima_entrada is not null respondeu,
  (s.tl ? 'Não Contatar' or s.acompanhamento->>'contato'='nao_contatar' or s.resultado#>>'{restricao,tipo}'='nao_contatar') nao_contatar,
  coalesce(nullif(s.resultado->>'etapa','qualificacao'), s.resultado->>'etapa_provavel', 'qualificacao') etapa,
  (s.evento_passado is not null and (s.ultima_entrada is null or (s.ultima_entrada at time zone 'America/Sao_Paulo')::date<=s.evento_passado)) perguntar_como_foi
 from s
)
select r.filial, r.pessoa, r.atual, x.alvo, x.motivo, r.funil_agencia_atualizado_em, r.funil_auto_em
from r cross join lateral (select * from (values
  (case
   when r.atual in ('Matriculados','Truncados') then r.atual
   when r.matric_mes then 'Matriculados'
   when r.nao_contatar then 'Truncados'
   when r.respondeu and (r.tl ?| array['Ativo','Aluno Ativo'] or r.ativo_merc) then 'Alunos'
   when r.respondeu and r.resultado->>'etapa'='matricula' then 'QuerEntrar'
   when r.evento_futuro then 'VaiPalestra'
   when r.perguntar_como_foi then 'ComoFoi'
   when r.evento_passado is not null then 'FalarCurso'
   when not r.respondeu then 'Frios'
   when r.etapa='eventos' then 'Frios'
   else 'FalarCurso' end,
  case
   when r.atual in ('Matriculados','Truncados') then 'coluna protegida'
   when r.matric_mes then 'matrícula do mês no Mercúrio'
   when r.nao_contatar then 'pediu para não ser contatado'
   when r.respondeu and (r.tl ?| array['Ativo','Aluno Ativo'] or r.ativo_merc) then 'aluno ativo que conversou'
   when r.respondeu and r.resultado->>'etapa'='matricula' then 'IA confirmou intenção de matrícula'
   when r.evento_futuro then 'confirmado ou inscrito no Ulisses em evento futuro'
   when r.perguntar_como_foi then 'evento de '||to_char(r.evento_passado,'DD/MM')||' já passou'
   when r.evento_passado is not null then 'conversou depois do evento'
   when not r.respondeu then 'sem resposta'
   when r.etapa='eventos' then 'conversa ainda no convite'
   else 'respondeu ('||r.etapa||')' end)) v(alvo, motivo)) x;
$$;

create or replace function crm_reorganizar_kanban(p_forcar boolean default false, p_aplicar boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_lote uuid := gen_random_uuid(); v_mov jsonb; v_total int;
begin
 drop table if exists _crm_kanban_mov;
 create temp table _crm_kanban_mov as
 select a.* from crm_kanban_alvos() a
 where a.alvo is distinct from a.atual
  and (p_forcar or not (a.atualizado_em > now()-interval '3 days'
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
revoke all on function crm_reorganizar_kanban(boolean,boolean) from public, anon, authenticated;
revoke all on function crm_kanban_alvos() from public, anon, authenticated;
commit;

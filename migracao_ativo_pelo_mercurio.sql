-- Contenção (2026-10-29): "é aluno ativo" passa a vir do banco do Mercúrio
-- (mercurio_alunos, online) nas filiais com código do Mercúrio; a etiqueta
-- "Ativo" estava desatualizada (411 dos 1.318 cards movidos pra Alunos não eram
-- ativos no Mercúrio). Nas filiais sem código, continua valendo a etiqueta.
-- crm_eh_ativo() é a regra única, usada também pelo Kanban.
begin;
create or replace function crm_eh_ativo(p_filial text, p_pessoa text, p_tags jsonb)
returns boolean language sql stable set search_path=public,pg_temp as $$
 select case when exists(select 1 from filiais f where f.nome=p_filial and nullif(trim(f.mercurio_unidade),'') is not null)
  then exists(select 1 from mercurio_alunos a where a.pessoa_identificador=p_pessoa and a.filial=p_filial and a.ativo)
  else coalesce(crm_tags_lista(p_tags) ?| array['Ativo','Aluno Ativo'],false) end;
$$;
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
   or exists(select 1 from evento_leads el where el."pessoaIdentificador"=l."pessoaIdentificador")
   or crm_eh_ativo(l.filial,l."pessoaIdentificador",l.tags))
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
   when crm_eh_ativo(r.filial,r.pessoa,r.tags) then 'Alunos'
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
   when crm_eh_ativo(r.filial,r.pessoa,r.tags) then 'aluno ativo no Mercúrio (sai do funil)'
   when r.respondeu and r.resultado->>'etapa'='matricula' then 'IA confirmou intenção de matrícula'
   when r.evento_futuro then 'confirmado ou inscrito no Ulisses em evento futuro'
   when r.perguntar_como_foi then 'evento de '||to_char(r.evento_passado,'DD/MM')||' já passou'
   when r.evento_passado is not null then 'conversou depois do evento'
   when not r.respondeu then 'sem resposta'
   when r.etapa='eventos' then 'conversa ainda no convite'
   else 'respondeu ('||r.etapa||')' end)) v(alvo, motivo)) x;
$$;

commit;

-- Fonte única para contadores e listas; mesmas pessoas, período e provas.
create or replace function fatos_funil_interacoes(p_inicio timestamptz,p_fim timestamptz,p_filial text default null)
returns table(filial text,pessoa text,inicio timestamptz,valida boolean,aceitou boolean,intencao boolean,pendente boolean,respondeu boolean,inscricao boolean,presenca boolean,matricula boolean,eventos jsonb)
language sql stable set search_path=public as $$
with envios as (
 select m.* from mensagens_whatsapp m where m.direcao='saida'
 and m.wa_status in ('enviado','entregue','lido') and m.wa_message_id is not null
 and not coalesce(m.importado_manualmente,false) and m.criado_em>=p_inicio and m.criado_em<p_fim
 and (p_filial is null or m.filial=p_filial)
), contatos as (
 select filial,"pessoaIdentificador" pessoa,min(criado_em) inicio from envios
 where "pessoaIdentificador" is not null group by filial,"pessoaIdentificador"
), respostas as (
 select c.filial,c.pessoa,m.id,r->>'classe' classificacao,(r->>'evento_id')::bigint evento_id from contatos c
 join mensagens_whatsapp m on m.filial=c.filial and m."pessoaIdentificador"=c.pessoa and m.direcao='entrada'
 and m.criado_em>=c.inicio and m.criado_em<=now() and m.wa_message_id is not null and not coalesce(m.importado_manualmente,false)
 left join funil_analises_conversa a on a.filial=c.filial and a.pessoa=c.pessoa
 left join lateral jsonb_array_elements(coalesce(a.resultado->'respostas','[]'::jsonb)) r on (r->>'mensagem_id')::bigint=m.id
), convites as (
 select c.filial,c.pessoa,f.evento_id,min(m.criado_em) convite_em from contatos c
 join mensagens_whatsapp m on m.filial=c.filial and m."pessoaIdentificador"=c.pessoa and m.criado_em>=c.inicio and m.direcao='saida'
 and m.wa_status in ('enviado','entregue','lido') and not coalesce(m.importado_manualmente,false)
 join funil_convites_comprovados f on f.mensagem_id=m.id group by c.filial,c.pessoa,f.evento_id
 union
 select r.filial,r.pessoa,r.evento_id,min(m.criado_em) from respostas r join mensagens_whatsapp m on m.id=r.id
 where r.classificacao='inscricao' and r.evento_id is not null group by r.filial,r.pessoa,r.evento_id
 union
 select c.filial,c.pessoa,(v->>'evento_id')::bigint,min(m.criado_em) from contatos c
 join funil_analises_conversa a on a.filial=c.filial and a.pessoa=c.pessoa
 cross join lateral jsonb_array_elements(coalesce(a.resultado->'convites','[]'::jsonb)) v
 join mensagens_whatsapp m on m.id=(v->>'mensagem_id')::bigint and m.filial=c.filial and m."pessoaIdentificador"=c.pessoa
 and m.criado_em>=c.inicio and m.direcao='saida' and m.wa_status in ('enviado','entregue','lido') and not coalesce(m.importado_manualmente,false)
 group by c.filial,c.pessoa,(v->>'evento_id')::bigint
), eventos_comprovados as (
 select v.filial,v.pessoa,e.id,e.nome,e.data,
 bool_or(el.evento_id is not null and (el.origem='ulisses' or exists(select 1 from leads_inscricoes l cross join lateral jsonb_array_elements(case when jsonb_typeof(l.historico_eventos)='array' then l.historico_eventos else '[]'::jsonb end) h
 where l."pessoaIdentificador"=v.pessoa and l.filial=v.filial
 and lower(trim(h->>'evento'))=lower(trim(e.nome))
 and substring(h->>'data' from '^([0-9]{2}/[0-9]{2}/[0-9]{4})')=to_char(e.data,'DD/MM/YYYY')))
 and e.data>=v.convite_em::date) inscrito,
 bool_or(el.compareceu=true and e.data>=v.convite_em::date and e.data<=current_date) compareceu
 from convites v join eventos e on e.id=v.evento_id and e.filial=v.filial
 left join evento_leads el on el.evento_id=e.id and el."pessoaIdentificador"=v.pessoa
 group by v.filial,v.pessoa,e.id,e.nome,e.data
), fatos as (
 select c.*,
 exists(select 1 from respostas r where r.filial=c.filial and r.pessoa=c.pessoa and r.classificacao in ('valida','aceitou','inscricao','recusa')) valida,
 exists(select 1 from funil_analises_conversa a join mensagens_whatsapp m on m.id=(a.resultado->'continuidade'->>'mensagem_id')::bigint where a.filial=c.filial and a.pessoa=c.pessoa and (a.resultado->'continuidade'->>'aceitou')::boolean=true and m.criado_em>=c.inicio and not coalesce(m.importado_manualmente,false)) aceitou,
 exists(select 1 from funil_analises_conversa a join mensagens_whatsapp m on m.id=(a.resultado->'intencao'->>'mensagem_id')::bigint where a.filial=c.filial and a.pessoa=c.pessoa and (a.resultado->'intencao'->>'pretende')::boolean=true and m.criado_em>=c.inicio and not coalesce(m.importado_manualmente,false)) intencao,
 exists(select 1 from funil_analises_conversa a where a.filial=c.filial and a.pessoa=c.pessoa and (a.estado<>'concluido' or a.versao_analisada is distinct from a.versao)) pendente,
 exists(select 1 from respostas r where r.filial=c.filial and r.pessoa=c.pessoa) respondeu,
 exists(select 1 from eventos_comprovados e where e.filial=c.filial and e.pessoa=c.pessoa and e.inscrito) inscricao,
 exists(select 1 from eventos_comprovados e where e.filial=c.filial and e.pessoa=c.pessoa and e.compareceu) presenca,
 (exists(select 1 from leads_inscricoes l where l."pessoaIdentificador"=c.pessoa and l.filial=c.filial
 and l.matricula_mercurio is not null and l.data_matricula_verificada_mercurio_em is not null
 and l.data_matricula>=c.inicio::date and l.data_matricula<=current_date)
 or exists(select 1 from mercurio_alunos a where a.filial=c.filial
 and (a.pessoa_identificador=c.pessoa or exists(select 1 from leads_inscricoes l where l."pessoaIdentificador"=c.pessoa and l.filial=c.filial and l.matricula_mercurio=a.matricula))
 and a.data_efetiva>=c.inicio::date and a.data_efetiva<=current_date and a.visto_em is not null)) matricula,
 (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'nome',e.nome,'data',e.data,'inscrito',e.inscrito,'compareceu',coalesce(e.compareceu,false)) order by e.data,e.id),'[]'::jsonb) from eventos_comprovados e where e.filial=c.filial and e.pessoa=c.pessoa) eventos
 from contatos c
) select * from fatos;
$$;

-- Usa snapshots automáticos; revisão humana não é requisito.
create or replace function relatorio_funil_interacoes(p_inicio timestamptz,p_fim timestamptz,p_filial text default null)
returns jsonb language sql stable set search_path=public as $$
with envios as (
 select m.* from mensagens_whatsapp m where m.direcao='saida'
 and m.wa_status in ('enviado','entregue','lido') and m.wa_message_id is not null
 and not coalesce(m.importado_manualmente,false) and m.criado_em>=p_inicio and m.criado_em<p_fim
 and (p_filial is null or m.filial=p_filial)
), fatos as (select * from fatos_funil_interacoes(p_inicio,p_fim,p_filial)), grupos as (
 select b.filial,false total,count(distinct pessoa) contatados,
 count(distinct pessoa) filter(where respondeu) responderam,
 count(distinct pessoa) filter(where valida) validas,count(distinct pessoa) filter(where aceitou) aceitaram,
 count(distinct pessoa) filter(where intencao) intencoes,count(distinct pessoa) filter(where inscricao) inscritos,
 count(distinct pessoa) filter(where presenca) presentes,count(distinct pessoa) filter(where matricula) matriculados,
 count(distinct pessoa) filter(where pendente) pendentes from (select nome filial from filiais where ativo is not false and (p_filial is null or nome=p_filial) union select filial from envios) b left join fatos f on f.filial is not distinct from b.filial group by b.filial
 union all
 select 'Total',true,count(distinct pessoa),count(distinct pessoa) filter(where respondeu),count(distinct pessoa) filter(where valida),count(distinct pessoa) filter(where aceitou),count(distinct pessoa) filter(where intencao),count(distinct pessoa) filter(where inscricao),count(distinct pessoa) filter(where presenca),count(distinct pessoa) filter(where matricula),count(distinct pessoa) filter(where pendente) from fatos
)
select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('mensagens',(select count(*) from envios e where g.total or e.filial is not distinct from g.filial),'sem_identificacao',(select count(*) from envios e where e."pessoaIdentificador" is null and (g.total or e.filial is not distinct from g.filial))) order by g.total desc,g.filial),'[]'::jsonb) from grupos g;
$$;



create or replace function leads_etapa_funil(p_inicio timestamptz,p_fim timestamptz,p_filial text,p_etapa text,p_apos text default null)
returns jsonb language plpgsql stable set search_path=public as $$
begin
 if p_etapa not in ('aceitaram','intencoes','inscritos','presentes','matriculados') or p_etapa is null then raise exception 'Etapa inválida.'; end if;
 return (
 with selecionados as (
 select * from fatos_funil_interacoes(p_inicio,p_fim,p_filial) f
 where case p_etapa when 'aceitaram' then aceitou when 'intencoes' then intencao when 'inscritos' then inscricao when 'presentes' then presenca when 'matriculados' then matricula end
 ), pessoas as (
 select f.pessoa,jsonb_agg(jsonb_build_object('filial',f.filial,'primeiro_contato',f.inicio,'eventos',(select coalesce(jsonb_agg(e),'[]'::jsonb) from jsonb_array_elements(f.eventos) e where p_etapa not in ('inscritos','presentes') or (p_etapa='inscritos' and (e->>'inscrito')::boolean) or (p_etapa='presentes' and (e->>'compareceu')::boolean)),
 'trecho',case when p_etapa='intencoes' then a.resultado->'intencao'->>'trecho' when p_etapa='aceitaram' then a.resultado->'continuidade'->>'trecho' else null end) order by f.filial) contextos
 from selecionados f left join funil_analises_conversa a on a.filial=f.filial and a.pessoa=f.pessoa group by f.pessoa
 ), pagina as (
 select p.pessoa,l."pessoaNome" nome,l.filial filial_cadastro,l.acompanhamento,p.contextos
 from pessoas p left join leads_inscricoes l on l."pessoaIdentificador"=p.pessoa
 where p_apos is null or p.pessoa>p_apos order by p.pessoa limit 50
 ) select jsonb_build_object('total',(select count(*) from pessoas),'leads',(select coalesce(jsonb_agg(to_jsonb(p) order by p.pessoa),'[]'::jsonb) from pagina p))
 );
end $$;

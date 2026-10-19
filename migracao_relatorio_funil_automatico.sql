-- Usa snapshots automáticos; revisão humana não é requisito.
create or replace function relatorio_funil_interacoes(p_inicio timestamptz,p_fim timestamptz,p_filial text default null)
returns jsonb language sql stable set search_path=public as $$
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
), fatos as (
 select c.*,
 exists(select 1 from respostas r where r.filial=c.filial and r.pessoa=c.pessoa and r.classificacao in ('valida','aceitou','inscricao','recusa')) valida,
 exists(select 1 from funil_analises_conversa a join mensagens_whatsapp m on m.id=(a.resultado->'continuidade'->>'mensagem_id')::bigint where a.filial=c.filial and a.pessoa=c.pessoa and (a.resultado->'continuidade'->>'aceitou')::boolean=true and m.criado_em>=c.inicio and not coalesce(m.importado_manualmente,false)) aceitou,
 exists(select 1 from funil_analises_conversa a join mensagens_whatsapp m on m.id=(a.resultado->'intencao'->>'mensagem_id')::bigint where a.filial=c.filial and a.pessoa=c.pessoa and (a.resultado->'intencao'->>'pretende')::boolean=true and m.criado_em>=c.inicio and not coalesce(m.importado_manualmente,false)) intencao,
 exists(select 1 from funil_analises_conversa a where a.filial=c.filial and a.pessoa=c.pessoa and (a.estado<>'concluido' or a.versao_analisada is distinct from a.versao)) pendente,
 exists(select 1 from respostas r where r.filial=c.filial and r.pessoa=c.pessoa) respondeu,
 exists(select 1 from convites v join evento_leads el on el.evento_id=v.evento_id and el."pessoaIdentificador"=v.pessoa join eventos e on e.id=v.evento_id
 where v.filial=c.filial and v.pessoa=c.pessoa and (el.origem='ulisses' or exists(select 1 from leads_inscricoes l cross join lateral jsonb_array_elements(case when jsonb_typeof(l.historico_eventos)='array' then l.historico_eventos else '[]'::jsonb end) h
 where l."pessoaIdentificador"=c.pessoa and l.filial=c.filial
 and lower(trim(h->>'evento'))=lower(trim(e.nome))
 and substring(h->>'data' from '^([0-9]{2}/[0-9]{2}/[0-9]{4})')=to_char(e.data,'DD/MM/YYYY')))
 and e.data>=v.convite_em::date) inscricao,
 exists(select 1 from convites v join evento_leads el on el.evento_id=v.evento_id and el."pessoaIdentificador"=v.pessoa
 join eventos e on e.id=v.evento_id
 where v.filial=c.filial and v.pessoa=c.pessoa and el.compareceu=true and e.data>=v.convite_em::date and e.data<=current_date) presenca,
 (exists(select 1 from leads_inscricoes l where l."pessoaIdentificador"=c.pessoa and l.filial=c.filial
 and l.matricula_mercurio is not null and l.data_matricula_verificada_mercurio_em is not null
 and l.data_matricula>=c.inicio::date and l.data_matricula<=current_date)
 or exists(select 1 from mercurio_alunos a where a.filial=c.filial
 and (a.pessoa_identificador=c.pessoa or exists(select 1 from leads_inscricoes l where l."pessoaIdentificador"=c.pessoa and l.filial=c.filial and l.matricula_mercurio=a.matricula))
 and a.data_efetiva>=c.inicio::date and a.data_efetiva<=current_date and a.visto_em is not null)) matricula
 from contatos c
), grupos as (
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


create or replace function situacao_funil_automatico(p_filial text default null) returns jsonb language sql stable set search_path=public as $$
 select jsonb_build_object('conversas',count(*),'concluidas',count(*) filter(where estado='concluido' and versao_analisada=versao),'pendentes',count(*) filter(where estado in ('pendente','processando')),'erros',count(*) filter(where estado='erro'),'mensagens_analisadas',coalesce(sum(quantidade_mensagens) filter(where estado='concluido' and versao_analisada=versao),0),'total_mensagens',(select count(*) from mensagens_whatsapp m where m.filial is not null and m."pessoaIdentificador" is not null and (p_filial is null or m.filial=p_filial)),'ultima_analise',max(analisado_em),
 'midias_inconclusivas',(select count(*) from funil_analises_conversa a cross join lateral jsonb_array_elements(coalesce(a.resultado->'respostas','[]'::jsonb)) r join mensagens_whatsapp m on m.id=(r->>'mensagem_id')::bigint where (p_filial is null or a.filial=p_filial) and r->>'classe'='inconclusiva' and m.tipo<>'texto'))
 from funil_analises_conversa where p_filial is null or filial=p_filial;
$$;
create or replace function evidencias_funil_automatico(p_inicio timestamptz,p_fim timestamptz,p_filial text default null,p_antes bigint default null)
returns jsonb language sql stable set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (
 select m.id,m.filial,m."pessoaIdentificador" pessoa,m.criado_em,m.corpo_texto,m.tipo,
 r->>'classe' classificacao,r->>'trecho' trecho,r->>'justificativa' justificativa,a.analisado_em,a.modelo,
 (select s.corpo_texto from mensagens_whatsapp s where s.filial=m.filial and s."pessoaIdentificador"=m."pessoaIdentificador" and s.direcao='saida' and s.criado_em<=m.criado_em and s.wa_status in ('enviado','entregue','lido') order by s.criado_em desc,s.id desc limit 1) contexto
 from funil_analises_conversa a cross join lateral jsonb_array_elements(coalesce(a.resultado->'respostas','[]'::jsonb)) r
 join mensagens_whatsapp m on m.id=(r->>'mensagem_id')::bigint
 where (p_filial is null or m.filial=p_filial) and (p_antes is null or m.id<p_antes)
 and exists(select 1 from mensagens_whatsapp s where s.filial=m.filial and s."pessoaIdentificador"=m."pessoaIdentificador" and s.direcao='saida' and s.wa_status in ('enviado','entregue','lido') and s.wa_message_id is not null and not coalesce(s.importado_manualmente,false) and s.criado_em>=p_inicio and s.criado_em<p_fim and s.criado_em<=m.criado_em)
 order by m.id desc limit 20) t;
$$;

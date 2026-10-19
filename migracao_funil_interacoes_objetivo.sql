-- Fatos do atendimento, sem inferir conversão de tags ou posição no Kanban.
create table if not exists funil_respostas_verificadas (
 mensagem_id bigint primary key references mensagens_whatsapp(id) on delete cascade,
 classificacao text not null check(classificacao in ('valida','aceitou','inscricao','recusa','automatica','inconclusiva')),
 evento_id bigint references eventos(id) on delete set null,
 revisado_por text not null, revisado_em timestamptz not null default now()
);
create table if not exists funil_convites_comprovados (
 mensagem_id bigint references mensagens_whatsapp(id) on delete cascade,
 evento_id bigint references eventos(id) on delete cascade,
 primary key(mensagem_id,evento_id)
);
alter table funil_respostas_verificadas enable row level security;
alter table funil_convites_comprovados enable row level security;
drop policy if exists leitura_funil_respostas on funil_respostas_verificadas;
create policy leitura_funil_respostas on funil_respostas_verificadas for select using(true);
drop policy if exists leitura_funil_convites on funil_convites_comprovados;
create policy leitura_funil_convites on funil_convites_comprovados for select using(true);
create index if not exists mensagens_funil_periodo on mensagens_whatsapp(criado_em,filial) where direcao='saida' and wa_status in ('enviado','entregue','lido');

create or replace function registrar_resposta_funil(p_mensagem bigint,p_classificacao text,p_evento bigint,p_revisor text)
returns void language plpgsql security definer set search_path=public as $$
declare m mensagens_whatsapp; anterior jsonb;
begin
 select * into m from mensagens_whatsapp where id=p_mensagem;
 if m.id is null or m.direcao<>'entrada' or coalesce(m.importado_manualmente,false) or m.wa_message_id is null then raise exception 'Selecione uma resposta recebida pelo WhatsApp oficial.'; end if;
 if nullif(trim(p_revisor),'') is null then raise exception 'Identifique o responsável pela revisão.'; end if;
 if p_classificacao not in ('valida','aceitou','inscricao','recusa','automatica','inconclusiva') then raise exception 'Classificação inválida.'; end if;
 if p_classificacao='inscricao' and p_evento is null then raise exception 'Indique o evento mencionado.'; end if;
 if p_evento is not null and not exists(select 1 from eventos where id=p_evento and filial=m.filial) then raise exception 'Evento de outra filial.'; end if;
 -- Serializa revisões concorrentes da mesma mensagem e mantém histórico.
 perform pg_advisory_xact_lock(p_mensagem);
 select to_jsonb(r) into anterior from funil_respostas_verificadas r where mensagem_id=p_mensagem;
 insert into funil_respostas_verificadas values(p_mensagem,p_classificacao,p_evento,trim(p_revisor),now())
 on conflict(mensagem_id) do update set classificacao=excluded.classificacao,evento_id=excluded.evento_id,revisado_por=excluded.revisado_por,revisado_em=excluded.revisado_em;
 insert into log_atividade(filial,acao,autor,pessoa_ids,detalhes) values(m.filial,'revisao_funil_interacoes',trim(p_revisor),jsonb_build_array(m."pessoaIdentificador"),jsonb_build_object('mensagem_id',p_mensagem,'anterior',anterior,'classificacao',p_classificacao,'evento_id',p_evento));
end $$;

create or replace function registrar_convite_funil(p_wa_id text,p_evento bigint)
returns void language plpgsql security definer set search_path=public as $$
begin
 insert into funil_convites_comprovados(mensagem_id,evento_id)
 select m.id,e.id from mensagens_whatsapp m join eventos e on e.id=p_evento and e.filial=m.filial
 where m.wa_message_id=p_wa_id and m.direcao='saida' and m.wa_status in ('enviado','entregue','lido') and not coalesce(m.importado_manualmente,false)
 on conflict do nothing;
end $$;

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
 select c.filial,c.pessoa,m.id,r.classificacao,r.evento_id from contatos c
 join mensagens_whatsapp m on m.filial=c.filial and m."pessoaIdentificador"=c.pessoa and m.direcao='entrada'
 and m.criado_em>=c.inicio and m.criado_em<=now() and m.wa_message_id is not null and not coalesce(m.importado_manualmente,false)
 left join funil_respostas_verificadas r on r.mensagem_id=m.id
), convites as (
 select c.filial,c.pessoa,f.evento_id,min(m.criado_em) convite_em from contatos c
 join mensagens_whatsapp m on m.filial=c.filial and m."pessoaIdentificador"=c.pessoa and m.criado_em>=c.inicio and m.direcao='saida'
 and m.wa_status in ('enviado','entregue','lido') and not coalesce(m.importado_manualmente,false)
 join funil_convites_comprovados f on f.mensagem_id=m.id group by c.filial,c.pessoa,f.evento_id
 union
 select r.filial,r.pessoa,r.evento_id,min(m.criado_em) from respostas r join mensagens_whatsapp m on m.id=r.id
 where r.classificacao='inscricao' and r.evento_id is not null group by r.filial,r.pessoa,r.evento_id
), fatos as (
 select c.*,
 exists(select 1 from respostas r where r.filial=c.filial and r.pessoa=c.pessoa and r.classificacao in ('valida','aceitou','inscricao','recusa')) valida,
 exists(select 1 from respostas r where r.filial=c.filial and r.pessoa=c.pessoa and r.classificacao in ('aceitou','inscricao')) aceitou,
 exists(select 1 from respostas r where r.filial=c.filial and r.pessoa=c.pessoa and r.classificacao='inscricao') intencao,
 exists(select 1 from respostas r where r.filial=c.filial and r.pessoa=c.pessoa and r.classificacao is null) pendente,
 exists(select 1 from respostas r where r.filial=c.filial and r.pessoa=c.pessoa) respondeu,
 exists(select 1 from convites v join evento_leads el on el.evento_id=v.evento_id and el."pessoaIdentificador"=v.pessoa join eventos e on e.id=v.evento_id
 where v.filial=c.filial and v.pessoa=c.pessoa and el.origem='ulisses' and e.data>=v.convite_em::date) inscricao,
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

create or replace function fila_revisao_funil(p_inicio timestamptz,p_fim timestamptz,p_filial text default null,p_antes bigint default null,p_revisadas boolean default false)
returns jsonb language sql stable set search_path=public as $$
select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (
 select m.id,m.filial,m."pessoaIdentificador" pessoa,l."pessoaNome" nome,m.corpo_texto,m.tipo,m.criado_em,
 r.classificacao,r.evento_id,
 (select s.corpo_texto from mensagens_whatsapp s where s.filial=m.filial and s."pessoaIdentificador"=m."pessoaIdentificador" and s.direcao='saida' and s.criado_em<=m.criado_em and s.wa_status in ('enviado','entregue','lido') and not coalesce(s.importado_manualmente,false) order by s.criado_em desc,s.id desc limit 1) contexto,
 (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'nome',e.nome,'data',e.data) order by e.data desc),'[]'::jsonb) from eventos e where e.filial=m.filial and e.data>=m.criado_em::date-30 and e.data<=m.criado_em::date+180) eventos
 from mensagens_whatsapp m left join funil_respostas_verificadas r on r.mensagem_id=m.id
 left join leads_inscricoes l on l."pessoaIdentificador"=m."pessoaIdentificador"
 where m.direcao='entrada' and m.wa_message_id is not null and not coalesce(m.importado_manualmente,false)
 and (p_filial is null or m.filial=p_filial) and (p_antes is null or m.id<p_antes)
 and ((p_revisadas and r.mensagem_id is not null) or (not p_revisadas and r.mensagem_id is null))
 and exists(select 1 from mensagens_whatsapp s where s.filial=m.filial and s."pessoaIdentificador"=m."pessoaIdentificador" and s.direcao='saida' and s.wa_status in ('enviado','entregue','lido') and s.wa_message_id is not null and not coalesce(s.importado_manualmente,false) and s.criado_em>=p_inicio and s.criado_em<p_fim and s.criado_em<=m.criado_em)
 order by m.id desc limit 20
) t;
$$;

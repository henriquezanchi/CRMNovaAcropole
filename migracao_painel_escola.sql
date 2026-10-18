-- Link de acompanhamento por escola: segredo aleatório guardado apenas como hash.
begin;
create table if not exists public.acompanhamento_links_escola (
 id bigint generated always as identity primary key,
 filial text not null references public.filiais(nome),
 chave_hash text not null unique check (chave_hash ~ '^[a-f0-9]{64}$'),
 criado_em timestamptz not null default now(),
 expira_em timestamptz not null,
 revogado_em timestamptz
);
alter table public.acompanhamento_links_escola enable row level security;
revoke all on public.acompanhamento_links_escola from public, anon, authenticated;
grant select,insert,update,delete on public.acompanhamento_links_escola to service_role;
grant usage,select on sequence public.acompanhamento_links_escola_id_seq to service_role;

create or replace function public.consultar_painel_escola(
 p_chave_hash text, p_busca text default '', p_categoria text default 'todos', p_inicio integer default 0, p_limite integer default 50
) returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
 with acesso as (
  select filial,expira_em from public.acompanhamento_links_escola
  where chave_hash=p_chave_hash and revogado_em is null and expira_em>now()
 ), base as (
  select l."pessoaIdentificador" as id,l."pessoaNome" as nome,l.funil_agencia as etapa,
   l.acompanhamento->>'apoio_escola' as apoio,
   case when coalesce(l.acompanhamento->>'apoio_escola','nao') not in ('nao','') then l.acompanhamento->>'pedido_escola' else null end as pedido,
   l.acompanhamento->>'inscricao' as inscricao,
   l.acompanhamento->>'proximo' as proximo,
   l.acompanhamento->>'proxima_em' as proxima_em,
   l.acompanhamento->>'responsavel' as responsavel,
   l.acompanhamento->>'atualizado_em' as atualizado_em,
   ev.nome as atividade,ev.data as data_atividade,ev.resposta_convite,ev.compareceu,ev.matriculado,
   case when coalesce(l.acompanhamento->>'apoio_escola','nao') not in ('nao','') then 'apoio'
    when l.acompanhamento->>'inscricao' in ('solicitada','dados_pendentes','aguardando_registro') then 'inscricao'
    else 'visita' end as categoria
  from public.leads_inscricoes l join acesso a on a.filial=l.filial
  left join lateral (
   select e.nome,e.data,el.resposta_convite,el.compareceu,el.matriculado
   from public.evento_leads el join public.eventos e on e.id=el.evento_id
   where el."pessoaIdentificador"=l."pessoaIdentificador" and e.filial=a.filial
    and e.data between current_date-90 and current_date+90
   order by e.data desc,el.id desc limit 1
  ) ev on true
  where l.lixeira_em is null and (
   coalesce(l.acompanhamento->>'apoio_escola','nao') not in ('nao','')
   or l.acompanhamento->>'inscricao' in ('solicitada','dados_pendentes','aguardando_registro')
   or (ev.data>=current_date and ev.resposta_convite='confirmado' and ev.compareceu is null)
   or (ev.data<current_date and ev.resposta_convite='confirmado' and ev.compareceu is null)
   or (ev.data<=current_date and ev.compareceu=true and ev.matriculado is distinct from true and coalesce(l.acompanhamento->>'inscricao','')<>'conferida')
  )
 ), filtrados as (
  select * from base where (p_categoria='todos' or categoria=p_categoria)
   and (coalesce(p_busca,'')='' or strpos(lower(coalesce(nome,'')),lower(p_busca))>0)
 ), pagina as (
  select * from filtrados order by proxima_em nulls last,nome,id
  limit least(greatest(coalesce(p_limite,50),1),100) offset greatest(coalesce(p_inicio,0),0)
 )
 select jsonb_build_object('escola',a.filial,'expira_em',a.expira_em,'consultado_em',now(),
  'total',(select count(*) from filtrados),
  'itens',coalesce((select jsonb_agg(to_jsonb(pagina)) from pagina),'[]'::jsonb)) from acesso a;
$$;
revoke all on function public.consultar_painel_escola(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.consultar_painel_escola(text,text,text,integer,integer) to service_role;
commit;

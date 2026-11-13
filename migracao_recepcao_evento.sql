-- Recepção de evento (13/11/2026, DMF 2026): página para a equipe da porta marcar presença no Ulisses
-- e inscrever na hora quem chegou sem inscrição. Acesso por link (chave no #) + PIN de 6 dígitos;
-- só os hashes ficam no banco. Escrita só pela Edge Function recepcao-evento (service_role).

create table if not exists public.recepcao_links (
    id bigserial primary key,
    rotulo text not null,
    chave_hash text not null unique,
    evento_id bigint not null references public.eventos(id),
    evento_id_ulisses bigint not null,
    filial_id_ulisses integer not null,
    produto_id_ulisses bigint not null,
    campanha_slug text,
    pin_hash text,
    pin_tentativas integer not null default 0,
    pin_bloqueado_ate timestamptz,
    expira_em timestamptz not null,
    revogado_em timestamptz,
    criado_em timestamptz not null default now()
);
alter table public.recepcao_links enable row level security;

create table if not exists public.recepcao_sessoes (
    token_hash text primary key,
    link_id bigint not null references public.recepcao_links(id) on delete cascade,
    apelido text,
    expira_em timestamptz not null,
    criado_em timestamptz not null default now()
);
alter table public.recepcao_sessoes enable row level security;

-- Tudo o que a recepção fez. client_id vem do aparelho: a fila offline reenvia sem duplicar.
create table if not exists public.recepcao_registros (
    id bigserial primary key,
    client_id uuid not null unique,
    link_id bigint not null references public.recepcao_links(id),
    evento_id_ulisses bigint not null,
    tipo text not null check (tipo in ('presenca', 'desfazer', 'inscricao')),
    email_evento_id bigint,
    nome text,
    ddd text,
    telefone text,
    email text,
    pessoa_identificador text,
    veio_com text,
    interesse_curso boolean,
    status text not null default 'pendente' check (status in ('pendente', 'ok', 'erro')),
    erro text,
    autor text,
    criado_no_aparelho timestamptz,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
);
alter table public.recepcao_registros enable row level security;
create index if not exists recepcao_registros_evento on public.recepcao_registros (evento_id_ulisses, criado_em);

-- Lista da porta: inscritos do Ulisses + se é aluno ativo (mesma regra do painel: telefone ou e-mail
-- e o mesmo primeiro nome) + presença. A tela mostra só os 4 últimos dígitos do celular; os 8 últimos
-- servem para buscar pelo número inteiro.
drop function if exists public.recepcao_lista(bigint);
create or replace function public.recepcao_lista(p_evento_id_ulisses bigint)
returns table (email_evento_id bigint, nome text, final_tel text, tel8 text, email_mascara text, aluno boolean,
               escola text, compareceu boolean, inscrito_em timestamptz, na_porta boolean)
language sql stable
set search_path = public
as $$
    select u.email_evento_id, trim(u.nome),
           right(regexp_replace(coalesce(u.telefone, ''), '\D', '', 'g'), 4),
           right(regexp_replace(coalesce(u.telefone, ''), '\D', '', 'g'), 8),
           case when u.email like '%@%' then left(u.email, 2) || '…@' || split_part(u.email, '@', 2) end,
           coalesce(cf.eh_aluno, mp.filial is not null),
           coalesce(case when cf.eh_aluno then cf.escola end, mp.filial), -- escola só de quem é aluno (Mercúrio)
           u.compareceu, coalesce(u.inscrito_em, u.visto_primeiro_em),
           exists (select 1 from recepcao_registros r where r.email_evento_id = u.email_evento_id and r.tipo = 'inscricao')
    from ulisses_inscricoes_evento u
    left join leads_inscricoes l on l."pessoaIdentificador" = u."pessoaIdentificador"
    left join painel_aluno_confirmado cf on cf.pessoa_id_ulisses = u.pessoa_id_ulisses
    left join lateral (select m.filial from mercurio_pessoas m where m.situacao = 'ATI'
        and ((campanha_telefone_chave(u.ddd, u.telefone) is not null and m.tel_chave = campanha_telefone_chave(u.ddd, u.telefone))
             or (nullif(lower(trim(u.email)), '') is not null and lower(m.email) = lower(trim(u.email))))
        and split_part(nome_normalizado(m.nome), ' ', 1) = split_part(nome_normalizado(u.nome), ' ', 1) limit 1) mp on true
    where u.evento_id_ulisses = p_evento_id_ulisses and u.removido_em is null
$$;
revoke all on function public.recepcao_lista(bigint) from public, anon, authenticated;

-- 13/11/2026: inscrição na porta sem e-mail não vai para o Ulisses (que exige e-mail): fica "reservado"
-- no CRM, ocupando vaga, e o e-mail é pedido depois por WhatsApp.
alter table public.recepcao_registros drop constraint if exists recepcao_registros_status_check;
alter table public.recepcao_registros add constraint recepcao_registros_status_check
    check (status in ('pendente', 'ok', 'erro', 'reservado'));

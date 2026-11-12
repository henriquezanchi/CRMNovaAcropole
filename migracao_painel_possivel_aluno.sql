-- Possíveis alunos entre os inscritos "de fora" (12/11/2026, pedido do usuário): muitos alunos se
-- inscrevem no Ulisses com outro e-mail/celular ou com o nome digitado diferente, e o painel os
-- conta como público de fora. (1) Varredura: sugere o membro ativo do Mercúrio mais parecido pelo
-- nome (igual, mesmo primeiro e último nome, ou nome parecido) e avisa quem marcou "já sou aluno"
-- no Ulisses. (2) Quem usa o painel com PIN confirma "é aluno" e de qual escola (ou "não é").
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

alter table ulisses_inscricoes_evento add column if not exists sugestao_aluno jsonb;

create or replace function nome_normalizado(p text) returns text
language sql immutable set search_path = public, extensions as $$
    select nullif(upper(trim(regexp_replace(extensions.unaccent(coalesce(p, '')), '\s+', ' ', 'g'))), '')
$$;

create or replace function ulisses_sugerir_alunos(p_evento bigint) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
    with alvo as (
        select u.email_evento_id, nome_normalizado(u.nome) nn,
               split_part(nome_normalizado(u.nome), ' ', 1) pri,
               regexp_replace(nome_normalizado(u.nome), '^.* ', '') ult,
               (u.bruto->'pessoa'->>'jaSouAluno') = 'true' disse_aluno
        from ulisses_inscricoes_evento u where u.evento_id_ulisses = p_evento and u.removido_em is null
    ),
    mp as (
        select m.nome, m.filial, nome_normalizado(m.nome) nn from mercurio_pessoas m where m.situacao = 'ATI' and m.nome is not null
    ),
    sug as (
        select a.email_evento_id, a.disse_aluno, b.*
        from alvo a left join lateral (
            select mp.nome, mp.filial,
                   case when mp.nn = a.nn then 'nome igual'
                        when split_part(mp.nn, ' ', 1) = a.pri and regexp_replace(mp.nn, '^.* ', '') = a.ult then 'mesmo primeiro e último nome'
                        else 'nome parecido' end motivo,
                   similarity(mp.nn, a.nn) sim
            from mp
            where a.nn is not null and (mp.nn = a.nn
               or (split_part(mp.nn, ' ', 1) = a.pri and regexp_replace(mp.nn, '^.* ', '') = a.ult and a.pri <> a.ult)
               or (split_part(mp.nn, ' ', 1) = a.pri and similarity(mp.nn, a.nn) >= 0.55))
            order by (mp.nn = a.nn) desc, similarity(mp.nn, a.nn) desc limit 1) b on true
    )
    update ulisses_inscricoes_evento u set sugestao_aluno = case
        when s.nome is null and not s.disse_aluno then null
        else jsonb_strip_nulls(jsonb_build_object('nome', s.nome, 'escola', s.filial, 'motivo', s.motivo,
              'semelhanca', case when s.nome is not null then round((s.sim * 100)::numeric) end, 'disse_aluno', nullif(s.disse_aluno, false))) end
    from sug s where s.email_evento_id = u.email_evento_id;
    get diagnostics n = row_count;
    return n;
end $$;
revoke all on function ulisses_sugerir_alunos(bigint) from public, anon, authenticated;
grant execute on function ulisses_sugerir_alunos(bigint) to service_role;

-- Confirmação feita no painel (por pessoa do Ulisses; vale para todos os eventos dela).
create table if not exists painel_aluno_confirmado (
    pessoa_id_ulisses text primary key,
    eh_aluno boolean not null,
    escola text,
    autor text,
    link_id bigint,
    atualizado_em timestamptz not null default now()
);
alter table painel_aluno_confirmado enable row level security; -- sem policy: só service_role

-- Contagem de inscritos do Ulisses por evento, para o cartão da Agenda (13/11/2026).
-- O cartão contava fichas do CRM ligadas ao evento (evento_leads), e a mesma pessoa
-- cadastrada em duas escolas contava duas vezes (DMF de Barra: 28 no cartão, 26 no Ulisses).
-- Agora conta pessoas na lista do Ulisses, com a mesma chave do painel de resultados
-- (telefone + primeiro nome, senão e-mail, senão o código do Ulisses).
-- Devolve só números: a tabela continua fechada para o navegador (tem e-mail e telefone).
create or replace function public.ulisses_contagem_inscritos(p_eventos int[])
returns table(evento_id_ulisses int, inscritos int, presentes int)
language sql stable security definer set search_path = public as $$
    select x.evento_id_ulisses::int, count(*)::int, count(*) filter (where x.compareceu)::int
    from (
        select distinct on (u.evento_id_ulisses, chave) u.evento_id_ulisses, u.compareceu
        from (
            select u.*, coalesce(campanha_telefone_chave(u.ddd, u.telefone) || ':' || split_part(nome_normalizado(u.nome), ' ', 1),
                                 nullif(lower(trim(u.email)), ''), u.pessoa_id_ulisses::text, u.email_evento_id::text) chave
            from ulisses_inscricoes_evento u
            where u.evento_id_ulisses = any(p_eventos) and u.removido_em is null
        ) u
        order by u.evento_id_ulisses, chave, u.compareceu desc nulls last
    ) x
    group by x.evento_id_ulisses;
$$;

revoke all on function public.ulisses_contagem_inscritos(int[]) from public;
grant execute on function public.ulisses_contagem_inscritos(int[]) to anon, authenticated;

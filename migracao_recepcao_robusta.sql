-- Recepção sem depender do Ulisses na hora (13/11/2026).
-- 1) A presença da lista da porta vem do último gesto registrado na recepção (presença/desfazer/inscrição na
--    porta); só quando não há registro vale o que veio do Ulisses. Assim a sincronização de 10 em 10 minutos não
--    "desmarca" quem acabou de chegar, e a presença vale mesmo com o Ulisses fora do ar (status pendente).
-- 2) recepcao_versao: resumo barato da lista; o aparelho só baixa a lista de novo quando ele muda.
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
           coalesce(cf.eh_aluno, coalesce(mt.filial, me.filial) is not null),
           coalesce(case when cf.eh_aluno then cf.escola end, mt.filial, me.filial), -- escola só de quem é aluno (Mercúrio)
           coalesce((select g.tipo <> 'desfazer' from recepcao_registros g
                     where g.email_evento_id = u.email_evento_id and g.tipo in ('presenca', 'desfazer', 'inscricao') and g.status <> 'erro'
                     order by g.criado_em desc limit 1), u.compareceu),
           coalesce(u.inscrito_em, u.visto_primeiro_em),
           exists (select 1 from recepcao_registros r where r.email_evento_id = u.email_evento_id and r.tipo = 'inscricao')
    from ulisses_inscricoes_evento u
    left join leads_inscricoes l on l."pessoaIdentificador" = u."pessoaIdentificador"
    left join painel_aluno_confirmado cf on cf.pessoa_id_ulisses = u.pessoa_id_ulisses
    left join lateral (select m.filial from mercurio_pessoas m where m.situacao = 'ATI'
        and m.tel_chave = campanha_telefone_chave(u.ddd, u.telefone)
        and split_part(nome_normalizado(m.nome), ' ', 1) = split_part(nome_normalizado(u.nome), ' ', 1) limit 1) mt on true
    left join lateral (select m.filial from mercurio_pessoas m where m.situacao = 'ATI'
        and lower(m.email) = nullif(lower(trim(u.email)), '')
        and split_part(nome_normalizado(m.nome), ' ', 1) = split_part(nome_normalizado(u.nome), ' ', 1) limit 1) me on true
    where u.evento_id_ulisses = p_evento_id_ulisses and u.removido_em is null
$$;
revoke all on function public.recepcao_lista(bigint) from public, anon, authenticated;

create or replace function public.recepcao_versao(p_evento_id_ulisses bigint)
returns text
language sql stable
set search_path = public
as $$
    select concat_ws(':',
        (select count(*) from ulisses_inscricoes_evento u where u.evento_id_ulisses = p_evento_id_ulisses and u.removido_em is null),
        (select coalesce(max(u.email_evento_id), 0) from ulisses_inscricoes_evento u where u.evento_id_ulisses = p_evento_id_ulisses and u.removido_em is null),
        (select count(*) filter (where u.compareceu) from ulisses_inscricoes_evento u where u.evento_id_ulisses = p_evento_id_ulisses and u.removido_em is null),
        (select count(*) from recepcao_registros r where r.evento_id_ulisses = p_evento_id_ulisses and r.tipo in ('presenca', 'desfazer', 'inscricao')),
        (select count(*) from recepcao_registros r where r.evento_id_ulisses = p_evento_id_ulisses and r.status = 'reservado'),
        (select count(*) from painel_aluno_confirmado))
$$;
revoke all on function public.recepcao_versao(bigint) from public, anon, authenticated;

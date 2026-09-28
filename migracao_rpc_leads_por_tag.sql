-- Pedido do usuário (2026-09-28, reunião com a Ediliene): "precisamos
-- criar uma sistemática... para enviar mensagens mais abertas para um
-- número muito grande de pessoas convidando para os próximos eventos" —
-- "Convidar (API)" já existia, mas só operava sobre `cardsSelecionados`
-- (checkbox no Kanban já paginado/carregado), não escalando pra "toda a
-- filial que tem tal perfil". Mesmo padrão de cast jsonb já usado em
-- `leads_ativos_inativos_da_filial()`/`leads_agenda_geral_prioritarios()`
-- — `tags` é jsonb guardado como STRING contendo o JSON, `(tags #>> '{}')::jsonb`
-- devolve o array de verdade nos dois formatos possíveis.
create or replace function leads_por_tag_filial(p_filial text, p_tag text, p_limite int default 1000, p_offset int default 0)
returns table (
    "pessoaIdentificador" text,
    "pessoaNome" text,
    "pessoaTelefoneDDD" text,
    "pessoaTelefoneNumero" text,
    filial text
)
language sql
stable
as $$
    select "pessoaIdentificador", "pessoaNome", "pessoaTelefoneDDD", "pessoaTelefoneNumero", filial
    from leads_inscricoes
    where filial = p_filial
      and lixeira_em is null
      and (tags #>> '{}')::jsonb @> to_jsonb(array[p_tag])
    order by "pessoaIdentificador"
    limit p_limite offset p_offset;
$$;

grant execute on function leads_por_tag_filial(text, text, int, int) to anon, authenticated;

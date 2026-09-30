-- RPC pra buscar candidatos a "lead prioritário" (Agenda do Dia — Todas
-- as Filiais, js/visao-geral.js) filtrando por conteúdo de `tags`.
-- `tags` é jsonb no banco (guardado como string JSON) — o PostgREST não
-- aceita cast (`coluna::tipo`) nem dentro do filtro `or=(...)` nem como
-- filtro solto (`coluna::tipo=ilike...` é ignorado, cai no operador cru
-- de jsonb e dá "operator does not exist: jsonb ~~* unknown"). Resolvido
-- com uma função SQL simples (roda com o privilégio de quem chama —
-- RLS de leads_inscricoes já libera SELECT público, então funciona pela
-- chave publishable igual qualquer outra consulta).
-- 2026-09-30: acrescentado `ultimo_contato_em` (coluna nova, ver
-- migracao_whatsapp_snooze_fila_ultimo_contato.sql) — pedido do usuário:
-- "organizar os novos contatos com base, entre outras coisas, nisso" (não
-- insistir em quem já foi contatado hoje). Filtro em si fica no FRONTEND
-- (js/visao-geral.js), aqui só devolve o dado.
create or replace function leads_agenda_geral_prioritarios()
returns table (
    "pessoaIdentificador" text,
    "pessoaNome" text,
    filial text,
    tags jsonb,
    historico_eventos jsonb,
    funil_agencia text,
    ultimo_contato_em timestamptz
)
language sql
stable
as $$
    select "pessoaIdentificador", "pessoaNome", filial, tags, historico_eventos, funil_agencia, ultimo_contato_em
    from leads_inscricoes
    where tags::text ilike '%Inscrito: Abertura de Turma%'
       or tags::text ilike '%Jornada: Engajado%'
       or tags::text ilike '%Jornada: Interesse Emergente%'
       or tags::text ilike '%Lead Forte 1%'
       or tags::text ilike '%Lead Forte 2%'
       or tags::text ilike '%Lead Forte 3%'
    limit 1500;
$$;

grant execute on function leads_agenda_geral_prioritarios() to anon, authenticated;

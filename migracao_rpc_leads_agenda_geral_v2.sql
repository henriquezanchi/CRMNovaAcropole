-- v2 de leads_agenda_geral_prioritarios() — pedido do usuário (2026-10-01):
-- "ajuste os parâmetros para dar atenção a essas pessoas" (quem tem a
-- tag nova "Retorno: Só 1 Evento", ver calcularTagsTrilhaEJornada() em
-- js/importador.js). Sem essa condição aqui, um lead que só tem "Retorno:
-- Só 1 Evento" (sem Lead Forte/Jornada também marcados) nunca entraria
-- nem como CANDIDATO na lista de 50 Leads Prioritários — a ordenação em
-- si (prioridade logo depois de Abertura de Turma) já foi ajustada em
-- js/visao-geral.js, mas só funciona pra quem está neste pool.
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
       or tags::text ilike '%Retorno: Só 1 Evento%'
    limit 1500;
$$;

grant execute on function leads_agenda_geral_prioritarios() to anon, authenticated;

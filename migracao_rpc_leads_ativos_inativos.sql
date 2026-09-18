-- Bug real (2026-09-18): tags "Ativo"/"Inativo" existem no banco (confirmado
-- em produção), mas ficam INVISÍVEIS no Kanban pra filiais grandes — a
-- paginação principal (carregarLeads(), js/app.js) ordena por
-- pessoaIdentificador ascendente e só traz os primeiros 500 por padrão;
-- como esses leads costumam ter ID SINTÉTICO (900000000+/950000000+ —
-- "Ativos/Inativos sem correspondência" em Inscrições, ver js/importador.js),
-- eles ficam sempre no FINAL da ordenação, atrás de todo lead com ID real
-- do Ulisses. Confirmado em Setor Oeste: 925 leads com ID menor que
-- 900000000 (sortam antes) contra só 176 sintéticos — com o padrão de 500
-- por página, NENHUM Ativo/Inativo carrega na visão inicial.
--
-- Mesma classe do bug já corrigido só pra "Matriculados"
-- (carregarMatriculadosSemPaginacao(), js/app.js) — esta função dá o mesmo
-- tratamento pra Ativo/Inativo. Precisa ser uma função SQL (não um filtro
-- direto do supabase-js) porque `tags` é jsonb e um `.ilike()`/`.or()` de
-- fora já deu erro confirmado antes ("operator does not exist: jsonb ~~*
-- unknown" — ver leads_agenda_geral_prioritarios(), mesmo motivo).
-- `tags #>> '{}'` funciona tanto se `tags` já for um array jsonb de
-- verdade quanto se for uma STRING jsonb contendo o JSON (formato real
-- observado em produção, "tags jsonb, na prática guardado como string
-- JSON") — nos dois casos o resultado, reconvertido com `::jsonb`, é o
-- array de tags de verdade.
create or replace function leads_ativos_inativos_da_filial(p_filial text)
returns setof leads_inscricoes
language sql
stable
as $$
  select *
  from leads_inscricoes
  where filial = p_filial
    and lixeira_em is null
    and (
      (tags #>> '{}')::jsonb @> '["Ativo"]'::jsonb
      or (tags #>> '{}')::jsonb @> '["Inativo"]'::jsonb
    );
$$;

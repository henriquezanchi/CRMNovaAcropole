-- ============================================================
-- Migração: número de matrícula do Mercúrio por lead (leads_inscricoes)
-- Rodar manualmente no SQL Editor do Supabase.
--
-- Guarda o número da coluna "Matr." da tela "Aluno => Matricular" do
-- Mercúrio — é o identificador estável que o importador de matrícula
-- (js/matricula-importar.js, texto colado da tabela) usa pra saber "esse
-- aluno já foi processado antes" e não duplicar/reprocessar quando o mesmo
-- aluno aparecer de novo num texto colado de outro dia (a lista do
-- Mercúrio cresce a cada matrícula nova, então textos colados de dias
-- diferentes se sobrepõem).
--
-- Índice único PARCIAL (só quando não é null) por filial: dois leads
-- podem ambos estar sem matricula_mercurio (ainda não processados), mas
-- não pode haver dois com o MESMO número na mesma filial.
-- ============================================================

alter table leads_inscricoes add column if not exists matricula_mercurio integer;

create unique index if not exists uq_leads_matricula_mercurio
    on leads_inscricoes (filial, matricula_mercurio)
    where matricula_mercurio is not null;

-- Lista GLOBAL (independente de filial) de quem é Ativo/Inativo em
-- QUALQUER unidade da rede — pedido do usuário (2026-09-18): uma aluna
-- ativa do Jardim América que participou de uma palestra no Setor Oeste
-- (e entrou no Ulisses de lá) tem um 2º lead, próprio de Setor Oeste, que
-- nunca ganha a tag Ativo/Inativo (o Mercúrio de Setor Oeste não a
-- conhece como aluna dele) — mesmo sendo a MESMA pessoa, aluna de
-- verdade da rede.
--
-- Casado só por telefone/e-mail normalizados (nunca por nome — homônimo
-- entre filiais é risco real demais pra arriscar sem um identificador
-- forte). Populada por scraper/mercurio.js (sincronizarRedeAtivosInativos(),
-- chamada ao fim do processamento de cada filial) e consultada pelo CRM
-- (js/app.js, carregarRedeAtivosInativos()) pra mostrar um badge PRÓPRIO
-- ("Ativo (Jardim América)") em qualquer lead de OUTRA filial que bata.
-- Mesmo padrão de acesso público do resto do projeto.
create table if not exists pessoas_ativas_rede (
    id bigint generated always as identity primary key,
    telefone_normalizado text,
    email_normalizado text,
    nome text,
    status text not null, -- 'Ativo' | 'Inativo'
    filial text not null, -- filial onde essa pessoa É de fato aluno(a)
    atualizado_em timestamptz not null default now()
);
alter table pessoas_ativas_rede enable row level security;
drop policy if exists "acesso publico pessoas_ativas_rede" on pessoas_ativas_rede;
create policy "acesso publico pessoas_ativas_rede" on pessoas_ativas_rede for all using (true) with check (true);
create index if not exists idx_pessoas_ativas_rede_telefone on pessoas_ativas_rede (telefone_normalizado);
create index if not exists idx_pessoas_ativas_rede_email on pessoas_ativas_rede (email_normalizado);

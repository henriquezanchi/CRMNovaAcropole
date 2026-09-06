-- ============================================================
-- Migração: catálogo de tags sugeridas (compartilhado entre navegadores)
-- Rodar manualmente no SQL Editor do Supabase (mesmo fluxo das migrações
-- anteriores). Antes esse catálogo era um array fixo em js/app.js —
-- virou uma tabela pra o time poder gerenciar pelo próprio CRM
-- ("Gerenciar Tags"), com o mesmo catálogo valendo pra todo mundo, não só
-- pra quem editou o código.
-- ============================================================

create table if not exists tags_sugeridas (
    id        bigint generated always as identity primary key,
    tag       text not null unique,
    ordem     int not null default 0,
    criado_em timestamptz not null default now()
);

-- Semente: o catálogo que já existia embutido no código, pra não perder
-- nada na migração. A cor de cada tag continua decidida automaticamente
-- por PADRÃO de texto (classeVisualTag()/FAMILIAS_TAG em js/app.js), não
-- por uma coluna aqui — por isso não tem coluna "familia" nesta tabela.
insert into tags_sugeridas (tag, ordem) values
    ('Não Atende / Caixa Postal', 0),
    ('Não responde mensagens', 1),
    ('Ligar à Noite', 2),
    ('Ligar no Sábado', 3),
    ('WhatsApp Inválido', 4),
    ('No-Show', 5),
    ('Lista de Espera', 6),
    ('Objeção: Tempo', 7),
    ('Objeção: Filhos pequenos', 8),
    ('Objeção: Financeiro', 9),
    ('Objeção: Distância/Trânsito', 10),
    ('Interesse: Estoicismo', 11),
    ('Interesse: Platão / Filosofia Clássica', 12),
    ('Interesse: Mitologia / A Odisseia', 13),
    ('Busca Autoconhecimento', 14),
    ('Sábado Filosófico', 15),
    ('Filosofilme', 16),
    ('Voluntariado', 17),
    ('Indicação de Aluno', 18)
on conflict (tag) do nothing;

alter table tags_sugeridas enable row level security;

-- Leitura e escrita públicas — mesmo modelo de acesso do resto do app
-- (chave publishable, sem login). A tela "Gerenciar Tags" escreve direto
-- nesta tabela pelo navegador.
drop policy if exists "acesso publico tags_sugeridas" on tags_sugeridas;
create policy "acesso publico tags_sugeridas"
    on tags_sugeridas for all
    using (true)
    with check (true);

-- ============================================================
-- Migração: leads possivelmente duplicados
-- Rodar manualmente no SQL Editor do Supabase (mesmo fluxo das migrações
-- anteriores). Guarda o resultado da varredura de duplicados — 1 linha
-- por lead que faz parte de algum grupo suspeito (não 1 linha por par,
-- pra dar conta de grupos com 3+ pessoas compartilhando o mesmo telefone).
--
-- A varredura roda automaticamente ao final de cada importação
-- (confirmarEnviarImportacao(), js/importador.js → detectarDuplicados(),
-- js/duplicados.js) e também sob demanda pelo botão "Verificar Agora" na
-- aba "Possíveis Duplicados". Cada varredura APAGA e recria do zero os
-- grupos daquela filial — é sempre um retrato fresco, não um histórico
-- acumulado (então "Ignorar" um grupo só vale até a próxima varredura).
-- ============================================================

create table if not exists duplicados_leads (
    id               bigint generated always as identity primary key,
    filial           text not null,
    grupo            text not null,   -- chave que agrupa os membros (ex: "tel:6299998888" ou "nome:MARIA:3")
    criterio         text not null,   -- 'telefone' | 'nome'
    pessoa_id        text not null,
    pessoa_nome      text,
    pessoa_telefone  text,
    detectado_em     timestamptz not null default now()
);

create index if not exists idx_duplicados_leads_filial on duplicados_leads(filial);

alter table duplicados_leads enable row level security;

drop policy if exists "acesso publico duplicados_leads" on duplicados_leads;
create policy "acesso publico duplicados_leads"
    on duplicados_leads for all
    using (true)
    with check (true);

-- ============================================================
-- Migração: cache de temas de evento classificados por IA
-- Rodar manualmente no SQL Editor do Supabase (mesmo fluxo das
-- migrações anteriores).
-- ============================================================

-- Tabela-cache: cada nome de evento (normalizado) só passa pela IA UMA VEZ,
-- em qualquer filial/importação — depois disso o tema fica salvo aqui e é
-- só reaproveitado. Mantém custo baixo e a taxonomia consistente ao longo
-- do tempo (sem o mesmo tipo de evento ganhando nomes de tema diferentes
-- entre uma importação e outra).
create table if not exists temas_eventos (
    evento_nome_normalizado text primary key, -- normalizarNomeImport() do nome do evento (maiúsculo, sem acento)
    evento_nome_original     text not null,
    tema                     text not null,
    criado_em                timestamptz not null default now()
);

alter table temas_eventos enable row level security;

-- Leitura pública (mesmo modelo de acesso do resto do app — chave
-- publishable, sem login). A escrita é feita pela Edge Function
-- classificar-temas usando a service role key, que ignora RLS.
drop policy if exists "leitura publica temas_eventos" on temas_eventos;
create policy "leitura publica temas_eventos"
    on temas_eventos for select
    using (true);

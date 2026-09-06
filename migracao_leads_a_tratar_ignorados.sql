-- ============================================================
-- Migração: "Ignorar" persistente na aba Leads a Tratar
-- Rodar manualmente no SQL Editor do Supabase.
--
-- Antes, "Ignorar" um grupo só apagava a linha de leads_a_tratar — como
-- toda "Verificar Agora"/reimportação APAGA E RECRIA os grupos do zero
-- (ver detectarLeadsATratar(), js/leads-a-tratar.js), o mesmo grupo
-- voltava a aparecer na próxima varredura. Esta tabela guarda a decisão
-- de "ignorar" separadamente, sobrevivendo às varreduras — o grupo só
-- reaparece se alguém "reconsiderar" manualmente (ver aba Leads a Tratar,
-- seção "Grupos Ignorados").
-- ============================================================

create table if not exists leads_a_tratar_ignorados (
    id          bigserial primary key,
    filial      text not null,
    grupo       text not null,        -- mesma chave usada em leads_a_tratar.grupo
    criterio    text,                 -- só informativo (telefone/email/nome/sem_telefone)
    descricao   text,                 -- nomes dos membros no momento de ignorar, só pra exibição legível
    ignorado_em timestamptz not null default now(),
    unique (filial, grupo)
);

alter table leads_a_tratar_ignorados enable row level security;

drop policy if exists "acesso publico leads_a_tratar_ignorados" on leads_a_tratar_ignorados;
create policy "acesso publico leads_a_tratar_ignorados"
    on leads_a_tratar_ignorados for all
    using (true)
    with check (true);

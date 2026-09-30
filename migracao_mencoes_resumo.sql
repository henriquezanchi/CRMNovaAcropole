-- Menções (@usuário) no Resumo/Anotações do lead — pedido do usuário
-- (2026-09-30): "crie uma forma de mencionar outros perfis de usuários
-- lá no resumo". Ao salvar um resumo contendo "@NomeDoUsuario" (batendo
-- com um nome ativo em usuarios_crm), grava 1 linha aqui — alimenta um
-- gatilho novo na Central de Notificações, filtrado pelo usuário LOGADO.
--
-- Só grava mensagens NOVAS (nomes mencionados que não estavam no texto
-- ANTES do salvamento atual, ver salvarResumoIA()/registrarMencoesResumo()
-- em js/app.js) — evita renotificar a cada pequena edição do mesmo texto.
--
-- Rodar manualmente: npx supabase db query --linked --file migracao_mencoes_resumo.sql
create table if not exists mencoes_resumo (
    id bigint generated always as identity primary key,
    "pessoaIdentificador" text not null,
    lead_nome text,
    usuario_mencionado text not null,
    autor text,
    trecho text, -- recorte do resumo (contexto, pra não precisar abrir o lead só pra saber do que se trata)
    lida boolean not null default false,
    criado_em timestamptz not null default now()
);

alter table mencoes_resumo enable row level security;
drop policy if exists "acesso publico mencoes_resumo" on mencoes_resumo;
create policy "acesso publico mencoes_resumo"
    on mencoes_resumo for all
    using (true)
    with check (true);

create index if not exists idx_mencoes_resumo_usuario on mencoes_resumo (usuario_mencionado, lida);

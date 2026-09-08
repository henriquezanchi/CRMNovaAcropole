-- ============================================================
-- Migração: log de atividade (auditoria durável)
-- Rodar manualmente no SQL Editor do Supabase (mesmo fluxo das migrações
-- anteriores).
--
-- Rede de segurança pedida pelo usuário enquanto o CRM ainda está em
-- desenvolvimento ativo (muitas mudanças de código por sessão): um
-- registro append-only das ações mais importantes feitas no CRM
-- (mover lead de coluna, adicionar/remover tag, mesclar leads, excluir
-- leads na Zona de Perigo, importação de planilha...), guardado no
-- Supabase — fora do alcance de qualquer mudança futura no front-end.
--
-- A garantia real de "não vai se perder" está na RLS: diferente de toda
-- outra tabela do projeto (que usa "for all using(true) with check(true)",
-- dando acesso total de leitura/escrita/exclusão), aqui só existem
-- policies de SELECT e INSERT. Não existe policy de UPDATE nem DELETE —
-- então nem um bug futuro no app (nem ninguém usando a chave publishable
-- direto) consegue alterar ou apagar uma linha já gravada. Uma vez
-- escrita, uma linha é permanente.
-- ============================================================

create table if not exists log_atividade (
    id          bigint generated always as identity primary key,
    criado_em   timestamptz not null default now(),
    filial      text,
    acao        text not null,       -- slug curto: 'mover_lead', 'tag_adicionar', 'tag_remover', 'mesclar_leads', 'excluir_leads_filial', 'importacao', 'motivo_perda', 'editar_contato', ...
    autor       text,                -- nome do atendente (mesmo localStorage do WhatsApp, "crm_na_nome_atendente") — sem login real no CRM, é best-effort
    pessoa_ids  jsonb,                -- array de pessoaIdentificador afetados por essa ação, quando fizer sentido
    detalhes    jsonb                 -- payload livre por tipo de ação (ex: {"novaColuna":"Matriculados","quantidade":3})
);

create index if not exists idx_log_atividade_criado_em on log_atividade (criado_em desc);
create index if not exists idx_log_atividade_filial on log_atividade (filial);
create index if not exists idx_log_atividade_acao on log_atividade (acao);

alter table log_atividade enable row level security;

drop policy if exists "log_atividade leitura publica" on log_atividade;
create policy "log_atividade leitura publica"
    on log_atividade for select
    using (true);

drop policy if exists "log_atividade insercao publica" on log_atividade;
create policy "log_atividade insercao publica"
    on log_atividade for insert
    with check (true);

-- Sem policy de UPDATE/DELETE de propósito — ver nota no cabeçalho.

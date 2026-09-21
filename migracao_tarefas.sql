-- ============================================================
-- Migração: Tarefas — primeiro pedaço do módulo de gestão de tarefas
-- pedido pelo usuário (2026-09-21): "visão de tarefas... responsável
-- (usuário ou equipe)... status pode mudar manualmente ou
-- automaticamente quando mudamos o lead de coluna, e vice-versa". Rodar
-- DEPOIS de migracao_equipes.sql (referencia `equipes`).
--
-- Decisões já confirmadas com o usuário antes de codificar:
-- - Uma tarefa pode ter VÁRIOS leads (ex: "mandar mensagem pra estes 20
--   leads" = 1 tarefa só) — por isso existe `tarefa_leads`, N:N, com o
--   status de conclusão POR LEAD dentro da tarefa (não 1 status pra
--   tarefa inteira) — é por lead que faz sentido "mover coluna".
-- - Responsável é usuário OU equipe (não precisa ser sempre 1 dos dois —
--   uma tarefa pode não ter responsável nenhum ainda, "a fazer por
--   qualquer um").
-- - O vínculo com coluna do Kanban guarda a CHAVE crua da coluna
--   (`columnsConfig[].key`, texto livre client-side — não existe tabela
--   de colunas válidas no servidor, ver CLAUDE.md "Colunas do Kanban são
--   dinâmicas") — mesma heurística de "guardar o texto e confiar" já
--   usada em Motivos de Perda/Matriculados/Recontato em todo o resto do
--   app; se o usuário renomear/apagar a coluna depois, o vínculo só para
--   de bater (fica órfão), não quebra nada.
-- ============================================================

create table if not exists tarefas (
    id                        bigint generated always as identity primary key,
    -- null = tarefa cross-filial (ex: time da Agência trabalhando em
    -- várias escolas); preenchido = tarefa escopada a 1 filial.
    filial                    text,
    titulo                    text not null,
    descricao                 text,
    responsavel_usuario_id    uuid references usuarios_crm(id) on delete set null,
    responsavel_equipe_id     bigint references equipes(id) on delete set null,
    prazo                     date,
    -- Ao mover um lead desta tarefa PRA esta coluna, marca o item dele
    -- na tarefa como concluído automaticamente. Null = sem gatilho
    -- automático, só conclusão manual.
    coluna_gatilho_conclusao  text,
    -- Ao marcar o item de um lead como concluído (manualmente OU via
    -- gatilho acima), move esse lead pra esta coluna. Null = não move
    -- nada, só marca concluído.
    coluna_ao_concluir        text,
    criado_por                text, -- nome do usuário logado (mesmo padrão de log_atividade.autor)
    criado_em                 timestamptz not null default now(),
    cancelada                 boolean not null default false
);

create table if not exists tarefa_leads (
    id                    bigint generated always as identity primary key,
    tarefa_id             bigint not null references tarefas(id) on delete cascade,
    "pessoaIdentificador" text not null, -- mesmo tipo/sem FK de evento_leads (ver migracao_evento_leads.sql)
    concluida             boolean not null default false,
    concluida_em          timestamptz,
    -- 'manual' (marcado na tela de Tarefas) ou 'coluna' (moveu pra
    -- coluna_gatilho_conclusao) — só informativo, pra dar pra entender
    -- na tela COMO cada item foi concluído.
    concluida_via         text,
    unique (tarefa_id, "pessoaIdentificador")
);

create index if not exists idx_tarefas_filial on tarefas (filial);
create index if not exists idx_tarefas_responsavel_usuario on tarefas (responsavel_usuario_id);
create index if not exists idx_tarefas_responsavel_equipe on tarefas (responsavel_equipe_id);
create index if not exists idx_tarefa_leads_tarefa on tarefa_leads (tarefa_id);
create index if not exists idx_tarefa_leads_pessoa on tarefa_leads ("pessoaIdentificador");

alter table tarefas enable row level security;
alter table tarefa_leads enable row level security;

-- Mesmo modelo de acesso público do resto do app.
drop policy if exists "acesso publico tarefas" on tarefas;
create policy "acesso publico tarefas"
    on tarefas for all
    using (true)
    with check (true);

drop policy if exists "acesso publico tarefa_leads" on tarefa_leads;
create policy "acesso publico tarefa_leads"
    on tarefa_leads for all
    using (true)
    with check (true);

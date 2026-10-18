-- Cobrança mensal por ciclo de abertura de turma (pedido do usuário, 2026-10-18).
--
-- - ciclos_turma: período de abertura de turmas, cadastrado POR FILIAL no CRM.
--   Toda turma do programa branco (tipo P, nível PP/N1) cuja data de abertura
--   cai no período pertence ao ciclo.
-- - cobrancas_mensais: 1 linha por filial por mês de cobrança. Gerada pela
--   Edge Function `cobranca-mensal` no dia 10 (ou próximo dia útil) como
--   RASCUNHO; o usuário revisa e fecha no CRM. Membros (base do Fixo) ficam
--   CONGELADOS no momento em que a cobrança é gerada.
-- - cobranca_itens: cada aluno cobrado. UNIQUE (matricula, unidade) garante
--   que ninguém é cobrado duas vezes — quem entra numa turma depois que a
--   cobrança do ciclo dela já saiu cai sozinho na cobrança seguinte.

create table if not exists ciclos_turma (
    id bigserial primary key,
    filial text not null,
    nome text not null,
    inicio date not null,
    fim date not null,
    criado_por text,
    criado_em timestamptz default now(),
    check (fim >= inicio)
);
create index if not exists idx_ciclos_turma_filial on ciclos_turma (filial, inicio);

create table if not exists cobrancas_mensais (
    id bigserial primary key,
    mes text not null,                       -- 'AAAA-MM' do mês da cobrança
    filial text not null,
    data_cobranca date not null,
    status text not null default 'rascunho' check (status in ('rascunho', 'fechada')),
    membros_congelados integer,
    valor_fixo numeric(10,2),
    fixo_manual boolean default false,       -- veio de valor_fixo_mensal_agencia
    modulo2_contratado boolean default true,
    valor_mensalidade numeric(10,2),
    matriculas integer default 0,
    comissao numeric(10,2) default 0,
    total numeric(10,2) default 0,
    janela_inicio date,                      -- complementar/recuperado: data individual nesta janela
    ciclos jsonb,                            -- ciclos fechados cobertos
    investigar jsonb,                        -- alunos a investigar (não cobrados)
    gerado_em timestamptz default now(),
    fechado_em timestamptz,
    fechado_por text,
    unique (mes, filial)
);

create table if not exists cobranca_itens (
    id bigserial primary key,
    cobranca_id bigint not null references cobrancas_mensais(id) on delete cascade,
    matricula integer not null,
    unidade text not null,
    filial text,
    pessoa_identificador text,
    nome text,
    nivel text,
    turma text,
    ciclo_id bigint,
    ciclo_nome text,
    data_efetiva date,
    data_referencia date,                    -- abertura da turma (branco) ou data individual
    programa text,
    recuperado boolean default false,
    ativo boolean default true,
    incluido boolean not null default true,  -- desmarcado na revisão = não cobra e não volta
    motivo_exclusao text,
    unique (matricula, unidade)
);
create index if not exists idx_cobranca_itens_cobranca on cobranca_itens (cobranca_id);

alter table ciclos_turma enable row level security;
alter table cobrancas_mensais enable row level security;
alter table cobranca_itens enable row level security;
drop policy if exists "acesso publico" on ciclos_turma;
create policy "acesso publico" on ciclos_turma for all using (true) with check (true);
drop policy if exists "acesso publico" on cobrancas_mensais;
create policy "acesso publico" on cobrancas_mensais for all using (true) with check (true);
drop policy if exists "acesso publico" on cobranca_itens;
create policy "acesso publico" on cobranca_itens for all using (true) with check (true);

-- Todo dia 09:00 Brasília (12:00 UTC). A function só age no dia de cobrança
-- (dia 10 ou o próximo dia útil); nos outros dias responde "não é hoje".
select cron.unschedule('cobranca-mensal-diario')
where exists (select 1 from cron.job where jobname = 'cobranca-mensal-diario');
select cron.schedule(
    'cobranca-mensal-diario',
    '0 12 * * *',
    $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/cobranca-mensal',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
    );
    $$
);

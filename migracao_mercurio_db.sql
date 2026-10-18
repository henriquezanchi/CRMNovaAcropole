-- Banco de consulta do Mercúrio (oinabview, via phpMyAdmin, atualizado toda
-- noite pela equipe do Mercúrio). Sincronizado pela Edge Function
-- `mercurio-db-sincronizar`. Base da conciliação de matrículas por turma,
-- de Recuperado/data de matrícula reais, do alerta de contribuição em
-- atraso, da contagem automática de Membros e do canal de origem.

-- Código da unidade no Mercúrio (cad_unidade/tur_unidade). Filial sem código
-- simplesmente não é sincronizada.
alter table filiais add column if not exists mercurio_unidade text;
alter table filiais add column if not exists membros_mercurio integer;

update filiais set mercurio_unidade = 'JAM' where nome = 'Goiânia - Jardim América' and mercurio_unidade is null;
update filiais set mercurio_unidade = 'STO' where nome = 'Goiânia - Setor Oeste'    and mercurio_unidade is null;
update filiais set mercurio_unidade = 'GAR' where nome = 'Goiânia - Garavelo'       and mercurio_unidade is null;
update filiais set mercurio_unidade = 'GY2' where nome = 'Goiânia II'               and mercurio_unidade is null;
update filiais set mercurio_unidade = 'BGA' where nome = 'Barra do Garças/MT'       and mercurio_unidade is null;

create table if not exists mercurio_turmas (
    unidade text not null,
    turma text not null,
    filial text,
    tipo text,              -- P = programa principal, R/M = complementar
    nivel text,
    dia text,
    horario text,
    inicio date,
    previsao_formatura date,
    sincronizado_em timestamptz default now(),
    primary key (unidade, turma)
);

-- 1 linha por aluno ATIVO visto no Mercúrio. Nunca apagada: quem some do
-- Mercúrio vira ativo=false e guarda a última competência calculada, pra o
-- histórico de cobrança não mudar depois que o aluno sai.
-- Sem CPF/RG de propósito. Telefone/e-mail vão só pro lead.
create table if not exists mercurio_alunos (
    matricula integer not null,
    unidade text not null,
    filial text,
    pessoa_identificador text,
    nome text,
    nivel text,
    turma_unidade text,
    turma text,
    ingresso date,
    reingresso date,
    recuperado boolean default false,
    data_efetiva date,               -- reingresso se recuperado, senão ingresso
    programa text,                   -- 'branco' | 'complementar' | 'outro'
    conta_remuneracao boolean default false,
    competencia text,                -- 'AAAA-MM' em que a matrícula conta pra cobrança
    turma_competencia text,          -- turma cuja abertura definiu a competência
    investigar_competencia text,     -- 'AAAA-MM' em que aparece como "investigar"
    motivo_investigar text,
    midia_ingresso integer,
    contribuicao numeric(10,2),
    meses_em_atraso integer default 0,
    ultimo_pagamento date,
    ativo boolean default true,
    visto_em timestamptz default now(),
    removido_em timestamptz,
    primary key (matricula, unidade)
);
create index if not exists idx_mercurio_alunos_competencia on mercurio_alunos (competencia);
create index if not exists idx_mercurio_alunos_investigar on mercurio_alunos (investigar_competencia);
create index if not exists idx_mercurio_alunos_filial on mercurio_alunos (filial);

-- Significado dos códigos de "como conheceu a escola" (cad_midia_ingresso).
-- O banco só guarda o número; a descrição é preenchida pelo time no CRM.
create table if not exists mercurio_midia_ingresso (
    codigo integer primary key,
    descricao text,
    ordem integer
);
insert into mercurio_midia_ingresso (codigo, ordem)
select c, c from unnest(array[0,5,10,15,20,25,30,35,40,45,50,55,60,65,70,75]) as c
on conflict (codigo) do nothing;

-- Quantidade de matrículas que a ESCOLA informou à mão em cada mês, pra
-- comparar com o que aparece no Mercúrio (devolver ou cobrar a diferença).
create table if not exists conciliacao_matriculas_informado (
    filial text not null,
    mes text not null,
    quantidade integer not null,
    observacao text,
    atualizado_por text,
    atualizado_em timestamptz default now(),
    primary key (filial, mes)
);
insert into conciliacao_matriculas_informado (filial, mes, quantidade, observacao) values
    ('Goiânia - Jardim América', '2026-10', 9,  'Coletado com a escola'),
    ('Goiânia - Garavelo',       '2026-10', 7,  'Coletado com a escola'),
    ('Goiânia - Setor Oeste',    '2026-10', 7,  'Coletado com a escola'),
    ('Goiânia II',               '2026-10', 12, 'Coletado com a escola')
on conflict (filial, mes) do nothing;

-- RLS: leitura pública (mesmo padrão do resto do app); mercurio_turmas/
-- mercurio_alunos só são escritas pela Edge Function (service_role).
alter table mercurio_turmas enable row level security;
alter table mercurio_alunos enable row level security;
alter table mercurio_midia_ingresso enable row level security;
alter table conciliacao_matriculas_informado enable row level security;

drop policy if exists "leitura publica" on mercurio_turmas;
create policy "leitura publica" on mercurio_turmas for select using (true);
drop policy if exists "leitura publica" on mercurio_alunos;
create policy "leitura publica" on mercurio_alunos for select using (true);
drop policy if exists "acesso publico" on mercurio_midia_ingresso;
create policy "acesso publico" on mercurio_midia_ingresso for all using (true) with check (true);
drop policy if exists "acesso publico" on conciliacao_matriculas_informado;
create policy "acesso publico" on conciliacao_matriculas_informado for all using (true) with check (true);

-- Log da sincronização no mesmo lugar das outras.
alter table status_sincronizacao_automatica drop constraint if exists status_sincronizacao_automatica_sistema_check;
alter table status_sincronizacao_automatica add constraint status_sincronizacao_automatica_sistema_check
    check (sistema in ('ulisses', 'mercurio', 'mercury_api', 'mercurio_db'));

-- Todo dia 06:30 Brasília (09:30 UTC) — o banco é atualizado por volta das 23h.
select cron.unschedule('mercurio-db-sincronizar-diario')
where exists (select 1 from cron.job where jobname = 'mercurio-db-sincronizar-diario');
select cron.schedule(
    'mercurio-db-sincronizar-diario',
    '30 9 * * *',
    $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/mercurio-db-sincronizar',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
    );
    $$
);

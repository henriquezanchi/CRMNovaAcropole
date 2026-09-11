-- Progresso em tempo real do scraper do Mercúrio (1 linha só, sempre
-- sobrescrita) -- base do sininho/indicador no topo do CRM que mostra
-- "rodando agora" com % e ETA, em vez de só saber depois que já terminou
-- (ver status_sincronizacao_automatica, que só grava no FIM da rodada).
create table if not exists public.scraper_progresso (
    id text primary key default 'mercurio',
    filial text,
    etapa text,
    passo_atual integer,
    passo_total integer,
    iniciado_em timestamptz,
    atualizado_em timestamptz not null default now(),
    concluido boolean not null default true
);

alter table public.scraper_progresso enable row level security;

-- Só leitura pro público (mesmo padrão de status_sincronizacao_automatica --
-- não é dado sensível). Escrita é só do scraper, via service_role, que
-- ignora RLS -- por isso nenhuma policy de insert/update é necessária.
drop policy if exists "scraper_progresso_select_publico" on public.scraper_progresso;
create policy "scraper_progresso_select_publico" on public.scraper_progresso
    for select using (true);

insert into public.scraper_progresso (id, concluido)
values ('mercurio', true)
on conflict (id) do nothing;

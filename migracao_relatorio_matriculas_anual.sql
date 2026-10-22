begin;
create table if not exists public.relatorio_matriculas_mensais (
    filial_id bigint not null references public.filiais(id),
    ano integer not null check(ano between 1900 and 2100),
    mes integer not null check(mes between 1 and 12),
    novas integer check(novas>=0),
    reingressos integer check(reingressos>=0),
    membros_referencia integer check(membros_referencia>=0),
    fonte_data date not null,
    parcial boolean not null default false,
    atualizado_em timestamptz not null default now(),
    primary key(filial_id,ano,mes)
);
alter table public.relatorio_matriculas_mensais enable row level security;
drop policy if exists leitura on public.relatorio_matriculas_mensais;
create policy leitura on public.relatorio_matriculas_mensais for select using(true);
grant select on public.relatorio_matriculas_mensais to anon,authenticated;
comment on table public.relatorio_matriculas_mensais is 'Estatística acadêmica por data de ingresso e reingresso, ATI+INA, PP/N1-N7/CA; não é comissão por ciclo nem conversão de leads. Denominador: membros atuais da base de referência.';
commit;

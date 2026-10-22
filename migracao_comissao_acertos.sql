-- Acertos do simulador: apenas comissões; o fixo e faturas fechadas ficam
-- preservados. O saldo é recalculado pela sequência mensal, sem lançá-lo
-- novamente como receita no mês seguinte.
begin;
create table if not exists public.comissao_acertos (
    filial_id bigint not null references public.filiais(id),
    mes text not null check (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    comissao_devida numeric(12,2) check (comissao_devida>=0),
    valor_recebido numeric(12,2) check (valor_recebido>=0),
    origem text not null default 'manual',
    observacao text,
    versao integer not null default 1,
    atualizado_por text,
    atualizado_em timestamptz not null default now(),
    primary key(filial_id,mes)
);
create table if not exists public.comissao_acertos_historico (
    id bigserial primary key,
    filial_id bigint not null,
    mes text not null,
    antes jsonb,
    depois jsonb not null,
    registrado_em timestamptz not null default now()
);
alter table public.comissao_acertos enable row level security;
alter table public.comissao_acertos_historico enable row level security;
drop policy if exists leitura on public.comissao_acertos;
create policy leitura on public.comissao_acertos for select using(true);
drop policy if exists leitura on public.comissao_acertos_historico;
create policy leitura on public.comissao_acertos_historico for select using(true);
grant select on public.comissao_acertos,public.comissao_acertos_historico to anon,authenticated;

create or replace function public.auditar_comissao_acertos() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
    insert into public.comissao_acertos_historico(filial_id,mes,antes,depois)
    values(new.filial_id,new.mes,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
    return new;
end; $$;
drop trigger if exists auditar_comissao_acertos on public.comissao_acertos;
create trigger auditar_comissao_acertos after insert or update on public.comissao_acertos
for each row execute function public.auditar_comissao_acertos();

create or replace function public.salvar_acerto_comissao(
    p_filial_id bigint,p_mes text,p_devida numeric,p_recebido numeric,
    p_versao integer,p_origem text,p_observacao text,p_autor text
) returns public.comissao_acertos
language plpgsql security definer set search_path=pg_catalog,public as $$
declare resultado public.comissao_acertos;
begin
    if not exists(select 1 from public.filiais where id=p_filial_id and ativo=true and filial_cobranca_id is null) then
        raise exception 'Use a filial responsável pela cobrança; filial inativa ou agrupada.';
    end if;
    if p_devida<0 or p_recebido<0 or p_devida='NaN'::numeric or p_recebido='NaN'::numeric then
        raise exception 'Informe valores não negativos.';
    end if;
    if p_versao=0 then
        insert into public.comissao_acertos(filial_id,mes,comissao_devida,valor_recebido,origem,observacao,atualizado_por)
        values(p_filial_id,p_mes,p_devida,p_recebido,left(coalesce(p_origem,'manual'),100),left(p_observacao,2000),left(p_autor,200))
        on conflict(filial_id,mes) do nothing returning * into resultado;
    else
        update public.comissao_acertos set comissao_devida=p_devida,valor_recebido=p_recebido,
            origem=left(coalesce(p_origem,'manual'),100),observacao=left(p_observacao,2000),atualizado_por=left(p_autor,200),
            versao=versao+1,atualizado_em=now()
        where filial_id=p_filial_id and mes=p_mes and versao=p_versao returning * into resultado;
    end if;
    if resultado.filial_id is null then
        raise exception 'Este mês foi alterado em outra sessão. Recarregue antes de salvar.' using errcode='40001';
    end if;
    return resultado;
end; $$;
revoke all on function public.salvar_acerto_comissao(bigint,text,numeric,numeric,integer,text,text,text) from public;
grant execute on function public.salvar_acerto_comissao(bigint,text,numeric,numeric,integer,text,text,text) to anon,authenticated,service_role;
commit;

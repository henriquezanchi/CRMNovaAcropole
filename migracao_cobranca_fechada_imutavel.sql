-- Preserva cobranças fechadas e seus itens, inclusive contra telas antigas
-- e geração concorrente de prévias. Não recalcula nem altera dados existentes.
-- Aplicar após migracao_cobranca_ciclos.sql.
begin;

create or replace function public.impedir_alteracao_cobranca_fechada()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    if old.status = 'fechada' then
        raise exception 'Cobrança fechada não pode ser alterada ou excluída.'
            using errcode = '23514';
    end if;
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

create or replace function public.impedir_alteracao_item_cobranca_fechada()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
    id_anterior bigint;
    id_novo bigint;
    cobranca record;
begin
    if tg_op <> 'INSERT' then
        id_anterior := old.cobranca_id;
    end if;
    if tg_op <> 'DELETE' then
        id_novo := new.cobranca_id;
    end if;

    -- A trava do pai serializa esta alteração com o fechamento. Em mudanças
    -- de vínculo, protege ambos os pais e usa ordem estável de aquisição.
    for cobranca in
        select id, status
        from public.cobrancas_mensais
        where id = id_anterior or id = id_novo
        order by id
        for update
    loop
        if cobranca.status = 'fechada' then
            -- A mesclagem preservadora transfere somente este vínculo para
            -- o cadastro sobrevivente; não altera o retrato financeiro.
            if tg_op = 'UPDATE' then
                if (to_jsonb(new) - 'pessoa_identificador') =
                   (to_jsonb(old) - 'pessoa_identificador') then
                    continue;
                end if;
            end if;
            raise exception 'Itens de cobrança fechada não podem ser incluídos, alterados ou excluídos.'
                using errcode = '23514';
        end if;
    end loop;

    -- Na exclusão em cascata de um rascunho, o pai já não está visível.
    -- A FK existente continua validando o pai de INSERT/UPDATE.
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_cobranca_fechada_imutavel on public.cobrancas_mensais;
create trigger trg_cobranca_fechada_imutavel
before update or delete on public.cobrancas_mensais
for each row execute function public.impedir_alteracao_cobranca_fechada();

drop trigger if exists trg_item_cobranca_fechada_imutavel on public.cobranca_itens;
create trigger trg_item_cobranca_fechada_imutavel
before insert or update or delete on public.cobranca_itens
for each row execute function public.impedir_alteracao_item_cobranca_fechada();

commit;

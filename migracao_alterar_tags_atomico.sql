-- Alteração ATÔMICA de etiquetas de um lead (2026-10-31).
--
-- Antes, seis Edge Functions liam as etiquetas, mexiam no JavaScript e
-- regravavam a lista inteira. Dois problemas reais:
--  1. Se a leitura falhasse (etiquetas gravadas como array jsonb de verdade,
--     ou com dupla codificação), o código tratava como lista vazia e gravava
--     só a etiqueta nova por cima, apagando todas as outras.
--  2. Duas rotinas ao mesmo tempo (ex.: webhook gravando "Não Contatar"
--     enquanto o whatsapp-send grava "Contato Recente") faziam a última
--     escrita apagar a primeira.
--
-- Esta função trava a linha (FOR UPDATE), lê de forma tolerante, aplica
-- remoções/adições e grava numa operação só. Se a leitura não der um array,
-- NÃO grava nada e devolve null.

create or replace function crm_alterar_tags(
    p_pessoa text,
    p_adicionar text[] default '{}',
    p_remover text[] default '{}',
    p_remover_prefixos text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    atual jsonb;
    lista jsonb;
    nova jsonb;
    etiqueta text;
begin
    select tags into atual from leads_inscricoes where "pessoaIdentificador" = p_pessoa for update;
    if not found then return null; end if;

    begin
        lista := case
            when atual is null or atual = 'null'::jsonb then '[]'::jsonb
            when jsonb_typeof(atual) = 'string' then (atual #>> '{}')::jsonb
            else atual
        end;
        -- dupla codificação (string dentro de string)
        if jsonb_typeof(lista) = 'string' then lista := (lista #>> '{}')::jsonb; end if;
        if lista is null or lista = 'null'::jsonb then lista := '[]'::jsonb; end if;
    exception when others then
        return null;
    end;
    if jsonb_typeof(lista) <> 'array' then return null; end if;

    select coalesce(jsonb_agg(to_jsonb(v) order by ord), '[]'::jsonb) into nova
    from jsonb_array_elements_text(lista) with ordinality as x(v, ord)
    where not (v = any(coalesce(p_remover, '{}')))
      and not exists (select 1 from unnest(coalesce(p_remover_prefixos, '{}')) pr where left(v, length(pr)) = pr);

    foreach etiqueta in array coalesce(p_adicionar, '{}') loop
        if etiqueta is not null and etiqueta <> '' and not (nova ? etiqueta) then
            nova := nova || to_jsonb(etiqueta);
        end if;
    end loop;

    if nova is distinct from lista or jsonb_typeof(atual) is distinct from 'string' then
        update leads_inscricoes set tags = to_jsonb(nova::text) where "pessoaIdentificador" = p_pessoa;
    end if;
    return nova;
end;
$$;

revoke all on function crm_alterar_tags(text, text[], text[], text[]) from public, anon, authenticated;
grant execute on function crm_alterar_tags(text, text[], text[], text[]) to service_role;

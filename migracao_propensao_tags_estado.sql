-- Backfill idempotente das tags explicativas no CRM já existente.
-- Só usa intenção/preferência canônicas; não lê histórico bruto ou eventos.
begin;

create schema if not exists crm_private;
revoke all on schema crm_private from public, anon, authenticated;
grant usage on schema crm_private to service_role;

create table if not exists crm_private.propensao_tags_estado_backup (
    filial text not null default '',
    pessoa_identificador text not null,
    tags_originais jsonb,
    salvo_em timestamptz not null default now(),
    primary key (filial, pessoa_identificador)
);
alter table crm_private.propensao_tags_estado_backup enable row level security;
revoke all on crm_private.propensao_tags_estado_backup from public, anon, authenticated;
grant select, insert on crm_private.propensao_tags_estado_backup to service_role;

-- Converte tags array e serializações JSON em até quatro camadas. NULL
-- significa formato desconhecido: o chamador deve deixar a fonte intacta.
create or replace function crm_private.propensao_tags_array(p_tags jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
    atual jsonb;
    texto_json text;
    profundidade integer := 0;
begin
    if p_tags is null then return '[]'::jsonb; end if;
    atual := p_tags;
    loop
        if jsonb_typeof(atual) = 'array' then return atual; end if;
        if jsonb_typeof(atual) <> 'string' or profundidade >= 4 then return null; end if;
        texto_json := atual #>> '{}';
        begin
            atual := texto_json::jsonb;
        exception when others then
            return null;
        end;
        profundidade := profundidade + 1;
    end loop;
end;
$$;
revoke all on function crm_private.propensao_tags_array(jsonb) from public, anon, authenticated;
grant execute on function crm_private.propensao_tags_array(jsonb) to service_role;

create or replace function crm_private.propensao_timestamp_seguro(p_valor text)
returns timestamptz
language plpgsql
immutable
set search_path = pg_temp
as $$
begin
    if nullif(btrim(p_valor), '') is null then return null; end if;
    return btrim(p_valor)::timestamptz;
exception when others then
    return null;
end;
$$;
revoke all on function crm_private.propensao_timestamp_seguro(text) from public, anon, authenticated;
grant execute on function crm_private.propensao_timestamp_seguro(text) to service_role;

-- Retorna array novo ou NULL para tags em formato inválido. Mantém toda tag
-- fora dos estados geridos e remove o rótulo global de adequação por turma.
create or replace function crm_private.propensao_tags_estado(
    p_tags jsonb,
    p_acompanhamento jsonb,
    p_agora timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path = pg_temp
as $$
declare
    originais jsonb;
    resultado jsonb := '[]'::jsonb;
    item jsonb;
    rotulo text;
    acompanhamento jsonb;
    intencao text;
    intencao_em_texto text;
    intencao_em timestamptz;
    intencao_por text;
    contato text;
    contato_em timestamptz;
    contato_por text;
    interesse_valido boolean := false;
    revogacao_explicita boolean := false;
    tinha_nao_contatar boolean := false;
    etiqueta_interesse text := 'Interesse a confirmar';
begin
    originais := crm_private.propensao_tags_array(p_tags);
    if originais is null then return null; end if;
    acompanhamento := case when jsonb_typeof(p_acompanhamento) = 'object' then p_acompanhamento else '{}'::jsonb end;
    intencao := acompanhamento->>'intencao';

    intencao_em_texto := nullif(btrim(acompanhamento->>'intencao_atualizado_em'), '');
    if intencao_em_texto is not null then
        intencao_em := crm_private.propensao_timestamp_seguro(intencao_em_texto);
        intencao_por := nullif(btrim(acompanhamento->>'intencao_atualizado_por'), '');
    else
        -- Campos legados só valem como intenção quando os dois dados
        -- legados (data e autor) estão presentes.
        intencao_em := crm_private.propensao_timestamp_seguro(acompanhamento->>'atualizado_em');
        intencao_por := nullif(btrim(acompanhamento->>'atualizado_por'), '');
    end if;
    interesse_valido := intencao in ('conhecer','participar','inscrever','depois','nao')
        and intencao_em is not null and intencao_em <= p_agora
        and intencao_por is not null;
    if interesse_valido then
        etiqueta_interesse := case when intencao = 'nao' then 'Interesse declarado: não' else 'Interesse declarado' end;
    end if;

    contato := acompanhamento->>'contato';
    contato_em := crm_private.propensao_timestamp_seguro(acompanhamento->>'preferencia_contato_em');
    contato_por := nullif(btrim(acompanhamento->>'preferencia_contato_por'), '');
    revogacao_explicita := contato = 'permitido' and contato_em is not null
        and contato_em <= p_agora and contato_por is not null;

    for item in select value from jsonb_array_elements(originais) loop
        if jsonb_typeof(item) = 'string' then rotulo := item #>> '{}'; else rotulo := null; end if;
        if rotulo in ('Interesse a confirmar','Interesse declarado','Interesse declarado: não','Horário a confirmar') then
            continue;
        end if;
        if rotulo in ('Não contatar','Não Contatar') then
            if contato = 'nao_contatar' then continue; end if;
            if revogacao_explicita then continue; end if;
            if tinha_nao_contatar then continue; end if;
            tinha_nao_contatar := true;
            continue;
        end if;
        resultado := resultado || jsonb_build_array(item);
    end loop;

    resultado := resultado || jsonb_build_array(etiqueta_interesse);
    if contato = 'nao_contatar' or (tinha_nao_contatar and not revogacao_explicita) then
        resultado := resultado || jsonb_build_array('Não contatar');
    end if;
    return resultado;
end;
$$;
revoke all on function crm_private.propensao_tags_estado(jsonb,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function crm_private.propensao_tags_estado(jsonb,jsonb,timestamptz) to service_role;

do $$
declare
    lead record;
    tags_novas jsonb;
    tags_gravadas jsonb;
    atualizados integer := 0;
    invalidos integer := 0;
begin
    insert into crm_private.propensao_tags_estado_backup
        (filial, pessoa_identificador, tags_originais)
    select coalesce(l.filial, ''), l."pessoaIdentificador", l.tags
    from public.leads_inscricoes l
    where l."pessoaIdentificador" is not null
    on conflict (filial, pessoa_identificador) do nothing;

    for lead in
        select "pessoaIdentificador", filial, tags, acompanhamento
        from public.leads_inscricoes
        where "pessoaIdentificador" is not null
        order by filial, "pessoaIdentificador"
        for update
    loop
        tags_novas := crm_private.propensao_tags_estado(lead.tags, lead.acompanhamento, now());
        if tags_novas is null then
            invalidos := invalidos + 1;
            continue;
        end if;

        -- Mantém a forma nativa de arrays; os registros usados pelo CRM são
        -- JSON string contendo um array serializado.
        if jsonb_typeof(lead.tags) = 'array' then
            tags_gravadas := tags_novas;
        else
            tags_gravadas := to_jsonb(tags_novas::text);
        end if;
        if tags_gravadas is distinct from lead.tags then
            update public.leads_inscricoes
               set tags = tags_gravadas
             where "pessoaIdentificador" = lead."pessoaIdentificador"
               and filial is not distinct from lead.filial;
            atualizados := atualizados + 1;
        end if;
    end loop;
    raise notice 'Tags de propensão atualizadas: %, fontes inválidas preservadas sem alteração: %', atualizados, invalidos;
end;
$$;

commit;

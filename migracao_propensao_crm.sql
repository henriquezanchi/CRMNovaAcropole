-- Base privada e append-only para avaliações explicáveis por abertura.
-- Aplicar manualmente após revisão; nenhuma tabela nova recebe policy pública.
begin;

create schema if not exists crm_private;
revoke all on schema crm_private from public, anon, authenticated;
grant usage on schema crm_private to service_role;

create table if not exists crm_private.propensao_tags_legadas_backup (
    pessoa_identificador text not null,
    filial text not null,
    tags_originais jsonb not null,
    copiado_em timestamptz not null default now(),
    primary key (filial, pessoa_identificador)
);
alter table crm_private.propensao_tags_legadas_backup enable row level security;
revoke all on crm_private.propensao_tags_legadas_backup from public, anon, authenticated;
grant select, insert on crm_private.propensao_tags_legadas_backup to service_role;

-- Guarda a lista original, de forma privada, antes de retirar apenas tags
-- derivadas por contagem/evento. O histórico bruto de eventos não é alterado.
insert into crm_private.propensao_tags_legadas_backup (pessoa_identificador, filial, tags_originais)
select l."pessoaIdentificador", l.filial, l.tags
from public.leads_inscricoes l
where exists (
    select 1
    from jsonb_array_elements_text(
        case
            when jsonb_typeof(l.tags) = 'string' then (l.tags #>> '{}')::jsonb
            when jsonb_typeof(l.tags) = 'array' then l.tags
            else '[]'::jsonb
        end
    ) as tag(valor)
    where tag.valor ~ '^Lead Forte( [1-3])?$'
       or tag.valor ~ '^(Jornada|Trilha|Retorno): '
)
on conflict (filial, pessoa_identificador) do nothing;

update public.leads_inscricoes l
set tags = to_jsonb((
    select coalesce(jsonb_agg(to_jsonb(tag.valor) order by tag.ordem), '[]'::jsonb)::text
    from jsonb_array_elements_text(
        case
            when jsonb_typeof(l.tags) = 'string' then (l.tags #>> '{}')::jsonb
            when jsonb_typeof(l.tags) = 'array' then l.tags
            else '[]'::jsonb
        end
    ) with ordinality as tag(valor, ordem)
    where tag.valor !~ '^Lead Forte( [1-3])?$'
      and tag.valor !~ '^(Jornada|Trilha|Retorno): '
))
where exists (
    select 1
    from jsonb_array_elements_text(
        case
            when jsonb_typeof(l.tags) = 'string' then (l.tags #>> '{}')::jsonb
            when jsonb_typeof(l.tags) = 'array' then l.tags
            else '[]'::jsonb
        end
    ) as tag(valor)
    where tag.valor ~ '^Lead Forte( [1-3])?$'
       or tag.valor ~ '^(Jornada|Trilha|Retorno): '
);

create table if not exists public.propensao_avaliacoes (
    id uuid primary key default gen_random_uuid(),
    filial_codigo text not null,
    filial text not null,
    abertura_id text not null check (length(btrim(abertura_id)) between 1 and 100),
    lead_id text not null,
    abertura jsonb not null check (jsonb_typeof(abertura) = 'object'),
    sinais jsonb not null default '[]'::jsonb check (jsonb_typeof(sinais) = 'array'),
    snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
    versao_motor text not null,
    versao_regras text not null,
    interesse_estado text not null check (interesse_estado in ('a_confirmar','conhecer','participar','inscrever','depois','nao')),
    adequacao_estado text not null check (adequacao_estado in ('a_confirmar','adequada','inadequada')),
    proxima_acao jsonb not null check (jsonb_typeof(proxima_acao) = 'object'),
    fundamentos jsonb not null default '[]'::jsonb check (jsonb_typeof(fundamentos) = 'array'),
    avaliado_em timestamptz not null,
    pre_resultado boolean not null,
    fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
    criado_em timestamptz not null default now(),
    unique (filial_codigo, abertura_id, lead_id, fingerprint)
);

create table if not exists public.propensao_acontecimentos (
    id uuid primary key default gen_random_uuid(),
    filial_codigo text not null,
    filial text not null,
    abertura_id text not null check (length(btrim(abertura_id)) between 1 and 100),
    lead_id text not null,
    tipo text not null check (tipo in ('interesse_declarado','disponibilidade_confirmada','presenca_palestra','outra_atividade','resposta_atendimento','pedido_matricula','nao_contatar','acao_realizada','resultado_atendimento')),
    valor jsonb not null,
    occurred_at timestamptz not null,
    origem text not null,
    natureza text not null check (natureza in ('declarado','observado','interpretado')),
    responsavel text not null,
    mercurio_id text,
    payload jsonb not null check (jsonb_typeof(payload) = 'object'),
    fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
    criado_em timestamptz not null default now(),
    unique (filial_codigo, abertura_id, lead_id, fingerprint)
);

create table if not exists public.propensao_acoes (
    id uuid primary key default gen_random_uuid(),
    acontecimento_id uuid not null references public.propensao_acontecimentos(id),
    filial_codigo text not null,
    filial text not null,
    abertura_id text not null,
    lead_id text not null,
    tipo text not null,
    ocorreu_em timestamptz not null,
    origem text not null,
    responsavel text not null,
    fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
    criado_em timestamptz not null default now(),
    unique (filial_codigo, abertura_id, lead_id, fingerprint)
);

create table if not exists public.propensao_resultados (
    id uuid primary key default gen_random_uuid(),
    acontecimento_id uuid not null references public.propensao_acontecimentos(id),
    filial_codigo text not null,
    filial text not null,
    abertura_id text not null,
    lead_id text not null,
    resultado text not null check (resultado in ('adiou','sem_interesse','horario_incompativel','contato_invalido','sem_resposta','matriculou')),
    motivo text,
    mercurio_id text,
    ocorreu_em timestamptz not null,
    origem text not null,
    natureza text not null check (natureza in ('declarado','observado')),
    responsavel text not null,
    fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
    criado_em timestamptz not null default now(),
    unique (filial_codigo, abertura_id, lead_id, fingerprint),
    check ((resultado = 'matriculou') = (mercurio_id is not null))
);

create index if not exists idx_propensao_avaliacoes_lead_abertura
    on public.propensao_avaliacoes (filial_codigo, abertura_id, lead_id, avaliado_em desc);
create index if not exists idx_propensao_eventos_lead_abertura
    on public.propensao_acontecimentos (filial_codigo, abertura_id, lead_id, occurred_at desc);
create index if not exists idx_propensao_resultados_mercurio
    on public.propensao_resultados (filial_codigo, mercurio_id) where mercurio_id is not null;

create or replace function public.propensao_bloquear_alteracao()
returns trigger
language plpgsql
as $$
begin
    raise exception 'Registros de propensão são append-only';
end;
$$;
revoke all on function public.propensao_bloquear_alteracao() from public, anon, authenticated, service_role;

drop trigger if exists propensao_avaliacoes_append_only on public.propensao_avaliacoes;
create trigger propensao_avaliacoes_append_only before update or delete on public.propensao_avaliacoes
for each row execute function public.propensao_bloquear_alteracao();
drop trigger if exists propensao_acontecimentos_append_only on public.propensao_acontecimentos;
create trigger propensao_acontecimentos_append_only before update or delete on public.propensao_acontecimentos
for each row execute function public.propensao_bloquear_alteracao();
drop trigger if exists propensao_acoes_append_only on public.propensao_acoes;
create trigger propensao_acoes_append_only before update or delete on public.propensao_acoes
for each row execute function public.propensao_bloquear_alteracao();
drop trigger if exists propensao_resultados_append_only on public.propensao_resultados;
create trigger propensao_resultados_append_only before update or delete on public.propensao_resultados
for each row execute function public.propensao_bloquear_alteracao();

do $$
declare
    tabela text;
begin
    foreach tabela in array array['propensao_avaliacoes','propensao_acontecimentos','propensao_acoes','propensao_resultados'] loop
        execute format('alter table public.%I enable row level security', tabela);
        execute format('revoke all on public.%I from public, anon, authenticated', tabela);
        execute format('grant select, insert on public.%I to service_role', tabela);
    end loop;
end;
$$;

-- Atualiza apenas preferência de contato e a tag canônica. O lock por lead
-- serializa atualizações concorrentes e a data do sinal impede que um evento
-- antigo reverta uma preferência mais recente.
create or replace function public.propensao_atualizar_nao_contatar(
    p_filial_codigo text,
    p_lead_id text,
    p_valor boolean,
    p_ocorreu_em timestamptz,
    p_responsavel text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    alvo_filial text;
    alvo_acompanhamento jsonb;
    alvo_tags jsonb;
    lista_tags jsonb := '[]'::jsonb;
    data_preferencia timestamptz;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'Ação restrita ao serviço';
    end if;
    if p_valor is null or p_ocorreu_em is null or length(btrim(coalesce(p_lead_id, ''))) = 0
       or length(btrim(coalesce(p_responsavel, ''))) = 0 then
        raise exception 'Dados da preferência incompletos';
    end if;

    select f.nome into alvo_filial
    from public.filiais f
    where f.mercurio_unidade = p_filial_codigo and f.ativo = true;
    if alvo_filial is null then return false; end if;

    select coalesce(l.acompanhamento, '{}'::jsonb), l.tags
      into alvo_acompanhamento, alvo_tags
    from public.leads_inscricoes l
    where l."pessoaIdentificador" = p_lead_id
      and l.filial = alvo_filial
      and l.lixeira_em is null
    for update;
    if not found then return false; end if;

    -- Registros novos usam carimbo próprio. O atualizado_em legado é usado
    -- como limite quando ainda não existe carimbo específico.
    begin
        data_preferencia := nullif(alvo_acompanhamento->>'preferencia_contato_em', '')::timestamptz;
    exception when others then data_preferencia := null;
    end;
    if data_preferencia is null and alvo_acompanhamento->>'contato' in ('permitido', 'pausado', 'nao_contatar') then
        begin
            data_preferencia := nullif(alvo_acompanhamento->>'atualizado_em', '')::timestamptz;
        exception when others then data_preferencia := null;
        end;
    end if;
    if data_preferencia is not null and data_preferencia >= p_ocorreu_em then return false; end if;

    begin
        if jsonb_typeof(alvo_tags) = 'string' then
            lista_tags := (alvo_tags #>> '{}')::jsonb;
        elsif jsonb_typeof(alvo_tags) = 'array' then
            lista_tags := alvo_tags;
        end if;
        if jsonb_typeof(lista_tags) <> 'array' then lista_tags := '[]'::jsonb; end if;
    exception when others then lista_tags := '[]'::jsonb;
    end;

    -- Sem cronologia comprovada, um bloqueio legado não é removido por replay.
    if not p_valor and data_preferencia is null and (alvo_acompanhamento->>'contato'='nao_contatar' or lista_tags ? 'Não contatar' or lista_tags ? 'Não Contatar') then return false; end if;

    if p_valor then
        if not (lista_tags ? 'Não contatar') then lista_tags := lista_tags || jsonb_build_array('Não contatar'); end if;
    else
        select coalesce(jsonb_agg(tag.valor order by tag.ordem), '[]'::jsonb)
          into lista_tags
        from jsonb_array_elements_text(lista_tags) with ordinality as tag(valor, ordem)
        where tag.valor not in ('Não contatar', 'Não Contatar');
    end if;

    update public.leads_inscricoes l
       set acompanhamento = alvo_acompanhamento || jsonb_build_object(
               'contato', case when p_valor then 'nao_contatar' else 'permitido' end,
               'preferencia_contato_em', p_ocorreu_em,
               'preferencia_contato_por', btrim(p_responsavel)
           ),
           tags = to_jsonb(lista_tags::text)
     where l."pessoaIdentificador" = p_lead_id and l.filial = alvo_filial and l.lixeira_em is null;
    return true;
end;
$$;
revoke all on function public.propensao_atualizar_nao_contatar(text,text,boolean,timestamptz,text) from public, anon, authenticated;
grant execute on function public.propensao_atualizar_nao_contatar(text,text,boolean,timestamptz,text) to service_role;

-- Remove ranking legado da agenda. Inscrição em abertura permanece como fato
-- operacional; tags de interesse/probabilidade por eventos deixam de ser filtro.
create or replace function public.leads_agenda_geral_prioritarios()
returns table (
    "pessoaIdentificador" text,
    "pessoaNome" text,
    filial text,
    tags jsonb,
    historico_eventos jsonb,
    funil_agencia text,
    ultimo_contato_em timestamptz
)
language sql
stable
as $$
    select "pessoaIdentificador", "pessoaNome", filial, tags, historico_eventos, funil_agencia, ultimo_contato_em
    from public.leads_inscricoes
    where tags::text ilike '%Inscrito: Abertura de Turma%'
    limit 1500;
$$;
grant execute on function public.leads_agenda_geral_prioritarios() to anon, authenticated;

commit;

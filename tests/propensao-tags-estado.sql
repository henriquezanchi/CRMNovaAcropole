-- Executar em banco de teste após migracao_propensao_tags_estado.sql.
-- Só chama helpers puros em fixtures e termina sem gravar dados.
begin;
do $$
declare
    agora timestamptz := '2026-10-23T12:00:00Z';
    tags jsonb;
    estado jsonb;
    repetido jsonb;
    invalida jsonb := to_jsonb('{tags-quebradas'::text);
begin
    tags := to_jsonb('["Campanha manual","Interesse declarado","Horário a confirmar"]'::text);
    estado := crm_private.propensao_tags_estado(tags, jsonb_build_object(
        'intencao','participar', 'intencao_atualizado_em','2026-10-22T12:00:00Z',
        'intencao_atualizado_por','Equipe A', 'contato','nao_contatar'
    ), agora);
    if jsonb_typeof(estado) <> 'array' or not (estado ? 'Campanha manual') or not (estado ? 'Interesse declarado') or not (estado ? 'Não contatar') then
        raise exception 'Falha: serialização válida, tag customizada, intenção declarada ou opt-out foram perdidos.';
    end if;
    if estado ? 'Horário a confirmar' or estado ? 'Interesse a confirmar' then
        raise exception 'Falha: sobrou tag global de horário ou estado de interesse incompatível.';
    end if;
    repetido := crm_private.propensao_tags_estado(to_jsonb(estado::text), jsonb_build_object(
        'intencao','participar', 'intencao_atualizado_em','2026-10-22T12:00:00Z',
        'intencao_atualizado_por','Equipe A', 'contato','nao_contatar'
    ), agora);
    if repetido <> estado then raise exception 'Falha: backfill não é idempotente.'; end if;

    estado := crm_private.propensao_tags_estado('[]'::jsonb, jsonb_build_object(
        'intencao','nao', 'intencao_atualizado_em','2026-10-22T12:00:00Z',
        'intencao_atualizado_por','Equipe B'
    ), agora);
    if not (estado ? 'Interesse declarado: não') or estado ? 'Interesse a confirmar' then
        raise exception 'Falha: declaração explícita de não interesse não foi classificada.';
    end if;

    estado := crm_private.propensao_tags_estado('[]'::jsonb, jsonb_build_object(
        'intencao','participar', 'intencao_atualizado_em','2099-01-01T00:00:00Z',
        'intencao_atualizado_por','Equipe A'
    ), agora);
    if not (estado ? 'Interesse a confirmar') or estado ? 'Interesse declarado' then
        raise exception 'Falha: declaração futura deveria permanecer desconhecida.';
    end if;

    estado := crm_private.propensao_tags_estado('["Não Contatar","tag alheia"]'::jsonb, jsonb_build_object(
        'contato','permitido', 'preferencia_contato_em','2026-10-22T12:00:00Z',
        'preferencia_contato_por','Equipe C'
    ), agora);
    if estado ? 'Não Contatar' or estado ? 'Não contatar' or not (estado ? 'tag alheia') then
        raise exception 'Falha: revogação explícita não removeu o opt-out ou removeu tag alheia.';
    end if;

    if crm_private.propensao_tags_estado(invalida, '{}'::jsonb, agora) is not null or invalida <> to_jsonb('{tags-quebradas'::text) then
        raise exception 'Falha: formato inválido precisa ser ignorado sem alterar a fonte.';
    end if;
    if crm_private.propensao_tags_array(to_jsonb(to_jsonb('["tag aninhada"]'::text)::text)) <> '["tag aninhada"]'::jsonb then
        raise exception 'Falha: serialização JSON aninhada válida não foi recuperada.';
    end if;
end;
$$;
rollback;

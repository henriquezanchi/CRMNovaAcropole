-- Auto-arquivar conversas de WhatsApp sem atividade há 30+ dias — pedido
-- do usuário (2026-09-30), agora que pin/arquivar existe (ver
-- migracao_whatsapp_pin_arquivar_ocultar.sql). Nunca arquiva uma conversa
-- FIXADA (wpp_fixado — fixar é um sinal explícito de "não deixa de ver
-- isso", mais forte que o auto-arquivamento) nem quem já está arquivado
-- (idempotente, evita update desnecessário).
--
-- Roda 1x/dia via pg_cron, mesmo padrão de `limpar_lixeira_leads_vencidos()`
-- (migracao_lixeira_lead.sql) — função + policy pública de sempre.
--
-- Rodar manualmente: npx supabase db query --linked --file migracao_auto_arquivar_conversas_whatsapp.sql
create or replace function arquivar_conversas_whatsapp_inativas(p_dias int default 30)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    v_afetados int;
begin
    with ultima_mensagem as (
        select "pessoaIdentificador", max(criado_em) as ultima_em
        from mensagens_whatsapp
        where "pessoaIdentificador" is not null
        group by "pessoaIdentificador"
    )
    update leads_inscricoes l
    set wpp_arquivado = true
    from ultima_mensagem u
    where l."pessoaIdentificador" = u."pessoaIdentificador"
      and l.wpp_arquivado = false
      and l.wpp_fixado = false
      and u.ultima_em < now() - (p_dias || ' days')::interval;

    get diagnostics v_afetados = row_count;
    return v_afetados;
end;
$$;

grant execute on function arquivar_conversas_whatsapp_inativas(int) to anon, authenticated;

select cron.schedule(
    'auto-arquivar-conversas-whatsapp-diario',
    '30 8 * * *', -- 08:30 Brasília (depois do disparo do Mercúrio às 05:00/08:00 UTC)
    $$ select arquivar_conversas_whatsapp_inativas(30); $$
);

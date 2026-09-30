-- 3 RPCs novas de relatório de WhatsApp (pedido do usuário, 2026-09-30) —
-- todas só LEITURA (nunca decidem nada, só agregam o que já existe em
-- mensagens_whatsapp). Motivo de serem RPC em vez de query direta do
-- PostgREST: as 3 precisam de window functions (lag/lead) ou agregação
-- que o PostgREST não expressa bem — mesma razão de sempre neste projeto.
--
-- Rodar manualmente: npx supabase db query --linked --file migracao_rpc_relatorios_whatsapp.sql

-- 1) SLA de PRIMEIRA resposta — pra cada mensagem de ENTRADA que é a
--    PRIMEIRA depois da nossa última saída (ou a primeira msg da conversa
--    inteira), calcula quanto tempo até a PRÓXIMA saída. Diferente do
--    timer de 24h (sobre a janela da Meta) e do SLA de coluna fria (sobre
--    tempo sem mover) — este é sobre velocidade de ATENDIMENTO.
create or replace function sla_primeira_resposta_whatsapp(p_filial text default null, p_dias int default 30)
returns table (
    total_respondidas int,
    media_minutos numeric,
    mediana_minutos numeric
)
language sql
stable
as $$
    with msgs as (
        select
            m.id, m."pessoaIdentificador", m.direcao, m.criado_em, m.filial,
            lag(m.direcao) over (partition by m."pessoaIdentificador" order by m.criado_em) as direcao_anterior
        from mensagens_whatsapp m
        where m."pessoaIdentificador" is not null
          and m.criado_em > now() - (p_dias || ' days')::interval
          and (p_filial is null or m.filial = p_filial)
    ),
    aguardando as (
        -- toda mensagem de ENTRADA cuja anterior NÃO foi entrada também
        -- (ou seja, é o INÍCIO de um período em que estamos devendo resposta)
        select id, "pessoaIdentificador", criado_em
        from msgs
        where direcao = 'entrada' and (direcao_anterior is null or direcao_anterior = 'saida')
    ),
    proxima_saida as (
        select a."pessoaIdentificador", a.criado_em as aguardando_desde,
               (select min(s.criado_em) from mensagens_whatsapp s
                where s."pessoaIdentificador" = a."pessoaIdentificador"
                  and s.direcao = 'saida' and s.criado_em > a.criado_em) as respondido_em
        from aguardando a
    ),
    tempos as (
        select extract(epoch from (respondido_em - aguardando_desde)) / 60 as minutos
        from proxima_saida
        where respondido_em is not null
    )
    select
        count(*)::int as total_respondidas,
        round(avg(minutos)::numeric, 1) as media_minutos,
        round((percentile_cont(0.5) within group (order by minutos))::numeric, 1) as mediana_minutos
    from tempos;
$$;
grant execute on function sla_primeira_resposta_whatsapp(text, int) to anon, authenticated;

-- 2) Desempenho por atendente — volume enviado + tempo médio de resposta
--    por `atendente_nome` (já gravado em toda mensagem de saída desde
--    migracao_whatsapp_atendente.sql). Não tenta atribuir conversão
--    (matrícula) a um atendente específico — não há vínculo confiável
--    "SDR X converteu lead Y" no banco hoje; fica só em volume/velocidade.
create or replace function desempenho_atendentes_whatsapp(p_filial text default null, p_dias int default 30)
returns table (
    atendente_nome text,
    mensagens_enviadas int,
    media_minutos_resposta numeric
)
language sql
stable
as $$
    with enviadas as (
        select m.id, m.atendente_nome, m."pessoaIdentificador", m.criado_em
        from mensagens_whatsapp m
        where m.direcao = 'saida'
          and m.atendente_nome is not null
          and m.criado_em > now() - (p_dias || ' days')::interval
          and (p_filial is null or m.filial = p_filial)
    ),
    -- tempo entre a mensagem de ENTRADA imediatamente anterior e ESTA
    -- resposta (mesma lógica de sla_primeira_resposta_whatsapp, mas
    -- atribuída a quem respondeu) — 1 linha por MENSAGEM (não por
    -- atendente), pra não precisar de nenhum JOIN por uma chave não-única
    -- depois (bug real achado testando: um JOIN por atendente_nome
    -- multiplicava as linhas, uma "Henrique" com 1,3 MILHÃO de mensagens
    -- "enviadas" — produto cartesiano entre todas as mensagens do mesmo
    -- atendente).
    com_tempo as (
        select
            e.id, e.atendente_nome,
            extract(epoch from (
                e.criado_em - (
                    select max(i.criado_em) from mensagens_whatsapp i
                    where i."pessoaIdentificador" = e."pessoaIdentificador"
                      and i.direcao = 'entrada' and i.criado_em < e.criado_em
                )
            )) / 60 as minutos
        from enviadas e
    )
    select
        atendente_nome,
        count(*)::int as mensagens_enviadas,
        round(avg(minutos) filter (where minutos is not null and minutos >= 0)::numeric, 1) as media_minutos_resposta
    from com_tempo
    group by atendente_nome
    order by count(*) desc;
$$;
grant execute on function desempenho_atendentes_whatsapp(text, int) to anon, authenticated;

-- 3) Volume por período — contagem enviado/recebido/falhou por DIA,
--    dentro do intervalo pedido (mesmo padrão de agrupar por dia já usado
--    em "Matrículas por Mês", só que aqui é granularidade diária, não
--    mensal, já que WhatsApp tem volume de sobra pra isso fazer sentido).
create or replace function volume_whatsapp_por_periodo(p_filial text default null, p_dias int default 30)
returns table (
    dia date,
    enviadas int,
    recebidas int,
    falhas int
)
language sql
stable
as $$
    select
        date(m.criado_em) as dia,
        count(*) filter (where m.direcao = 'saida' and m.wa_status <> 'falhou')::int as enviadas,
        count(*) filter (where m.direcao = 'entrada')::int as recebidas,
        count(*) filter (where m.wa_status = 'falhou')::int as falhas
    from mensagens_whatsapp m
    where m.criado_em > now() - (p_dias || ' days')::interval
      and (p_filial is null or m.filial = p_filial)
    group by date(m.criado_em)
    order by dia;
$$;
grant execute on function volume_whatsapp_por_periodo(text, int) to anon, authenticated;

-- Bug real corrigido (2026-10-01, achado pelo usuário com exemplo real —
-- caso do Lúcio): classificar-resposta-convite e sugerir-resposta-whatsapp
-- rodavam no MESMO cron (*/15 * * * *), então processavam a MESMA
-- mensagem nova quase ao mesmo tempo. A dedup de sugerir-resposta-whatsapp
-- (pular mensagem que já tem classificação de convite) só funciona se a
-- linha de classificar-resposta-convite já estiver COMMITADA no banco na
-- hora da checagem — numa corrida de poucos segundos entre as duas
-- invocações, isso nem sempre é verdade, e as duas geravam (e uma delas
-- chegava a ENVIAR) uma sugestão própria pra mesma mensagem — uma pior
-- (genérica, "qual dia você pode?") competindo com a melhor (específica
-- do convite, com link/endereço reais).
--
-- Corrigido dando um atraso de 5 minutos pra sugerir-resposta-whatsapp —
-- classificar-resposta-convite sempre roda primeiro (:00/:15/:30/:45),
-- sugerir-resposta-whatsapp roda 5 min depois (:05/:20/:35/:50): tempo de
-- sobra pra classificação (que leva segundos) estar commitada antes da
-- checagem de dedup da outra function rodar.
select cron.schedule(
    'sugerir-resposta-whatsapp',
    '5,20,35,50 * * * *',
    $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/sugerir-resposta-whatsapp',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb
    );
    $$
);

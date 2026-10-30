-- Monitor da conta do WhatsApp na Meta (30/10/2026). Pedido do usuário depois
-- do banimento revertido: saber pelo CRM, e não pelo e-mail horas depois, quando
-- o número for banido, restrito ou cair de qualidade. A Edge Function
-- whatsapp-saude-conta grava 1 linha por número a cada 30 min; o sino
-- (js/notificacoes.js) e o Resumo Diário leem a mais recente. Guarda 30 dias.
create table if not exists whatsapp_saude_conta (
    id bigserial primary key,
    verificado_em timestamptz not null default now(),
    phone_number_id text not null,
    numero text,
    nome text,
    status text,
    quality_rating text,
    messaging_limit_tier text,
    name_status text,
    ok boolean not null,
    problema text,
    detalhe jsonb
);
create index if not exists idx_whatsapp_saude_conta_recente on whatsapp_saude_conta (phone_number_id, verificado_em desc);

-- Leitura pública (mesmo modelo do resto do app); escrita só pela Edge Function.
alter table whatsapp_saude_conta enable row level security;
drop policy if exists "leitura publica" on whatsapp_saude_conta;
create policy "leitura publica" on whatsapp_saude_conta for select using (true);

select cron.unschedule(jobid) from cron.job where jobname = 'whatsapp-saude-conta';
select cron.schedule(
    'whatsapp-saude-conta',
    '*/30 * * * *',
    $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/whatsapp-saude-conta',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea'),
        body := '{}'::jsonb
    );
    $$
);

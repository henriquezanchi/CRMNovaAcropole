-- Cobrança das escolas pela Cora (16/11/2026, pedido do usuário).
-- Boleto + Pix gerados pela API da Cora (Integração Direta, Edge Function cora-cobranca),
-- acompanhamento do pagamento (webhook + consulta diária) e lembrete 3 dias depois.

alter table filiais add column if not exists cnpj_cobranca text;   -- só dígitos (CPF ou CNPJ de quem paga)
alter table filiais add column if not exists email_cobranca text;  -- opcional (aviso por e-mail da própria Cora)

create table if not exists cobrancas_cora (
    id bigserial primary key,
    filial text not null,
    competencia text not null,                 -- '2026-11'
    tipo text not null default 'fixo',         -- 'fixo' | 'comissao'
    descricao text not null,
    valor_centavos integer not null check (valor_centavos >= 500),
    vencimento date not null,
    ambiente text not null default 'producao' check (ambiente in ('producao', 'stage')),
    idempotency_key uuid not null default gen_random_uuid(),
    cora_invoice_id text unique,
    status text not null default 'criando',    -- criando | OPEN | LATE | PAID | CANCELLED | erro
    erro text,
    linha_digitavel text,
    boleto_url text,
    pix_emv text,
    mensagem text,                             -- texto pronto para o diretor
    mensagem_lembrete text,
    enviada_em timestamptz,                    -- quando a mensagem foi enviada ao diretor
    pago_em timestamptz,
    valor_pago_centavos integer,
    lembrete_em timestamptz,
    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now(),
    criado_por text,
    unique (filial, competencia, tipo, ambiente)
);

alter table cobrancas_cora enable row level security;
drop policy if exists "cobrancas_cora leitura" on cobrancas_cora;
create policy "cobrancas_cora leitura" on cobrancas_cora for select using (true);
-- Escrita só pelas Edge Functions (service_role).

-- Consulta diária do status e lembrete (09:30 Brasília).
select cron.unschedule('cora-cobranca-diario') where exists (select 1 from cron.job where jobname = 'cora-cobranca-diario');
select cron.schedule('cora-cobranca-diario', '30 12 * * *', $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/cora-cobranca',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-funil-token',
            (select decrypted_secret from vault.decrypted_secrets where name = 'funil_analise_token' limit 1)),
        body := '{"acao":"rotina"}'::jsonb,
        timeout_milliseconds := 60000)
$$);

-- Resumo do trabalho de contatos de uma escola (ou grupo, ex.: Rio Verde + Jataí) num período,
-- para a mensagem de cobrança. Inscrições: qualquer evento do Ulisses depois do 1º contato.
create or replace function cobranca_relatorio_contatos(p_filiais text[], p_de date, p_ate date)
returns jsonb language sql stable security definer set search_path = public as $$
with saidas as (
    select m."pessoaIdentificador" p, min(m.criado_em) primeiro
    from mensagens_whatsapp m join leads_inscricoes l on l."pessoaIdentificador" = m."pessoaIdentificador"
    where m.direcao = 'saida' and coalesce(m.wa_status, '') <> 'falhou' and l.filial = any(p_filiais)
      and m.criado_em >= p_de and m.criado_em < p_ate + 1
    group by 1)
select jsonb_build_object(
    'contatados', (select count(*) from saidas),
    'responderam', (select count(*) from saidas s where exists (select 1 from mensagens_whatsapp m
        where m."pessoaIdentificador" = s.p and m.direcao = 'entrada' and m.criado_em > s.primeiro)),
    'inscritos', (select count(distinct s.p) from saidas s join evento_leads el on el."pessoaIdentificador" = s.p
        and el.origem = 'ulisses' and el.criado_em > s.primeiro))
$$;
revoke all on function cobranca_relatorio_contatos(text[], date, date) from public, anon, authenticated;
grant execute on function cobranca_relatorio_contatos(text[], date, date) to service_role;

-- CNPJs encontrados na Receita (BrasilAPI) e conferidos pelo endereço da escola (16/11/2026).
-- Barra do Garças: endereço da Receita diferente do atual (provável mudança de sede).
update filiais f set cnpj_cobranca = v.cnpj from (values
    ('Goiânia - Setor Universitário', '37623295000162'),
    ('Goiânia - Jardim América', '09000374000181'),
    ('Rio Verde', '24375575000157'),
    ('Goiânia II', '58210925000147'),
    ('Goiânia - Garavelo', '60772925000182'),
    ('Barra do Garças/MT', '42640546000157')
) v(nome, cnpj) where f.nome = v.nome and f.cnpj_cobranca is null;

-- Informados pelo usuário (Eldorado, Catalão) e lidos do Mercúrio (unidades.uni_cnpj): Cidade Jardim
-- ("Org. Nova Acrópole Goiânia Noroeste") e Alto da Glória. Setor Oeste: o Mercúrio traz o CNPJ do
-- Setor Universitário — aguarda confirmação.
update filiais f set cnpj_cobranca = v.cnpj from (values
    ('Goiânia - Eldorado', '52041808000110'),
    ('Catalão', '58188448000160'),
    ('Goiânia - Cidade Jardim', '37954921000101'),
    ('Goiânia - Alto da Glória', '58212384000196')
) v(nome, cnpj) where f.nome = v.nome and f.cnpj_cobranca is null;

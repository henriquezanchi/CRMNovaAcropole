-- ============================================================
-- Migração: integração real com WhatsApp (Meta Cloud API)
-- Rodar manualmente no SQL Editor do Supabase (mesmo fluxo das
-- migrações anteriores: migracao_filiais.sql, migracao_historico_eventos.sql).
-- ============================================================

-- PRÉ-CHECK — rode isto primeiro e confirme que o tipo bate com o
-- que a coluna "pessoaIdentificador" abaixo está usando (text).
-- Se vier diferente de "text"/"character varying", ajuste o tipo de
-- mensagens_whatsapp."pessoaIdentificador" antes de continuar.
--
-- select data_type from information_schema.columns
-- where table_name = 'leads_inscricoes' and column_name = 'pessoaIdentificador';

-- ------------------------------------------------------------
-- 1) Tabela de mensagens
-- ------------------------------------------------------------
create table if not exists mensagens_whatsapp (
    id                    bigserial primary key,
    "pessoaIdentificador" text,               -- nullable de propósito: mensagem sem lead identificado não pode se perder
    telefone_whatsapp     text not null,       -- dígitos crus do "from"/"to" da Meta, sempre preenchido
    filial                text,
    direcao               text not null check (direcao in ('entrada', 'saida')),
    tipo                  text not null default 'texto'
                              check (tipo in ('texto','template','imagem','audio','documento','video','sticker','localizacao','botao','outro')),
    corpo_texto           text,
    wa_message_id         text,
    wa_status             text not null default 'enviando'
                              check (wa_status in ('enviando','enviado','entregue','lido','falhou')),
    wa_status_erro        jsonb,
    phone_number_id_meta  text,
    payload_bruto         jsonb,
    criado_em             timestamptz not null default now(),
    atualizado_em         timestamptz not null default now()
);

-- Sem WHERE de propósito: um índice único "cheio" já permite múltiplas
-- linhas com wa_message_id = null (Postgres nunca considera NULL = NULL
-- pra fins de unicidade) e, diferente de um índice parcial, funciona como
-- alvo de ON CONFLICT (wa_message_id) no upsert do whatsapp-webhook sem
-- precisar repetir o predicado — um índice único parcial exigiria isso e
-- faria o upsert falhar em runtime.
create unique index if not exists uq_mensagens_wa_message_id
    on mensagens_whatsapp (wa_message_id);

create index if not exists idx_mensagens_pessoa_criado
    on mensagens_whatsapp ("pessoaIdentificador", criado_em);

create index if not exists idx_mensagens_telefone
    on mensagens_whatsapp (telefone_whatsapp);

-- Necessário para o Supabase Realtime enxergar a tabela (fácil de esquecer):
alter publication supabase_realtime add table mensagens_whatsapp;

-- ------------------------------------------------------------
-- 2) View auxiliar: lista de conversas (1 linha por lead, mais recente primeiro)
-- ------------------------------------------------------------
create or replace view vw_wpp_conversas as
select
    "pessoaIdentificador",
    max(criado_em) as ultima_mensagem_em,
    (array_agg(corpo_texto order by criado_em desc))[1] as ultimo_texto,
    (array_agg(direcao    order by criado_em desc))[1] as ultima_direcao,
    (array_agg(wa_status   order by criado_em desc))[1] as ultimo_status,
    (array_agg(filial      order by criado_em desc))[1] as filial
from mensagens_whatsapp
where "pessoaIdentificador" is not null
group by "pessoaIdentificador";

-- Usado pelo whatsapp-webhook pra casar mensagem recebida -> lead (busca
-- por DDD e depois filtra os candidatos de número em código) — sem índice
-- aqui, isso vira um scan completo de leads_inscricoes a cada mensagem
-- recebida.
create index if not exists idx_leads_telefone_ddd
    on leads_inscricoes ("pessoaTelefoneDDD");

-- ------------------------------------------------------------
-- 3) Número da Meta por filial (nulo = usa o secret padrão
--    WHATSAPP_PHONE_NUMBER_ID_DEFAULT na Edge Function)
-- ------------------------------------------------------------
alter table filiais add column if not exists whatsapp_phone_number_id text;

-- ------------------------------------------------------------
-- 4) RLS — mesmo modelo de acesso já usado pelo resto do app
--    (chave publishable/anon lê e escreve direto, sem login).
--    Ajuste aqui se o projeto tiver políticas mais restritivas
--    nas tabelas existentes que este arquivo não está enxergando.
-- ------------------------------------------------------------
alter table mensagens_whatsapp enable row level security;

drop policy if exists "leitura publica mensagens_whatsapp" on mensagens_whatsapp;
create policy "leitura publica mensagens_whatsapp"
    on mensagens_whatsapp for select
    using (true);

-- Não existe policy de INSERT para o público de propósito: só as Edge
-- Functions inserem mensagens (envio/recebimento), usando a service role
-- key (que ignora RLS).
--
-- Exceção de UPDATE: o frontend precisa conseguir vincular manualmente uma
-- conversa "não identificada" (mensagem recebida de um número que não bateu
-- com nenhum lead) a um lead, direto do navegador — mesmo padrão de escrita
-- direta já usado em outras partes do CRM (ex: tags). A policy só permite
-- mexer em linhas que AINDA estão sem pessoaIdentificador, então não dá pra
-- reatribuir uma mensagem já vinculada.
drop policy if exists "vincular conversas nao identificadas" on mensagens_whatsapp;
create policy "vincular conversas nao identificadas"
    on mensagens_whatsapp for update
    using ("pessoaIdentificador" is null)
    with check (true);

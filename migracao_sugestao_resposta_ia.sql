-- Sugestão de resposta por IA pra QUALQUER lead que respondeu no
-- WhatsApp (pedido do usuário, 2026-09-29) — diferente de
-- classificacoes_resposta_convite (escopada só a quem tem convite de
-- evento pendente), esta cobre qualquer resposta, com toggle de
-- habilitar/desabilitar por FILIAL (padrão) e por CONVERSA (override).
--
-- Rodar manualmente: npx supabase db query --linked --file migracao_sugestao_resposta_ia.sql

-- Padrão por filial — true = já nasce ligado (é o comportamento pedido).
alter table filiais
  add column if not exists ia_sugestao_resposta_habilitada boolean not null default true;

-- Override por conversa/lead — null = segue o padrão da filial; true/false
-- = decisão explícita pra ESTE lead, independente do resto da filial.
alter table leads_inscricoes
  add column if not exists ia_sugestao_resposta boolean;

create table if not exists sugestoes_resposta_wpp (
  id bigint generated always as identity primary key,
  "pessoaIdentificador" text not null,
  mensagem_origem_id bigint not null references mensagens_whatsapp(id) unique,
  sugestao_resposta text,
  status text not null default 'pendente' check (status in ('pendente','enviada','descartada')),
  criado_em timestamptz not null default now()
);

create index if not exists idx_sugestoes_resposta_wpp_pessoa on sugestoes_resposta_wpp ("pessoaIdentificador");
create index if not exists idx_sugestoes_resposta_wpp_status on sugestoes_resposta_wpp (status);

alter table sugestoes_resposta_wpp enable row level security;
drop policy if exists "sugestoes_resposta_wpp_select" on sugestoes_resposta_wpp;
create policy "sugestoes_resposta_wpp_select" on sugestoes_resposta_wpp for select using (true);
drop policy if exists "sugestoes_resposta_wpp_insert" on sugestoes_resposta_wpp;
create policy "sugestoes_resposta_wpp_insert" on sugestoes_resposta_wpp for insert with check (true);
drop policy if exists "sugestoes_resposta_wpp_update" on sugestoes_resposta_wpp;
create policy "sugestoes_resposta_wpp_update" on sugestoes_resposta_wpp for update using (true) with check (true);

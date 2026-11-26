-- WhatsApp oficial de cada escola no CRM, em coexistência com o app WhatsApp Business (26/11/2026, pedido do usuário).
-- A escola conecta o número pelo cadastro incorporado da Meta (Embedded Signup v5) a partir de Gerenciar Filiais.
-- O token da escola fica cifrado (AES-GCM, chave só na Edge Function whatsapp-conexao) e esta tabela não tem
-- nenhuma policy: só o service_role lê. A tela usa a view whatsapp_conexoes_status, sem o token.
--
-- usar_no_crm começa desligado: com a conexão feita, as conversas do número da escola já entram no CRM
-- (recebidas, enviadas pelo celular e histórico), mas nada sai por esse número até alguém ligar o uso no CRM.

create table if not exists whatsapp_conexoes (
  filial text primary key,
  waba_id text not null,
  phone_number_id text not null unique,
  business_id text,
  numero_exibicao text,
  nome_verificado text,
  coexistencia boolean not null default true,
  token_cifrado text,
  estado text not null default 'conectado' check (estado in ('conectado', 'desconectado', 'erro')),
  usar_no_crm boolean not null default false,
  contatos_sincronizacao_em timestamptz,
  historico_sincronizacao_em timestamptz,
  historico_progresso integer,
  ultimo_erro text,
  conectado_em timestamptz not null default now(),
  conectado_por text,
  desconectado_em timestamptz,
  atualizado_em timestamptz not null default now()
);

alter table whatsapp_conexoes enable row level security;

create or replace view whatsapp_conexoes_status as
select filial, waba_id, phone_number_id, numero_exibicao, nome_verificado, coexistencia, estado, usar_no_crm,
       contatos_sincronizacao_em, historico_sincronizacao_em, historico_progresso, ultimo_erro,
       conectado_em, conectado_por, desconectado_em, atualizado_em
  from whatsapp_conexoes;

grant select on whatsapp_conexoes_status to anon, authenticated;

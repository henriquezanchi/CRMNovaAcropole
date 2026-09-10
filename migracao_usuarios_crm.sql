-- Contas de usuário (voluntários) com permissão por módulo — substitui o
-- portão de senha única (js/acesso.js) por um login NOMINAL: cada pessoa
-- entra com nome + senha próprios, só vê os módulos (abas da sidebar)
-- liberados pra ela, e esse nome passa a aparecer nas mensagens de
-- WhatsApp enviadas por ela (ver htmlMensagemWpp() em js/whatsapp.js).
--
-- MESMO MODELO DE SEGURANÇA já documentado pra js/acesso.js: isto NÃO é
-- proteção contra um atacante técnico determinado (a chave publishable do
-- Supabase já dá acesso total a quem tiver o código-fonte, com ou sem
-- login) — é só "manter gente honesta honesta" e dar identidade a cada
-- atendente. A senha nunca fica em texto puro, só o hash SHA-256
-- (senha_hash) — calculado no navegador, mesmo princípio de
-- SENHA_ACESSO_HASH.
create table if not exists usuarios_crm (
    id uuid primary key default gen_random_uuid(),
    nome text not null unique,
    senha_hash text not null,
    -- Lista de tab-id's liberados pra esse usuário (ex: ["tab-crm","tab-whatsapp"]).
    -- Vazio = nenhum módulo (login funciona, mas não vê nada — evitar).
    modulos jsonb not null default '[]'::jsonb,
    -- Admin vê e gerencia a tela de Usuários; usuário comum não.
    eh_admin boolean not null default false,
    -- Desativar em vez de apagar — preserva o autor no log_atividade/histórico.
    ativo boolean not null default true,
    criado_em timestamptz not null default now()
);

alter table usuarios_crm enable row level security;

drop policy if exists "usuarios_crm select" on usuarios_crm;
create policy "usuarios_crm select" on usuarios_crm for select using (true);
drop policy if exists "usuarios_crm insert" on usuarios_crm;
create policy "usuarios_crm insert" on usuarios_crm for insert with check (true);
drop policy if exists "usuarios_crm update" on usuarios_crm;
create policy "usuarios_crm update" on usuarios_crm for update using (true) with check (true);
drop policy if exists "usuarios_crm delete" on usuarios_crm;
create policy "usuarios_crm delete" on usuarios_crm for delete using (true);

-- Usuário admin inicial pra não ficar sem acesso depois de trocar o
-- portão antigo pelo login nominal — nome "Henrique", senha temporária
-- "trocar123" (hash abaixo). TROQUE ESSA SENHA na tela "Gerenciar
-- Usuários" assim que entrar pela primeira vez.
insert into usuarios_crm (nome, senha_hash, modulos, eh_admin, ativo)
values (
    'Henrique',
    'b0857a7c7d3178e44ca0d8836786ae18ee806f7625e589b98c5bad307813eaf6',
    '["tab-dashboard","tab-crm","tab-agenda","tab-mapa-turmas","tab-whatsapp","tab-relatorios","tab-leads-tratar","tab-importar"]'::jsonb,
    true,
    true
)
on conflict (nome) do nothing;

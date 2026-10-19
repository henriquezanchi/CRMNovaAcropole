-- Evidência de consulta: dados mínimos e acesso restrito ao serviço.
create table if not exists auditoria_contatos_fontes (
 pessoa text primary key, consultado_em timestamptz not null default now(), cadastro_antes jsonb not null, fontes jsonb not null
);
alter table auditoria_contatos_fontes enable row level security;
revoke all on auditoria_contatos_fontes from anon,authenticated;

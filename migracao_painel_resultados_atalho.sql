-- Atalho para o painel de resultados dentro do CRM (05/11/2026, pedido do usuário).
-- O link completo (com a chave) fica aqui para o botão "Painel de Resultados" da aba
-- Relatórios. Decisão do usuário: quem entra no CRM já vê dados mais sensíveis que o
-- painel; os links por escola continuam só com quem os recebeu.
create table if not exists painel_resultados_atalhos (
    id bigserial primary key,
    rotulo text not null,
    url text not null,
    ordem int not null default 0,
    criado_em timestamptz not null default now()
);
alter table painel_resultados_atalhos enable row level security;
drop policy if exists painel_resultados_atalhos_leitura on painel_resultados_atalhos;
create policy painel_resultados_atalhos_leitura on painel_resultados_atalhos for select using (true);

-- O link da coordenação (com a chave) foi inserido direto no banco em 05/11/2026 e não
-- fica neste arquivo, que é público no repositório. Para trocar:
--   insert into painel_resultados_atalhos (rotulo, url, ordem)
--   values ('Coordenação regional', 'https://crm-nova-acropole.vercel.app/resultados.html#<chave>', 0);

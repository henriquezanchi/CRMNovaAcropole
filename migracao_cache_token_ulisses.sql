-- Cache do token M2M do Auth0 (API do Ulisses), 19/11/2026. O Auth0 avisou 80% da cota mensal de tokens M2M do
-- tenant acropolebrasil: o robô dos inscritos roda a cada 10 min numa máquina nova (GitHub Actions) e pedia um token
-- novo a cada rodada, embora o token valha 24 h. Uma linha só; RLS ligado e sem políticas (só a service role lê).
create table if not exists public.ulisses_token_cache (
    id smallint primary key default 1 check (id = 1),
    token text not null,
    expira_em timestamptz not null,
    atualizado_em timestamptz not null default now()
);
alter table public.ulisses_token_cache enable row level security;

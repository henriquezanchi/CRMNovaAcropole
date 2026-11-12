-- Lista de inscritos de cada evento como vem do Ulisses (12/11/2026, pedido do usuário: o painel
-- do DMF mostrava 118 inscritos e o Ulisses tinha 171). Antes o painel só contava inscrições que o
-- CRM conseguia ligar a um cadastro DA ESCOLA DO EVENTO; quem já tinha cadastro em outra escola
-- (ou nenhum) ficava de fora. Agora a sincronização (scraper/importar-ulisses-api.js) grava aqui
-- toda inscrição recebida, e o painel conta por esta lista. "pessoaIdentificador" é o cadastro do
-- CRM ligado com segurança (mesmo código do Ulisses em qualquer escola, ou telefone/e-mail na
-- escola com o mesmo primeiro nome); fica vazio quando não há.
create table if not exists ulisses_inscricoes_evento (
    email_evento_id bigint primary key,
    evento_id_ulisses bigint not null,
    filial_id_ulisses int,
    pessoa_id_ulisses text,
    nome text,
    email text,
    ddd text,
    telefone text,
    compareceu boolean,
    inscrito_em timestamptz,
    visto_primeiro_em timestamptz not null default now(),
    visto_em timestamptz not null default now(),
    removido_em timestamptz,
    "pessoaIdentificador" text,
    bruto jsonb
);
create index if not exists ulisses_inscricoes_evento_ev_idx on ulisses_inscricoes_evento (evento_id_ulisses);
alter table ulisses_inscricoes_evento enable row level security; -- sem policy: só service_role

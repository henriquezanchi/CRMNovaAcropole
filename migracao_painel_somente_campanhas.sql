-- Link do painel só com campanha(s), sem a aba Escolas (12/11/2026, pedido do usuário:
-- painel do DMF Goiânia para compartilhar com outras pessoas, com PIN para liberar nomes e
-- telefones). O link e o PIN em si são criados direto no banco e nunca ficam no repositório.
alter table painel_resultados_links add column if not exists somente_campanhas boolean not null default false;

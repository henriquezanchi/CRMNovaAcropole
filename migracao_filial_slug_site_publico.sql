-- Coluna slug_site_publico em filiais — nome do "slug" da página pública
-- da filial em acropole.org.br (ex: "garavelo" em
-- https://acropole.org.br/garavelo/), usado só como CHECKPOINT
-- independente: o scraper do Ulisses compara os eventos futuros que
-- gravou em `eventos` contra o que a própria página pública da filial
-- anuncia, pra pegar cedo um caso de sessão logada na filial errada (ver
-- CLAUDE.md, seção "Ulisses", bug real 2026-09-10 — "Bushido"/"Workshop
-- de Oratória", exclusivos do Garavelo, foram cadastrados também sob
-- "Goiânia - Setor Oeste"). Nullable — filial sem slug configurado
-- simplesmente não passa por essa auditoria (nunca inventamos a URL).
alter table filiais add column if not exists slug_site_publico text;

-- Preenchido manualmente (não são adivinhados) a partir do que o usuário
-- informou diretamente nesta sessão (2026-09-10):
update filiais set slug_site_publico = 'goiania-jardimamerica' where nome = 'Goiânia - Jardim América';
update filiais set slug_site_publico = 'goiania-setoroeste' where nome = 'Goiânia - Setor Oeste';
update filiais set slug_site_publico = 'garavelo' where nome = 'Goiânia - Garavelo';
update filiais set slug_site_publico = 'barradogarcas' where nome = 'Barra do Garças/MT';

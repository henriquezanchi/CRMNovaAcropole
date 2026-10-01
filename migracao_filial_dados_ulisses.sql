-- Migração: dados complementares da filial, capturados da API oficial
-- do Ulisses (GET /facade/filial/{id}) — pedido do usuário (2026-10-01):
-- "podemos pegar o link do maps no ulisses (entre vários outros dados
-- que não mudam frequentemente)". Achado real: esse endpoint já devolve
-- `linkMapa` — um link de PIN exato (lat/lng reais), bem mais preciso
-- que o nosso `maps/search/?query=<endereço em texto>` gerado na hora —
-- além de `lat`/`lng` soltos, `facebook`, `instagram`.
--
-- Preenchido 1x/dia de carona em sincronizarEventosUlissesApi()
-- (scraper/importar-ulisses-api.js) — já itera nossas filiais mapeadas
-- pro Ulisses todo dia mesmo assim, então isso não é chamada de API
-- extra nenhuma de peso (são dados "que não mudam frequentemente", só
-- fica sempre em dia sem custo). Nunca sobrescreve com null — ver
-- padrão de preservação já usado em sincronizarEventosUlissesApi() pra
-- outros campos.
alter table filiais add column if not exists link_maps_ulisses text;
alter table filiais add column if not exists lat numeric;
alter table filiais add column if not exists lng numeric;
alter table filiais add column if not exists facebook text;
alter table filiais add column if not exists instagram text;

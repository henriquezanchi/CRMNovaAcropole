-- Guarda o ID INTERNO do evento no sistema do Ulisses em cada linha de
-- `eventos` — pedido do usuário (2026-09-30), depois de uma resposta real
-- do Célio ("Provavelmente algo como filtrarEmails") apontar pra um
-- endpoint alternativo (`POST /facade/filtrarEmails`) que resolve o bug
-- de NullPointerException do `/facade/emails/{eventoId}` (ver CLAUDE.md,
-- "Comparecimento via API do Ulisses — RESOLVIDO"). Sem esse id salvo,
-- cada sincronização de comparecimento precisaria redescobrir o eventoId
-- escaneando `listarTodosEventos()` de novo — com ele, é 1 lookup direto.
--
-- Preenchido por `sincronizarEventosUlissesApi()` (scraper/importar-ulisses-api.js)
-- ao criar/atualizar a linha base do evento — nunca sobrescrito com null
-- (mesmo princípio de preservação de todo o resto do scraper).
--
-- Rodar manualmente: npx supabase db query --linked --file migracao_evento_id_ulisses.sql
alter table eventos add column if not exists evento_id_ulisses bigint;
create index if not exists idx_eventos_evento_id_ulisses on eventos (evento_id_ulisses) where evento_id_ulisses is not null;

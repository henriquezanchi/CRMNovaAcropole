// Cliente da API OFICIAL do Ulisses (https://api.acropolebrasil.com.br/),
// autenticação OAuth2 Client Credentials via Auth0 — caminho alternativo
// ao scraper por navegador (ulisses.js/ulisses-local.js), que depende de
// login manual por causa do Cloudflare. Ver CLAUDE.md, seção "API
// oficial do Ulisses" pro histórico completo (conversa com o Célio,
// endpoints mapeados no Swagger, status de autorização).
//
// ESTADO ATUAL (2026-09-18): a credencial (client_id/client_secret) já
// está salva no cofre (sistema='ulisses_api', filial='GLOBAL' —
// migracao_credenciais_scraper_ulisses_api.sql), e o token é emitido
// normalmente, mas o client AINDA NÃO tem nenhum scope/permission
// autorizado do lado da Acrópole Brasil — só os endpoints públicos
// funcionam (tiposEvento/proximosEventos/evento/eventos). Os que
// precisamos de verdade (csvInscricoes/participantes/compareceu/
// filiaisAtivas/filial/listarTodosEventos) devolvem 401 até o Célio
// autorizar. Este módulo já fica pronto pra quando isso acontecer — não
// está encadeado em nenhum job (main() de ulisses.js/mercurio.js) ainda,
// de propósito, pra não gerar erro constante enquanto fica bloqueado. Use
// `npm run testar-ulisses-api` (scraper/testar-ulisses-api.js) pra
// conferir o status a qualquer momento, sem precisar mexer em código.
import { lerCredencial } from './lib/supabaseAdmin.js';

const AUTH0_TOKEN_URL = 'https://acropolebrasil.us.auth0.com/oauth/token';
const API_AUDIENCE = 'https://api.acropolebrasil.com.br/';
const API_BASE_URL = 'https://api.acropolebrasil.com.br';

// Cache em memória do token — client_credentials do Auth0 aqui vem com
// expires_in de 24h (86400s); não faz sentido pedir um novo a cada
// chamada. Renova sozinho quando faltar menos de 1 minuto pra expirar.
let tokenCache = null; // { accessToken, expiraEm }

async function obterTokenUlissesApi() {
    if (tokenCache && tokenCache.expiraEm - Date.now() > 60_000) {
        return tokenCache.accessToken;
    }
    const { usuario: clientId, senha: clientSecret } = await lerCredencial('ulisses_api', null);
    const resp = await fetch(AUTH0_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            audience: API_AUDIENCE,
            grant_type: 'client_credentials',
        }),
    });
    const dados = await resp.json();
    if (!resp.ok || !dados.access_token) {
        throw new Error(`Falha ao obter token OAuth2 do Ulisses: ${dados.error || resp.status} — ${dados.error_description || 'sem detalhe'}`);
    }
    tokenCache = { accessToken: dados.access_token, expiraEm: Date.now() + dados.expires_in * 1000 };
    return tokenCache.accessToken;
}

// Chamada genérica autenticada. `esperado` é só pra mensagem de erro mais
// clara — não muda o comportamento. Lança erro com o status HTTP sempre
// que a resposta não for 2xx (inclusive 401 — o chamador decide o que
// fazer, ex: testar-ulisses-api.js trata 401 como "esperado, ainda
// bloqueado" em vez de falha).
async function chamarApi(path, { method = 'GET', esperado, texto = false } = {}) {
    const token = await obterTokenUlissesApi();
    const resp = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
        const corpo = await resp.text().catch(() => '');
        const erro = new Error(`${method} ${path} -> ${resp.status}${esperado ? ` (esperado: ${esperado})` : ''}${corpo ? ` — ${corpo.slice(0, 300)}` : ''}`);
        erro.status = resp.status;
        throw erro;
    }
    return texto ? resp.text() : resp.json();
}

// ---- Endpoints PÚBLICOS (já funcionam com o client atual, sem scope) ----
export const tiposEvento = () => chamarApi('/tiposEvento');
export const proximosEventos = () => chamarApi('/proximosEventos');
export const evento = (eventoId) => chamarApi(`/evento/${eventoId}`);
export const eventosPorFilial = (filialId) => chamarApi(`/eventos/${filialId}`);

// ---- Endpoints PROTEGIDOS (401 até o Célio autorizar o scope) ----
export const filiaisAtivas = () => chamarApi('/facade/filiaisAtivas', { esperado: 'precisa de scope autorizado pela Acrópole Brasil' });
export const filial = (filialId) => chamarApi(`/facade/filial/${filialId}`, { esperado: 'precisa de scope autorizado pela Acrópole Brasil' });
export const listarTodosEventos = (filialId) => chamarApi(`/facade/listarTodosEventos/${filialId}`, { esperado: 'precisa de scope autorizado pela Acrópole Brasil' });
export const participantesEvento = (eventoId) => chamarApi(`/facade/participantes/${eventoId}`, { esperado: 'precisa de scope autorizado pela Acrópole Brasil' });
export const csvInscricoes = (filialId) => chamarApi(`/facade/csvInscricoes/${filialId}`, { esperado: 'precisa de scope autorizado pela Acrópole Brasil', texto: true });
export const marcarCompareceu = (emailEventoId, compareceu) =>
    chamarApi(`/facade/compareceu/${emailEventoId}/${compareceu ? 'true' : 'false'}`, { method: 'POST', esperado: 'precisa de scope autorizado pela Acrópole Brasil' });

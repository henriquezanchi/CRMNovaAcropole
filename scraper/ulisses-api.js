// Cliente da API OFICIAL do Ulisses (https://api.acropolebrasil.com.br/),
// autenticação OAuth2 Client Credentials via Auth0 — caminho alternativo
// ao scraper por navegador (ulisses.js/ulisses-local.js), que depende de
// login manual por causa do Cloudflare. Ver CLAUDE.md, seção "API
// oficial do Ulisses" pro histórico completo (conversa com o Célio,
// endpoints mapeados no Swagger, status de autorização).
//
// ESTADO ATUAL (2026-09-21): LIBERADO pela Acrópole Brasil (Célio),
// TODAS as filiais — inclusive `filialId=132` (Goiânia - Setor Oeste),
// que devolvia 403 ("Este usuário não tem permissão de acesso à esta
// filial") até o Célio ajustar essa autorização especificamente pra ela
// (confirmado testando ao vivo, 2 tentativas com 403 seguidas de uma
// terceira já OK, minutos depois). Ainda assim, todo código que itera
// filiais deve continuar isolando falha por filial (mesmo princípio já
// usado em `mercurio.js`/`ulisses.js`) — não custa nada e protege contra
// uma futura filial nova com o mesmo tipo de esquecimento de permissão.
// **Rodando de dentro do GitHub Actions, NADA disto funciona** — ver
// CLAUDE.md, seção "CORREÇÃO GRAVE... a API do Ulisses TAMBÉM é
// bloqueada": api.acropolebrasil.com.br está atrás do MESMO Cloudflare
// que bloqueia login por navegador, e o bloqueio pega até uma chamada
// HTTPS pura com token válido vinda de IP de datacenter. Só funciona da
// máquina de confiança — `scraper/ulisses-local.js` (de carona) ou
// `scraper/sincronizar-ulisses-api-local.mjs` (dedicado, headless). Ver
// `scraper/importar-ulisses-api.js` pra sincronização de verdade
// (Inscrições/Eventos/Comparecimento) e CLAUDE.md, seção "API oficial do
// Ulisses", pro histórico completo.
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
async function chamarApi(path, { method = 'GET', esperado, texto = false, corpo } = {}) {
    const token = await obterTokenUlissesApi();
    const resp = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(corpo ? { 'content-type': 'application/json' } : {}),
        },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
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
// `emailsDoEvento` (não `participantesEvento`, que só devolve
// pessoaId/pessoaNome — EmailDTO, confirmado no Swagger) é quem de fato
// serve pra sincronizar comparecimento/telefone/e-mail: cada `Email`
// devolvido traz `ddd`/`telefone`/`email`/`nome` e um array
// `emailEventos[]` — cada item tem `evento.id`/`compareceu`/`data`, dá
// pra achar a entrada certa filtrando por `evento.id === eventoId`.
export const emailsDoEvento = (eventoId) => chamarApi(`/facade/emails/${eventoId}`, { esperado: 'precisa de scope autorizado pela Acrópole Brasil' });
// RESOLVIDO (2026-09-30) — o Célio sugeriu "algo como filtrarEmails" como
// alternativa ao `emailsDoEvento()` acima (que quebra com
// NullPointerException pra token M2M, ver comentário dela). Achado no
// Swagger: `POST /facade/filtrarEmails`, corpo `FiltroDTO`. Testado ao
// vivo contra produção (eventoId=24343, filialId=132): funciona
// perfeitamente via M2M e devolve exatamente os mesmos dados
// (nome/telefone/e-mail + `emailEventos[].compareceu`/`.id`) que
// `emailsDoEvento()` deveria ter devolvido.
// `filialId` é OBRIGATÓRIO — sem ele, 403 "Este usuário não tem
// permissão de acesso à esta filial" (mesmo erro de permissão já visto
// em outros endpoints, não um bug novo).
// Histórico de idas e vindas nesse campo específico (`ligacoes`), API
// claramente inconsistente/frágil do lado deles:
// - Original: `['TODOS']` — funcionava.
// - 2026-09-30: Célio reportou `FiltroDTO.getLigacoes() is null` com
//   `['TODOS']` em ALGUNS casos, pediu pra mandar `[]`.
// - 2026-10-01: `[]` passou a dar 400 "Selecione pelo menos um filtro
//   para cada tipo" — e `['TODOS']` voltou a funcionar (200, dados reais)
//   nos mesmos testes. O lado deles mudou de novo, sem aviso.
// Em vez de ficar alternando o valor fixo toda vez que isso quebrar de
// novo, agora tenta `['TODOS']` primeiro (o caso mais comum/testado) e,
// SÓ se a resposta falhar especificamente por causa de `ligacoes`
// (400 "para cada tipo" ou 500/NullPointerException), cai pra `[]` — o
// outro valor já visto funcionando em algum momento. Cobre os 2
// comportamentos já observados em produção sem exigir código novo da
// próxima vez que a API mudar de novo.
export async function filtrarEmails(eventoId, filialId) {
    const base = { eventoId, filialId, alunos: ['TODOS'], comparecimentos: ['TODOS'], ordenacao: '', pesquisa: '' };
    try {
        return await chamarApi('/facade/filtrarEmails', { method: 'POST', esperado: 'precisa de scope autorizado pela Acrópole Brasil', corpo: { ...base, ligacoes: ['TODOS'] } });
    } catch (e) {
        const msg = String(e.message || '');
        if (!/ligaç|NullPointerException|getLigacoes/i.test(msg)) throw e;
        return await chamarApi('/facade/filtrarEmails', { method: 'POST', esperado: 'precisa de scope autorizado pela Acrópole Brasil', corpo: { ...base, ligacoes: [] } });
    }
}
export const emailPorId = (id) => chamarApi(`/facade/email/${id}`, { esperado: 'precisa de scope autorizado pela Acrópole Brasil' });
export const csvInscricoes = (filialId) => chamarApi(`/facade/csvInscricoes/${filialId}`, { esperado: 'precisa de scope autorizado pela Acrópole Brasil', texto: true });
export const marcarCompareceu = (emailEventoId, compareceu) =>
    chamarApi(`/facade/compareceu/${emailEventoId}/${compareceu ? 'true' : 'false'}`, { method: 'POST', esperado: 'precisa de scope autorizado pela Acrópole Brasil' });

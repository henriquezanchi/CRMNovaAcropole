// Cliente da API externa do Mercury (v2 do Mercúrio) — REST, JSON,
// paginação por cursor. Diferente do scraper antigo (Playwright, login
// por formulário/HTTP Basic), aqui é só Bearer token — dá pra chamar
// direto de uma Edge Function, sem navegador nenhum envolvido.
//
// Secret esperado: MERCURY_API_KEY (setado via `supabase secrets set`,
// nunca no código). Endereço base fixo — só o do Railway (produção),
// nunca localhost:3000 (banco de testes do lado deles).
const MERCURY_BASE_URL = "https://sincere-passion-production-416b.up.railway.app/external/v1";

export class MercuryApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

// Limite documentado: 120 pedidos/minuto por chave (429 "External API
// rate limit exceeded" se passar). BUG REAL achado testando: rodar 4
// filiais em sequência SEM pausa nenhuma estourou o limite no meio do
// caminho (confirmado contra produção). Um intervalo mínimo FIXO entre
// chamadas (módulo inteiro, não por filial) resolve o caso comum, mas o
// limite é uma janela deslizante do SERVIDOR — outras chamadas recentes
// (de uma rodada de teste anterior, ou outra invocação concorrente da
// mesma function) contam pra mesma janela e um intervalo fixo sozinho
// não garante nunca estourar. Por isso, além do espaçamento, todo 429
// tenta de novo com backoff (1º retry 5s, 2º 15s) antes de desistir —
// mesma filosofia de "nunca confiar só em evitar o erro, também
// recuperar dele" já usada em outras integrações do projeto.
const INTERVALO_MINIMO_MS = 900; // ~66 chamadas/min, folga generosa sobre o limite de 120
const ESPERAS_RETRY_429_MS = [5000, 15000];
let ultimaChamadaEm = 0;
async function respeitarLimiteDeTaxa() {
    const agora = Date.now();
    const espera = ultimaChamadaEm + INTERVALO_MINIMO_MS - agora;
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimaChamadaEm = Date.now();
}

export async function chamarMercury<T = any>(path: string): Promise<T> {
    const chave = Deno.env.get("MERCURY_API_KEY");
    if (!chave) throw new MercuryApiError(500, "MERCURY_API_KEY não configurado");

    for (let tentativa = 0; ; tentativa++) {
        await respeitarLimiteDeTaxa();
        const res = await fetch(`${MERCURY_BASE_URL}${path}`, {
            headers: { Authorization: `Bearer ${chave}`, Accept: "application/json" },
        });
        const text = await res.text();
        let json: any;
        try { json = JSON.parse(text); } catch { json = text; }

        if (res.status === 429 && tentativa < ESPERAS_RETRY_429_MS.length) {
            await new Promise((r) => setTimeout(r, ESPERAS_RETRY_429_MS[tentativa]));
            continue;
        }
        if (!res.ok) {
            const msg = (json && json.message) || (typeof json === "string" ? json : JSON.stringify(json));
            throw new MercuryApiError(res.status, `Mercury ${res.status}: ${msg}`);
        }
        return json as T;
    }
}

// Pagina um endpoint de LISTA (que devolve {data:[...], page:{nextCursor}})
// até acabar o cursor — mesmo padrão de paginação já usado em todo o
// resto do projeto (1000/100 em 100), só que aqui o servidor já controla
// o cursor (não dá, nem precisa, pra montar "à mão" — o guia da API é
// explícito sobre isso).
export async function* paginarMercury<T = any>(pathBase: string, params: Record<string, string> = {}): AsyncGenerator<T> {
    let cursor: string | null = null;
    for (;;) {
        const qs = new URLSearchParams({ limit: "100", ...params });
        if (cursor) qs.set("cursor", cursor);
        const resp = await chamarMercury<{ data: T[]; page: { nextCursor: string | null } }>(`${pathBase}?${qs}`);
        for (const item of resp.data || []) yield item;
        cursor = resp.page ? resp.page.nextCursor : null;
        if (!cursor) break;
    }
}

// Mapeamento branchId (Mercury) -> nome da filial no CRM — confirmado
// contra produção nesta sessão varrendo /classes (achou todas as 5 sem
// ambiguidade). Mesmo espírito de MAPEAMENTO_FILIAL_ID_CONHECIDO já
// usado pra API do Ulisses (poucas filiais, muda raramente — mapa fixo
// no código é mais simples que uma coluna nova em `filiais`).
export const MAPEAMENTO_FILIAL_MERCURY: Record<string, string> = {
    "24": "Goiânia - Jardim América",
    "81": "Goiânia - Setor Oeste",
    "64": "Goiânia - Garavelo",
    "66": "Goiânia II",
    "52": "Barra do Garças/MT",
};

export function branchIdParaFilial(branchId: string): string | null {
    return MAPEAMENTO_FILIAL_MERCURY[branchId] || null;
}

export function filialParaBranchId(filial: string): string | null {
    for (const [bid, nome] of Object.entries(MAPEAMENTO_FILIAL_MERCURY)) if (nome === filial) return bid;
    return null;
}

// Mesmo vocabulário de nível já usado em classificarNivel() (js/importador.js)
// — aqui já não precisa de regex em texto livre, o Mercury já devolve o
// código limpo (level.code). Confirmado contra as 5 filiais: só aparecem
// N1-N4, PP, TA, CO, JN, CA — bate exato com o que o CRM já reconhece.
export function nivelPorCodigoMercury(code: string | null | undefined): string | null {
    if (!code) return null;
    const c = String(code).trim().toUpperCase();
    if (c === "TA" || c === "CO") return "Merlin";
    if (c === "CA") return "CA";
    if (c === "JN") return "JN";
    if (c === "PP") return "PP";
    if (c === "N1") return "N1";
    const m = c.match(/^N([2-7])$/);
    if (m) return "Membro";
    return null;
}

export function normalizarNomeMercury(nome: string | null | undefined): string {
    if (!nome) return "";
    return nome
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toUpperCase()
        .replace(/\s+/g, " ")
        .trim();
}

// "62 81824744" -> {ddd:"62", numero:"81824744"} — formato confirmado
// contra dossiê real. Sem espaço nenhum (ou formato inesperado), cai
// no fallback de tratar tudo como "numero" sem DDD (melhor que jogar
// fora o dado inteiro).
export function partirTelefoneMercury(telefone: string | null | undefined): { ddd: string; numero: string } | null {
    if (!telefone) return null;
    const limpo = telefone.replace(/[^\d ]/g, "").trim();
    if (!limpo) return null;
    const espaco = limpo.indexOf(" ");
    if (espaco === -1) return { ddd: "", numero: limpo };
    return { ddd: limpo.slice(0, espaco).trim(), numero: limpo.slice(espaco + 1).replace(/\s+/g, "") };
}

// "2011-01-05T00:00:00.000Z" -> "05/01/2011" — mesmo formato texto já
// usado em leads_inscricoes.data_saida (motivo_saida/data_saida vêm de
// texto livre raspado do Mercúrio antigo; mantemos o mesmo formato pra
// não quebrar nada que já lê esse campo, ex: bloco "Saída (Inativo)" na
// gaveta do lead).
export function isoParaDataBR(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const soData = String(iso).slice(0, 10); // "AAAA-MM-DD"
    const partes = soData.split("-");
    if (partes.length !== 3) return null;
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

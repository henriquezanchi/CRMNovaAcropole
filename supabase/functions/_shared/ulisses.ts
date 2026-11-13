// Cliente mínimo da API do Ulisses para Edge Functions (13/11/2026, recepção do DMF).
// Mesmo caminho de scraper/ulisses-api.js: token do Auth0 com o client guardado no cofre
// (credenciais_scraper, sistema 'ulisses_api') e chamadas pela ponte da Cloudflare
// (PONTE_URL/PONTE_CHAVE), porque o Cloudflare da Acrópole recusa chamadas de datacenter.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const AUTH0_TOKEN_URL = "https://acropolebrasil.us.auth0.com/oauth/token";
const API = "https://api.acropolebrasil.com.br";
let tokenCache: { token: string; expira: number } | null = null;

async function token(admin: SupabaseClient): Promise<string> {
    if (tokenCache && tokenCache.expira - Date.now() > 60_000) return tokenCache.token;
    const { data, error } = await admin.rpc("ler_credencial_scraper", {
        p_sistema: "ulisses_api", p_filial: "GLOBAL", p_chave: Deno.env.get("CREDENCIAIS_SCRAPER_CHAVE"),
    });
    if (error || !data?.length) throw new Error("Credencial da API do Ulisses indisponível.");
    const resp = await fetch(AUTH0_TOKEN_URL, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: data[0].usuario, client_secret: data[0].senha, audience: `${API}/`, grant_type: "client_credentials" }),
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok || !j.access_token) throw new Error("Falha ao obter acesso à API do Ulisses.");
    tokenCache = { token: j.access_token, expira: Date.now() + (j.expires_in || 3600) * 1000 };
    return tokenCache.token;
}

export async function chamarUlisses(admin: SupabaseClient, path: string, opcoes: { method?: string; corpo?: any; autenticar?: boolean } = {}): Promise<any> {
    const ponte = Deno.env.get("PONTE_URL"), chave = Deno.env.get("PONTE_CHAVE");
    const url = ponte && chave ? `${ponte}/?url=${encodeURIComponent(API + path)}` : API + path;
    const headers: Record<string, string> = {
        Accept: "application/json", "User-Agent": "PortalNovaAcropole/1.0 (CRM)", "X-Portal-NA": "bypass",
    };
    if (ponte && chave) headers["x-ponte-chave"] = chave;
    if (opcoes.autenticar !== false) headers.Authorization = `Bearer ${await token(admin)}`;
    if (opcoes.corpo !== undefined) headers["content-type"] = "application/json";
    let ultimoErro = "";
    for (let tentativa = 0; tentativa < 3; tentativa++) {
        const resp = await fetch(url, { method: opcoes.method || "GET", headers, body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined });
        const texto = await resp.text();
        if (resp.ok) { try { return texto ? JSON.parse(texto) : null; } catch { return texto; } }
        const desafio = resp.status === 403 && /just a moment|cf-chl|challenge-platform/i.test(texto);
        let msg = texto.slice(0, 300);
        try { const j = JSON.parse(texto); msg = j.message || j.error || msg; } catch { /* texto */ }
        ultimoErro = desafio ? "O Ulisses recusou a conexão (proteção anti-robô). Tente de novo." : `Ulisses respondeu ${resp.status}: ${msg}`;
        if (!desafio && ![429, 502, 503, 504].includes(resp.status)) break;
        await new Promise((r) => setTimeout(r, 1500 * (tentativa + 1)));
    }
    throw new Error(ultimoErro);
}

// Pessoas inscritas num evento, com emailEventos[] (id = emailEventoId, compareceu).
export async function filtrarEmails(admin: SupabaseClient, eventoId: number, filialId: number): Promise<any[]> {
    const base = { eventoId, filialId, alunos: ["TODOS"], comparecimentos: ["TODOS"], ordenacao: "", pesquisa: "" };
    try {
        return await chamarUlisses(admin, "/facade/filtrarEmails", { method: "POST", corpo: { ...base, ligacoes: ["TODOS"] } }) || [];
    } catch (e) {
        if (!/ligaç|NullPointer|getLigacoes/i.test(String((e as Error).message))) throw e;
        return await chamarUlisses(admin, "/facade/filtrarEmails", { method: "POST", corpo: { ...base, ligacoes: [] } }) || [];
    }
}

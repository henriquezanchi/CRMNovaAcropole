// Cliente da API da Cora (Integração Direta, conta PJ da Aletheia) — 16/11/2026.
// Toda chamada usa mTLS (certificado + chave privada) e um token client_credentials de 1 h.
// Segredos: CORA_CLIENT_ID, CORA_PROD_CERT/CORA_PROD_KEY, CORA_STAGE_CERT/CORA_STAGE_KEY
// (gravados por tools/cora/gravar-segredos-cora.mjs, nunca no repositório).
// deno-lint-ignore-file no-explicit-any

export type AmbienteCora = "producao" | "stage";

const HOSTS: Record<AmbienteCora, string> = {
    producao: "https://matls-clients.api.cora.com.br",
    stage: "https://matls-clients.api.stage.cora.com.br",
};
const clientes = new Map<AmbienteCora, any>();
const tokens = new Map<AmbienteCora, { token: string; expira: number }>();

function cliente(amb: AmbienteCora): any {
    let c = clientes.get(amb);
    if (!c) {
        const sufixo = amb === "producao" ? "PROD" : "STAGE";
        const cert = Deno.env.get(`CORA_${sufixo}_CERT`), key = Deno.env.get(`CORA_${sufixo}_KEY`);
        if (!cert || !key) throw new Error(`Credenciais da Cora (${amb}) não configuradas.`);
        c = (Deno as any).createHttpClient({ cert, key });
        clientes.set(amb, c);
    }
    return c;
}

async function token(amb: AmbienteCora): Promise<string> {
    const t = tokens.get(amb);
    if (t && t.expira - Date.now() > 60_000) return t.token;
    const resp = await fetch(`${HOSTS[amb]}/token`, {
        method: "POST", client: cliente(amb),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=client_credentials&client_id=${encodeURIComponent(Deno.env.get("CORA_CLIENT_ID") || "")}`,
    } as any);
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok || !j.access_token) throw new Error(`Cora recusou o acesso (${resp.status}).`);
    tokens.set(amb, { token: j.access_token, expira: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
    return j.access_token;
}

export async function chamarCora(amb: AmbienteCora, path: string, opcoes: { method?: string; corpo?: unknown; idempotencia?: string } = {}): Promise<{ ok: boolean; status: number; dados: any }> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await token(amb)}`, Accept: "application/json" };
    if (opcoes.corpo !== undefined) headers["Content-Type"] = "application/json";
    if (opcoes.idempotencia) headers["Idempotency-Key"] = opcoes.idempotencia;
    const resp = await fetch(`${HOSTS[amb]}${path}`, {
        method: opcoes.method || "GET", client: cliente(amb), headers,
        body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
    } as any);
    const texto = await resp.text();
    let dados: any = texto;
    try { dados = texto ? JSON.parse(texto) : null; } catch { /* texto */ }
    return { ok: resp.ok, status: resp.status, dados };
}

// Edge Function: dispara o workflow do GitHub Actions (.github/workflows/
// scraper.yml) sob demanda, a partir de um clique no CRM — em vez de
// esperar o agendamento diário (05:00 Brasília). Só faz sentido pro
// Mercúrio: o passo do Ulisses fica sempre pulado no workflow (`if:
// false`, Cloudflare bloqueia IP de datacenter — ver CLAUDE.md), então
// disparar o workflow só roda a parte que já é 100% automática mesmo.
//
// Usa a API REST do GitHub (workflow_dispatch), com um Personal Access
// Token guardado como secret (GITHUB_TOKEN_DISPATCH — nome próprio pra
// não confundir com o GITHUB_TOKEN automático que o próprio Actions já
// usa em outro contexto). O token nunca é exposto ao navegador — só
// esta function o usa, chamada pelo botão "Rodar Mercúrio agora" no CRM.
//
// Mantém verificação de JWT padrão — chamada pelo navegador com a chave
// publishable, igual o resto do app.
import { corsHeaders, handleCors } from "../_shared/cors.ts";

const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN_DISPATCH")!;
const GITHUB_REPO = Deno.env.get("GITHUB_REPO") ?? "henriquezanchi/CRMNovaAcropole";
const GITHUB_WORKFLOW = Deno.env.get("GITHUB_WORKFLOW_FILE") ?? "scraper.yml";
const GITHUB_REF = Deno.env.get("GITHUB_REF_BRANCH") ?? "main";

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;

    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);
    if (!GITHUB_TOKEN) return json({ ok: false, erro: "GITHUB_TOKEN_DISPATCH não configurado (supabase secrets set)" }, 500);

    try {
        const resp = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${GITHUB_TOKEN}`,
                    Accept: "application/vnd.github+json",
                    "Content-Type": "application/json",
                    "User-Agent": "crm-nova-acropole-scraper-disparar",
                },
                body: JSON.stringify({ ref: GITHUB_REF }),
            },
        );

        if (resp.status !== 204) {
            const detalhe = await resp.text().catch(() => "");
            return json({ ok: false, erro: "github_erro", status: resp.status, detalhe }, 502);
        }

        return json({ ok: true, disparado_em: new Date().toISOString() });
    } catch (e) {
        return json({ ok: false, erro: "falha_rede_github", detalhe: String(e) }, 502);
    }
});

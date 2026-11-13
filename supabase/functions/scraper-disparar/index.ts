// Edge Function: dispara o workflow do GitHub Actions (.github/workflows/
// scraper.yml) sob demanda, a partir de uma chamada do CRM. O workflow
// executa Mercúrio por padrão ou Ulisses via API oficial quando receber
// `modo: "ulisses_api"`.
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
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

// Intervalo mínimo entre dois disparos do mesmo modo. Esta function aceita a
// chave pública (o botão do CRM e o cron usam ela), então sem um freio
// qualquer um podia disparar o workflow em sequência, gastando minutos do
// Actions e martelando o Ulisses/Mercúrio.
const MINUTOS_ENTRE_DISPAROS = 5;

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

    // `filial` opcional — pedido do usuário (2026-09-10): rodar só 1
    // filial pra testar mais rápido, e evitar tráfego desnecessário no
    // Mercúrio conforme mais filiais forem entrando. String vazia/ausente
    // = comportamento de sempre (todas). Repassado como `inputs.filial`
    // pro workflow_dispatch (env `FILTRO_FILIAL`, mesmo filtro do uso local).
    // `modo` aceita `mercurio` ou `ulisses_api`; ausente mantém o fluxo
    // anterior e qualquer outro valor é rejeitado.
    let filial = "";
    let modo = "mercurio";
    try {
        const body = await req.json();
        if (body && typeof body.filial === "string") filial = body.filial;
        if (body && body.modo !== undefined) {
            if (!["mercurio", "ulisses_api", "ulisses_inscritos"].includes(body.modo)) {
                return json({ ok: false, erro: "modo precisa ser 'mercurio', 'ulisses_api' ou 'ulisses_inscritos'" }, 400);
            }
            modo = body.modo;
        }
    } catch { /* corpo vazio ({}) é o caso normal (todas as filiais) */ }

    const desde = new Date(Date.now() - MINUTOS_ENTRE_DISPAROS * 60 * 1000).toISOString();
    const { data: recentes } = await supabaseAdmin.from("log_atividade")
        .select("criado_em").eq("acao", "scraper_disparado").eq("detalhes->>modo", modo)
        .gte("criado_em", desde).limit(1);
    if (recentes && recentes.length > 0) {
        return json({ ok: false, erro: `Já houve um disparo de "${modo}" nos últimos ${MINUTOS_ENTRE_DISPAROS} minutos. Aguarde um pouco.` }, 200);
    }

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
                body: JSON.stringify({ ref: GITHUB_REF, inputs: { filial, modo } }),
            },
        );

        if (resp.status !== 204) {
            const detalhe = await resp.text().catch(() => "");
            return json({ ok: false, erro: "github_erro", status: resp.status, detalhe }, 502);
        }

        await supabaseAdmin.from("log_atividade").insert({
            filial: filial || "GLOBAL", acao: "scraper_disparado", autor: "scraper-disparar",
            pessoa_ids: [], detalhes: { modo, filial: filial || null },
        });
        return json({ ok: true, disparado_em: new Date().toISOString() });
    } catch (e) {
        return json({ ok: false, erro: "falha_rede_github", detalhe: String(e) }, 502);
    }
});

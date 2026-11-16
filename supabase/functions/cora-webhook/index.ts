// Edge Function: cora-webhook — recebe o aviso da Cora (fatura paga, vencida, cancelada) — 16/11/2026.
// A documentação da Cora não descreve assinatura do aviso, então ele só serve de gatilho: o status
// é sempre lido de volta na própria Cora (cora-cobranca, acao "consultar") antes de mudar o CRM.
// Publicada sem verificação de JWT (a Cora não manda token).
// deno-lint-ignore-file no-explicit-any
function acharInvoiceId(x: any, prof = 0): string | null {
    if (!x || prof > 4) return null;
    if (typeof x === "string") return /^inv_[A-Za-z0-9_-]{4,80}$/.test(x) ? x : null;
    if (typeof x !== "object") return null;
    for (const v of Object.values(x)) { const r = acharInvoiceId(v, prof + 1); if (r) return r; }
    return null;
}

Deno.serve(async (req) => {
    if (req.method !== "POST") return new Response("ok");
    const texto = await req.text();
    let corpo: any = null;
    try { corpo = JSON.parse(texto); } catch { /* corpo não-JSON */ }
    const inv = acharInvoiceId(corpo) || acharInvoiceId(req.headers.get("webhook-resource-id") || "");
    console.log("aviso da Cora", { inv, evento: req.headers.get("webhook-event-type") || corpo?.event || null });
    if (inv) {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/cora-cobranca`, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ acao: "consultar", invoice_id: inv }),
        }).catch(() => {});
    }
    return new Response("ok");
});

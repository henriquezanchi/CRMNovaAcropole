// Edge Function: marca uma mensagem RECEBIDA como lida na Meta (o "✓✓
// azul" do lado do lead) — pedido do usuário (2026-09-29, "implemente
// tudo que for possível"). A Graph API tem um endpoint próprio pra
// isso, separado do envio normal de mensagem (por isso não entrou em
// whatsapp-send: não tem "to" nem tipo de mensagem, é só um POST com
// `status: "read"` + o id da mensagem).
//
// Chamada pelo frontend (js/whatsapp.js, marcarUltimaMensagemComoLidaWpp())
// ao abrir uma conversa — best-effort, fire-and-forget, nunca bloqueia a
// UI nem quebra nada se falhar.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin, NOME_TABELA_LEADS } from "../_shared/supabaseAdmin.ts";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") ?? "v21.0";
const TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;
const PHONE_ID_DEFAULT = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_DEFAULT")!;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    let corpoReq: { pessoaIdentificador?: string; waMessageId?: string };
    try {
        corpoReq = await req.json();
    } catch {
        return json({ ok: false, erro: "json_invalido" }, 400);
    }
    const { pessoaIdentificador, waMessageId } = corpoReq;
    if (!pessoaIdentificador || !waMessageId) return json({ ok: false, erro: "parametros_faltando" }, 400);

    // Resolve o número da Meta que "recebeu" — precisa ser o mesmo número
    // que está marcando como lido (a filial do lead, com fallback pro padrão).
    let phoneNumberId = PHONE_ID_DEFAULT;
    const { data: lead } = await supabaseAdmin.from(NOME_TABELA_LEADS).select("filial").eq("pessoaIdentificador", pessoaIdentificador).maybeSingle();
    if (lead?.filial) {
        const { data: filialRow } = await supabaseAdmin.from("filiais").select("whatsapp_phone_number_id").eq("nome", lead.filial).maybeSingle();
        if (filialRow?.whatsapp_phone_number_id) phoneNumberId = filialRow.whatsapp_phone_number_id;
    }

    try {
        const resp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: waMessageId }),
        });
        const data = await resp.json();
        if (!resp.ok) return json({ ok: false, erro: "erro_meta", detalhe: data?.error }, 200);
        return json({ ok: true });
    } catch (e) {
        return json({ ok: false, erro: "falha_rede", detalhe: String(e) }, 502);
    }
});

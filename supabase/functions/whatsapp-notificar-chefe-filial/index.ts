// Edge Function: manda uma mensagem de texto livre pro WhatsApp do CHEFE
// DE FILIAL/professor responsável (não de um lead, não do admin do
// scraper) — usada em 2 situações:
//   1. Aviso de aniversário de aluno ATIVO no dia (job diário do
//      Mercúrio, scraper/mercurio.js, chamada server-a-server com
//      SERVICE_ROLE_KEY).
//   2. "Enviar resumo das interações pro chefe de filial", botão na
//      gaveta do lead (js/app.js) — chamada pelo NAVEGADOR (chave
//      publishable), pra qualquer SDR poder avisar o chefe sobre um
//      lead específico que merece atenção.
//
// Só recebe `filial` (nunca um número de telefone direto) — o número do
// chefe (filiais.whatsapp_chefe_numero) é resolvido AQUI, no servidor,
// nunca exposto ao frontend. Sem número configurado pra aquela filial,
// devolve erro claro (não falha silenciosamente).
//
// Mantém verificação de JWT padrão (igual whatsapp-send) — tanto o
// scraper (SERVICE_ROLE_KEY) quanto o navegador (chave publishable) já
// mandam um Bearer válido.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") ?? "v21.0";
const TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;
const PHONE_ID_DEFAULT = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_DEFAULT")!;

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

    let corpoReq: { filial?: string; texto?: string };
    try {
        corpoReq = await req.json();
    } catch {
        return json({ ok: false, erro: "json_invalido" }, 400);
    }

    const { filial, texto } = corpoReq;
    if (!filial || !texto?.trim()) return json({ ok: false, erro: "parametros_faltando" }, 400);

    const { data: filialRow, error: erroFilial } = await supabaseAdmin
        .from("filiais")
        .select("whatsapp_chefe_numero, whatsapp_phone_number_id")
        .eq("nome", filial)
        .maybeSingle();
    if (erroFilial) return json({ ok: false, erro: "erro_buscar_filial", detalhe: erroFilial.message }, 500);
    if (!filialRow?.whatsapp_chefe_numero) {
        return json({ ok: false, erro: "chefe_sem_numero", detalhe: `Filial "${filial}" não tem WhatsApp de chefe configurado (Gerenciar Filiais).` }, 422);
    }

    const phoneNumberId = filialRow.whatsapp_phone_number_id || PHONE_ID_DEFAULT;

    let respGraph: Response;
    let respJson: any;
    try {
        respGraph = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to: filialRow.whatsapp_chefe_numero,
                type: "text",
                text: { body: texto },
            }),
        });
        respJson = await respGraph.json();
    } catch (e) {
        return json({ ok: false, erro: "falha_rede_meta", detalhe: String(e) }, 502);
    }

    if (!respGraph.ok) {
        const codigo = respJson?.error?.code;
        const mensagemErro = String(respJson?.error?.message || "");
        const foraDaJanela = codigo === 131047 || /24 hour/i.test(mensagemErro);
        return json({ ok: false, erro: foraDaJanela ? "janela_fechada" : "erro_meta", detalhe: respJson?.error }, 200);
    }

    return json({ ok: true, wa_message_id: respJson.messages?.[0]?.id });
});

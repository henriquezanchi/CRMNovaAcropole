// Edge Function: manda uma mensagem de texto livre pro WhatsApp do ADMIN
// (não de um lead) — usada pelo scraper (mercurio.js, job diário do
// GitHub Actions) pra lembrar de rodar a importação do Ulisses em dias
// críticos (evento por perto) ou na checagem semanal de rotina.
//
// Diferente de whatsapp-send (que sempre busca telefone de um LEAD em
// leads_inscricoes), esta manda pra um número FIXO, configurado como
// secret (WHATSAPP_NUMERO_ADMIN) — nunca fica hardcoded no código nem
// no repositório. Reaproveita os MESMOS segredos da integração de
// WhatsApp já existente (WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID_DEFAULT),
// sem duplicar nada.
//
// Chamada só server-a-server (scraper, com SUPABASE_SERVICE_ROLE_KEY) —
// mantém a verificação de JWT padrão (nunca é chamada pelo navegador).
//
// ⚠️ Limitação conhecida (WhatsApp Cloud API): texto livre só é aceito
// se o destinatário tiver mandado mensagem pro número comercial nas
// últimas 24h (janela de atendimento) — senão a Meta recusa com o erro
// 131047 e a mensagem nunca chega. Pra um lembrete que precisa ser
// confiável todo dia, o certo é ter um TEMPLATE aprovado pela Meta
// (fora da janela de 24h, só template funciona) — ainda não existe um
// pra isso. Até lá, esta function tenta texto livre e loga o erro se a
// janela estiver fechada, mas não tem como "forçar" a entrega.
import { corsHeaders, handleCors } from "../_shared/cors.ts";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") ?? "v21.0";
const TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;
const PHONE_ID_DEFAULT = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_DEFAULT")!;
const NUMERO_ADMIN = Deno.env.get("WHATSAPP_NUMERO_ADMIN")!; // E.164 sem "+", ex: 5562991729783

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
    if (!NUMERO_ADMIN) return json({ ok: false, erro: "WHATSAPP_NUMERO_ADMIN não configurado (supabase secrets set)" }, 500);

    let corpoReq: { texto?: string };
    try {
        corpoReq = await req.json();
    } catch {
        return json({ ok: false, erro: "json_invalido" }, 400);
    }

    const texto = corpoReq.texto?.trim();
    if (!texto) return json({ ok: false, erro: "texto_vazio" }, 400);

    let respGraph: Response;
    let respJson: any;
    try {
        respGraph = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID_DEFAULT}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to: NUMERO_ADMIN,
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

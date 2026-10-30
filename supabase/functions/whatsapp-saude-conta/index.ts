// Edge Function: whatsapp-saude-conta — pedido do usuário (30/10/2026), depois
// de a Meta banir e reverter (em ~1h) as contas do WhatsApp do portfólio: a
// gente só soube pelo e-mail, horas depois. Esta função consulta na Graph API,
// a cada 30 min (pg_cron), o status e a qualidade de cada número que o CRM usa,
// grava em whatsapp_saude_conta (lida pelo sino e pelo Resumo Diário) e, quando
// a situação MUDA (ficou ruim ou voltou ao normal), avisa o admin pelo
// lembrete-scraper. Se a conta estiver banida esse WhatsApp pode não chegar —
// por isso o sino do CRM lê a mesma tabela.
//
// Números verificados: WHATSAPP_PHONE_NUMBER_ID_DEFAULT + os
// filiais.whatsapp_phone_number_id preenchidos (mesma origem de whatsapp-send).
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") ?? "v21.0";
const TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;
const PHONE_ID_DEFAULT = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_DEFAULT")!;
const CAMPOS = "display_phone_number,verified_name,status,quality_rating,messaging_limit_tier,name_status";
const DIAS_HISTORICO = 30;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const TRADUCAO_STATUS: Record<string, string> = {
    CONNECTED: "conectado",
    BANNED: "BANIDO",
    FLAGGED: "sinalizado pela Meta",
    RESTRICTED: "restrito",
    RATE_LIMITED: "com limite de envio",
    DISCONNECTED: "desconectado",
    PENDING: "pendente",
    DELETED: "excluído",
    UNVERIFIED: "não verificado",
};
const TRADUCAO_QUALIDADE: Record<string, string> = { GREEN: "alta", YELLOW: "média", RED: "baixa", UNKNOWN: "sem avaliação" };

// Problema = qualquer coisa que impeça ou ameace o envio. Qualidade "UNKNOWN"
// (número novo, sem histórico) não é problema.
function descreverProblema(status: string | null, qualidade: string | null): string | null {
    const partes: string[] = [];
    if (status && status !== "CONNECTED") partes.push(`número ${TRADUCAO_STATUS[status] || status}`);
    if (qualidade === "RED") partes.push("qualidade baixa");
    if (qualidade === "YELLOW") partes.push("qualidade média (atenção)");
    return partes.length ? partes.join(" e ") : null;
}

async function consultarNumero(phoneId: string) {
    try {
        const resp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}?fields=${CAMPOS}`, {
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
        const data = await resp.json();
        if (!resp.ok || data?.error) {
            const msg = data?.error?.message || `HTTP ${resp.status}`;
            return { ok: false, problema: `a Meta recusou a consulta: ${msg}`, detalhe: data };
        }
        const problema = descreverProblema(data.status ?? null, data.quality_rating ?? null);
        return {
            ok: !problema,
            problema,
            numero: data.display_phone_number ?? null,
            nome: data.verified_name ?? null,
            status: data.status ?? null,
            quality_rating: data.quality_rating ?? null,
            messaging_limit_tier: data.messaging_limit_tier ?? null,
            name_status: data.name_status ?? null,
            detalhe: data,
        };
    } catch (e) {
        // Falha de rede nossa não é problema da conta — não grava como problema.
        return { erroRede: String(e instanceof Error ? e.message : e) };
    }
}

async function avisarAdmin(texto: string) {
    try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/lembrete-scraper`, {
            method: "POST",
            headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
            body: JSON.stringify({ texto }),
        });
    } catch { /* best-effort: o sino do CRM lê a mesma tabela */ }
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    const { data: filiais } = await supabaseAdmin.from("filiais").select("whatsapp_phone_number_id").not("whatsapp_phone_number_id", "is", null);
    const ids = [...new Set([PHONE_ID_DEFAULT, ...(filiais || []).map((f: any) => String(f.whatsapp_phone_number_id))].filter(Boolean))];

    const resultados: any[] = [];
    for (const phoneId of ids) {
        const r: any = await consultarNumero(phoneId);
        if (r.erroRede) { resultados.push({ phoneId, erroRede: r.erroRede }); continue; }

        const { data: anterior } = await supabaseAdmin
            .from("whatsapp_saude_conta")
            .select("ok, problema")
            .eq("phone_number_id", phoneId)
            .order("verificado_em", { ascending: false })
            .limit(1)
            .maybeSingle();

        const linha = {
            phone_number_id: phoneId,
            numero: r.numero ?? null,
            nome: r.nome ?? null,
            status: r.status ?? null,
            quality_rating: r.quality_rating ?? null,
            messaging_limit_tier: r.messaging_limit_tier ?? null,
            name_status: r.name_status ?? null,
            ok: r.ok,
            problema: r.problema ?? null,
            detalhe: r.detalhe ?? null,
        };
        const { error } = await supabaseAdmin.from("whatsapp_saude_conta").insert(linha);
        if (error) console.warn("[whatsapp-saude-conta] falha ao gravar:", error.message);

        const rotulo = r.numero ? `${r.nome || "WhatsApp"} (${r.numero})` : `número ${phoneId}`;
        const mudou = !anterior || anterior.ok !== r.ok || (anterior.problema || null) !== (r.problema || null);
        if (mudou && !r.ok) {
            await avisarAdmin(`🚨 *WhatsApp do CRM com problema*\n${rotulo}: ${r.problema}.\n\nConfira em business.facebook.com/business-support-home. Os envios podem estar falhando.`);
        } else if (mudou && r.ok && anterior && !anterior.ok) {
            const qualidade = TRADUCAO_QUALIDADE[r.quality_rating] || r.quality_rating || "?";
            await avisarAdmin(`✅ *WhatsApp do CRM normalizado*\n${rotulo}: conectado, qualidade ${qualidade}.`);
        }
        resultados.push({ phoneId, ...linha, detalhe: undefined, avisou: mudou });
    }

    const limite = new Date(Date.now() - DIAS_HISTORICO * 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin.from("whatsapp_saude_conta").delete().lt("verificado_em", limite);

    return json({ ok: true, resultados });
});

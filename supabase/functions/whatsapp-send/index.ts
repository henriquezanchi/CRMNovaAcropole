// Edge Function: envia uma mensagem de WhatsApp (texto livre ou template)
// pra um lead, via Meta Cloud API, e grava o resultado em mensagens_whatsapp.
//
// Chamada pelo frontend via `supabaseClient.functions.invoke('whatsapp-send', {...})`.
// Mantém verificação de JWT padrão (o supabase-js já manda a chave publishable
// como Bearer automaticamente) — ver supabase/config.toml.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin, NOME_TABELA_LEADS, NOME_TABELA_MENSAGENS } from "../_shared/supabaseAdmin.ts";
import { montarNumeroE164 } from "../_shared/telefone.ts";

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

    let corpoReq: {
        pessoaIdentificador?: string;
        tipo?: "texto" | "template";
        texto?: string;
        templateNome?: string;
        templateParams?: string[];
        templatePreview?: string;
    };
    try {
        corpoReq = await req.json();
    } catch {
        return json({ ok: false, erro: "json_invalido" }, 400);
    }

    const { pessoaIdentificador, tipo, texto, templateNome, templateParams, templatePreview } = corpoReq;
    if (!pessoaIdentificador || !tipo) return json({ ok: false, erro: "parametros_faltando" }, 400);
    if (tipo === "texto" && !texto?.trim()) return json({ ok: false, erro: "texto_vazio" }, 400);
    if (tipo === "template" && !templateNome) return json({ ok: false, erro: "template_nome_faltando" }, 400);

    // Busca telefone/filial do lead no servidor — não confia no que vier do front.
    const { data: lead, error: erroLead } = await supabaseAdmin
        .from(NOME_TABELA_LEADS)
        .select('pessoaTelefoneDDD, pessoaTelefoneNumero, pessoaNome, filial')
        .eq('pessoaIdentificador', pessoaIdentificador)
        .single();
    if (erroLead || !lead) return json({ ok: false, erro: "lead_nao_encontrado" }, 404);

    const numeroE164 = montarNumeroE164(lead.pessoaTelefoneDDD, lead.pessoaTelefoneNumero);
    if (!numeroE164) return json({ ok: false, erro: "lead_sem_telefone" }, 422);

    // Resolve o número da Meta que envia: da filial do lead, com fallback pro padrão.
    let phoneNumberId = PHONE_ID_DEFAULT;
    if (lead.filial) {
        const { data: filialRow } = await supabaseAdmin
            .from("filiais")
            .select("whatsapp_phone_number_id")
            .eq("nome", lead.filial)
            .maybeSingle();
        if (filialRow?.whatsapp_phone_number_id) phoneNumberId = filialRow.whatsapp_phone_number_id;
    }

    const bodyGraph = tipo === "template"
        ? {
            messaging_product: "whatsapp",
            to: numeroE164,
            type: "template",
            template: {
                name: templateNome,
                language: { code: "pt_BR" },
                components: [{
                    type: "body",
                    parameters: (templateParams || []).map((p) => ({ type: "text", text: p })),
                }],
            },
        }
        : {
            messaging_product: "whatsapp",
            to: numeroE164,
            type: "text",
            text: { body: texto },
        };

    const corpoTexto = tipo === "template" ? (templatePreview || `[Template: ${templateNome}]`) : texto;

    let respGraph: Response;
    let respJson: any;
    try {
        respGraph = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(bodyGraph),
        });
        respJson = await respGraph.json();
    } catch (e) {
        return json({ ok: false, erro: "falha_rede_meta", detalhe: String(e) }, 502);
    }

    if (!respGraph.ok) {
        const codigo = respJson?.error?.code;
        const mensagemErro = String(respJson?.error?.message || "");
        // 131047 é o código real da Meta pra "fora da janela de 24h", mas a
        // Meta já mudou detalhes de erro entre versões — checa o texto também.
        const foraDaJanela = codigo === 131047 || /24 hour/i.test(mensagemErro);

        await supabaseAdmin.from(NOME_TABELA_MENSAGENS).insert({
            pessoaIdentificador,
            telefone_whatsapp: numeroE164,
            filial: lead.filial,
            direcao: "saida",
            tipo,
            corpo_texto: corpoTexto,
            wa_status: "falhou",
            wa_status_erro: respJson?.error ?? { message: "erro desconhecido" },
            phone_number_id_meta: phoneNumberId,
            payload_bruto: respJson,
        });

        return json({ ok: false, erro: foraDaJanela ? "janela_fechada" : "erro_meta", detalhe: respJson?.error }, 200);
    }

    const waMessageId = respJson.messages?.[0]?.id;
    await supabaseAdmin.from(NOME_TABELA_MENSAGENS).insert({
        pessoaIdentificador,
        telefone_whatsapp: numeroE164,
        filial: lead.filial,
        direcao: "saida",
        tipo,
        corpo_texto: corpoTexto,
        wa_message_id: waMessageId,
        wa_status: "enviado",
        phone_number_id_meta: phoneNumberId,
        payload_bruto: respJson,
    });

    return json({ ok: true, wa_message_id: waMessageId });
});

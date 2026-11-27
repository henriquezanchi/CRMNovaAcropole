// Edge Function: modelos de mensagem do WhatsApp (27/11/2026).
//
// Lista e cria modelos na conta do WhatsApp Business (WABA) pela Graph API. Com uma filial que conectou o próprio
// número (whatsapp_conexoes), usa a conta e o token da escola; sem filial, a conta da agência (token padrão, contas
// descobertas pelo debug_token). Criar modelo exige administrador do CRM com a senha (mesmo critério de
// whatsapp-conexao). O modelo criado fica em análise na Meta; o CRM só o usa depois de aprovado.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { GRAPH_VERSION, numeroEscolaDaFilial, TOKEN_PADRAO } from "../_shared/whatsapp-numeros.ts";

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function adminValido(usuario: unknown, senhaHash: unknown): Promise<boolean> {
    if (typeof usuario !== "string" || typeof senhaHash !== "string" || !usuario || !/^[0-9a-f]{64}$/.test(senhaHash)) return false;
    const { data } = await supabaseAdmin.from("usuarios_crm").select("id")
        .eq("nome", usuario).eq("senha_hash", senhaHash).eq("eh_admin", true).eq("ativo", true).maybeSingle();
    return !!data;
}

/** Contas (WABA) que um token enxerga. */
async function contasDoToken(token: string): Promise<string[]> {
    const contas = new Set<string>();
    const dbg = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json()).catch(() => ({}));
    for (const s of dbg?.data?.granular_scopes || []) {
        if (String(s.scope).startsWith("whatsapp_business")) (s.target_ids || []).forEach((t: string) => contas.add(String(t)));
    }
    if (!contas.size) {
        const neg = await fetch(`${GRAPH}/me/businesses?fields=id,owned_whatsapp_business_accounts{id},client_whatsapp_business_accounts{id}`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json()).catch(() => ({}));
        for (const b of neg?.data || []) {
            for (const w of [...(b.owned_whatsapp_business_accounts?.data || []), ...(b.client_whatsapp_business_accounts?.data || [])]) contas.add(String(w.id));
        }
    }
    const fixa = Deno.env.get("WHATSAPP_WABA_ID");
    if (!contas.size && fixa) contas.add(fixa);
    return [...contas];
}

/** Conta e token que valem para a filial: a da escola conectada, senão a da agência. */
async function contaDaFilial(filial: string | null): Promise<{ contas: string[]; token: string; origem: string }> {
    const escola = await numeroEscolaDaFilial(filial);
    if (escola?.token && escola.estado === "conectado") return { contas: [escola.wabaId], token: escola.token, origem: `WhatsApp de ${escola.filial}` };
    return { contas: await contasDoToken(TOKEN_PADRAO), token: TOKEN_PADRAO, origem: "WhatsApp da agência" };
}

const mensagemErro = (d: any) => String(d?.error?.error_user_msg || d?.error?.message || "erro desconhecido");

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return json({ ok: false, erro: "Use POST." }, 405);
    let corpo: any;
    try { corpo = await req.json(); } catch { return json({ ok: false, erro: "JSON inválido." }, 400); }
    if (!(await adminValido(corpo.usuario, corpo.senhaHash))) return json({ ok: false, erro: "Só um administrador do CRM, com a senha, mexe nos modelos." }, 403);
    const filial = typeof corpo.filial === "string" && corpo.filial.trim() ? corpo.filial.trim() : null;
    const { contas, token, origem } = await contaDaFilial(filial);
    if (!contas.length || !token) return json({ ok: false, erro: "Nenhuma conta do WhatsApp encontrada para este token." }, 404);

    if (corpo.acao === "listar") {
        const modelos: any[] = [];
        for (const w of contas) {
            const r = await fetch(`${GRAPH}/${w}/message_templates?limit=100&fields=name,status,category,language,components,rejected_reason`, {
                headers: { Authorization: `Bearer ${token}` },
            }).then((x) => x.json()).catch(() => ({}));
            if (r?.error) { modelos.push({ conta: w, erro: mensagemErro(r) }); continue; }
            for (const t of r?.data || []) {
                modelos.push({
                    conta: w, nome: t.name, status: t.status, categoria: t.category, idioma: t.language,
                    corpo: (t.components || []).find((k: any) => k.type === "BODY")?.text ?? null,
                    rodape: (t.components || []).find((k: any) => k.type === "FOOTER")?.text ?? null,
                    motivo: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
                });
            }
        }
        return json({ ok: true, origem, contas, modelos });
    }

    if (corpo.acao === "criar") {
        const nome = String(corpo.nome || "").trim().toLowerCase();
        const texto = String(corpo.corpo || "").trim();
        const rodape = String(corpo.rodape || "").trim();
        const categoria = ["MARKETING", "UTILITY"].includes(String(corpo.categoria)) ? String(corpo.categoria) : "UTILITY";
        const idioma = /^[a-z]{2}(_[A-Z]{2})?$/.test(String(corpo.idioma || "")) ? String(corpo.idioma) : "pt_BR";
        if (!/^[a-z0-9_]{3,512}$/.test(nome)) return json({ ok: false, erro: "O nome do modelo usa só letras minúsculas, números e _." }, 400);
        if (!texto || texto.length > 1024) return json({ ok: false, erro: "O texto do modelo precisa ter de 1 a 1024 caracteres." }, 400);
        const conta = corpo.conta && contas.includes(String(corpo.conta)) ? String(corpo.conta) : contas[0];
        const components: any[] = [{ type: "BODY", text: texto }];
        // Variáveis {{1}}, {{2}}... precisam de exemplo para a Meta analisar.
        const variaveis = [...new Set(texto.match(/\{\{\d+\}\}/g) || [])].length;
        if (variaveis) components[0].example = { body_text: [Array.from({ length: variaveis }, (_, i) => `exemplo ${i + 1}`)] };
        if (rodape) components.push({ type: "FOOTER", text: rodape.slice(0, 60) });
        else if (categoria === "MARKETING") components.push({ type: "FOOTER", text: "Para não receber mais, responda SAIR" });
        const modelo = { name: nome, language: idioma, category: categoria, components };
        const r = await fetch(`${GRAPH}/${conta}/message_templates`, {
            method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(modelo),
        }).then((x) => x.json()).catch((e) => ({ error: { message: String(e) } }));
        await supabaseAdmin.from("log_atividade").insert({
            filial: filial || "GLOBAL", acao: "modelo_whatsapp_criado", autor: String(corpo.usuario),
            pessoa_ids: [], detalhes: { conta, nome, categoria, idioma, resposta: r },
        }).then(() => {}, () => {});
        if (r?.error) return json({ ok: false, erro: mensagemErro(r) }, 400);
        return json({ ok: true, id: r.id, status: r.status, categoria: r.category, nome, conta });
    }

    return json({ ok: false, erro: "Ação desconhecida." }, 400);
});

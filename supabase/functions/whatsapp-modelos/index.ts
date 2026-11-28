// Edge Function: modelos de mensagem do WhatsApp (27/11/2026).
//
// Lista e cria modelos na conta do WhatsApp Business (WABA) pela Graph API. Com uma filial que conectou o próprio
// número (whatsapp_conexoes), usa a conta e o token da escola; sem filial, a conta da agência (token padrão, contas
// descobertas pelo debug_token). Criar modelo exige administrador do CRM com a senha (mesmo critério de
// whatsapp-conexao). O modelo criado fica em análise na Meta; o CRM só o usa depois de aprovado.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { conexaoDaFilial, GRAPH_VERSION, TOKEN_PADRAO } from "../_shared/whatsapp-numeros.ts";

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
    // Token de usuário de sistema sem escopo por conta: pergunta direto ao portfólio da agência.
    const portfolio = Deno.env.get("WHATSAPP_BUSINESS_ID") || "1510384940854530";
    if (!contas.size) {
        for (const campo of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
            const r = await fetch(`${GRAPH}/${portfolio}/${campo}?fields=id,name`, { headers: { Authorization: `Bearer ${token}` } })
                .then((x) => x.json()).catch(() => ({}));
            for (const w of r?.data || []) contas.add(String(w.id));
            if (r?.error) console.warn(campo, r.error.message);
        }
    }
    const fixa = Deno.env.get("WHATSAPP_WABA_ID");
    if (!contas.size && fixa) contas.add(fixa);
    return [...contas];
}

/** Conta e token que valem para a filial: a da escola conectada, senão a da agência. */
async function contaDaFilial(filial: string | null): Promise<{ contas: string[]; token: string; origem: string }> {
    const escola = await conexaoDaFilial(filial);
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

    // Diagnóstico (só leitura): GET em um caminho da Graph API com o token em uso. Para achar a conta certa.
    if (corpo.acao === "graph") {
        const caminho = String(corpo.caminho || "");
        if (!/^\/[A-Za-z0-9_\/.?=&%,-]+$/.test(caminho)) return json({ ok: false, erro: "Caminho inválido." }, 400);
        const r = await fetch(`${GRAPH}${caminho}`, { headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
        return json({ ok: true, resposta: r });
    }

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
        // Diagnóstico: o que a Meta diz de cada conta (ajuda quando a API de modelos é recusada).
        const diagnostico: any[] = [];
        for (const w of contas) {
            const info = await fetch(`${GRAPH}/${w}?fields=id,name,account_review_status,business_verification_status,ownership_type,on_behalf_of_business_info,message_template_namespace,timezone_id,is_enabled_for_insights`, {
                headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json()).catch((e) => ({ error: { message: String(e) } }));
            const numeros = await fetch(`${GRAPH}/${w}/phone_numbers?fields=id,display_phone_number,platform_type,is_on_biz_app,status`, {
                headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json()).catch((e) => ({ error: { message: String(e) } }));
            diagnostico.push({ conta: w, info, numeros });
        }
        const numeroAgencia = await fetch(`${GRAPH}/${Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_DEFAULT")}?fields=id,display_phone_number,verified_name,account_mode,platform_type,is_on_biz_app`, {
            headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json()).catch(() => ({}));
        const portfolio = Deno.env.get("WHATSAPP_BUSINESS_ID") || "1510384940854530";
        const doPortfolio: any = {};
        for (const campo of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
            doPortfolio[campo] = await fetch(`${GRAPH}/${portfolio}/${campo}?fields=id,name`, { headers: { Authorization: `Bearer ${token}` } })
                .then((x) => x.json()).catch((e) => ({ error: String(e) }));
        }
        (diagnostico as any).push({ numeroAgencia, portfolio, doPortfolio });
        const me = await fetch(`${GRAPH}/me?fields=id,name`, { headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json()).catch(() => ({}));
        const dbg = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}`, { headers: { Authorization: `Bearer ${token}` } })
            .then((x) => x.json()).catch(() => ({}));
        return json({ ok: true, origem, contas, modelos, diagnostico, me, escopos: dbg?.data?.granular_scopes, tipo: dbg?.data?.type, app: dbg?.data?.app_id });
    }

    // Copia os modelos APROVADOS da conta da agência para a conta da escola (cada conta do WhatsApp tem os seus
    // próprios modelos; sem isso, uma escola recém-conectada não consegue mandar nenhum modelo pelo CRM).
    if (corpo.acao === "copiar") {
        if (!filial) return json({ ok: false, erro: "Informe a filial de destino." }, 400);
        if (origem === "WhatsApp da agência") return json({ ok: false, erro: "Esta filial não tem número próprio conectado." }, 400);
        const contaAgencia = Deno.env.get("WHATSAPP_WABA_ID");
        if (!contaAgencia || !TOKEN_PADRAO) return json({ ok: false, erro: "Conta da agência não configurada (WHATSAPP_WABA_ID)." }, 500);
        const fonte = await fetch(`${GRAPH}/${contaAgencia}/message_templates?limit=100&fields=name,status,category,language,components`, {
            headers: { Authorization: `Bearer ${TOKEN_PADRAO}` } }).then((x) => x.json()).catch(() => ({}));
        if (fonte?.error) return json({ ok: false, erro: "Não consegui ler os modelos da agência: " + mensagemErro(fonte) }, 400);
        const destino = contas[0];
        const jaTem = await fetch(`${GRAPH}/${destino}/message_templates?limit=100&fields=name,language`, {
            headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json()).catch(() => ({}));
        const existentes = new Set((jaTem?.data || []).map((t: any) => `${t.name}|${t.language}`));
        const resultado: any[] = [];
        for (const t of fonte?.data || []) {
            if (t.status !== "APPROVED") { resultado.push({ nome: t.name, idioma: t.language, pulado: `status ${t.status}` }); continue; }
            if (existentes.has(`${t.name}|${t.language}`)) { resultado.push({ nome: t.name, idioma: t.language, pulado: "já existe" }); continue; }
            const components = (t.components || []).map((c: any) => {
                const k: any = { type: c.type };
                if (c.format) k.format = c.format;
                if (c.text) k.text = c.text;
                if (c.buttons) k.buttons = c.buttons;
                if (c.example) k.example = c.example;
                // Corpo com variáveis sem exemplo: a Meta exige exemplo para analisar.
                if (c.type === "BODY" && !k.example) {
                    const n = [...new Set(String(c.text || "").match(/\{\{\d+\}\}/g) || [])].length;
                    if (n) k.example = { body_text: [Array.from({ length: n }, (_, i) => `exemplo ${i + 1}`)] };
                }
                return k;
            });
            const r = await fetch(`${GRAPH}/${destino}/message_templates`, {
                method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ name: t.name, language: t.language, category: t.category, components }),
            }).then((x) => x.json()).catch((e) => ({ error: { message: String(e) } }));
            resultado.push(r?.error ? { nome: t.name, idioma: t.language, erro: mensagemErro(r) } : { nome: t.name, idioma: t.language, status: r.status, id: r.id });
        }
        await supabaseAdmin.from("log_atividade").insert({
            filial, acao: "modelos_whatsapp_copiados", autor: String(corpo.usuario),
            pessoa_ids: [], detalhes: { de: contaAgencia, para: destino, resultado },
        }).then(() => {}, () => {});
        return json({ ok: true, de: contaAgencia, para: destino, resultado });
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

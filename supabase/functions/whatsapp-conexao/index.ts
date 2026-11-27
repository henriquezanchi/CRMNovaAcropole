// Edge Function: conecta o WhatsApp oficial de uma escola ao CRM (26/11/2026, pedido do usuário).
//
// A tela (Gerenciar Filiais > WhatsApp oficial da escola) abre o cadastro incorporado da Meta (Embedded Signup v5,
// com coexistência: o número continua no app WhatsApp Business do celular). Ao terminar, a Meta devolve um código de
// 5 minutos, o id do número e o id da conta (WABA) da escola. Esta função:
//   1. troca o código pelo token da escola (precisa do segredo do app, por isso fica no servidor);
//   2. confere que o número pertence àquela conta;
//   3. inscreve o app do CRM na conta da escola (para receber as mensagens no whatsapp-webhook);
//   4. guarda o token cifrado em whatsapp_conexoes;
//   5. pede à Meta os contatos e os últimos 6 meses de conversa do app (só pode ser pedido uma vez, até 24 h depois).
//
// Ações que mudam algo exigem usuário administrador do CRM e a senha dele (mesmo critério do PIN dos painéis).
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { cifrarToken, decifrarToken, esquecerCacheNumeros, GRAPH_VERSION, TOKEN_PADRAO } from "../_shared/whatsapp-numeros.ts";

// App que faz o cadastro incorporado (Embedded Signup). Pode ser outro app do mesmo portfólio já aprovado como
// Provedor de Tecnologia (27/11/2026: o da Semperia), diferente do app usado pelo número da agência. Sem os
// segredos WHATSAPP_ES_*, cai no app da agência (WHATSAPP_APP_ID/WHATSAPP_APP_SECRET).
const APP_SECRET = Deno.env.get("WHATSAPP_ES_APP_SECRET") || Deno.env.get("WHATSAPP_APP_SECRET") || "";
const CONFIG_ID = Deno.env.get("WHATSAPP_ES_CONFIG_ID") ?? "";
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
// As mensagens das contas das escolas chegam no webhook do CRM mesmo quando o app de cadastro tem outro webhook.
const WEBHOOK_CRM = Deno.env.get("WHATSAPP_WEBHOOK_URL") || `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook`;
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

let appIdCache: string | null = null;
/** Id do app da Meta: segredo WHATSAPP_APP_ID ou, sem ele, o app dono do token da agência. */
async function appId(): Promise<string | null> {
    if (appIdCache) return appIdCache;
    const fixo = Deno.env.get("WHATSAPP_ES_APP_ID") || Deno.env.get("WHATSAPP_APP_ID");
    if (fixo) return (appIdCache = fixo);
    if (!TOKEN_PADRAO) return null;
    const r = await fetch(`${GRAPH}/app?fields=id,name`, { headers: { Authorization: `Bearer ${TOKEN_PADRAO}` } });
    const d = await r.json().catch(() => ({}));
    return r.ok && d?.id ? (appIdCache = String(d.id)) : null;
}

async function graph(caminho: string, token: string, init: RequestInit = {}) {
    const r = await fetch(`${GRAPH}${caminho}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    const dados = await r.json().catch(() => ({}));
    return { ok: r.ok, dados };
}

const mensagemErro = (dados: any) => String(dados?.error?.error_user_msg || dados?.error?.message || "erro desconhecido");

async function adminValido(usuario: unknown, senhaHash: unknown): Promise<boolean> {
    if (typeof usuario !== "string" || typeof senhaHash !== "string" || !usuario || !/^[0-9a-f]{64}$/.test(senhaHash)) return false;
    const { data } = await supabaseAdmin.from("usuarios_crm").select("id")
        .eq("nome", usuario).eq("senha_hash", senhaHash).eq("eh_admin", true).eq("ativo", true).maybeSingle();
    return !!data;
}

async function registrar(filial: string, acao: string, autor: string, detalhes: Record<string, unknown>) {
    await supabaseAdmin.from("log_atividade").insert({ filial, acao, autor, pessoa_ids: [], detalhes }).then(() => {}, () => {});
}

/** Pede contatos e histórico do app (cada um só uma vez por conexão). Devolve o que não deu certo. */
async function pedirSincronizacao(filial: string, phoneNumberId: string, token: string) {
    const erros: string[] = [];
    const agora = new Date().toISOString();
    const mudancas: Record<string, unknown> = {};
    for (const [tipo, coluna] of [["smb_app_state_sync", "contatos_sincronizacao_em"], ["history", "historico_sincronizacao_em"]] as const) {
        const r = await graph(`/${phoneNumberId}/smb_app_data`, token, {
            method: "POST",
            body: JSON.stringify({ messaging_product: "whatsapp", sync_type: tipo }),
        });
        if (r.ok) mudancas[coluna] = agora;
        else erros.push(`${tipo === "history" ? "Histórico" : "Contatos"}: ${mensagemErro(r.dados)}`);
    }
    mudancas.ultimo_erro = erros.length ? erros.join(" · ") : null;
    mudancas.atualizado_em = agora;
    await supabaseAdmin.from("whatsapp_conexoes").update(mudancas).eq("filial", filial);
    return erros;
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return json({ ok: false, erro: "Use POST." }, 405);

    let corpo: any;
    try { corpo = await req.json(); } catch { return json({ ok: false, erro: "JSON inválido." }, 400); }
    const acao = String(corpo?.acao || "");

    if (acao === "config") {
        return json({ ok: true, appId: await appId(), configId: CONFIG_ID || null, graphVersion: GRAPH_VERSION });
    }

    const filial = typeof corpo.filial === "string" ? corpo.filial.trim() : "";
    if (!filial) return json({ ok: false, erro: "Informe a filial." }, 400);
    if (!(await adminValido(corpo.usuario, corpo.senhaHash))) {
        return json({ ok: false, erro: "Só um administrador do CRM, com a senha, pode mexer na conexão do WhatsApp." }, 403);
    }
    const autor = String(corpo.usuario);
    const { data: filialRow } = await supabaseAdmin.from("filiais").select("nome").eq("nome", filial).maybeSingle();
    if (!filialRow) return json({ ok: false, erro: "Filial não encontrada." }, 404);

    if (acao === "conectar") {
        const code = String(corpo.code || "");
        let wabaId = String(corpo.wabaId || "");
        let phoneNumberId = String(corpo.phoneNumberId || "");
        if (!code) return json({ ok: false, erro: "Faltou o código devolvido pela Meta." }, 400);
        const idApp = await appId();
        if (!idApp || !APP_SECRET) return json({ ok: false, erro: "App da Meta sem id ou segredo configurado no servidor." }, 500);

        // 1. Código -> token da escola.
        const troca = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({ client_id: idApp, client_secret: APP_SECRET, code }));
        const trocaDados = await troca.json().catch(() => ({}));
        const token: string | undefined = trocaDados?.access_token;
        if (!troca.ok || !token) return json({ ok: false, erro: "A Meta não aceitou o código: " + mensagemErro(trocaDados) }, 400);

        // Sem o id da conta no retorno da tela, procura nas contas que o token enxerga.
        if (!wabaId) {
            const contas = await graph(`/debug_token?input_token=${encodeURIComponent(token)}`, token);
            const escopo = (contas.dados?.data?.granular_scopes || []).find((s: any) => s.scope === "whatsapp_business_management");
            wabaId = String(escopo?.target_ids?.[0] || "");
        }
        if (!wabaId) return json({ ok: false, erro: "Não foi possível descobrir a conta do WhatsApp da escola." }, 400);

        // 2. O número precisa ser daquela conta.
        const numeros = await graph(`/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type,is_on_biz_app`, token);
        if (!numeros.ok) return json({ ok: false, erro: "Não consegui ler os números da conta: " + mensagemErro(numeros.dados) }, 400);
        const lista: any[] = numeros.dados?.data || [];
        const numero = phoneNumberId ? lista.find((n) => String(n.id) === phoneNumberId) : (lista.length === 1 ? lista[0] : null);
        if (!numero) return json({ ok: false, erro: "O número escolhido não está nesta conta do WhatsApp." }, 400);
        phoneNumberId = String(numero.id);

        const { data: outra } = await supabaseAdmin.from("whatsapp_conexoes").select("filial")
            .eq("phone_number_id", phoneNumberId).neq("filial", filial).maybeSingle();
        if (outra) return json({ ok: false, erro: `Este número já está conectado à filial ${outra.filial}.` }, 409);

        // 3. App do CRM inscrito na conta da escola: as mensagens passam a chegar no whatsapp-webhook.
        const inscricao = await graph(`/${wabaId}/subscribed_apps`, token, {
            method: "POST", body: JSON.stringify({ override_callback_uri: WEBHOOK_CRM, verify_token: VERIFY_TOKEN }),
        });
        if (!inscricao.ok) return json({ ok: false, erro: "Não consegui ligar o recebimento de mensagens: " + mensagemErro(inscricao.dados) }, 400);

        // 4. Guarda a conexão. Uso no CRM sempre começa desligado.
        const coexistencia = numero.is_on_biz_app === true || corpo.coexistencia === true;
        const { error } = await supabaseAdmin.from("whatsapp_conexoes").upsert({
            filial, waba_id: wabaId, phone_number_id: phoneNumberId, business_id: corpo.businessId ? String(corpo.businessId) : null,
            numero_exibicao: numero.display_phone_number || null, nome_verificado: numero.verified_name || null,
            coexistencia, token_cifrado: await cifrarToken(token), estado: "conectado", usar_no_crm: false,
            contatos_sincronizacao_em: null, historico_sincronizacao_em: null, historico_progresso: null, ultimo_erro: null,
            conectado_em: new Date().toISOString(), conectado_por: autor, desconectado_em: null, atualizado_em: new Date().toISOString(),
        }, { onConflict: "filial" });
        if (error) return json({ ok: false, erro: "Não consegui guardar a conexão: " + error.message }, 500);
        esquecerCacheNumeros();

        // 5. Contatos e histórico do app (prazo de 24 h; só faz sentido em coexistência).
        const erros = coexistencia ? await pedirSincronizacao(filial, phoneNumberId, token) : [];
        await registrar(filial, "whatsapp_oficial_conectado", autor, { numero: numero.display_phone_number, waba_id: wabaId, coexistencia, erros_sincronizacao: erros });
        return json({ ok: true, numero: numero.display_phone_number, nome: numero.verified_name, coexistencia, errosSincronizacao: erros });
    }

    const { data: conexao } = await supabaseAdmin.from("whatsapp_conexoes").select("*").eq("filial", filial).maybeSingle();
    if (!conexao) return json({ ok: false, erro: "Esta filial ainda não conectou o WhatsApp." }, 404);

    if (acao === "usar_no_crm") {
        const ligar = corpo.ligar === true;
        if (ligar && conexao.estado !== "conectado") return json({ ok: false, erro: "Reconecte o WhatsApp antes de usar no CRM." }, 409);
        await supabaseAdmin.from("whatsapp_conexoes").update({ usar_no_crm: ligar, atualizado_em: new Date().toISOString() }).eq("filial", filial);
        await registrar(filial, ligar ? "whatsapp_oficial_uso_ligado" : "whatsapp_oficial_uso_desligado", autor, { numero: conexao.numero_exibicao });
        return json({ ok: true, usarNoCrm: ligar });
    }

    if (acao === "sincronizar") {
        if (!conexao.token_cifrado || conexao.estado !== "conectado") return json({ ok: false, erro: "Conexão sem token ativo." }, 409);
        const erros = await pedirSincronizacao(filial, conexao.phone_number_id, await decifrarToken(conexao.token_cifrado));
        return json({ ok: erros.length === 0, erros });
    }

    if (acao === "desconectar") {
        // Para de receber e de enviar pelo CRM. O número continua normal no app do celular; para tirá-lo da plataforma
        // da Meta de vez, a escola usa Configurações > Conta > Plataforma Business > Desconectar no próprio app.
        if (conexao.token_cifrado) {
            const token = await decifrarToken(conexao.token_cifrado).catch(() => "");
            if (token) await graph(`/${conexao.waba_id}/subscribed_apps`, token, { method: "DELETE" }).catch(() => null);
        }
        await supabaseAdmin.from("whatsapp_conexoes").update({
            estado: "desconectado", usar_no_crm: false, token_cifrado: null,
            desconectado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
        }).eq("filial", filial);
        esquecerCacheNumeros();
        await registrar(filial, "whatsapp_oficial_desconectado", autor, { numero: conexao.numero_exibicao });
        return json({ ok: true });
    }

    return json({ ok: false, erro: "Ação desconhecida." }, 400);
});

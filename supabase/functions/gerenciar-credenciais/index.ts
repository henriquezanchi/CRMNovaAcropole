// Edge Function: guarda (só ESCRITA, nunca leitura) as credenciais dos
// sistemas de terceiros usados pelo futuro scraper (Ulisses de cada
// filial, Mercúrio) — cifradas com pgcrypto direto no banco
// (migracao_credenciais_scraper.sql), nunca em texto puro.
//
// Chamada pelo frontend (tela "Configurar Login Automático" na aba
// Importar) via `supabaseClient.functions.invoke('gerenciar-credenciais', {...})`.
// Mantém a verificação de JWT padrão (só o próprio frontend chama esta
// function, diferente do webhook do WhatsApp) — mesmo assim, quem decide
// se pode gravar aqui é o Postgres (só o service_role tem EXECUTE na
// função salvar_credencial_scraper), não esta function sozinha.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const CREDENCIAIS_SCRAPER_CHAVE = Deno.env.get("CREDENCIAIS_SCRAPER_CHAVE");

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

    if (!CREDENCIAIS_SCRAPER_CHAVE) {
        return json({ ok: false, erro: "CREDENCIAIS_SCRAPER_CHAVE não configurada — rode: supabase secrets set CREDENCIAIS_SCRAPER_CHAVE=<uma-senha-forte-qualquer>" }, 500);
    }

    let corpo: { sistema?: string; filial?: string; usuario?: string; senha?: string; adminNome?: string; adminSenha?: string };
    try {
        corpo = await req.json();
    } catch {
        return json({ ok: false, erro: "corpo inválido (esperado JSON)" }, 400);
    }

    const { sistema, usuario, senha } = corpo;
    let filial = corpo.filial;

    // Só um ADMINISTRADOR do CRM pode trocar senhas do cofre. A chave pública
    // do navegador sozinha não basta (antes, qualquer um com ela trocava a
    // senha do Mercúrio/Ulisses e sabotava as sincronizações). A senha do
    // admin vem em texto e é conferida aqui pelo hash; ter só o hash, que é
    // legível no banco, não permite passar por esta checagem.
    const tokenRecebido = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const ehServidor = tokenRecebido !== "" && tokenRecebido === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!ehServidor) {
        const adminNome = String(corpo.adminNome || "").trim();
        const adminSenha = String(corpo.adminSenha || "");
        if (!adminNome || !adminSenha) return json({ ok: false, erro: "Informe sua senha de administrador do CRM para salvar." }, 200);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(adminSenha))))
            .map((x) => x.toString(16).padStart(2, "0")).join("");
        const { data: admin } = await supabaseAdmin.from("usuarios_crm")
            .select("id").eq("nome", adminNome).eq("senha_hash", hash).eq("eh_admin", true).eq("ativo", true).maybeSingle();
        if (!admin) return json({ ok: false, erro: "Senha de administrador incorreta (ou usuário sem permissão de admin)." }, 200);
    }

    // "crm_acesso" foi adicionado depois (migracao_credenciais_scraper_crm_acesso.sql
    // alargou a constraint no banco), mas essa checagem aqui nunca tinha
    // sido atualizada — bug real, achado nesta sessão: o botão "Salvar" do
    // bloco "CRM Publicado" sempre retornava esse erro, nunca chegou a
    // gravar nada.
    if (sistema !== "ulisses" && sistema !== "mercurio" && sistema !== "mercurio_http" && sistema !== "crm_acesso" && sistema !== "ulisses_api") {
        return json({ ok: false, erro: "sistema precisa ser 'ulisses', 'mercurio', 'mercurio_http', 'crm_acesso' ou 'ulisses_api'" }, 400);
    }
    if (!senha || senha.trim() === "") {
        return json({ ok: false, erro: "senha é obrigatória" }, 400);
    }
    if (sistema === "ulisses" && (!filial || filial.trim() === "")) {
        return json({ ok: false, erro: "filial é obrigatória para o Ulisses (cada filial tem uma senha diferente)" }, 400);
    }
    // Mercúrio (e a autenticação HTTP básica dele), o portão do CRM
    // publicado e a API oficial do Ulisses (client_id/client_secret M2M,
    // 1 aplicação só no Auth0 deles) são credenciais únicas,
    // compartilhadas/globais — ignora qualquer filial que venha no corpo
    // e força o valor global fixo.
    if (sistema === "mercurio" || sistema === "mercurio_http" || sistema === "crm_acesso" || sistema === "ulisses_api") filial = "GLOBAL";

    const { error } = await supabaseAdmin.rpc("salvar_credencial_scraper", {
        p_sistema: sistema,
        p_filial: filial,
        p_usuario: usuario || null,
        p_senha: senha,
        p_chave: CREDENCIAIS_SCRAPER_CHAVE,
    });

    if (error) {
        console.error("Erro ao salvar credencial:", error);
        return json({ ok: false, erro: error.message }, 500);
    }

    return json({ ok: true });
});

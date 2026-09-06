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

    let corpo: { sistema?: string; filial?: string; usuario?: string; senha?: string };
    try {
        corpo = await req.json();
    } catch {
        return json({ ok: false, erro: "corpo inválido (esperado JSON)" }, 400);
    }

    const { sistema, usuario, senha } = corpo;
    let filial = corpo.filial;

    if (sistema !== "ulisses" && sistema !== "mercurio") {
        return json({ ok: false, erro: "sistema precisa ser 'ulisses' ou 'mercurio'" }, 400);
    }
    if (!senha || senha.trim() === "") {
        return json({ ok: false, erro: "senha é obrigatória" }, 400);
    }
    if (sistema === "ulisses" && (!filial || filial.trim() === "")) {
        return json({ ok: false, erro: "filial é obrigatória para o Ulisses (cada filial tem uma senha diferente)" }, 400);
    }
    // Mercúrio é uma senha só, compartilhada entre as filiais — ignora
    // qualquer filial que venha no corpo e força o valor global fixo.
    if (sistema === "mercurio") filial = "GLOBAL";

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

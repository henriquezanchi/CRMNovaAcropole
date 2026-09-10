// Edge Function: monta e manda pro WhatsApp do CHEFE DE FILIAL um resumo
// AGREGADO do trabalho da semana (últimos 7 dias) — pedido do usuário:
// "implementar o envio de resumo das conversas para o chefe da filial de
// forma geral (mandar o resumo do trabalho da semana, apontando quais os
// leads foram contatados, e qual o resultado de cada contato) ao invés
// de um resumo individual".
//
// Fonte dos dados: log_atividade (auditoria durável já existente, ver
// migracao_log_atividade.sql) — cada lead "tocado" nos últimos 7 dias
// (moveu de coluna, ganhou/perdeu tag, foi mesclado) entra na lista, com
// o estado ATUAL dele (coluna do funil + tags) como "resultado".
//
// Dois modos de chamada:
//   - { filial: "X" }  → processa só essa filial (botão manual no CRM).
//   - {} (sem filial)  → processa TODAS as filiais que têm
//     whatsapp_chefe_numero configurado (pensado pro pg_cron semanal).
//
// Reaproveita a Edge Function whatsapp-notificar-chefe-filial (já resolve
// o número do chefe a partir da filial, nunca exposto ao navegador) via
// chamada server-a-server, em vez de duplicar a lógica de envio.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const DIAS_JANELA = 7;
const LIMITE_LEADS_NA_MENSAGEM = 40;
const ACOES_RELEVANTES = ["mover_lead", "tag_adicionar", "tag_remover", "tag_massa", "mesclar_leads"];

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

async function montarResumoDaFilial(filial: string): Promise<string | null> {
    const desde = new Date(Date.now() - DIAS_JANELA * 24 * 60 * 60 * 1000).toISOString();

    const { data: entradas, error: erroLog } = await supabaseAdmin
        .from("log_atividade")
        .select("pessoa_ids, acao")
        .eq("filial", filial)
        .gte("criado_em", desde)
        .in("acao", ACOES_RELEVANTES);
    if (erroLog) throw new Error(`log_atividade: ${erroLog.message}`);

    const idsTocados = new Set<string>();
    (entradas || []).forEach((e) => {
        (Array.isArray(e.pessoa_ids) ? e.pessoa_ids : []).forEach((id: unknown) => idsTocados.add(String(id)));
    });
    if (idsTocados.size === 0) return null;

    const { data: leads, error: erroLeads } = await supabaseAdmin
        .from("leads_inscricoes")
        .select('pessoaIdentificador, pessoaNome, tags, funil_agencia')
        .in("pessoaIdentificador", [...idsTocados]);
    if (erroLeads) throw new Error(`leads_inscricoes: ${erroLeads.message}`);
    if (!leads || leads.length === 0) return null;

    const linhas = leads.slice(0, LIMITE_LEADS_NA_MENSAGEM).map((l) => {
        let tags: string[] = [];
        try { tags = typeof l.tags === "string" ? JSON.parse(l.tags) : (l.tags || []); } catch { /* ignora */ }
        const tagsTxt = tags.filter((t) => t && t.trim()).join(", ");
        return `• ${l.pessoaNome || "Lead sem nome"} — coluna: ${l.funil_agencia || "?"}${tagsTxt ? ` (${tagsTxt})` : ""}`;
    });

    const restante = leads.length - linhas.length;
    const rodape = restante > 0 ? `\n...e mais ${restante} lead(s).` : "";

    return `📊 *Resumo semanal — ${filial}*\n${leads.length} lead(s) contatado(s)/atualizado(s) nos últimos ${DIAS_JANELA} dias:\n\n${linhas.join("\n")}${rodape}`;
}

async function enviarParaChefe(filial: string, texto: string) {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-notificar-chefe-filial`;
    const resp = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ filial, texto }),
    });
    return resp.json();
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;

    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    let corpoReq: { filial?: string };
    try {
        corpoReq = await req.json().catch(() => ({}));
    } catch {
        corpoReq = {};
    }

    const filiaisAlvo: string[] = [];
    if (corpoReq.filial) {
        filiaisAlvo.push(corpoReq.filial);
    } else {
        const { data: filiais, error } = await supabaseAdmin
            .from("filiais")
            .select("nome")
            .not("whatsapp_chefe_numero", "is", null)
            .eq("ativo", true);
        if (error) return json({ ok: false, erro: "erro_buscar_filiais", detalhe: error.message }, 500);
        (filiais || []).forEach((f) => filiaisAlvo.push(f.nome));
    }

    const resultados: Record<string, unknown> = {};
    for (const filial of filiaisAlvo) {
        try {
            const texto = await montarResumoDaFilial(filial);
            if (!texto) { resultados[filial] = { ok: true, semAtividade: true }; continue; }
            resultados[filial] = await enviarParaChefe(filial, texto);
        } catch (e) {
            resultados[filial] = { ok: false, erro: String(e instanceof Error ? e.message : e) };
        }
    }

    return json({ ok: true, resultados });
});

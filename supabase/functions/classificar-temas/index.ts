// Edge Function: classifica nomes de evento em "temas" (ex: "Estoicismo",
// "Mitologia", "Desenvolvimento Pessoal") usando a Anthropic Messages API,
// e grava o resultado em temas_eventos pra nunca precisar reclassificar o
// mesmo evento de novo (cache compartilhado entre filiais/importações).
//
// Chamada pelo frontend (js/importador.js) via
// `supabaseClient.functions.invoke('classificar-temas', {...})` só com os
// nomes de evento que AINDA não existem em temas_eventos — quem chama já
// filtrou o que já está cacheado.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODELO = "claude-haiku-4-5-20251001"; // rápido e barato, adequado pra classificação

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

// Mesma normalização usada em js/importador.js (normalizarNomeImport) —
// precisa bater exatamente pra o cache funcionar.
function normalizarNomeEvento(nome: string): string {
    const SEM_ACENTO = new RegExp("[\\u0300-\\u036f]", "g"); // mesmo intervalo Unicode usado em normalizarNomeImport() (js/importador.js)
    return nome
        .normalize("NFD").replace(SEM_ACENTO, "")
        .toUpperCase()
        .replace(/\s+/g, " ")
        .trim();
}

function montarPrompt(eventos: string[]): string {
    return `Você é um classificador de eventos de uma escola de filosofia (Nova Acrópole). Recebe uma lista de nomes de eventos (palestras, cursos, oficinas, workshops, mostras etc.) e deve agrupá-los em TEMAS concisos e reutilizáveis (ex: "Filosofia Antiga", "Estoicismo", "Mitologia", "Arte e Cultura", "Desenvolvimento Pessoal", "Introdução à Filosofia", "Meditação e Autoconhecimento").

Regras:
- Reaproveite o MESMO tema para eventos claramente relacionados, mesmo que os nomes sejam um pouco diferentes entre si.
- O tema deve ser curto (2 a 4 palavras), em português, e NÃO deve incluir o tipo do evento (não escreva "Palestra", "Curso", "Oficina" etc no tema — isso já é classificado separadamente por outro processo).
- Se não conseguir identificar um tema claro a partir do nome, use "Geral".
- Responda para TODOS os eventos da lista, usando o nome exatamente como foi dado (não corrija nem abrevie).

Responda SOMENTE com um JSON válido, sem nenhum texto antes ou depois, no formato exato:
{"nome exato do evento 1": "Tema 1", "nome exato do evento 2": "Tema 2"}

Eventos (um por linha):
${eventos.join("\n")}`;
}

function extrairJSON(texto: string): Record<string, string> {
    // O modelo às vezes envolve a resposta em ```json ... ``` mesmo quando
    // instruído a não fazer isso — remove antes de parsear.
    const limpo = texto.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(limpo);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Resposta da IA não é um objeto JSON.");
    }
    return parsed;
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;

    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    let corpoReq: { eventos?: string[] };
    try {
        corpoReq = await req.json();
    } catch {
        return json({ ok: false, erro: "json_invalido" }, 400);
    }

    const eventos = Array.from(new Set((corpoReq.eventos || []).map((e) => String(e || "").trim()).filter(Boolean)));
    if (eventos.length === 0) return json({ ok: true, mapa: {} });

    let respIA: Response;
    let dataIA: any;
    try {
        respIA = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: MODELO,
                max_tokens: 4096,
                messages: [{ role: "user", content: montarPrompt(eventos) }],
            }),
        });
        dataIA = await respIA.json();
    } catch (e) {
        return json({ ok: false, erro: "falha_rede_ia", detalhe: String(e) }, 502);
    }

    if (!respIA.ok) {
        return json({ ok: false, erro: "erro_ia", detalhe: dataIA?.error }, 200);
    }

    let mapa: Record<string, string>;
    try {
        const textoResposta = dataIA.content?.[0]?.text ?? "";
        mapa = extrairJSON(textoResposta);
    } catch (e) {
        return json({ ok: false, erro: "resposta_ia_invalida", detalhe: String(e) }, 200);
    }

    // Grava no cache (upsert por evento_nome_normalizado) — melhor esforço:
    // uma falha ao gravar não deve impedir de devolver o mapa pro frontend
    // aplicar nesta importação mesmo assim.
    const linhas = Object.entries(mapa).map(([nomeOriginal, tema]) => ({
        evento_nome_normalizado: normalizarNomeEvento(nomeOriginal),
        evento_nome_original: nomeOriginal,
        tema: String(tema || "Geral").trim() || "Geral",
    }));
    if (linhas.length > 0) {
        const { error } = await supabaseAdmin.from("temas_eventos").upsert(linhas, { onConflict: "evento_nome_normalizado" });
        if (error) console.error("Erro ao gravar temas_eventos:", error);
    }

    return json({ ok: true, mapa });
});

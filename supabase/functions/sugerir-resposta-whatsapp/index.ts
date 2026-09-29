// Edge Function: sugerir-resposta-whatsapp — pedido do usuário
// (2026-09-29): "Crie uma sugestão de resposta com IA para cada lead que
// respondeu (eu preciso autorizar o envio dessa sugestão). Permita
// habilitar ou desabilitar essa função por conversa, e também por
// filial".
//
// Mesmo princípio de sempre (ia-diagnostico-saude/ia-recomendar-contatos/
// classificar-resposta-convite): a DETECÇÃO de quem tem resposta pra
// sugerir é 100% regra fixa em SQL
// (mensagens_candidatas_sugestao_resposta(),
// migracao_rpc_candidatas_sugestao_resposta.sql, já respeitando o toggle
// habilitar/desabilitar por conversa/filial) — a IA só ESCREVE o texto.
// NUNCA envia sozinha — só grava com status='pendente'; o SDR revisa e
// autoriza o envio (js/whatsapp.js, card acima da caixa de texto do
// WhatsApp Unificado).
//
// Diferença pra classificar-resposta-convite: aquela é escopada a quem
// tem CONVITE DE EVENTO pendente (categoriza confirmou/recusou/etc.);
// esta cobre QUALQUER resposta recebida, sem categoria fixa nem tocar em
// evento_leads — só um rascunho de resposta humanizada. Pra evitar 2
// sugestões concorrentes na mesma mensagem, esta pula quem já tem uma
// classificação de convite gravada pra essa mesma mensagem (a
// específica já cobre esse caso, com mais contexto de evento).
//
// Chamada por pg_cron a cada 15 min (migracao_agendamento_sugestao_resposta.sql).
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODELO = "claude-haiku-4-5-20251001";
const LIMITE_HISTORICO = 6;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Candidata = { mensagem_id: number; pessoaIdentificador: string; corpo_texto: string; filial: string | null };

async function montarContexto(pessoaIdentificador: string): Promise<string> {
    const { data } = await supabaseAdmin
        .from("mensagens_whatsapp")
        .select("direcao, corpo_texto, tipo")
        .eq("pessoaIdentificador", pessoaIdentificador)
        .order("criado_em", { ascending: false })
        .limit(LIMITE_HISTORICO);
    const msgs = (data || []).reverse();
    return msgs.map((m: any) => `${m.direcao === "entrada" ? "Lead" : "Escola"}: ${m.tipo === "texto" ? m.corpo_texto : `[${m.tipo}]`}`).join("\n");
}

function montarPrompt(contexto: string, ultimaMensagem: string): string {
    return `Você ajuda o time de atendimento de uma escola de filosofia (Nova Acrópole) a responder mensagens de WhatsApp de leads/alunos, de forma humanizada.

Histórico recente da conversa (mais antiga primeiro):
${contexto}

A última mensagem do lead (a que precisa de resposta agora) foi: "${ultimaMensagem}"

Escreva um rascunho de resposta em português, curto (1-4 frases), caloroso, natural — NUNCA robótico, NUNCA insistente/vendedor logo de cara. Regras:
- Responda diretamente ao que a pessoa disse/perguntou, usando o histórico só como contexto.
- NUNCA invente fato concreto que você não tem certeza (endereço, valor, data, nome de evento específico, horário) — se a pergunta exigir um dado desses, só reconheça a pergunta e diga que alguém vai confirmar em breve.
- Se a mensagem for só um agradecimento/despedida, uma resposta breve e cordial já basta.
- Se não der pra saber o que responder com confiança (mensagem ambígua, fora de contexto, ou perigosa de responder sem saber mais), devolva "sugestao": null — não force um texto.

Responda SOMENTE com um JSON válido, sem texto antes ou depois, no formato exato: {"sugestao": "..." ou null}`;
}

async function sugerirUma(contexto: string, ultimaMensagem: string): Promise<{ sugestao: string | null; erro?: string; debugBruto?: string }> {
    if (!ANTHROPIC_API_KEY) return { sugestao: null, erro: "sem_anthropic_api_key" };
    let bruto = "";
    try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({ model: MODELO, max_tokens: 400, messages: [{ role: "user", content: montarPrompt(contexto, ultimaMensagem) }] }),
        });
        const respText = await resp.text();
        if (!resp.ok) return { sugestao: null, erro: "resp_nao_ok: " + respText, debugBruto: respText };
        const data = JSON.parse(respText);
        bruto = String(data.content?.[0]?.text ?? "");
        const texto = bruto.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(texto);
        const sugestao = typeof parsed?.sugestao === "string" && parsed.sugestao.trim() ? parsed.sugestao.trim() : null;
        return { sugestao, debugBruto: bruto };
    } catch (e) {
        return { sugestao: null, erro: String(e), debugBruto: bruto };
    }
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    const url = new URL(req.url);
    const modoDebug = url.searchParams.get("debug") === "1";

    const { data: candidatas, error } = await supabaseAdmin.rpc("mensagens_candidatas_sugestao_resposta", { p_limite: modoDebug ? 3 : 30 });
    if (error) return json({ ok: false, erro: "falha_buscar_candidatas", detalhe: error.message }, 500);
    if (!candidatas || candidatas.length === 0) return json({ ok: true, processadas: 0 });

    // Pula quem já tem uma classificação de convite pra ESTA mensagem —
    // aquele fluxo já cobre com mais contexto (nome/data do evento);
    // evita 2 sugestões concorrentes pro mesmo lead ao mesmo tempo.
    const idsMsg = (candidatas as Candidata[]).map((c) => c.mensagem_id);
    const { data: jaClassificadas } = await supabaseAdmin
        .from("classificacoes_resposta_convite")
        .select("mensagem_origem_id")
        .in("mensagem_origem_id", idsMsg);
    const setJaClassificadas = new Set((jaClassificadas || []).map((r: any) => r.mensagem_origem_id));

    if (modoDebug) {
        const resultadosDebug = [];
        for (const item of candidatas as Candidata[]) {
            if (setJaClassificadas.has(item.mensagem_id)) continue;
            const contexto = await montarContexto(item.pessoaIdentificador);
            resultadosDebug.push({ corpo_texto: item.corpo_texto, ...(await sugerirUma(contexto, item.corpo_texto)) });
        }
        return json({ ok: true, debug: resultadosDebug });
    }

    let processadas = 0;
    for (const item of candidatas as Candidata[]) {
        if (setJaClassificadas.has(item.mensagem_id)) continue;

        const contexto = await montarContexto(item.pessoaIdentificador);
        const resultado = await sugerirUma(contexto, item.corpo_texto);
        if (resultado.erro) console.warn("Sugestão não gerada (fallback sem texto):", resultado.erro);

        const { error: erroInsert } = await supabaseAdmin.from("sugestoes_resposta_wpp").insert({
            pessoaIdentificador: item.pessoaIdentificador,
            mensagem_origem_id: item.mensagem_id,
            sugestao_resposta: resultado.sugestao,
        });
        // unique(mensagem_origem_id) — corrida com outra execução do
        // cron falha o insert (23505) e segue pra próxima, sem duplicar.
        if (erroInsert) { console.warn("Não gravou sugestão (provável corrida):", erroInsert.message); continue; }
        processadas++;
    }

    return json({ ok: true, processadas });
});

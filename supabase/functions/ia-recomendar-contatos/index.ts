// Edge Function: "Recomendações de Contato (IA)" — pedido do usuário
// (2026-09-21): "avaliar as melhores tarefas por filial e por SDR, no
// sentido de converter em matrículas... inteligente em relação ao
// planejamento de contato, para que o contato em si seja humanizado".
//
// Diferente de `ia-diagnostico-saude`, esta function NÃO faz nenhuma
// consulta ao banco — quem decide QUEM contatar (a lista de leads e por
// que eles são prioritários) é o FRONTEND (js/tarefas.js), reaproveitando
// a MESMA lógica de ranking já usada em "50 Leads Prioritários"
// (js/visao-geral.js: rankLeadForte/Jornada/Abertura de Turma/SLA — 100%
// determinística, sem IA). Aqui a IA só recebe os sinais JÁ CALCULADOS de
// cada lead e escreve, por lead:
// - "motivo": por que ele está nesta lista (1 frase, factual, só com o
//   que foi dado — nunca inventa evento/tag que não veio no payload).
// - "abordagem": uma sugestão de abertura de conversa curta, calorosa e
//   NÃO agressiva/vendedora — é o "humanizado" pedido — sempre grounded
//   nos sinais recebidos (ex: menciona o evento específico se foi dado).
//
// Mesmo padrão de `classificar-temas`: recebe dados já filtrados pelo
// frontend, chama a Anthropic API, devolve JSON. Quem GRAVA (Tarefa,
// abordagem_sugerida do lead, log_atividade) é o frontend depois.
import { corsHeaders, handleCors } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODELO = "claude-haiku-4-5-20251001";

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

type LeadSinal = {
    pessoaIdentificador: string;
    nome: string;
    sinais: Record<string, unknown>;
};

function montarPrompt(leads: LeadSinal[]): string {
    return `Você ajuda SDRs (vendedores) de uma escola de filosofia (Nova Acrópole) a planejar contatos com leads, de forma HUMANIZADA — o objetivo é converter em matrícula, mas SEM parecer um script robótico ou insistente. Recebe uma lista de leads já priorizados (a priorização, por regra fixa, já foi feita — não é sua tarefa reavaliar isso), cada um com os sinais que o tornam prioritário agora.

Para CADA lead da lista, escreva:
- "motivo": 1 frase curta e factual, em português, explicando por que contatar esta pessoa AGORA (baseado SÓ nos sinais dados — ex: inscrição futura numa turma, tempo parado sem contato, nível de interesse).
- "abordagem": uma sugestão de MENSAGEM DE ABERTURA curta (1-2 frases), em tom caloroso, pessoal e nada insistente — cite o contexto real do lead quando fizer sentido (ex: o evento que ele frequentou, se veio nos sinais), nunca invente um evento/detalhe que não foi dado. Nunca comece com "Olá, tudo bem?" genérico — seja específico ao contexto da pessoa. Nunca pressione por matrícula na abertura, é só o primeiro contato.

Regras importantes:
- NUNCA invente nome de evento, data, ou qualquer fato que não esteja nos sinais fornecidos.
- Se os sinais forem escassos, prefira uma abordagem mais genérica (mas ainda calorosa) a inventar contexto.
- Responda SOMENTE com um array JSON válido, na MESMA ORDEM da lista recebida, sem texto antes ou depois, no formato: [{"motivo": "...", "abordagem": "..."}, ...]

Leads (JSON, um objeto por pessoa, na ordem em que a resposta deve vir):
${JSON.stringify(leads.map((l) => ({ nome: l.nome, sinais: l.sinais })))}`;
}

function extrairJSONArray(texto: string): any[] {
    const limpo = texto.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(limpo);
    if (!Array.isArray(parsed)) throw new Error("Resposta da IA não é um array JSON.");
    return parsed;
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;

    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    let corpo: { leads?: LeadSinal[] };
    try {
        corpo = await req.json();
    } catch {
        return json({ ok: false, erro: "json_invalido" }, 400);
    }

    const leads = (corpo.leads || []).filter((l) => l && l.pessoaIdentificador);
    if (leads.length === 0) return json({ ok: true, recomendacoes: [] });
    if (leads.length > 40) return json({ ok: false, erro: "muitos_leads_de_uma_vez_maximo_40" }, 400);

    try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: MODELO,
                max_tokens: 4096,
                messages: [{ role: "user", content: montarPrompt(leads) }],
            }),
        });
        const data = await resp.json();
        if (!resp.ok) return json({ ok: false, erro: "erro_ia", detalhe: data?.error }, 200);

        const textos = extrairJSONArray(data.content?.[0]?.text ?? "");
        if (textos.length !== leads.length) {
            return json({ ok: false, erro: "resposta_ia_tamanho_invalido" }, 200);
        }

        const recomendacoes = leads.map((l, i) => ({
            pessoaIdentificador: l.pessoaIdentificador,
            motivo: String(textos[i]?.motivo || "").trim() || "Lead prioritário (ver sinais).",
            abordagem: String(textos[i]?.abordagem || "").trim() || null,
        }));

        return json({ ok: true, recomendacoes });
    } catch (e) {
        return json({ ok: false, erro: "falha_rede_ia", detalhe: String(e) }, 502);
    }
});

// Edge Function: "Sugerir com IA" no bloco Resumo/Anotações da gaveta do
// lead — pedido do usuário (2026-09-30): "permita que a IA complemente o
// resumo que está lá, ou sugira a criação de um resumo".
//
// Mesmo padrão de ia-recomendar-contatos: NÃO consulta o banco — o
// FRONTEND (js/app.js) já junta o resumo atual + as últimas mensagens de
// WhatsApp do lead e manda tudo pronto; esta function só escreve. A
// sugestão NUNCA é salva sozinha — o botão "Usar esta sugestão" no
// frontend é sempre um passo manual (mesmo princípio de todo o resto do
// projeto: IA nunca decide/grava por conta própria).
import { corsHeaders, handleCors } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODELO = "claude-haiku-4-5-20251001";

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

type Mensagem = { direcao: "entrada" | "saida"; texto: string };

function montarPrompt(nomeLead: string, resumoAtual: string, mensagens: Mensagem[]): string {
    const conversa = mensagens.length > 0
        ? mensagens.map((m) => `${m.direcao === "entrada" ? nomeLead : "Atendente"}: ${m.texto}`).join("\n")
        : "(sem mensagens de WhatsApp carregadas)";

    if (resumoAtual.trim()) {
        return `Você ajuda uma equipe de SDR (vendedores) de uma escola de filosofia a manter anotações curtas e úteis sobre cada lead. Já existe um resumo escrito à mão sobre "${nomeLead}":

"""
${resumoAtual}
"""

Aqui estão as últimas mensagens reais de WhatsApp trocadas com essa pessoa:
"""
${conversa}
"""

Sua tarefa: sugerir um COMPLEMENTO curto (1-3 frases) pra esse resumo, com informação NOVA que apareceu na conversa e ainda não está anotada — nunca repita o que já está escrito, nunca invente fato que não veio na conversa. Se não houver nada novo relevante pra acrescentar, responda exatamente: SEM_NOVIDADE.

Responda SOMENTE com o texto do complemento (ou SEM_NOVIDADE), sem aspas, sem explicação, sem prefixo.`;
    }

    return `Você ajuda uma equipe de SDR (vendedores) de uma escola de filosofia a manter anotações curtas sobre cada lead. Não existe nenhum resumo escrito ainda sobre "${nomeLead}". Aqui estão as últimas mensagens reais de WhatsApp trocadas com essa pessoa:
"""
${conversa}
"""

Sua tarefa: escrever um resumo curto (2-4 frases), em português, só com fatos que realmente apareceram na conversa — nunca invente. Se não houver mensagens suficientes pra resumir nada de útil, responda exatamente: SEM_NOVIDADE.

Responda SOMENTE com o texto do resumo (ou SEM_NOVIDADE), sem aspas, sem explicação, sem prefixo.`;
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    let corpo: { nomeLead?: string; resumoAtual?: string; mensagens?: Mensagem[] };
    try {
        corpo = await req.json();
    } catch {
        return json({ ok: false, erro: "json_invalido" }, 400);
    }

    const nomeLead = (corpo.nomeLead || "esse lead").trim();
    const resumoAtual = corpo.resumoAtual || "";
    const mensagens = (corpo.mensagens || []).slice(-10); // últimas 10, suficiente pra contexto sem estourar o prompt

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
                max_tokens: 400,
                messages: [{ role: "user", content: montarPrompt(nomeLead, resumoAtual, mensagens) }],
            }),
        });
        const data = await resp.json();
        if (!resp.ok) return json({ ok: false, erro: "erro_ia", detalhe: data?.error }, 200);

        const texto = String(data.content?.[0]?.text ?? "").trim();
        if (!texto || texto.toUpperCase().includes("SEM_NOVIDADE")) {
            return json({ ok: true, sugestao: null });
        }
        return json({ ok: true, sugestao: texto });
    } catch (e) {
        return json({ ok: false, erro: "falha_rede_ia", detalhe: String(e) }, 502);
    }
});

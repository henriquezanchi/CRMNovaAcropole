// Edge Function: classificar-resposta-convite — pedido do usuário
// (2026-09-28, reunião com a Ediliene, Jardim América): "tratar as
// respostas dessas pessoas de maneira muito inteligente e muito
// dinâmica, de forma a reagrupar conforme a resposta, e disparar
// mensagens específicas para cada grupo de respostas".
//
// Mesmo princípio já seguido em ia-diagnostico-saude/ia-recomendar-contatos/
// classificar-temas: a DETECÇÃO de quem tem resposta pendente pra
// classificar é 100% regra fixa em SQL
// (mensagens_candidatas_classificacao_convite(),
// migracao_classificacao_respostas_convite.sql) — a IA NUNCA decide quem
// entra na lista, só escolhe entre um conjunto FIXO de categorias e
// escreve o texto de acompanhamento pra cada mensagem já selecionada.
//
// Chamada por pg_cron a cada 15 min
// (migracao_agendamento_classificacao_respostas.sql) — NUNCA pelo
// whatsapp-webhook: não queremos arriscar atrasar o 200 OK pra Meta com
// uma chamada de IA de 1-3s dentro do caminho crítico do webhook.
//
// Decisão confirmada com o usuário: NUNCA envia a sugestão sozinha — só
// grava categoria + texto sugerido com status='pendente'; o SDR revisa e
// clica "Enviar" no painel "Respostas de Convite pra Revisar" (Agenda do
// Dia, js/visao-geral.js).
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin, NOME_TABELA_LEADS } from "../_shared/supabaseAdmin.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODELO = "claude-haiku-4-5-20251001";
const CATEGORIAS_VALIDAS = ["confirmou", "nao_pode_ir", "pediu_informacao", "sem_interesse", "ambiguo"];

// Tag aplicada ao lead — família nova "Convite: X" (ver FAMILIAS_TAG,
// js/app.js). Sempre SUBSTITUI uma classificação de convite anterior
// (nunca acumula "Convite: X" velho se a pessoa responder de novo e
// mudar de categoria).
const ROTULO_TAG: Record<string, string> = {
    confirmou: "Convite: Confirmou",
    nao_pode_ir: "Convite: Não Pode Ir",
    pediu_informacao: "Convite: Pediu Informação",
    sem_interesse: "Convite: Sem Interesse",
    ambiguo: "Convite: Ambíguo",
};

// evento_leads.resposta_convite só é atualizado quando a categoria
// mapeia claramente pra confirmado/recusado — "pediu_informacao" e
// "ambiguo" deixam como estava (`pendente`), precisa de humano.
const MAPA_RESPOSTA_CONVITE: Record<string, string | null> = {
    confirmou: "confirmado",
    nao_pode_ir: "recusado",
    sem_interesse: "recusado",
    pediu_informacao: null,
    ambiguo: null,
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Candidata = {
    mensagem_id: number;
    pessoaIdentificador: string;
    corpo_texto: string;
    evento_id: number;
    evento_nome: string;
    evento_data: string;
};

function montarPrompt(item: Candidata): string {
    return `Você ajuda uma escola de filosofia (Nova Acrópole) a triar respostas de convites de evento pelo WhatsApp. Uma pessoa foi convidada pro evento "${item.evento_nome}" (${item.evento_data}) e respondeu a mensagem abaixo.

Classifique a resposta em EXATAMENTE UMA destas categorias (nunca invente uma categoria fora desta lista):
- "confirmou": confirma presença / tem interesse claro em ir.
- "nao_pode_ir": diz que não pode ir a ESTE evento especificamente (mas de forma neutra, sem recusar contato futuro).
- "pediu_informacao": pergunta algo prático (endereço, horário, valor, como chegar, etc.) — ainda não confirmou nem recusou.
- "sem_interesse": recusa/diz que não tem interesse, ou pede pra não ser contatado(a) de novo.
- "ambiguo": a mensagem não permite classificar com confiança (ex: só um cumprimento genérico, mensagem sem relação clara com o convite, ou de outro assunto).

Se tiver qualquer dúvida real, prefira "ambiguo" — nunca force uma categoria só pra escolher algo.

Além da categoria, escreva "sugestao_resposta": um rascunho de mensagem de acompanhamento em português, curto (2-4 frases), caloroso e natural (não robótico), pra um atendente humano revisar antes de enviar. Regras da sugestão:
- Se "nao_pode_ir": agradeça, e diga que vamos avisar sobre os PRÓXIMOS eventos (nunca invente nome/data de evento futuro específico).
- Se "pediu_informacao": só reconheça a pergunta e diga que alguém vai responder com os detalhes em breve (nunca invente o endereço/horário/valor de verdade).
- Se "sem_interesse": uma despedida breve e respeitosa, sem insistir.
- Se "confirmou": confirme o registro da presença dela com entusiasmo, sem inventar detalhe logístico novo.
- Se "ambiguo": deixe "sugestao_resposta" como null — não force um texto sem saber o que responder.
- NUNCA invente evento, data, endereço, valor, ou qualquer fato que não foi dado aqui.

Mensagem recebida: "${item.corpo_texto}"

Responda SOMENTE com um JSON válido, sem texto antes ou depois, no formato exato: {"categoria": "...", "sugestao_resposta": "..." ou null}`;
}

async function classificarUma(item: Candidata): Promise<{ categoria: string; sugestao_resposta: string | null; debugBruto?: string; debugErro?: string }> {
    if (!ANTHROPIC_API_KEY) return { categoria: "ambiguo", sugestao_resposta: null, debugErro: "sem_anthropic_api_key" };
    try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({ model: MODELO, max_tokens: 500, messages: [{ role: "user", content: montarPrompt(item) }] }),
        });
        const data = await resp.json();
        if (!resp.ok) return { categoria: "ambiguo", sugestao_resposta: null, debugErro: "resp_nao_ok: " + JSON.stringify(data?.error || data) };
        const bruto = String(data.content?.[0]?.text ?? "");
        const texto = bruto.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(texto);
        const categoria = CATEGORIAS_VALIDAS.includes(parsed?.categoria) ? parsed.categoria : "ambiguo";
        const sugestao = typeof parsed?.sugestao_resposta === "string" && parsed.sugestao_resposta.trim() ? parsed.sugestao_resposta.trim() : null;
        return { categoria, sugestao_resposta: categoria === "ambiguo" ? null : sugestao, debugBruto: bruto };
    } catch (e) {
        // JSON malformado, rede fora, etc — nunca trava a rotina, cai no
        // fallback mais seguro (precisa de revisão humana, sem sugestão).
        return { categoria: "ambiguo", sugestao_resposta: null, debugErro: String(e) };
    }
}

async function aplicarTagConvite(pessoaIdentificador: string, tagNova: string) {
    const { data: lead } = await supabaseAdmin.from(NOME_TABELA_LEADS).select("tags").eq("pessoaIdentificador", pessoaIdentificador).maybeSingle();
    if (!lead) return;
    let tags: string[] = [];
    try {
        const parsed = JSON.parse(lead.tags || "[]");
        if (Array.isArray(parsed)) tags = parsed;
    } catch { /* tags malformada — trata como vazia, nunca trava */ }
    tags = tags.filter((t) => !String(t).startsWith("Convite: "));
    tags.push(tagNova);
    await supabaseAdmin.from(NOME_TABELA_LEADS).update({ tags: JSON.stringify(tags) }).eq("pessoaIdentificador", pessoaIdentificador);
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    const url = new URL(req.url);
    const modoDebug = url.searchParams.get("debug") === "1";

    const { data: candidatas, error } = await supabaseAdmin.rpc("mensagens_candidatas_classificacao_convite", { p_limite: modoDebug ? 3 : 30 });
    if (error) return json({ ok: false, erro: "falha_buscar_candidatas", detalhe: error.message }, 500);
    if (!candidatas || candidatas.length === 0) return json({ ok: true, processadas: 0 });

    // Modo debug: NÃO grava nada no banco — só devolve o texto bruto da
    // IA (e qualquer erro de parsing) pra diagnosticar o formato real da
    // resposta, sem poluir classificacoes_resposta_convite com testes.
    if (modoDebug) {
        const resultadosDebug = [];
        for (const item of candidatas as Candidata[]) {
            resultadosDebug.push({ corpo_texto: item.corpo_texto, ...(await classificarUma(item)) });
        }
        return json({ ok: true, debug: resultadosDebug });
    }

    let processadas = 0;
    for (const item of candidatas as Candidata[]) {
        const resultado = await classificarUma(item);

        const { error: erroInsert } = await supabaseAdmin.from("classificacoes_resposta_convite").insert({
            pessoaIdentificador: item.pessoaIdentificador,
            evento_id: item.evento_id,
            mensagem_origem_id: item.mensagem_id,
            categoria: resultado.categoria,
            sugestao_resposta: resultado.sugestao_resposta,
        });
        // unique(mensagem_origem_id) — se 2 execuções do cron se
        // sobrepuserem, a 2ª simplesmente falha o insert (23505) e
        // segue pra próxima, sem duplicar nem travar a rotina.
        if (erroInsert) { console.warn("Não gravou classificação (provável corrida com outra execução):", erroInsert.message); continue; }
        processadas++;

        await aplicarTagConvite(item.pessoaIdentificador, ROTULO_TAG[resultado.categoria]);

        const novaResposta = MAPA_RESPOSTA_CONVITE[resultado.categoria];
        if (novaResposta) {
            await supabaseAdmin.from("evento_leads")
                .update({ resposta_convite: novaResposta })
                .eq("pessoaIdentificador", item.pessoaIdentificador)
                .eq("evento_id", item.evento_id);
        }
    }

    return json({ ok: true, processadas });
});

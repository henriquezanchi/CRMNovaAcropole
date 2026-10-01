// Helper compartilhado pra chamar a Anthropic API — pedido do usuário
// (2026-10-01): "o custo da api está mais alto... o que está gastando
// tanta api do claude?". Achado real: nenhuma das 6 functions que chamam
// a Anthropic usava CACHE DE PROMPT, mesmo as 2 que rodam sozinhas a
// cada 15 minutos (classificar-resposta-convite/sugerir-resposta-whatsapp)
// carregando um bloco de instrução fixo de ~5.600 caracteres (~1.400-1.800
// tokens) — pago INTEIRO em toda chamada, pra sempre, mesmo sendo quase
// idêntico de uma chamada pra outra.
//
// `chamarClaude()` centraliza a chamada (nunca mais duplicar
// fetch+parse em cada function) e aceita um prompt JÁ DIVIDIDO em um
// bloco CACHEÁVEL (regras fixas + calendário do dia + exemplos — tudo
// que NÃO muda entre os leads processados numa mesma rodada do cron) e
// um bloco DINÂMICO (dados do lead específico, histórico da conversa,
// última mensagem) — só o primeiro ganha `cache_control`. Dentro de uma
// MESMA rodada de cron (vários candidatos processados em sequência, em
// poucos segundos), o 2º candidato em diante já aproveita o cache do 1º
// — ganho real, mesmo com a janela padrão de 5 min da Anthropic.
//
// Também GRAVA (best-effort, nunca trava a chamada) 1 linha em
// `ia_uso_tokens` por chamada, com os números EXATOS que a própria API
// devolve — é a fonte de verdade de quanto cada function realmente
// custa, substitui estimar por tamanho de texto.
import { supabaseAdmin } from "./supabaseAdmin.ts";

export type RespostaClaude = {
    texto: string | null;
    erro?: string;
    usage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
};

export async function chamarClaude(opts: {
    apiKey: string | undefined;
    modelo: string;
    blocoCacheavel: string;
    blocoDinamico: string;
    maxTokens?: number;
    functionName: string;
}): Promise<RespostaClaude> {
    const { apiKey, modelo, blocoCacheavel, blocoDinamico, maxTokens = 500, functionName } = opts;
    if (!apiKey) return { texto: null, erro: "sem_anthropic_api_key" };

    try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            // anthropic-beta: prompt-caching — achado testando ao vivo
            // (2026-10-01): sem este header, a Anthropic aceita o campo
            // `cache_control` sem erro nenhum, mas simplesmente IGNORA
            // (cache_creation_input_tokens/cache_read_input_tokens
            // vieram zerados nos 2 primeiros testes reais).
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": "prompt-caching-2024-07-31", "content-type": "application/json" },
            body: JSON.stringify({
                model: modelo,
                max_tokens: maxTokens,
                messages: [{
                    role: "user",
                    // blocoDinamico vazio (ex: prompt de 1 bloco só, sem
                    // nada variável) nunca manda um 2º content-block vazio
                    // — a API rejeita "text" vazio.
                    content: blocoDinamico
                        ? [
                            { type: "text", text: blocoCacheavel, cache_control: { type: "ephemeral" } },
                            { type: "text", text: blocoDinamico },
                        ]
                        : [{ type: "text", text: blocoCacheavel, cache_control: { type: "ephemeral" } }],
                }],
            }),
        });
        const respText = await resp.text();
        if (!resp.ok) return { texto: null, erro: "resp_nao_ok: " + respText };

        const data = JSON.parse(respText);
        const texto = String(data.content?.[0]?.text ?? "");
        const usage = data.usage ? {
            input_tokens: data.usage.input_tokens ?? 0,
            output_tokens: data.usage.output_tokens ?? 0,
            cache_creation_input_tokens: data.usage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: data.usage.cache_read_input_tokens ?? 0,
        } : undefined;

        if (usage) {
            // Best-effort — nunca deixa uma falha de log derrubar a
            // chamada real (mesmo princípio de registrarStatusSincronizacao()).
            supabaseAdmin.from("ia_uso_tokens").insert({
                function_name: functionName,
                modelo,
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
                cache_read_input_tokens: usage.cache_read_input_tokens || 0,
            }).then(() => {}, (e: unknown) => console.warn(`[${functionName}] Erro ao logar uso de tokens (não afeta a chamada):`, e));
        }

        return { texto, usage };
    } catch (e) {
        return { texto: null, erro: String(e) };
    }
}

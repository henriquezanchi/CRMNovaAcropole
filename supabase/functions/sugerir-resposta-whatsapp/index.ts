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
import { buscarExemplosEstilo } from "../_shared/exemplosEstilo.ts";

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

// Pedido do usuário (2026-09-29): "quero criar um bot... já com uma
// sugestão de resposta inteligente (pode pesquisar em todo o crm para
// responder)" — antes a IA só via as últimas mensagens da PRÓPRIA
// conversa, então nunca conseguia responder "quanto custa"/"onde fica"/
// "que evento eu já fui" com segurança (sem o dado, sempre caía no
// "vou confirmar"). Agora busca o que já existe no CRM sobre este lead
// específico — filial (endereço/mensalidade), tags, eventos que já
// frequentou, resumo/abordagem já anotados pelo time — e entrega tudo
// pro prompt. Continua proibido inventar o que NÃO vier aqui.
async function montarContextoCRM(pessoaIdentificador: string, filial: string | null): Promise<string> {
    const partes: string[] = [];

    const { data: lead } = await supabaseAdmin
        .from("leads_inscricoes")
        .select("pessoaNome, tags, historico_eventos, resumo_ia, abordagem_sugerida, como_prefere_ser_chamado")
        .eq("pessoaIdentificador", pessoaIdentificador)
        .maybeSingle();

    if (lead) {
        const nome = lead.como_prefere_ser_chamado || (lead.pessoaNome || "").split(" ")[0];
        if (nome) partes.push(`Nome do lead (pra chamar): ${nome}`);

        let tags: string[] = [];
        try {
            const parsed = typeof lead.tags === "string" ? JSON.parse(lead.tags) : lead.tags;
            if (Array.isArray(parsed)) tags = parsed;
        } catch { /* tags malformada — ignora, nunca trava */ }
        if (tags.length > 0) partes.push(`Tags do lead: ${tags.join(", ")}`);

        if (Array.isArray(lead.historico_eventos) && lead.historico_eventos.length > 0) {
            const eventos = lead.historico_eventos.slice(-5).map((ev: any) => `${ev.evento || "evento"} (${ev.data || "data desconhecida"})`).join("; ");
            partes.push(`Eventos que este lead já frequentou: ${eventos}`);
        }
        if (lead.resumo_ia) partes.push(`Resumo já anotado pelo time sobre esta pessoa: ${lead.resumo_ia}`);
        if (lead.abordagem_sugerida) partes.push(`Abordagem já sugerida pra este lead: ${lead.abordagem_sugerida}`);
    }

    if (filial) {
        const { data: filialRow } = await supabaseAdmin
            .from("filiais")
            .select("nome_com_preposicao, endereco, valor_mensalidade")
            .eq("nome", filial)
            .maybeSingle();
        if (filialRow) {
            // Pedido do usuário (2026-10-01, achado testando ao vivo): a IA
            // gerou "Estamos aqui do Setor Oeste" (errado) usando a
            // preposição crua — agora a frase pronta já vem com "na"/"no"
            // certo embutido, pra IA só copiar em vez de tentar montar
            // sozinha.
            if (filialRow.nome_com_preposicao) partes.push(`Como falar da filial: "aqui na Nova Acrópole ${filialRow.nome_com_preposicao}" (nunca comece a frase com "aqui do"/"aqui da")`);
            if (filialRow.endereco) partes.push(`Endereço desta filial: ${filialRow.endereco}`);
            if (filialRow.valor_mensalidade) partes.push(`Valor da mensalidade desta filial: R$ ${filialRow.valor_mensalidade}`);
        }
    }

    // Pedido do usuário (2026-10-01): se o lead tem um convite de evento
    // ainda PENDENTE (ainda não confirmou nem recusou), a IA precisa
    // saber os dados reais (data/hora/link) pra poder ENTREGAR a
    // informação de verdade quando perguntarem, em vez de só prometer
    // "vou te mandar" — mesmo dado que classificar-resposta-convite já
    // usa, mas disponível aqui também pro caso de a mensagem não ter
    // caído no fluxo específico de convite (ex: pergunta de follow-up
    // fora da janela de 3h daquela RPC).
    const { data: convitePendente } = await supabaseAdmin
        .from("evento_leads")
        .select("evento_id, eventos(nome, data, hora, link_inscricao)")
        .eq("pessoaIdentificador", pessoaIdentificador)
        .eq("resposta_convite", "pendente")
        .order("evento_id", { ascending: false })
        .limit(1)
        .maybeSingle();
    const eventoPendente = (convitePendente as any)?.eventos;
    if (eventoPendente) {
        partes.push(`Este lead tem um convite PENDENTE (ainda não confirmou nem recusou) pro evento "${eventoPendente.nome}", data ${eventoPendente.data}${eventoPendente.hora ? `, horário ${eventoPendente.hora}` : ""}.`);
        if (eventoPendente.link_inscricao) partes.push(`Link de inscrição deste evento: ${eventoPendente.link_inscricao}`);
    }

    return partes.length > 0 ? partes.join("\n") : "(nenhum dado adicional cadastrado sobre este lead/filial)";
}

function montarPrompt(contexto: string, contextoCRM: string, ultimaMensagem: string, exemplos: string, hojeISO: string): string {
    const blocoExemplos = exemplos
        ? `\nExemplos REAIS de como o time já respondeu perguntas parecidas (siga o MESMO TOM — caloroso, direto, sem ser robótico — mas nunca copie dado concreto de lá, use sempre os "Dados já cadastrados" acima, que são da conversa de AGORA):\n${exemplos}\n`
        : "";

    return `Você ajuda o time de atendimento de uma escola de filosofia (Nova Acrópole) a responder mensagens de WhatsApp de leads/alunos, de forma humanizada.

Hoje é ${hojeISO}.

Dados já cadastrados no CRM sobre este lead e sua filial (use pra responder com precisão quando fizer sentido, ex: perguntas sobre endereço/valor/eventos que já foi):
${contextoCRM}
${blocoExemplos}
Histórico recente da conversa (mais antiga primeiro):
${contexto}

A última mensagem do lead (a que precisa de resposta agora) foi: "${ultimaMensagem}"

Escreva um rascunho de resposta em português, curto (1-5 frases), caloroso, natural — NUNCA robótico, NUNCA insistente/vendedor logo de cara. Regras:
- Responda considerando TODO o histórico acima (pode ter mais de uma mensagem do lead em sequência) — nunca ignore o que ela já disse antes só porque a "última mensagem" é curta (ex: "pode sim", "sim", "pode mandar").
- Se os "Dados já cadastrados" acima tiverem a resposta exata pra pergunta (endereço, valor, evento, link de inscrição), ENTREGUE esse dado real na resposta — nunca diga só "vou te mandar os detalhes"/"estou enviando agora" se o dado já está disponível aqui; escreva o dado de verdade na mensagem.
- NUNCA invente fato concreto que não esteja nos dados acima (endereço, valor, data, nome de evento específico, horário) — se a pergunta exigir um dado que não está listado ali, só reconheça a pergunta e diga que alguém vai confirmar em breve.
- Se a mensagem for só um agradecimento/despedida, uma resposta breve e cordial já basta.
- Se o lead disser uma OBJEÇÃO (não pode agora, está sem tempo, já é/foi aluno e não quer voltar agora, etc.), use o mesmo tom empático e sem insistência dos exemplos acima — nunca insista ou tente reverter a objeção à força.
- Se não der pra saber o que responder com confiança (mensagem ambígua, fora de contexto, ou perigosa de responder sem saber mais), devolva "sugestao": null — não force um texto.
- ATENÇÃO a datas abreviadas no formato "NN/NN" (ex: "01/27", "depois de 03/28"): o formato brasileiro é DIA/MÊS, então o SEGUNDO número só pode ser mês válido se for de 1 a 12. Se o SEGUNDO número for MAIOR que 12 (como em "01/27", onde 27 não é mês nenhum), não é dia/mês — é quase certamente MÊS/ANO abreviado: "01/27" = janeiro de 2027, NUNCA "27 de janeiro". Se for usar essa data na resposta, escreva por extenso COM O ANO (ex: "em janeiro de 2027"), nunca deixe o ano implícito quando o lead mencionou um.

Além disso, verifique se o LEAD mencionou explicitamente um período/data FUTURA específica pra ser recontatado (ex: "me chama em julho de 2027", "só depois do carnaval", "no mês que vem", "após 01/27") — isso é diferente de uma recusa vaga tipo "mais tarde"/"outro dia" (que NÃO conta). Se houver uma data/período específico o suficiente pra converter numa data real (aplicando a regra de data abreviada acima quando for o caso):
- "lembrete_sugerido": {"data": "AAAA-MM-DD" (sua melhor estimativa da data mencionada, calculada a partir de hoje — ${hojeISO}; pra mês/ano sem dia específico, use o dia 01), "motivo": "1 frase curta resumindo o motivo, ex: 'Disse que não pode agora, mas quer ser contatada em janeiro de 2027'"}
- Se não houver nenhuma data/período específico mencionado, "lembrete_sugerido": null.

Responda SOMENTE com um JSON válido, sem texto antes ou depois, no formato exato: {"sugestao": "..." ou null, "lembrete_sugerido": {"data": "...", "motivo": "..."} ou null}`;
}

async function sugerirUma(contexto: string, contextoCRM: string, ultimaMensagem: string, exemplos: string, hojeISO: string): Promise<{ sugestao: string | null; lembreteData: string | null; lembreteMotivo: string | null; erro?: string; debugBruto?: string }> {
    if (!ANTHROPIC_API_KEY) return { sugestao: null, lembreteData: null, lembreteMotivo: null, erro: "sem_anthropic_api_key" };
    let bruto = "";
    try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({ model: MODELO, max_tokens: 500, messages: [{ role: "user", content: montarPrompt(contexto, contextoCRM, ultimaMensagem, exemplos, hojeISO) }] }),
        });
        const respText = await resp.text();
        if (!resp.ok) return { sugestao: null, lembreteData: null, lembreteMotivo: null, erro: "resp_nao_ok: " + respText, debugBruto: respText };
        const data = JSON.parse(respText);
        bruto = String(data.content?.[0]?.text ?? "");
        const texto = bruto.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(texto);
        const sugestao = typeof parsed?.sugestao === "string" && parsed.sugestao.trim() ? parsed.sugestao.trim() : null;
        const lembrete = parsed?.lembrete_sugerido;
        const lembreteData = lembrete && typeof lembrete.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(lembrete.data) ? lembrete.data : null;
        const lembreteMotivo = lembreteData && typeof lembrete.motivo === "string" && lembrete.motivo.trim() ? lembrete.motivo.trim() : null;
        return { sugestao, lembreteData, lembreteMotivo: lembreteData ? lembreteMotivo : null, debugBruto: bruto };
    } catch (e) {
        return { sugestao: null, lembreteData: null, lembreteMotivo: null, erro: String(e), debugBruto: bruto };
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
    const exemplos = await buscarExemplosEstilo();
    const hojeISO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()); // en-CA = AAAA-MM-DD

    if (modoDebug) {
        const resultadosDebug = [];
        for (const item of candidatas as Candidata[]) {
            if (setJaClassificadas.has(item.mensagem_id)) continue;
            const contexto = await montarContexto(item.pessoaIdentificador);
            const contextoCRM = await montarContextoCRM(item.pessoaIdentificador, item.filial);
            resultadosDebug.push({ corpo_texto: item.corpo_texto, contextoCRM, ...(await sugerirUma(contexto, contextoCRM, item.corpo_texto, exemplos, hojeISO)) });
        }
        return json({ ok: true, debug: resultadosDebug });
    }

    let processadas = 0;
    for (const item of candidatas as Candidata[]) {
        if (setJaClassificadas.has(item.mensagem_id)) continue;

        const contexto = await montarContexto(item.pessoaIdentificador);
        const contextoCRM = await montarContextoCRM(item.pessoaIdentificador, item.filial);
        const resultado = await sugerirUma(contexto, contextoCRM, item.corpo_texto, exemplos, hojeISO);
        if (resultado.erro) console.warn("Sugestão não gerada (fallback sem texto):", resultado.erro);

        const { error: erroInsert } = await supabaseAdmin.from("sugestoes_resposta_wpp").insert({
            pessoaIdentificador: item.pessoaIdentificador,
            mensagem_origem_id: item.mensagem_id,
            sugestao_resposta: resultado.sugestao,
            lembrete_sugerido_data: resultado.lembreteData,
            lembrete_sugerido_motivo: resultado.lembreteMotivo,
        });
        // unique(mensagem_origem_id) — corrida com outra execução do
        // cron falha o insert (23505) e segue pra próxima, sem duplicar.
        if (erroInsert) { console.warn("Não gravou sugestão (provável corrida):", erroInsert.message); continue; }
        processadas++;
    }

    return json({ ok: true, processadas });
});

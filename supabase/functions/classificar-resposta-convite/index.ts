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
import { buscarExemplosEstilo } from "../_shared/exemplosEstilo.ts";
import { buscarListaFiliais, linkMapsEndereco } from "../_shared/filiaisInfo.ts";
import { montarTabelaDiasSemana, adicionarMeses } from "../_shared/calendario.ts";
import { buscarPersonaAtendente } from "../_shared/persona.ts";

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

const LIMITE_HISTORICO = 6;

// Pedido do usuário (2026-10-01, achado testando ao vivo): a IA só via a
// ÚLTIMA mensagem isolada, sem o resto da conversa — ignorava o que a
// pessoa já tinha dito antes na mesma troca. Agora busca as últimas N
// mensagens da conversa (mesmo padrão de sugerir-resposta-whatsapp).
async function montarHistorico(pessoaIdentificador: string): Promise<string> {
    const { data } = await supabaseAdmin
        .from("mensagens_whatsapp")
        .select("direcao, corpo_texto, tipo")
        .eq("pessoaIdentificador", pessoaIdentificador)
        .order("criado_em", { ascending: false })
        .limit(LIMITE_HISTORICO);
    const msgs = (data || []).reverse();
    return msgs.map((m: any) => `${m.direcao === "entrada" ? "Lead" : "Escola"}: ${m.tipo === "texto" ? m.corpo_texto : `[${m.tipo}]`}`).join("\n");
}

type DadosEvento = {
    hora: string | null;
    endereco: string | null;
    linkInscricao: string | null;
    filialFalada: string | null; // ex: "Setor Oeste" já com a preposição certa pronta pra usar
    proximoEventoNome: string | null; // pra quando a pessoa não pode ir a ESTE — próxima Abertura de Turma da mesma filial, se houver
    proximoEventoData: string | null;
    listaFiliais: string; // bug real corrigido (2026-10-01) — ver _shared/filiaisInfo.ts
};

// Busca os dados REAIS do evento (endereço/horário/link) pra que a
// sugestão de "pediu_informacao" possa ENTREGAR a informação de verdade
// em vez de só prometer "alguém vai te mandar" — e, pra "nao_pode_ir",
// busca a próxima Abertura de Turma da mesma filial (evento DIFERENTE do
// que a pessoa recusou), pra sugerir convidá-la pra essa em vez de só se
// despedir. Nunca inventa nada — se não achar, os campos ficam null e o
// prompt é instruído a não inventar.
async function buscarDadosEvento(eventoId: number, textoConversa: string): Promise<DadosEvento> {
    const vazio: DadosEvento = { hora: null, endereco: null, linkInscricao: null, filialFalada: null, proximoEventoNome: null, proximoEventoData: null, listaFiliais: "" };
    const { data: evento } = await supabaseAdmin
        .from("eventos")
        .select("hora, link_inscricao, filial, data, tipo")
        .eq("id", eventoId)
        .maybeSingle();
    if (!evento) return vazio;

    let endereco: string | null = null;
    let filialFalada: string | null = null;
    if (evento.filial) {
        const { data: filialRow } = await supabaseAdmin
            .from("filiais")
            .select("nome_com_preposicao, endereco")
            .eq("nome", evento.filial)
            .maybeSingle();
        endereco = filialRow?.endereco || null;
        filialFalada = filialRow?.nome_com_preposicao || null;
    }

    let proximoEventoNome: string | null = null;
    let proximoEventoData: string | null = null;
    if (evento.filial) {
        const { data: proximo } = await supabaseAdmin
            .from("eventos")
            .select("nome, data")
            .eq("filial", evento.filial)
            .eq("tipo", "Abertura de Turma")
            .eq("ativo", true)
            .neq("id", eventoId)
            .gte("data", new Date().toISOString().slice(0, 10))
            .order("data", { ascending: true })
            .limit(1)
            .maybeSingle();
        if (proximo) { proximoEventoNome = proximo.nome; proximoEventoData = proximo.data; }
    }

    const listaFiliais = await buscarListaFiliais(evento.filial || null, textoConversa);

    return { hora: evento.hora || null, endereco, linkInscricao: evento.link_inscricao || null, filialFalada, proximoEventoNome, proximoEventoData, listaFiliais };
}

function montarPrompt(item: Candidata, historico: string, dados: DadosEvento, exemplos: string, hojeISO: string, persona: string): string {
    const blocoExemplos = exemplos
        ? `\nExemplos REAIS de como o time já respondeu perguntas/objeções parecidas (siga o MESMO TOM — caloroso, direto, sem ser robótico, sem insistir — mas nunca copie o dado concreto de lá, use sempre os "Dados reais do evento" acima):\n${exemplos}\n`
        : "";
    const blocoPersona = persona ? `\n${persona}\n` : "";
    const infoEvento = [
        `Nome: ${item.evento_nome}`,
        `Data: ${item.evento_data}`,
        dados.hora ? `Horário: ${dados.hora}` : null,
        dados.endereco ? `Endereço: ${dados.endereco} (link do Google Maps: ${linkMapsEndereco(dados.endereco)} — sempre que mencionar o endereço na resposta, inclua também este link)` : null,
        dados.linkInscricao ? `Link de inscrição: ${dados.linkInscricao}` : null,
        dados.filialFalada ? `Como falar da filial: "aqui na Nova Acrópole ${dados.filialFalada}" (nunca comece a frase com "aqui do"/"aqui da")` : null,
    ].filter(Boolean).join("\n");

    const infoProximoEvento = dados.proximoEventoNome
        ? `\nSe a pessoa não pode ir a ESTE evento, existe uma próxima Abertura de Turma na mesma filial: "${dados.proximoEventoNome}" em ${dados.proximoEventoData}. Pode convidá-la pra essa em vez de só se despedir.`
        : "";

    return `Você ajuda uma escola de filosofia (Nova Acrópole) a triar respostas de convites de evento pelo WhatsApp. Uma pessoa foi convidada pro evento abaixo e respondeu.

${montarTabelaDiasSemana(hojeISO)}

Dados reais do evento (use pra responder com precisão — nunca invente nada que não esteja aqui):
${infoEvento}${infoProximoEvento}
${dados.listaFiliais ? "\n" + dados.listaFiliais + "\n" : ""}
${blocoPersona}${blocoExemplos}
Histórico recente da conversa (mais antiga primeiro, pode ter mais de uma mensagem do lead em sequência):
${historico}

Classifique a ÚLTIMA mensagem do lead (a de baixo) em EXATAMENTE UMA destas categorias (nunca invente uma categoria fora desta lista), considerando TODO o histórico acima, não só a última linha isolada:
- "confirmou": confirma presença / tem interesse claro em ir.
- "nao_pode_ir": diz que não pode ir a ESTE evento especificamente (mas de forma neutra, sem recusar contato futuro).
- "pediu_informacao": pergunta algo prático (endereço, horário, valor, como chegar, etc.) — ainda não confirmou nem recusou.
- "sem_interesse": recusa/diz que não tem interesse, ou pede pra não ser contatado(a) de novo.
- "ambiguo": a mensagem não permite classificar com confiança (ex: só um cumprimento genérico, mensagem sem relação clara com o convite, ou de outro assunto).

Se tiver qualquer dúvida real, prefira "ambiguo" — nunca force uma categoria só pra escolher algo.

Além da categoria, escreva "sugestao_resposta": um rascunho de mensagem de acompanhamento em português, curto (2-5 frases), caloroso e natural (não robótico), que responda considerando TODA a conversa acima (nunca ignore o que a pessoa já disse antes na mesma troca). Regras da sugestão:
- Se houver um bloco "Persona configurada por..." acima, siga o tom E as observações dali À RISCA (tem prioridade sobre o estilo padrão) — mas nunca sobre as regras de segurança abaixo (nunca inventar fato, nunca "confirmo você", etc.).
- Se "nao_pode_ir": agradeça; se houver uma próxima Abertura de Turma listada acima, pergunte se ela gostaria de ir nessa (cite nome e data reais); senão, diga que vamos avisar sobre os próximos eventos, sem inventar nome/data.
- Se "pediu_informacao": responda com os dados REAIS acima que fizerem sentido pra pergunta dela (endereço, horário, link de inscrição) — NUNCA diga só "vou te mandar os detalhes" se o dado já está disponível aqui, entregue de verdade. Só diga "alguém vai confirmar" pro que realmente não está listado acima (ex: valor, se não vier).
- Se "sem_interesse": uma despedida breve e respeitosa, sem insistir.
- Se "confirmou": acolha com entusiasmo e repita a data/horário/endereço JÁ FIXOS (acima) pra ela não ter dúvida, e inclua o link de inscrição se ela ainda não tiver se inscrito oficialmente (sem inventar se não tiver). NUNCA pergunte "qual dia você pode" como se houvesse escolha de data. NUNCA use frases que pareçam uma decisão ADMINISTRATIVA já fechada por nós — tipo "confirmo você", "está confirmada a sua vaga", "registrei sua presença" — isso pode soar opressivo/constrangedor, como se a pessoa tivesse assinado um compromisso formal só por dizer "sim". Prefira um tom de convite caloroso ("Que bom que você vai poder vir! Te esperamos..."/"Show! Então a gente se vê..."), nunca de registro burocrático.
- Se "ambiguo": deixe "sugestao_resposta" como null — não force um texto sem saber o que responder.
- NUNCA invente evento, data, endereço, valor, ou qualquer fato que não foi dado aqui.
- Se o lead mencionar ou perguntar sobre uma unidade/filial DIFERENTE da do evento (ver lista de unidades acima, se houver), responda com os dados REAIS daquela unidade que ele mencionou — nunca confunda com a filial deste evento.
- Se o histórico tiver uma promessa vaga de dia da semana feita pela ESCOLA (ex: "teremos outra oportunidade na próxima quinta") e o lead só confirmou agora, use a tabela de calendário no topo pra achar a DATA EXATA daquele dia da semana — nunca escreva uma data sem conferir na tabela.
- ATENÇÃO a datas abreviadas no formato "NN/NN" (ex: "01/27", "após 01/27"): o formato brasileiro é DIA/MÊS, então o SEGUNDO número só pode ser mês válido se for de 1 a 12. Se o SEGUNDO número for MAIOR que 12 (como em "01/27", onde 27 não é mês), não é dia/mês — é quase certamente MÊS/ANO abreviado: "01/27" = janeiro de 2027, NUNCA "27 de janeiro". Se usar essa data na sugestão, escreva por extenso COM O ANO (ex: "em janeiro de 2027"), nunca deixe o ano implícito quando o lead mencionou um.

Além disso, verifique se o LEAD mencionou explicitamente um período/data FUTURA específica pra ser recontatado (ex: "me chama em julho de 2027", "só depois do carnaval", "no mês que vem", "após 01/27") — diferente de uma recusa vaga ("mais tarde"/"outro dia", que NÃO conta). Se houver data/período específico o suficiente pra converter numa data real (aplicando a regra de data abreviada acima quando for o caso):
- "lembrete_sugerido": {"data": "AAAA-MM-DD" (sua melhor estimativa, calculada a partir de hoje — ${hojeISO}; pra mês/ano sem dia específico, use o dia 01), "motivo": "1 frase curta, ex: 'Disse que não pode ir a este evento, mas quer ser contatada em janeiro de 2027'"}
- Senão, "lembrete_sugerido": null.

Responda SOMENTE com um JSON válido, sem texto antes ou depois, no formato exato: {"categoria": "...", "sugestao_resposta": "..." ou null, "lembrete_sugerido": {"data": "...", "motivo": "..."} ou null}`;
}

// Pedido do usuário (2026-10-01): "quando a pessoa disser que não pode
// agora, mas não der um prazo, crie um lembrete para 6 meses" — mesmo
// fix de sugerir-resposta-whatsapp, a data é SEMPRE calculada por código
// (adicionarMeses(), _shared/calendario.ts), nunca pela IA.
const MESES_LEMBRETE_PADRAO_NAO_PODE_IR = 6;
function aplicarLembretePadraoNaoPodeIrSemPrazo(resultado: { categoria: string; lembreteData: string | null; lembreteMotivo: string | null }, hojeISO: string) {
    if (resultado.categoria === "nao_pode_ir" && !resultado.lembreteData) {
        resultado.lembreteData = adicionarMeses(hojeISO, MESES_LEMBRETE_PADRAO_NAO_PODE_IR);
        resultado.lembreteMotivo = "Disse que não pode ir a este evento, sem dar um prazo pra retomar contato — lembrete padrão de 6 meses.";
    }
}

async function classificarUma(item: Candidata, historico: string, dados: DadosEvento, exemplos: string, hojeISO: string, persona: string): Promise<{ categoria: string; sugestao_resposta: string | null; lembreteData: string | null; lembreteMotivo: string | null; debugBruto?: string; debugErro?: string }> {
    if (!ANTHROPIC_API_KEY) return { categoria: "ambiguo", sugestao_resposta: null, lembreteData: null, lembreteMotivo: null, debugErro: "sem_anthropic_api_key" };
    try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({ model: MODELO, max_tokens: 500, messages: [{ role: "user", content: montarPrompt(item, historico, dados, exemplos, hojeISO, persona) }] }),
        });
        const data = await resp.json();
        if (!resp.ok) return { categoria: "ambiguo", sugestao_resposta: null, lembreteData: null, lembreteMotivo: null, debugErro: "resp_nao_ok: " + JSON.stringify(data?.error || data) };
        const bruto = String(data.content?.[0]?.text ?? "");
        const texto = bruto.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(texto);
        const categoria = CATEGORIAS_VALIDAS.includes(parsed?.categoria) ? parsed.categoria : "ambiguo";
        const sugestao = typeof parsed?.sugestao_resposta === "string" && parsed.sugestao_resposta.trim() ? parsed.sugestao_resposta.trim() : null;
        const lembrete = parsed?.lembrete_sugerido;
        const lembreteData = lembrete && typeof lembrete.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(lembrete.data) ? lembrete.data : null;
        const lembreteMotivo = lembreteData && typeof lembrete.motivo === "string" && lembrete.motivo.trim() ? lembrete.motivo.trim() : null;
        return { categoria, sugestao_resposta: categoria === "ambiguo" ? null : sugestao, lembreteData, lembreteMotivo: lembreteData ? lembreteMotivo : null, debugBruto: bruto };
    } catch (e) {
        // JSON malformado, rede fora, etc — nunca trava a rotina, cai no
        // fallback mais seguro (precisa de revisão humana, sem sugestão).
        return { categoria: "ambiguo", sugestao_resposta: null, lembreteData: null, lembreteMotivo: null, debugErro: String(e) };
    }
}

// Pedido do usuário (2026-10-01): "cada SDR teria a sua persona" — ver
// _shared/persona.ts. Resolvida pelo atendente REALMENTE responsável
// por esta conversa (leads_inscricoes.wpp_atendente_responsavel), não
// pela filial do evento.
async function buscarPersonaDoLead(pessoaIdentificador: string): Promise<string> {
    const { data: lead } = await supabaseAdmin
        .from(NOME_TABELA_LEADS)
        .select("wpp_atendente_responsavel")
        .eq("pessoaIdentificador", pessoaIdentificador)
        .maybeSingle();
    return buscarPersonaAtendente(lead?.wpp_atendente_responsavel);
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
    const exemplos = await buscarExemplosEstilo();
    const hojeISO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()); // en-CA = AAAA-MM-DD

    if (modoDebug) {
        const resultadosDebug = [];
        for (const item of candidatas as Candidata[]) {
            const historico = await montarHistorico(item.pessoaIdentificador);
            const dados = await buscarDadosEvento(item.evento_id, `${historico}\n${item.corpo_texto}`);
            const persona = await buscarPersonaDoLead(item.pessoaIdentificador);
            const resultadoDebug = await classificarUma(item, historico, dados, exemplos, hojeISO, persona);
            aplicarLembretePadraoNaoPodeIrSemPrazo(resultadoDebug, hojeISO);
            resultadosDebug.push({ corpo_texto: item.corpo_texto, ...resultadoDebug });
        }
        return json({ ok: true, debug: resultadosDebug });
    }

    let processadas = 0;
    for (const item of candidatas as Candidata[]) {
        const historico = await montarHistorico(item.pessoaIdentificador);
        const dados = await buscarDadosEvento(item.evento_id, `${historico}\n${item.corpo_texto}`);
        const persona = await buscarPersonaDoLead(item.pessoaIdentificador);
        const resultado = await classificarUma(item, historico, dados, exemplos, hojeISO, persona);

        // Mesmo fix de sugerir-resposta-whatsapp (2026-10-01): distingue
        // "ambiguo" porque a IA genuinamente decidiu (fica gravado, é um
        // resultado válido) de "ambiguo" porque a CHAMADA falhou (erro de
        // rede/rate limit/JSON malformado — debugErro vem preenchido só
        // nesse caso, nunca quando o modelo respondeu normalmente). Falha
        // técnica pula sem gravar, pra virar candidata de novo na próxima
        // rodada do cron.
        if (resultado.debugErro) {
            console.warn("Classificação não gerada (erro técnico, vai tentar de novo na próxima rodada):", resultado.debugErro);
            continue;
        }
        aplicarLembretePadraoNaoPodeIrSemPrazo(resultado, hojeISO);

        const { error: erroInsert } = await supabaseAdmin.from("classificacoes_resposta_convite").insert({
            pessoaIdentificador: item.pessoaIdentificador,
            evento_id: item.evento_id,
            mensagem_origem_id: item.mensagem_id,
            categoria: resultado.categoria,
            sugestao_resposta: resultado.sugestao_resposta,
            lembrete_sugerido_data: resultado.lembreteData,
            lembrete_sugerido_motivo: resultado.lembreteMotivo,
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

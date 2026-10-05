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
import { buscarListaFiliais, linkMapsDaFilial } from "../_shared/filiaisInfo.ts";
import { montarTabelaDiasSemana, adicionarMeses } from "../_shared/calendario.ts";
import { buscarPersonaAtendente } from "../_shared/persona.ts";
import { chamarClaude } from "../_shared/anthropic.ts";

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
    linkMaps: string | null;
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
    const vazio: DadosEvento = { hora: null, endereco: null, linkMaps: null, linkInscricao: null, filialFalada: null, proximoEventoNome: null, proximoEventoData: null, listaFiliais: "" };
    const { data: evento } = await supabaseAdmin
        .from("eventos")
        .select("hora, link_inscricao, filial, data, tipo")
        .eq("id", eventoId)
        .maybeSingle();
    if (!evento) return vazio;

    let endereco: string | null = null;
    let linkMaps: string | null = null;
    let filialFalada: string | null = null;
    if (evento.filial) {
        const { data: filialRow } = await supabaseAdmin
            .from("filiais")
            .select("nome_com_preposicao, endereco, link_maps_ulisses")
            .eq("nome", evento.filial)
            .maybeSingle();
        endereco = filialRow?.endereco || null;
        linkMaps = linkMapsDaFilial(filialRow);
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

    return { hora: evento.hora || null, endereco, linkMaps, linkInscricao: evento.link_inscricao || null, filialFalada, proximoEventoNome, proximoEventoData, listaFiliais };
}

// Pedido do usuário (2026-10-01): "o custo da api está mais alto... o
// que está gastando tanta api do claude?" — mesmo fix de
// sugerir-resposta-whatsapp: esta function também roda sozinha a cada
// 15 min, e o prompt nunca usava CACHE DE PROMPT. Dividido em
// montarPromptCacheavel() (regras fixas + calendário do dia + exemplos —
// IGUAL pra qualquer candidato processado nesta rodada) e
// montarPromptDinamico() (dados do evento específico + persona do
// atendente + histórico — muda por candidato). Ver
// _shared/anthropic.ts/chamarClaude() pra como o cache_control é
// aplicado só no bloco cacheável.
//
// MÍNIMO CACHEÁVEL (achado real, 2026-10-01, medido contra a Anthropic
// direto): o Haiku 4.5 (MODELO acima) só cacheia a partir de 4.096
// tokens — bem mais que os 2.048 das versões antigas de Haiku. Sem
// EXEMPLOS_ADICIONAIS_ESTILO_CONVITE abaixo (conteúdo real de estilo,
// não enchimento — mesmo raciocínio de sugerir-resposta-whatsapp), o
// bloco de regras fixas sozinho não bate esse piso e o cache nunca
// ativava (cache_creation_input_tokens/cache_read_input_tokens sempre
// 0, sem erro nenhum — silenciosamente ignorado).
const EXEMPLOS_ADICIONAIS_ESTILO_CONVITE = `
Mais exemplos de bom padrão de classificação + resposta (situações comuns, não são do lead atual — nunca copie o dado concreto, só o critério e o tom):

Lead: "Consegui sim, nos vemos lá!"
Categoria: confirmou. Bom padrão de resposta: entusiasmo genuíno, repetir dia/horário/endereço reais, sem soar burocrático. Ex: "Que alegria, [nome]! Te esperamos [dia] às [hora] em [endereço]."

Lead: "Infelizmente não vou poder ir dessa vez, surgiu um compromisso"
Categoria: nao_pode_ir. Bom padrão: acolher sem cobrar motivo, oferecer a próxima oportunidade só se houver uma Abertura de Turma real nos dados do evento. Ex: "Sem problema, [nome]! Fica pra próxima. Se quiser, temos [próximo evento real] chegando."

Lead: "Esse evento é pago ou gratuito?"
Categoria: pediu_informacao. Bom padrão: responder com o dado real do evento (ingresso/valor) quando disponível; sem o dado, reconhecer e dizer que vai confirmar. Ex: "Ótima pergunta, [nome]! [resposta com o dado real, se houver]."

Lead: "Não tenho interesse, por favor não me chamem mais pra isso"
Categoria: sem_interesse. Bom padrão: respeitar na hora, despedida breve, sem insistir ou perguntar o porquê. Ex: "Combinado, [nome], obrigado por avisar. Tudo de bom!"

Lead: manda só um emoji de joinha (👍) sem nenhuma palavra
Categoria: ambiguo (joinha sozinho pode ser "sim" ou só reconhecimento de ter lido — não dá pra confirmar presença com certeza). Bom padrão: "sugestao_resposta" null — deixar pra revisão humana decidir se vale perguntar de novo.

Lead: "Quem mais vai estar lá?"
Categoria: pediu_informacao. Bom padrão: responder com o que for real/disponível (tipo de evento, perfil de quem costuma ir) sem inventar lista de pessoas específicas. Ex: "Geralmente é um grupo bem variado, [nome] — de curiosos a quem já estuda filosofia há anos. Um ambiente bem acolhedor!"

Lead responde um "kkkk" ou figurinha de risada, sem nenhuma palavra, a um convite
Categoria: ambiguo. Bom padrão: nunca assumir que é confirmação só pela reação positiva — "sugestao_resposta" pode perguntar com leveza se ela vai, mas "categoria" continua ambiguo até haver uma resposta mais clara.

Lead: "Já fui semana passada, não pretendo repetir tão cedo"
Categoria: nao_pode_ir (recusa específica a ESTE convite, sem ser uma recusa definitiva de contato futuro). Bom padrão: agradecer a presença anterior com carinho, sem insistir no evento atual. Ex: "Que bom que você foi, [nome]! Sem pressa nenhuma, quando bater vontade de voltar é só avisar."

Lead: "Posso levar meu filho/um amigo junto?"
Categoria: pediu_informacao. Bom padrão: responder com o que for real (evento costuma ser aberto a acompanhantes, salvo informação em contrário nos dados) sem inventar regra de idade/quantidade. Ex: "Com certeza, [nome]! Pode trazer quem quiser, quanto mais gente melhor."

Lead: "Talvez, ainda não sei se consigo"
Categoria: ambiguo (nem confirmou nem recusou com clareza). Bom padrão de resposta: deixar a porta aberta sem pressionar por uma resposta fechada agora. Ex: "Sem problema, [nome], qualquer coisa me avisa depois! Se precisar de mais informação pra decidir, é só perguntar."

Lead: "Esqueci completamente, foi hoje?"
Categoria: ambiguo (mensagem reativa, não dá pra saber se ainda vai comparecer). Bom padrão: responder com a data/horário reais do evento com acolhimento, sem cobrar. Ex: "Foi sim, [nome], mas sem problema! Se quiser, te aviso do próximo."

Lead: "Vou estar viajando nessa data, mas me interessa muito"
Categoria: nao_pode_ir. Bom padrão: reconhecer o interesse genuíno dela, oferecer o próximo evento real se houver, sem soar como insistência. Ex: "Entendo, [nome]! Boa viagem. Assim que tivermos outra data, te aviso com prazer."

Lead manda o próprio nome completo sem mais nenhuma palavra, em resposta a um convite
Categoria: ambiguo (pode ser confirmação de identidade pedida em outro contexto, não necessariamente resposta ao convite). Bom padrão: "sugestao_resposta" perguntando com gentileza se isso é uma confirmação de presença, sem assumir.

Lead: "Fico sabendo o valor da próxima turma?"
Categoria: pediu_informacao (mesmo dentro de uma conversa sobre convite de evento, uma pergunta sobre matrícula/turma é prática e deve ser respondida com dado real se disponível). Bom padrão: responder com o valor real da filial se vier nos dados informados; sem o dado, reconhecer e prometer confirmar.

Lead: "Tem estacionamento perto?"
Categoria: pediu_informacao. Bom padrão: responder com o endereço/link de mapa real se disponível, reconhecendo que não sabe sobre estacionamento específico sem inventar. Ex: "Ótima pergunta, [nome]! O endereço é [endereço] — [link de mapa, se houver]. Sobre estacionamento especificamente, vou confirmar com a equipe de lá."

Lead: "Me add num grupo de WhatsApp sobre isso?"
Categoria: pediu_informacao. Bom padrão: nunca inventar/prometer um grupo que não foi mencionado nos dados — reconhecer o pedido e dizer que vai verificar com a equipe. Ex: "Vou verificar isso com a equipe, [nome], e já te retorno!"

Lead: "Essa é a mesma pessoa que me ligou semana passada?"
Categoria: ambiguo (pergunta sobre identidade de quem atende, não sobre o convite em si). Bom padrão: esclarecer com transparência, sem fingir ser outra pessoa. Ex: "Pode ser que sim ou que seja outra pessoa da equipe, [nome] — aqui somos um time só, sempre prontos pra ajudar!"
`;
function montarPromptCacheavel(exemplos: string, hojeISO: string): string {
    const blocoExemplos = exemplos
        ? `\nExemplos REAIS de como o time já respondeu perguntas/objeções parecidas (siga o MESMO TOM — caloroso, direto, sem ser robótico, sem insistir — mas nunca copie o dado concreto de lá, use sempre os dados do evento informados a seguir):\n${exemplos}\n`
        : "";

    return `Você ajuda uma escola de filosofia (Nova Acrópole) a triar respostas de convites de evento pelo WhatsApp. Uma pessoa foi convidada pra um evento e respondeu.

${montarTabelaDiasSemana(hojeISO)}
${blocoExemplos}
${EXEMPLOS_ADICIONAIS_ESTILO_CONVITE}
Depois desta mensagem virão: os dados reais do evento específico, o histórico recente da conversa, e a última mensagem do lead que precisa ser classificada.

Classifique a ÚLTIMA mensagem do lead (a mais recente do histórico) em EXATAMENTE UMA destas categorias (nunca invente uma categoria fora desta lista), considerando TODO o histórico, não só a última linha isolada:
- "confirmou": confirma presença / tem interesse claro em ir.
- "nao_pode_ir": diz que não pode ir a ESTE evento especificamente (mas de forma neutra, sem recusar contato futuro).
- "pediu_informacao": pergunta algo prático (endereço, horário, valor, como chegar, etc.) — ainda não confirmou nem recusou.
- "sem_interesse": recusa/diz que não tem interesse, ou pede pra não ser contatado(a) de novo.
- "ambiguo": a mensagem não permite classificar com confiança (ex: só um cumprimento genérico, mensagem sem relação clara com o convite, ou de outro assunto).

Se tiver qualquer dúvida real, prefira "ambiguo" — nunca force uma categoria só pra escolher algo.

Além da categoria, escreva "sugestao_resposta": um rascunho de mensagem de acompanhamento em português, curto (2-5 frases), caloroso e natural (não robótico), que responda considerando TODA a conversa (nunca ignore o que a pessoa já disse antes na mesma troca). Regras da sugestão:
- Se houver um bloco "Persona configurada por..." nos dados informados, siga o tom E as observações dali À RISCA (tem prioridade sobre o estilo padrão) — mas nunca sobre as regras de segurança abaixo (nunca inventar fato, nunca "confirmo você", etc.).
- Se "nao_pode_ir": agradeça; se houver uma próxima Abertura de Turma informada nos dados do evento, pergunte se ela gostaria de ir nessa (cite nome e data reais); senão, diga que vamos avisar sobre os próximos eventos, sem inventar nome/data.
- Se "pediu_informacao": responda com os dados REAIS do evento que fizerem sentido pra pergunta dela (endereço, horário, link de inscrição) — NUNCA diga só "vou te mandar os detalhes" se o dado já está disponível, entregue de verdade. Só diga "alguém vai confirmar" pro que realmente não foi informado (ex: valor, se não vier).
- Se "sem_interesse": uma despedida breve e respeitosa, sem insistir.
- Se "confirmou": acolha com entusiasmo e repita a data/horário/endereço JÁ FIXOS (nos dados do evento) pra ela não ter dúvida, e inclua o link de inscrição se ela ainda não tiver se inscrito oficialmente (sem inventar se não tiver). NUNCA pergunte "qual dia você pode" como se houvesse escolha de data. NUNCA use frases que pareçam uma decisão ADMINISTRATIVA já fechada por nós — tipo "confirmo você", "está confirmada a sua vaga", "registrei sua presença" — isso pode soar opressivo/constrangedor, como se a pessoa tivesse assinado um compromisso formal só por dizer "sim". Prefira um tom de convite caloroso ("Que bom que você vai poder vir! Te esperamos..."/"Show! Então a gente se vê..."), nunca de registro burocrático.
- Se "ambiguo": deixe "sugestao_resposta" como null — não force um texto sem saber o que responder.
- NUNCA invente evento, data, endereço, valor, ou qualquer fato que não tenha sido informado.
- Se o lead mencionar ou perguntar sobre uma unidade/filial DIFERENTE da do evento (ver lista de unidades nos dados informados, se houver), responda com os dados REAIS daquela unidade que ele mencionou — nunca confunda com a filial deste evento.
- Se o histórico tiver uma promessa vaga de dia da semana feita pela ESCOLA (ex: "teremos outra oportunidade na próxima quinta") e o lead só confirmou agora, use a tabela de calendário acima pra achar a DATA EXATA daquele dia da semana — nunca escreva uma data sem conferir na tabela.
- ATENÇÃO a datas abreviadas no formato "NN/NN" (ex: "01/27", "após 01/27"): o formato brasileiro é DIA/MÊS, então o SEGUNDO número só pode ser mês válido se for de 1 a 12. Se o SEGUNDO número for MAIOR que 12 (como em "01/27", onde 27 não é mês), não é dia/mês — é quase certamente MÊS/ANO abreviado: "01/27" = janeiro de 2027, NUNCA "27 de janeiro". Se usar essa data na sugestão, escreva por extenso COM O ANO (ex: "em janeiro de 2027"), nunca deixe o ano implícito quando o lead mencionou um.

Além disso, verifique se o LEAD mencionou explicitamente um período/data FUTURA específica pra ser recontatado (ex: "me chama em julho de 2027", "só depois do carnaval", "no mês que vem", "após 01/27") — diferente de uma recusa vaga ("mais tarde"/"outro dia", que NÃO conta). Se houver data/período específico o suficiente pra converter numa data real (aplicando a regra de data abreviada acima quando for o caso):
- "lembrete_sugerido": {"data": "AAAA-MM-DD" (sua melhor estimativa, calculada a partir de HOJE, informado na tabela de calendário acima; pra mês/ano sem dia específico, use o dia 01), "motivo": "1 frase curta, ex: 'Disse que não pode ir a este evento, mas quer ser contatada em janeiro de 2027'"}
- Senão, "lembrete_sugerido": null.

Responda SOMENTE com um JSON válido, sem texto antes ou depois, no formato exato: {"categoria": "...", "sugestao_resposta": "..." ou null, "lembrete_sugerido": {"data": "...", "motivo": "..."} ou null}`;
}

function montarPromptDinamico(item: Candidata, historico: string, dados: DadosEvento, persona: string): string {
    const blocoPersona = persona ? `\n${persona}\n` : "";
    const infoEvento = [
        `Nome: ${item.evento_nome}`,
        `Data: ${item.evento_data}`,
        dados.hora ? `Horário: ${dados.hora}` : null,
        dados.endereco ? `Endereço: ${dados.endereco} (link do Google Maps: ${dados.linkMaps} — sempre que mencionar o endereço na resposta, inclua também este link)` : null,
        dados.linkInscricao ? `Link de inscrição: ${dados.linkInscricao}` : null,
        dados.filialFalada ? `Como falar da filial: "aqui na Nova Acrópole ${dados.filialFalada}" (nunca comece a frase com "aqui do"/"aqui da")` : null,
    ].filter(Boolean).join("\n");

    const infoProximoEvento = dados.proximoEventoNome
        ? `\nSe a pessoa não pode ir a ESTE evento, existe uma próxima Abertura de Turma na mesma filial: "${dados.proximoEventoNome}" em ${dados.proximoEventoData}. Pode convidá-la pra essa em vez de só se despedir.`
        : "";

    return `Dados reais do evento (use pra responder com precisão — nunca invente nada que não esteja aqui):
${infoEvento}${infoProximoEvento}
${dados.listaFiliais ? "\n" + dados.listaFiliais + "\n" : ""}
${blocoPersona}
Histórico recente da conversa (mais antiga primeiro, pode ter mais de uma mensagem do lead em sequência):
${historico}`;
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
    const resultado = await chamarClaude({
        apiKey: ANTHROPIC_API_KEY,
        modelo: MODELO,
        blocoCacheavel: montarPromptCacheavel(exemplos, hojeISO),
        blocoDinamico: montarPromptDinamico(item, historico, dados, persona),
        maxTokens: 500,
        functionName: "classificar-resposta-convite",
    });
    if (resultado.erro || !resultado.texto) {
        // JSON malformado, rede fora, etc — nunca trava a rotina, cai no
        // fallback mais seguro (precisa de revisão humana, sem sugestão).
        return { categoria: "ambiguo", sugestao_resposta: null, lembreteData: null, lembreteMotivo: null, debugErro: resultado.erro || "resposta_vazia" };
    }
    try {
        const bruto = resultado.texto;
        const texto = bruto.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(texto);
        const categoria = CATEGORIAS_VALIDAS.includes(parsed?.categoria) ? parsed.categoria : "ambiguo";
        const sugestao = typeof parsed?.sugestao_resposta === "string" && parsed.sugestao_resposta.trim() ? parsed.sugestao_resposta.trim() : null;
        const lembrete = parsed?.lembrete_sugerido;
        const lembreteData = lembrete && typeof lembrete.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(lembrete.data) ? lembrete.data : null;
        const lembreteMotivo = lembreteData && typeof lembrete.motivo === "string" && lembrete.motivo.trim() ? lembrete.motivo.trim() : null;
        return { categoria, sugestao_resposta: categoria === "ambiguo" ? null : sugestao, lembreteData, lembreteMotivo: lembreteData ? lembreteMotivo : null, debugBruto: bruto };
    } catch (e) {
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

        // Bug real corrigido (2026-10-06, mesma classe do fix em
        // sugerir-resposta-whatsapp): sem isso, uma classificação pendente
        // de uma rodada anterior nunca era descartada quando a conversa
        // andava e uma nova classificação nascia pro mesmo lead — 32
        // leads reais chegaram a acumular até 5 pendentes ao mesmo tempo
        // no painel "Respostas de Convite pra Revisar".
        await supabaseAdmin.from("classificacoes_resposta_convite")
            .update({ status: "descartada" })
            .eq("pessoaIdentificador", item.pessoaIdentificador)
            .eq("status", "pendente")
            .neq("mensagem_origem_id", item.mensagem_id);

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

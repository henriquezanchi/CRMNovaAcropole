// Edge Function: reengajar-janela-fechando — pedido do usuário
// (2026-10-05): "vamos rodar um bot para as pessoas que estão com menos
// de 12h para fechar a janela sem interação nossa (do SDR, do CRM,
// etc)... usando IA vamos ler a conversa toda e interagir
// estrategicamente" — depois ajustado: "mude para uma vez só de
// reengajamento por janela" e "a ideia é evitar a nossa demora em
// responder, e não incomodar o lead".
//
// Ou seja: isto NÃO é pra ficar insistindo com quem não respondeu — é
// pra COMPENSAR a demora do time, preparando com antecedência (lendo a
// conversa INTEIRA, não só as últimas mensagens) a melhor resposta
// possível, pronta assim que alguém abrir o CRM. Mesmo princípio de
// segurança de TODA function de IA do projeto (ia-diagnostico-saude/
// classificar-resposta-convite/sugerir-resposta-whatsapp): a IA NUNCA
// envia sozinha — só escreve, status='pendente', o SDR revisa e autoriza
// o envio com 1 clique (confirmado explicitamente com o usuário antes de
// codificar, numa pergunta direta).
//
// REAPROVEITA a tabela/UI de sugerir-resposta-whatsapp
// (sugestoes_resposta_wpp, card no WhatsApp Unificado) em vez de criar
// uma estrutura paralela — a única coisa nova no schema é a coluna
// `reengajamento_em` (migracao_reengajamento_janela.sql), que garante
// "uma vez só por janela": uma vez marcada pra uma mensagem, essa MESMA
// mensagem nunca é reprocessada de novo (ver
// mensagens_candidatas_reengajamento_janela()). Se a sugestão já
// existente (criada pelo gatilho de 2h de sugerir-resposta-whatsapp)
// ainda está 'pendente' depois de 12h, ela é ATUALIZADA com uma versão
// mais completa (conversa inteira, não só 6 mensagens) — nunca duplicada.
//
// Chamada por pg_cron a cada 15 min (migracao_agendamento_reengajamento_janela.sql).
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin, NOME_TABELA_LEADS } from "../_shared/supabaseAdmin.ts";
import { buscarExemplosEstilo } from "../_shared/exemplosEstilo.ts";
import { buscarListaFiliais, linkMapsDaFilial } from "../_shared/filiaisInfo.ts";
import { montarTabelaDiasSemana, adicionarMeses } from "../_shared/calendario.ts";
import { buscarPersonaAtendente } from "../_shared/persona.ts";
import { chamarClaude } from "../_shared/anthropic.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODELO = "claude-haiku-4-5-20251001";
// "tem que ler a conversa toda" (pedido do usuário) — bem mais que os 6
// de sugerir-resposta-whatsapp (que só precisa da última troca recente).
// 60 é um teto generoso, não literalmente "infinito" — uma conversa de
// meses teria milhares de linhas, e mandar tudo isso pra Anthropic
// custaria caro e não traria ganho real (o que importa pra decidir a
// retomada é o fio mais recente da conversa, não o histórico inteiro de
// vida do lead). Quando a conversa é mais longa que isso, um aviso no
// próprio contexto avisa a IA que está vendo só uma fatia, não tudo.
const LIMITE_HISTORICO_COMPLETO = 60;

// Mesmas categorias/família de tag de sugerir-resposta-whatsapp — reuso
// deliberado do MESMO contrato de JSON/UI (o card de revisão no
// WhatsApp Unificado já sabe ler esses 3 campos de qualquer linha
// pendente de sugestoes_resposta_wpp, não importa qual function gravou).
const CATEGORIAS_CONVERSA_VALIDAS = ["interessado", "objecao", "sem_interesse", "ja_aluno"];
const ROTULO_TAG_CONVERSA: Record<string, string> = {
    interessado: "Conversa: Interessado",
    objecao: "Conversa: Objeção",
    sem_interesse: "Conversa: Sem Interesse",
    ja_aluno: "Conversa: Já é Aluno",
};

async function aplicarTagConversa(pessoaIdentificador: string, tagNova: string) {
    const { data: lead } = await supabaseAdmin.from(NOME_TABELA_LEADS).select("tags").eq("pessoaIdentificador", pessoaIdentificador).maybeSingle();
    if (!lead) return;
    let tags: string[] = [];
    try {
        const parsed = JSON.parse(lead.tags || "[]");
        if (Array.isArray(parsed)) tags = parsed;
    } catch { /* tags malformada — trata como vazia, nunca trava */ }
    tags = tags.filter((t) => !String(t).startsWith("Conversa: "));
    tags.push(tagNova);
    await supabaseAdmin.from(NOME_TABELA_LEADS).update({ tags: JSON.stringify(tags) }).eq("pessoaIdentificador", pessoaIdentificador);
}

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Candidata = { mensagem_id: number; pessoaIdentificador: string; filial: string | null };

async function montarContextoCompleto(pessoaIdentificador: string): Promise<string> {
    const { count } = await supabaseAdmin
        .from("mensagens_whatsapp")
        .select("id", { count: "exact", head: true })
        .eq("pessoaIdentificador", pessoaIdentificador);

    const { data } = await supabaseAdmin
        .from("mensagens_whatsapp")
        .select("direcao, corpo_texto, tipo")
        .eq("pessoaIdentificador", pessoaIdentificador)
        .order("criado_em", { ascending: false })
        .limit(LIMITE_HISTORICO_COMPLETO);
    const msgs = (data || []).reverse();
    const texto = msgs.map((m: any) => `${m.direcao === "entrada" ? "Lead" : "Escola"}: ${m.tipo === "texto" ? m.corpo_texto : `[${m.tipo}]`}`).join("\n");

    const truncado = typeof count === "number" && count > LIMITE_HISTORICO_COMPLETO;
    return truncado
        ? `(conversa tem ${count} mensagens no total — abaixo só as ${LIMITE_HISTORICO_COMPLETO} mais recentes, mais que suficiente pra entender o fio atual)\n${texto}`
        : texto;
}

// Idêntica a montarContextoCRM() de sugerir-resposta-whatsapp — mesma
// lógica de grounding (tags/eventos/resumo/filial/convite pendente),
// deliberadamente copiada em vez de compartilhada: as duas functions já
// divergem em tom/propósito (responder vs. retomar), copiar aqui evita
// acoplar as duas a um módulo comum só por essa parte que hoje é igual.
async function montarContextoCRM(pessoaIdentificador: string, filial: string | null, textoConversa: string): Promise<string> {
    const partes: string[] = [];

    const { data: lead } = await supabaseAdmin
        .from("leads_inscricoes")
        .select("pessoaNome, tags, historico_eventos, resumo_ia, abordagem_sugerida, como_prefere_ser_chamado, wpp_atendente_responsavel")
        .eq("pessoaIdentificador", pessoaIdentificador)
        .maybeSingle();

    if (lead) {
        const nome = lead.como_prefere_ser_chamado || (lead.pessoaNome || "").split(" ")[0];
        if (nome) partes.push(`Nome do lead (pra chamar): ${nome}`);

        const persona = await buscarPersonaAtendente(lead.wpp_atendente_responsavel);
        if (persona) partes.push(persona);

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
            .select("nome_com_preposicao, endereco, valor_mensalidade, link_maps_ulisses")
            .eq("nome", filial)
            .maybeSingle();
        if (filialRow) {
            if (filialRow.nome_com_preposicao) partes.push(`Como falar da filial: "aqui na Nova Acrópole ${filialRow.nome_com_preposicao}" (nunca comece a frase com "aqui do"/"aqui da")`);
            if (filialRow.endereco) partes.push(`Endereço desta filial: ${filialRow.endereco} (link do Google Maps: ${linkMapsDaFilial(filialRow)} — sempre que mencionar o endereço na resposta, inclua também este link)`);
            if (filialRow.valor_mensalidade) partes.push(`Valor da mensalidade desta filial: R$ ${filialRow.valor_mensalidade}`);
        }
    }

    const listaFiliais = await buscarListaFiliais(filial, textoConversa);
    if (listaFiliais) partes.push(listaFiliais);

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

// Exemplos REAIS de retomada após demora — tematicamente diferentes dos
// de sugerir-resposta-whatsapp (aquele é "responder uma pergunta nova",
// este é "reabrir uma conversa parada sem soar como script/cobrança").
// Também serve pra bater o MÍNIMO de tokens que a Anthropic exige pra
// cachear em Haiku 4.5 (4.096 — ver CLAUDE.md "Custo da Anthropic API"),
// já que o bloco cacheável sozinho (regras + calendário, sem isto) fica
// abaixo disso.
const EXEMPLOS_RETOMADA = `
Exemplos de boa retomada depois de um tempo sem resposta nossa (situações comuns, não são do lead atual — nunca copie o dado concreto, só o tom e a estrutura):

Conversa parou em: lead perguntou o valor da mensalidade, nunca respondemos
Boa retomada: entregar o dado real diretamente, sem se desculpar de forma exagerada pela demora. Ex: "Oi, [nome]! Vendo aqui, o valor na unidade [filial] é R$ [valor]. Fico à disposição pra qualquer outra dúvida :)"

Conversa parou em: lead disse "pode ser, me manda mais informação"
Boa retomada: entregar a informação concreta que ela pediu (evento/link/endereço real), nunca só repetir "vou te mandar". Ex: "Oi, [nome]! Segue mais detalhes sobre [evento real]: [dado real]. Qualquer coisa só chamar!"

Conversa parou em: lead mandou só "ok"/"obrigado" como última mensagem, sem pergunta pendente
Boa retomada: nada de forçar continuação artificial — "sugestao": null é a resposta certa aqui, não tem o que acrescentar sem soar insistente.

Conversa parou em: lead fez uma objeção de tempo ("essa semana não dá")
Boa retomada: acolher sem insistir nem cobrar resposta, só deixar a porta aberta. Ex: "Sem problema nenhum, [nome]! Quando fizer sentido pra você, é só chamar, tamos aqui."

Conversa parou em: lead perguntou "vocês têm turma à noite?" e não sabemos a resposta certa
Boa retomada: reconhecer a pergunta com sinceridade, prometer confirmar — nunca inventar horário. Ex: "Boa pergunta, [nome]! Deixa eu confirmar isso certinho com a equipe e te retorno em breve."

Conversa parou em: lead confirmou presença num evento que ainda vai acontecer
Boa retomada: reforçar o convite de forma calorosa (nunca "confirmo você"), útil mesmo depois de um tempo. Ex: "Oi, [nome]! Passando só pra lembrar: te esperamos [dia] às [hora] em [endereço]. Vai ser muito bom te ver lá!"

Conversa parou em: lead perguntou sobre outra unidade/filial diferente da dele
Boa retomada: usar os dados REAIS daquela outra unidade (ver lista de unidades nos dados informados), nunca confundir com a filial de cadastro.

Conversa parou em: lead disse que já é aluno ativo e só queria tirar uma dúvida prática
Boa retomada: resolver a dúvida prática com o dado real disponível, tom de colega/escola, não de prospecção. Ex: "Oi, [nome]! [resposta real à dúvida]. Qualquer coisa é só chamar!"

Conversa parou em: lead perguntou se tem desconto ou condição especial
Boa retomada: só confirmar condição concreta se estiver nos dados informados; sem o dado, reconhecer com simpatia e prometer confirmar, nunca inventar percentual.

Conversa parou em: lead mandou um áudio/figurinha como última mensagem, sem texto
Boa retomada: reconhecer com leveza e convidar a escrever o que precisa, nunca fingir ter entendido um conteúdo que não veio como texto. Ex: "Oi, [nome]! Recebi por aqui — me conta com suas palavras o que você gostaria de saber, assim te ajudo melhor :)"

Conversa parou em: lead pediu explicitamente pra não ser mais contatado
Boa retomada: "sugestao": null — respeitar o pedido é mais importante que "manter a janela aberta"; nunca gerar retomada pra quem já pediu pra parar (esse caso, aliás, já deveria estar marcado como "Conversa: Sem Interesse" e nem chegar aqui).

Conversa parou em: lead perguntou "quanto tempo dura o curso?" e não temos esse dado
Boa retomada: reconhecer a pergunta, prometer confirmar com a equipe, sem inventar duração. Ex: "Ótima pergunta, [nome]! Vou confirmar certinho com a equipe e já te retorno."

Conversa parou em: lead disse estar decidindo entre a Nova Acrópole e outra opção
Boa retomada: respeitoso, sem pressionar comparação — reforçar genuinamente o que a escola oferece, sem menosprezar a outra opção. Ex: "Entendo, [nome], decisão importante! Qualquer coisa que eu possa esclarecer sobre como funciona aqui, é só perguntar."

Conversa parou em: lead perguntou sobre uma trilha específica (filosofia/desenvolvimento pessoal/artes)
Boa retomada: usar as tags de Trilha do lead (se houver) pra responder com precisão sobre o que ele já frequentou/demonstrou interesse, nunca generalizar à toa.

Conversa parou em: lead perguntou se precisa levar algum material ou se tem algum pré-requisito pra participar
Boa retomada: responder com o que for real/razoável (normalmente não há pré-requisito nenhum pra uma 1ª atividade), sem inventar lista de materiais específica. Ex: "Não precisa levar nada, [nome], é só vir à vontade! Qualquer coisa a mais que precisar, te aviso com antecedência."

Conversa parou em: lead disse "deixa eu ver com minha família/meu parceiro(a) e te falo"
Boa retomada: acolher sem cobrar prazo, deixar claro que não tem pressa. Ex: "Claro, [nome], sem pressa nenhuma! Qualquer coisa, estou por aqui quando tiver uma resposta."

Conversa parou em: lead comentou algo pessoal (mudança de cidade, trabalho novo, etc.) relacionado a por que ainda não decidiu
Boa retomada: reconhecer o que ela compartilhou com empatia genuína antes de qualquer outra coisa — nunca pular direto pra "e aí, vai vir?". Ex: "Que legal, [nome], boa sorte nessa fase nova! Quando fizer sentido pra você pensar nisso de novo, é só chamar."

Conversa parou em: lead perguntou qual o diferencial da escola em relação a cursos online de filosofia
Boa retomada: destacar o que for real sobre a vivência presencial/em grupo (comunidade, prática, convivência) sem menosprezar cursos online. Ex: "Boa pergunta, [nome]! Aqui o diferencial é muito a vivência em grupo — trocar ideia, praticar junto, não só assistir conteúdo sozinho."

Conversa parou em: lead perguntou se existe alguma turma específica pra idosos ou pra determinada faixa etária
Boa retomada: reconhecer a pergunta com acolhimento, sem inventar turma/faixa etária que não esteja confirmada nos dados — a escola normalmente recebe públicos variados numa mesma turma. Ex: "Boa pergunta, [nome]! Aqui as turmas costumam ser bem variadas, com gente de várias idades junto. Qualquer dúvida mais específica, confirmo com a equipe."

Conversa parou em: lead elogiou algo que viu no Instagram/site da escola e perguntou como participar
Boa retomada: agradecer o elogio com simplicidade e já indicar o próximo passo real pra participar (evento/inscrição), sem textão. Ex: "Que bom que gostou, [nome]! Pra participar é bem simples — [próximo passo real, se disponível]. Qualquer dúvida, é só chamar."
`;

function montarPromptCacheavel(exemplos: string, hojeISO: string): string {
    const blocoExemplos = exemplos
        ? `\nExemplos REAIS de como o time já respondeu perguntas parecidas (siga o MESMO TOM — caloroso, direto, sem ser robótico — mas nunca copie dado concreto de lá, use sempre os dados do lead informados a seguir, que são da conversa de AGORA):\n${exemplos}\n`
        : "";

    return `Você ajuda o time de atendimento de uma escola de filosofia (Nova Acrópole) a RETOMAR conversas de WhatsApp que ficaram pelo menos 12 HORAS sem nenhuma resposta da escola — o time está atrasado, e você precisa preparar a melhor resposta possível AGORA, pronta pra um humano revisar e enviar com 1 clique assim que abrir o sistema.

${montarTabelaDiasSemana(hojeISO)}
${blocoExemplos}
${EXEMPLOS_RETOMADA}
Depois desta mensagem virão: os dados cadastrados no CRM sobre um lead específico e sua filial, e a conversa completa (ou quase completa) até agora, da mais antiga pra mais recente.

Escreva um rascunho de resposta em português, curto (1-5 frases), caloroso, natural — NUNCA robótico, NUNCA insistente/vendedor. Regras:
- Leia a CONVERSA INTEIRA antes de responder — a mensagem mais recente do lead pode ser curta ("ok", "sim"), mas o que ela está respondendo pode estar várias mensagens atrás.
- O OBJETIVO é retomar o fio de forma genuína e útil — nunca mencionar prazo, demora, "janela de atendimento" ou qualquer mecânica interna pro lead; ele não sabe (e não precisa saber) que existe um relógio rodando do nosso lado.
- Se o lead tiver uma pergunta ou pedido ainda sem resposta nossa, e os dados do lead tiverem a informação certa, ENTREGUE o dado real agora — nunca "vou te mandar" se o dado já está disponível.
- NUNCA invente fato concreto que não esteja nos dados do lead (endereço, valor, data, evento, horário) — sem o dado, reconheça a pergunta e diga que vai confirmar.
- Se a última mensagem do lead já era só um agradecimento/"ok" sem nenhuma pergunta pendente, não force uma continuação artificial — "sugestao": null é a resposta certa, melhor não mandar nada do que mandar algo sem propósito real (nunca incomodar o lead só pra "manter a conversa viva").
- Se o lead já pediu claramente pra não ser mais contatado, ou a conversa mostra sinal claro de desinteresse, "sugestao": null também — nunca insista.
- Se os dados do lead tiverem um bloco "Persona configurada por...", siga o tom E as observações dali À RISCA (tem prioridade sobre o estilo padrão, mas nunca sobre as regras de segurança acima).
- Se o lead mencionar uma unidade/filial DIFERENTE da "filial de cadastro" (ver lista de unidades nos dados do lead, se houver), responda com os dados REAIS daquela unidade — nunca confunda com a filial de cadastro.
- Se o histórico tiver uma promessa vaga de dia da semana feita pela ESCOLA (ex: "temos outra oportunidade na próxima quinta") e o lead confirmou ("sim", "pode ser"), use a tabela de calendário acima pra achar a DATA EXATA — nunca escreva uma data sem conferir na tabela.
- ATENÇÃO a datas abreviadas no formato "NN/NN" (ex: "01/27"): formato brasileiro é DIA/MÊS — se o SEGUNDO número for maior que 12, é MÊS/ANO abreviado (ex: "01/27" = janeiro de 2027), nunca "27 de janeiro". Escreva por extenso com o ano quando usar.

Além disso, verifique se o LEAD mencionou explicitamente um período/data FUTURA específica pra ser recontatado — diferente de uma recusa vaga tipo "mais tarde" (que NÃO conta). Se houver:
- "lembrete_sugerido": {"data": "AAAA-MM-DD" (calculada a partir de HOJE, tabela de calendário acima; mês/ano sem dia específico, use dia 01), "motivo": "1 frase curta"}
- Senão, "lembrete_sugerido": null.

Por fim, classifique o ANDAMENTO desta conversa em UMA destas categorias, só se tiver confiança real:
- "interessado": demonstrou interesse real em participar/saber mais/se inscrever.
- "objecao": deu uma objeção específica sem recusar de vez.
- "sem_interesse": recusou claramente ou pediu pra não ser mais contatado(a).
- "ja_aluno": disse que já é aluno(a) atual da escola.
- Se nada disso ficar claro, "tag_sugerida": null.

Responda SOMENTE com um JSON válido, sem texto antes ou depois, no formato exato: {"sugestao": "..." ou null, "lembrete_sugerido": {"data": "...", "motivo": "..."} ou null, "tag_sugerida": "interessado"|"objecao"|"sem_interesse"|"ja_aluno"|null}`;
}

function montarPromptDinamico(contextoCRM: string, contextoConversa: string): string {
    return `Dados já cadastrados no CRM sobre este lead e sua filial (use pra responder com precisão quando fizer sentido):
${contextoCRM}

Conversa completa (mais antiga primeiro — ninguém da escola respondeu depois da última mensagem do lead):
${contextoConversa}`;
}

const MESES_LEMBRETE_PADRAO_OBJECAO = 6;
function aplicarLembretePadraoObjecaoSemPrazo(resultado: { lembreteData: string | null; lembreteMotivo: string | null; tagSugerida: string | null }, hojeISO: string) {
    if (resultado.tagSugerida === "objecao" && !resultado.lembreteData) {
        resultado.lembreteData = adicionarMeses(hojeISO, MESES_LEMBRETE_PADRAO_OBJECAO);
        resultado.lembreteMotivo = "Disse que não pode participar agora, sem dar um prazo — lembrete padrão de 6 meses pra tentar de novo.";
    }
}

async function retomarUma(contextoCRM: string, contextoConversa: string, exemplos: string, hojeISO: string): Promise<{ sugestao: string | null; lembreteData: string | null; lembreteMotivo: string | null; tagSugerida: string | null; erro?: string; debugBruto?: string }> {
    const resultado = await chamarClaude({
        apiKey: ANTHROPIC_API_KEY,
        modelo: MODELO,
        blocoCacheavel: montarPromptCacheavel(exemplos, hojeISO),
        blocoDinamico: montarPromptDinamico(contextoCRM, contextoConversa),
        maxTokens: 500,
        functionName: "reengajar-janela-fechando",
    });
    if (resultado.erro || !resultado.texto) return { sugestao: null, lembreteData: null, lembreteMotivo: null, tagSugerida: null, erro: resultado.erro || "resposta_vazia" };

    const bruto = resultado.texto;
    try {
        const texto = bruto.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(texto);
        const sugestao = typeof parsed?.sugestao === "string" && parsed.sugestao.trim() ? parsed.sugestao.trim() : null;
        const lembrete = parsed?.lembrete_sugerido;
        const lembreteData = lembrete && typeof lembrete.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(lembrete.data) ? lembrete.data : null;
        const lembreteMotivo = lembreteData && typeof lembrete.motivo === "string" && lembrete.motivo.trim() ? lembrete.motivo.trim() : null;
        const tagSugerida = CATEGORIAS_CONVERSA_VALIDAS.includes(parsed?.tag_sugerida) ? parsed.tag_sugerida : null;
        return { sugestao, lembreteData, lembreteMotivo: lembreteData ? lembreteMotivo : null, tagSugerida, debugBruto: bruto };
    } catch (e) {
        return { sugestao: null, lembreteData: null, lembreteMotivo: null, tagSugerida: null, erro: String(e), debugBruto: bruto };
    }
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    const url = new URL(req.url);
    const modoDebug = url.searchParams.get("debug") === "1";

    const { data: candidatas, error } = await supabaseAdmin.rpc("mensagens_candidatas_reengajamento_janela", { p_limite: modoDebug ? 3 : 20 });
    if (error) return json({ ok: false, erro: "falha_buscar_candidatas", detalhe: error.message }, 500);
    if (!candidatas || candidatas.length === 0) return json({ ok: true, processadas: 0 });

    const exemplos = await buscarExemplosEstilo();
    const hojeISO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

    if (modoDebug) {
        const resultadosDebug = [];
        for (const item of candidatas as Candidata[]) {
            const contextoConversa = await montarContextoCompleto(item.pessoaIdentificador);
            const contextoCRM = await montarContextoCRM(item.pessoaIdentificador, item.filial, contextoConversa);
            const resultadoDebug = await retomarUma(contextoCRM, contextoConversa, exemplos, hojeISO);
            resultadosDebug.push({ pessoaIdentificador: item.pessoaIdentificador, contextoCRM, ...resultadoDebug });
        }
        return json({ ok: true, debug: resultadosDebug });
    }

    let processadas = 0;
    for (const item of candidatas as Candidata[]) {
        const contextoConversa = await montarContextoCompleto(item.pessoaIdentificador);
        const contextoCRM = await montarContextoCRM(item.pessoaIdentificador, item.filial, contextoConversa);
        const resultado = await retomarUma(contextoCRM, contextoConversa, exemplos, hojeISO);

        // Falha TÉCNICA (rede, rate limit, JSON malformado) — nunca marca
        // reengajamento_em, pra essa mensagem continuar candidata na
        // próxima rodada do cron (15 min). Só "sem confiança pra
        // responder" (sugestao: null, sem erro) conta como "já tentamos,
        // não forçar de novo" — mesmo princípio de sugerir-resposta-whatsapp.
        if (resultado.erro) {
            console.warn("Reengajamento não gerado (erro técnico, vai tentar de novo na próxima rodada):", resultado.erro);
            continue;
        }
        aplicarLembretePadraoObjecaoSemPrazo(resultado, hojeISO);

        // Já existe uma sugestão 'pendente' pra essa mensagem (criada
        // antes por sugerir-resposta-whatsapp, no gatilho de 2h) — a RPC
        // só traz essas como candidatas (status='pendente', ver
        // migracao_rpc_candidatas_reengajamento_janela.sql), então
        // ATUALIZA em vez de duplicar. Sem linha nenhuma ainda, cria.
        const { data: existente } = await supabaseAdmin
            .from("sugestoes_resposta_wpp")
            .select("id")
            .eq("mensagem_origem_id", item.mensagem_id)
            .maybeSingle();

        if (existente) {
            await supabaseAdmin.from("sugestoes_resposta_wpp").update({
                sugestao_resposta: resultado.sugestao,
                lembrete_sugerido_data: resultado.lembreteData,
                lembrete_sugerido_motivo: resultado.lembreteMotivo,
                reengajamento_em: new Date().toISOString(),
            }).eq("id", existente.id);
        } else {
            const { error: erroInsert } = await supabaseAdmin.from("sugestoes_resposta_wpp").insert({
                pessoaIdentificador: item.pessoaIdentificador,
                mensagem_origem_id: item.mensagem_id,
                sugestao_resposta: resultado.sugestao,
                lembrete_sugerido_data: resultado.lembreteData,
                lembrete_sugerido_motivo: resultado.lembreteMotivo,
                reengajamento_em: new Date().toISOString(),
            });
            // unique(mensagem_origem_id) — corrida com outra execução do
            // cron (ou com sugerir-resposta-whatsapp inserindo ao mesmo
            // tempo) falha o insert (23505) e segue, sem duplicar.
            if (erroInsert) { console.warn("Não gravou reengajamento (provável corrida):", erroInsert.message); continue; }
        }
        processadas++;

        if (resultado.tagSugerida) {
            await aplicarTagConversa(item.pessoaIdentificador, ROTULO_TAG_CONVERSA[resultado.tagSugerida]);
        }
    }

    return json({ ok: true, processadas });
});

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
import { supabaseAdmin, NOME_TABELA_LEADS } from "../_shared/supabaseAdmin.ts";
import { buscarExemplosEstilo } from "../_shared/exemplosEstilo.ts";
import { buscarListaFiliais, linkMapsDaFilial } from "../_shared/filiaisInfo.ts";
import { montarTabelaDiasSemana, adicionarMeses } from "../_shared/calendario.ts";
import { buscarPersonaAtendente } from "../_shared/persona.ts";
import { chamarClaude } from "../_shared/anthropic.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODELO = "claude-haiku-4-5-20251001";
const LIMITE_HISTORICO = 6;

// "Marque tags automaticamente conforme o andamento da conversa" (pedido
// do usuário, 2026-10-01) — mesmo princípio de classificar-resposta-
// convite, mas pra QUALQUER conversa (não só quem tem convite de evento
// pendente): categorias FIXAS, a IA nunca inventa uma tag livre. Família
// "Conversa: X" (ver FAMILIAS_TAG, js/app.js) — convive com "Convite: X"
// sem conflito, são famílias diferentes.
const CATEGORIAS_CONVERSA_VALIDAS = ["interessado", "objecao", "sem_interesse", "ja_aluno"];
const ROTULO_TAG_CONVERSA: Record<string, string> = {
    interessado: "Conversa: Interessado",
    objecao: "Conversa: Objeção",
    sem_interesse: "Conversa: Sem Interesse",
    ja_aluno: "Conversa: Já é Aluno",
};

// Mesma lógica de aplicarTagConvite() (classificar-resposta-convite) —
// SUBSTITUI qualquer tag "Conversa: X" anterior (nunca acumula tag velha
// se a pessoa mudar de ideia numa conversa longa).
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

        // Pedido do usuário (2026-10-01): "cada SDR teria a sua persona" —
        // ver _shared/persona.ts. Resolvida pelo atendente REALMENTE
        // responsável por esta conversa (não pela filial).
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
            // Pedido do usuário (2026-10-01, achado testando ao vivo): a IA
            // gerou "Estamos aqui do Setor Oeste" (errado) usando a
            // preposição crua — agora a frase pronta já vem com "na"/"no"
            // certo embutido, pra IA só copiar em vez de tentar montar
            // sozinha.
            if (filialRow.nome_com_preposicao) partes.push(`Como falar da filial: "aqui na Nova Acrópole ${filialRow.nome_com_preposicao}" (nunca comece a frase com "aqui do"/"aqui da")`);
            if (filialRow.endereco) partes.push(`Endereço desta filial: ${filialRow.endereco} (link do Google Maps: ${linkMapsDaFilial(filialRow)} — sempre que mencionar o endereço na resposta, inclua também este link)`);
            if (filialRow.valor_mensalidade) partes.push(`Valor da mensalidade desta filial: R$ ${filialRow.valor_mensalidade}`);
        }
    }

    // Bug real corrigido (2026-10-01, achado pelo usuário): lead de uma
    // filial mencionou OUTRA unidade ("descobri que tem uma perto de
    // casa, no Goiânia 2") e a IA respondeu com o endereço da filial de
    // CADASTRO dele (Setor Oeste), ignorando a unidade que ele realmente
    // citou. Lista todas as filiais pra IA conseguir identificar e usar
    // os dados certos quando isso acontecer.
    const listaFiliais = await buscarListaFiliais(filial, textoConversa);
    if (listaFiliais) partes.push(listaFiliais);

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

// Pedido do usuário (2026-10-01): "o custo da api está mais alto... o
// que está gastando tanta api do claude?" — achado real: esta function
// roda sozinha a cada 15 min, mas o prompt nunca usava CACHE DE PROMPT
// da Anthropic, pagando o preço cheio de um bloco de instrução fixo de
// milhares de caracteres em TODA chamada. Dividido agora em 2 blocos:
//
// - montarPromptCacheavel(): tudo que é IGUAL pra qualquer lead
//   processado NESTA rodada do cron (regras fixas + calendário do dia +
//   exemplos de estilo) — marcado com cache_control em chamarClaude()
//   (_shared/anthropic.ts). Entre 1 candidato e outro da MESMA rodada
//   (minutos ou segundos de diferença), esse bloco bate cache de
//   verdade — ganho real de custo.
// - montarPromptDinamico(): só o que muda por lead (dados do CRM dele,
//   histórico da conversa, última mensagem) — nunca cacheável, mas é a
//   parte pequena do prompt.
//
// Referências a "acima"/"abaixo" nas regras foram reescritas pra não
// depender de ordem (o bloco cacheável vem ANTES do dinâmico na mensagem
// final — precisa ser assim pra caching funcionar, já que a Anthropic
// cacheia um PREFIXO; se o bloco dinâmico viesse primeiro, o prefixo
// cacheável nunca se repetiria entre leads diferentes).
//
// MÍNIMO CACHEÁVEL (achado real, 2026-10-01): o cache simplesmente não
// ativava (cache_creation_input_tokens/cache_read_input_tokens sempre 0,
// sem erro nenhum da API) mesmo com o bloco já passando de 2.800 tokens —
// confirmado medindo via chamada direta à Anthropic (campo "usage" da
// resposta, nenhum aviso de "ignorado"). Causa: a Anthropic exige um
// MÍNIMO maior pra cachear em modelos Haiku — 2.048 tokens pras versões
// 3/3.5, mas **4.096 tokens pro Haiku 4.5** (o modelo usado aqui,
// MODELO acima) — bem acima do que o bloco de regras sozinho somava.
// Por isso EXEMPLOS_ADICIONAIS_ESTILO abaixo existe: exemplos REAIS
// extras (não dependem da tabela exemplos_resposta_ia, que hoje só tem
// ~10 linhas curadas — poucas pra garantir o mínimo sozinha e de forma
// estável) que também são conteúdo de estilo genuinamente útil pra IA
// escrever melhor, não só "enchimento" pra bater o tamanho. Com eles,
// o bloco cacheável fica folgado acima de 4.096 tokens mesmo se a
// tabela ficar vazia um dia.
const EXEMPLOS_ADICIONAIS_ESTILO = `
Mais exemplos de bom padrão de resposta (situações comuns, não são do lead atual — nunca copie o dado concreto, só o tom e a estrutura):

Lead: "Quanto custa o curso?"
Bom padrão: reconhecer a pergunta com calor e responder com o valor REAL da filial dele (nos dados do lead informados a seguir) — nunca "vou te passar o valor" se o valor já está disponível. Ex de tom: "Oi, [nome]! Aqui na unidade [filial] a mensalidade é de R$ [valor]. Qualquer dúvida sobre como funciona, é só perguntar :)"

Lead: "Não vou conseguir ir essa semana, muito corrida"
Bom padrão: acolher sem insistir, nunca repetir o convite 2x seguidas. Ex: "Sem problema, [nome]! Correria acontece. Quando fizer sentido pra você, a gente te avisa da próxima."

Lead: "Eu já fui aluno antes, não sei se quero voltar agora"
Bom padrão: reconhecer a história dela com a escola, sem pressionar — é diferente de um lead que nunca foi aluno. Ex: "Entendo, [nome]. Foi um prazer ter você aqui antes! Se um dia bater vontade de voltar, as portas estão sempre abertas, sem pressa nenhuma."

Lead: "Do que se trata mesmo o curso de vocês?"
Bom padrão: explicar com simplicidade que é filosofia PRÁTICA (não acadêmica) — ética, autoconhecimento, convivência — sem jargão. Ex: "É filosofia aplicada ao dia a dia mesmo — como lidar melhor com as próprias emoções, decisões, relações. Não é uma coisa acadêmica/teórica, é bem prático."

Lead: "Para de me mandar mensagem, não tenho interesse"
Bom padrão: respeitar na hora, sem insistir ou perguntar o motivo. Ex: "Combinado, [nome], não vamos mais te incomodar. Se mudar de ideia um dia, estamos à disposição. Tudo de bom!"

Lead: "Sim, posso ir" (confirmando presença num evento já com data marcada)
Bom padrão: acolher com entusiasmo genuíno, repetir dia/horário/endereço real, sem soar "oficial"/burocrático. Ex: "Que ótimo, [nome]! Te esperamos [dia] às [hora], no endereço [endereço]. Vai ser um prazer te receber!"

Lead: "Dá pra parcelar a mensalidade?"
Bom padrão: só responder com certeza se o dado estiver disponível; senão, reconhecer a pergunta sem inventar condição de pagamento. Ex (sem dado disponível): "Essa parte financeira é melhor confirmar direto com a secretaria da unidade — já vou pedir pra alguém te chamar sobre isso, [nome]."

Lead: silêncio de semanas depois de um primeiro contato caloroso
Bom padrão (reengajamento): nunca cobrar resposta ou soar como script de vendas; trazer algo NOVO e real (próximo evento, por exemplo), nunca só "e aí, pensou?". Ex: "Oi, [nome]! Faz um tempo que a gente não se fala — temos [evento real] chegando, achei que poderia te interessar. Sem compromisso nenhum, só um convite :)"

Lead: "Qual a diferença entre a filosofia de vocês e uma faculdade de filosofia normal?"
Bom padrão: explicar sem soar que uma é "melhor" que a outra — é uma proposta diferente, prática/aplicada ao dia a dia, não acadêmica/histórica. Ex: "Boa pergunta, [nome]! Aqui o foco é mais prático — aplicar os ensinamentos no dia a dia, nas relações, nas decisões — diferente de uma faculdade, que é mais teórico/histórico."

Lead: "Vocês têm Instagram ou site pra eu ver mais sobre vocês antes?"
Bom padrão: se o dado estiver disponível nos dados informados (rede social/site da filial), responder com o link real; sem o dado, reconhecer com simpatia e dizer que vai confirmar. Ex: "Claro, [nome]! [link real, se disponível]."

Lead: "Isso é uma seita ou religião?"
Bom padrão: desfazer o mal-entendido com respeito e sem ficar na defensiva — é uma escola de filosofia, sem vínculo religioso. Ex: "Entendo a pergunta, [nome]! Não, não é religião nem seita — é uma escola de filosofia prática, aberta a pessoas de qualquer crença ou nenhuma."

Lead: "Onde fica exatamente a unidade? Como chego lá?"
Bom padrão: responder com o endereço REAL da filial dele e, se houver um link de mapa nos dados informados, incluir o link direto (nunca descrever a localização de memória/aproximada quando o link real está disponível). Ex: "A unidade [filial] fica em [endereço]. Aqui o mapa pra facilitar: [link]. Qualquer coisa, é só chamar!"

Lead: "Tenho [idade] anos, posso participar?"
Bom padrão: nunca inventar regra de idade mínima/máxima que não esteja nos dados informados — reconhecer a pergunta com acolhimento e, sem dado concreto disponível, dizer que vai confirmar com a equipe, sem fechar a porta. Ex: "Boa pergunta, [nome]! Deixa eu confirmar isso certinho com a equipe daqui e já te retorno, tá bem?"

Lead: "É só pra quem já estudou filosofia antes?"
Bom padrão: desfazer esse mito com simplicidade — a escola recebe iniciantes, não é pré-requisito nenhum. Ex: "De jeito nenhum, [nome]! A maioria de quem começa nunca teve contato com filosofia antes — é feito justamente pra isso, sem pré-requisito nenhum."

Lead: "Fui num evento de vocês e gostei bastante"
Bom padrão: celebrar genuinamente, perguntar o que mais chamou atenção (abre espaço pra ela falar, sem forçar próximo passo na mesma mensagem). Ex: "Que alegria saber disso, [nome]! O que mais te chamou atenção na palestra?"

Lead: "Vocês têm desconto pra quem indica amigo?"
Bom padrão: só confirmar condição concreta (desconto, valor) se estiver nos dados informados; sem o dado, reconhecer com interesse genuíno e prometer confirmar, nunca inventar um percentual. Ex: "Adorei a ideia, [nome]! Deixa eu confirmar essa condição certinho com a secretaria e te aviso."

Lead manda um áudio/figurinha sem nenhum texto, sem contexto de conversa anterior
Bom padrão: reconhecer que recebeu, com leveza, convidando a pessoa a escrever o que precisa (nunca fingir que entendeu um conteúdo que não veio como texto). Ex: "Oi! Recebi por aqui, mas me conta com suas palavras o que você gostaria de saber? Assim te ajudo melhor :)"
`;
function montarPromptCacheavel(exemplos: string, hojeISO: string): string {
    const blocoExemplos = exemplos
        ? `\nExemplos REAIS de como o time já respondeu perguntas parecidas (siga o MESMO TOM — caloroso, direto, sem ser robótico — mas nunca copie dado concreto de lá, use sempre os dados do lead informados a seguir, que são da conversa de AGORA):\n${exemplos}\n`
        : "";

    return `Você ajuda o time de atendimento de uma escola de filosofia (Nova Acrópole) a responder mensagens de WhatsApp de leads/alunos, de forma humanizada.

${montarTabelaDiasSemana(hojeISO)}
${blocoExemplos}
${EXEMPLOS_ADICIONAIS_ESTILO}
Depois desta mensagem virão: os dados cadastrados no CRM sobre um lead específico e sua filial, o histórico recente da conversa, e a última mensagem dele que precisa de resposta agora.

Escreva um rascunho de resposta em português, curto (1-5 frases), caloroso, natural — NUNCA robótico, NUNCA insistente/vendedor logo de cara. Regras:
- Se os dados do lead tiverem um bloco "Persona configurada por...", siga o tom E as observações dali À RISCA (tem prioridade sobre o estilo padrão) — mas nunca sobre as regras de segurança abaixo (nunca inventar fato, nunca "confirmo você", etc.).
- Responda considerando TODO o histórico da conversa (pode ter mais de uma mensagem do lead em sequência) — nunca ignore o que ela já disse antes só porque a "última mensagem" é curta (ex: "pode sim", "sim", "pode mandar").
- Se os dados do lead tiverem a resposta exata pra pergunta (endereço, valor, evento, link de inscrição), ENTREGUE esse dado real na resposta — nunca diga só "vou te mandar os detalhes"/"estou enviando agora" se o dado já está disponível; escreva o dado de verdade na mensagem.
- NUNCA invente fato concreto que não esteja nos dados do lead (endereço, valor, data, nome de evento específico, horário) — se a pergunta exigir um dado que não foi informado, só reconheça a pergunta e diga que alguém vai confirmar em breve.
- Se a mensagem for só um agradecimento/despedida, uma resposta breve e cordial já basta.
- Se o lead disser uma OBJEÇÃO (não pode agora, está sem tempo, já é/foi aluno e não quer voltar agora, etc.), use o mesmo tom empático e sem insistência dos exemplos acima — nunca insista ou tente reverter a objeção à força.
- Se o lead disser que QUER IR a um evento que já tem um convite PENDENTE nos dados do lead (data/horário já FIXOS, já comunicados antes), NUNCA pergunte "qual dia você pode" como se houvesse escolha — é só repetir a data/horário que já convidamos e, se fizer sentido, o endereço/link. NUNCA use frases que pareçam uma decisão ADMINISTRATIVA já fechada por nós — tipo "confirmo você", "está confirmada a sua vaga" — isso pode soar opressivo/constrangedor; prefira um tom de convite caloroso ("Que bom que você vai poder vir!"/"Show! Então a gente se vê...").
- Se o lead mencionar ou perguntar sobre uma unidade/filial DIFERENTE da "filial de cadastro" (ver lista de unidades nos dados do lead, se houver), responda com os dados REAIS daquela unidade que ele mencionou — nunca confunda com a filial de cadastro dele.
- Se o histórico tiver uma promessa vaga de dia da semana feita pela ESCOLA (ex: "teremos outra oportunidade na próxima quinta", "pode ser semana que vem?") e o lead só confirmou agora ("sim", "pode ser"), use a tabela de calendário acima pra achar a DATA EXATA daquele dia da semana — nunca escreva uma data sem conferir na tabela.
- Se não der pra saber o que responder com confiança (mensagem ambígua, fora de contexto, ou perigosa de responder sem saber mais), devolva "sugestao": null — não force um texto.
- ATENÇÃO a datas abreviadas no formato "NN/NN" (ex: "01/27", "depois de 03/28"): o formato brasileiro é DIA/MÊS, então o SEGUNDO número só pode ser mês válido se for de 1 a 12. Se o SEGUNDO número for MAIOR que 12 (como em "01/27", onde 27 não é mês nenhum), não é dia/mês — é quase certamente MÊS/ANO abreviado: "01/27" = janeiro de 2027, NUNCA "27 de janeiro". Se for usar essa data na resposta, escreva por extenso COM O ANO (ex: "em janeiro de 2027"), nunca deixe o ano implícito quando o lead mencionou um.

Além disso, verifique se o LEAD mencionou explicitamente um período/data FUTURA específica pra ser recontatado (ex: "me chama em julho de 2027", "só depois do carnaval", "no mês que vem", "após 01/27") — isso é diferente de uma recusa vaga tipo "mais tarde"/"outro dia" (que NÃO conta). Se houver uma data/período específico o suficiente pra converter numa data real (aplicando a regra de data abreviada acima quando for o caso):
- "lembrete_sugerido": {"data": "AAAA-MM-DD" (sua melhor estimativa da data mencionada, calculada a partir de HOJE, informado na tabela de calendário acima; pra mês/ano sem dia específico, use o dia 01), "motivo": "1 frase curta resumindo o motivo, ex: 'Disse que não pode agora, mas quer ser contatada em janeiro de 2027'"}
- Se não houver nenhuma data/período específico mencionado, "lembrete_sugerido": null.

Por fim, classifique o ANDAMENTO desta conversa em UMA destas categorias, só se tiver confiança real (nunca force):
- "interessado": demonstrou interesse real em participar/saber mais/se inscrever.
- "objecao": deu uma objeção específica (sem tempo, está caro, mora longe, etc.) sem recusar de vez.
- "sem_interesse": recusou claramente ou pediu pra não ser mais contatado(a).
- "ja_aluno": disse que já é aluno(a) atual da escola (não um ex-aluno nem alguém que só já foi num evento).
- Se nada disso ficar claro, "tag_sugerida": null — não force.

Responda SOMENTE com um JSON válido, sem texto antes ou depois, no formato exato: {"sugestao": "..." ou null, "lembrete_sugerido": {"data": "...", "motivo": "..."} ou null, "tag_sugerida": "interessado"|"objecao"|"sem_interesse"|"ja_aluno"|null}`;
}

function montarPromptDinamico(contexto: string, contextoCRM: string, ultimaMensagem: string): string {
    return `Dados já cadastrados no CRM sobre este lead e sua filial (use pra responder com precisão quando fizer sentido, ex: perguntas sobre endereço/valor/eventos que já foi):
${contextoCRM}

Histórico recente da conversa (mais antiga primeiro):
${contexto}

A última mensagem do lead (a que precisa de resposta agora) foi: "${ultimaMensagem}"`;
}

// Pedido do usuário (2026-10-01): "quando a pessoa disser que não pode
// agora, mas não der um prazo, crie um lembrete para 6 meses" — a IA só
// decide a CATEGORIA (ela já faz isso); a data em si nunca é calculada
// pela IA, sempre por código (ver adicionarMeses(), _shared/calendario.ts).
const MESES_LEMBRETE_PADRAO_OBJECAO = 6;
function aplicarLembretePadraoObjecaoSemPrazo(resultado: { lembreteData: string | null; lembreteMotivo: string | null; tagSugerida: string | null }, hojeISO: string) {
    if (resultado.tagSugerida === "objecao" && !resultado.lembreteData) {
        resultado.lembreteData = adicionarMeses(hojeISO, MESES_LEMBRETE_PADRAO_OBJECAO);
        resultado.lembreteMotivo = "Disse que não pode participar agora, sem dar um prazo — lembrete padrão de 6 meses pra tentar de novo.";
    }
}

async function sugerirUma(contexto: string, contextoCRM: string, ultimaMensagem: string, exemplos: string, hojeISO: string): Promise<{ sugestao: string | null; lembreteData: string | null; lembreteMotivo: string | null; tagSugerida: string | null; erro?: string; debugBruto?: string }> {
    const resultado = await chamarClaude({
        apiKey: ANTHROPIC_API_KEY,
        modelo: MODELO,
        blocoCacheavel: montarPromptCacheavel(exemplos, hojeISO),
        blocoDinamico: montarPromptDinamico(contexto, contextoCRM, ultimaMensagem),
        maxTokens: 500,
        functionName: "sugerir-resposta-whatsapp",
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
            const contextoCRM = await montarContextoCRM(item.pessoaIdentificador, item.filial, `${contexto}\n${item.corpo_texto}`);
            const resultadoDebug = await sugerirUma(contexto, contextoCRM, item.corpo_texto, exemplos, hojeISO);
            aplicarLembretePadraoObjecaoSemPrazo(resultadoDebug, hojeISO);
            resultadosDebug.push({ corpo_texto: item.corpo_texto, contextoCRM, ...resultadoDebug });
        }
        return json({ ok: true, debug: resultadosDebug });
    }

    let processadas = 0;
    for (const item of candidatas as Candidata[]) {
        if (setJaClassificadas.has(item.mensagem_id)) continue;

        const contexto = await montarContexto(item.pessoaIdentificador);
        const contextoCRM = await montarContextoCRM(item.pessoaIdentificador, item.filial, `${contexto}\n${item.corpo_texto}`);
        const resultado = await sugerirUma(contexto, contextoCRM, item.corpo_texto, exemplos, hojeISO);
        // Bug real corrigido (2026-10-01, "não está gerando respostas,
        // pq?"): uma falha TÉCNICA (rede, rate limit momentâneo da
        // Anthropic, JSON malformado) sempre caía no mesmo "sugestao:
        // null" de quando a IA genuinamente não tem confiança — e como o
        // registro era sempre gravado, a mensagem nunca mais virava
        // candidata de novo (a RPC só pega quem ainda não tem linha aqui).
        // Reproduzido manualmente: o MESMO contexto, chamado de novo,
        // gerou uma sugestão ótima — confirma que foi uma falha pontual,
        // não a IA "decidindo" que não dava pra responder. Agora, com
        // erro técnico, PULA sem gravar nada — a próxima rodada do cron
        // (15 min) tenta de novo com a mesma mensagem.
        if (resultado.erro) {
            console.warn("Sugestão não gerada (erro técnico, vai tentar de novo na próxima rodada):", resultado.erro);
            continue;
        }
        aplicarLembretePadraoObjecaoSemPrazo(resultado, hojeISO);

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

        // Tag é aplicada direto (diferente da sugestão de texto/lembrete,
        // que sempre esperam clique humano) — mesmo padrão já usado em
        // classificar-resposta-convite: marcar uma tag é baixo risco,
        // reversível a qualquer momento pela gaveta/WhatsApp Unificado.
        if (resultado.tagSugerida) {
            await aplicarTagConversa(item.pessoaIdentificador, ROTULO_TAG_CONVERSA[resultado.tagSugerida]);
        }
    }

    return json({ ok: true, processadas });
});

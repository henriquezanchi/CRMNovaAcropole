// Edge Function: priorizar-convite-ia — Camada 3 do "Disparo Inteligente
// do Dia" (pedido do usuário, 2026-10-08): "primeiro priorizamos de
// acordo com as tags (não custa nada)... e só então lemos a conversa dos
// leads de cima pra baixo... e já registramos o resumo da conversa".
//
// Chamada SOB DEMANDA (nunca por cron) — o frontend (js/whatsapp.js,
// botão "Analisar com IA" em cada grupo do Disparo Inteligente) só chama
// isto pra quem a Camada 2 (resumo_ia já existente, mas desatualizado —
// mais antigo que a última mensagem da conversa) não resolveu sozinha de
// graça. Mesmo princípio de sempre (ia-diagnostico-saude/
// classificar-resposta-convite/sugerir-resposta-whatsapp): quem entra na
// lista é SEMPRE decidido por regra fixa no frontend — a IA aqui só LÊ e
// ESCREVE, nunca escolhe quem avaliar.
//
// Decisão confirmada com o usuário antes de construir: quando a IA achar
// um sinal claro de recusa/opt-out ("não vou poder ir", "me tira da
// lista") a resposta é EXCLUIR SÓ DESTA CAMPANHA — nunca aplica tag
// permanente sozinha (isso continua exigindo revisão humana, igual
// qualquer outra tag de sistema). "Na dúvida, prefira excluir" — errar
// pulando um bom candidato é bem mais barato que errar reenviando pra
// quem já disse que não quer.
//
// Já que estamos pagando pela leitura da conversa de qualquer forma, o
// resumo atualizado é gravado sozinho em leads_inscricoes.resumo_ia (+
// resumo_ia_atualizado_em) — é o "já registramos o resumo da conversa"
// pedido pelo usuário.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin, NOME_TABELA_LEADS } from "../_shared/supabaseAdmin.ts";
import { buscarExemplosEstilo } from "../_shared/exemplosEstilo.ts";
import { montarTabelaDiasSemana } from "../_shared/calendario.ts";
import { chamarClaude } from "../_shared/anthropic.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODELO = "claude-haiku-4-5-20251001";
const LIMITE_HISTORICO = 30; // bem mais que o rascunho de resposta (6) — aqui o objetivo é JULGAR a conversa inteira recente, não só responder a última mensagem
const LIMITE_CANDIDATOS_POR_CHAMADA = 40; // trava de segurança — o frontend já corta pela cota do grupo (normalmente bem menor), isso é só um teto duro

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Candidato = { pessoaIdentificador: string; nome?: string | null; eventoNome?: string | null };

async function montarContextoConversa(pessoaIdentificador: string): Promise<string> {
    const { data } = await supabaseAdmin
        .from("mensagens_whatsapp")
        .select("direcao, corpo_texto, tipo")
        .eq("pessoaIdentificador", pessoaIdentificador)
        .order("criado_em", { ascending: false })
        .limit(LIMITE_HISTORICO);
    const msgs = (data || []).reverse();
    if (msgs.length === 0) return "(nenhuma mensagem de WhatsApp trocada com este lead ainda)";
    return msgs.map((m: any) => `${m.direcao === "entrada" ? "Lead" : "Escola"}: ${m.tipo === "texto" ? m.corpo_texto : `[${m.tipo}]`}`).join("\n");
}

async function montarContextoCRM(pessoaIdentificador: string): Promise<{ texto: string; nome: string; resumoAtual: string | null }> {
    const { data: lead } = await supabaseAdmin
        .from(NOME_TABELA_LEADS)
        .select("pessoaNome, tags, resumo_ia, como_prefere_ser_chamado")
        .eq("pessoaIdentificador", pessoaIdentificador)
        .maybeSingle();
    if (!lead) return { texto: "(lead não encontrado)", nome: "", resumoAtual: null };

    const partes: string[] = [];
    let tags: string[] = [];
    try {
        const parsed = typeof lead.tags === "string" ? JSON.parse(lead.tags) : lead.tags;
        if (Array.isArray(parsed)) tags = parsed;
    } catch { /* tags malformada — ignora, nunca trava */ }
    if (tags.length > 0) partes.push(`Tags do lead: ${tags.join(", ")}`);
    if (lead.resumo_ia) partes.push(`Resumo já anotado pelo time sobre esta pessoa (pode estar desatualizado — é por isso que estamos relendo a conversa agora): ${lead.resumo_ia}`);

    const nome = lead.como_prefere_ser_chamado || (lead.pessoaNome || "").split(" ")[0] || "";
    return { texto: partes.length > 0 ? partes.join("\n") : "(nenhum dado adicional cadastrado)", nome, resumoAtual: lead.resumo_ia || null };
}

// Exemplos dedicados a ESTA decisão (excluir desta campanha de convite ou
// não) — diferente dos exemplos de "como responder" já usados em
// sugerir-resposta-whatsapp, aqui o que importa é reconhecer sinal de
// recusa/indisponibilidade/opt-out em QUALQUER ponto da conversa, mesmo
// sem ligação direta com o convite de hoje. Também ajuda a bater o
// mínimo de tokens cacheáveis do Haiku 4.5 (4.096 — ver anthropic.ts).
const EXEMPLOS_EXCLUSAO = `
Exemplos de quando EXCLUIR (excluir_desta_campanha: true):

Conversa: "Lead: Infelizmente não vou poder ir esse mês, viajo dia 15 e só volto depois" — a pessoa deu um motivo concreto de indisponibilidade pro período. Excluir, motivo: "Disse que viaja dia 15 e só volta depois — indisponível no período."

Conversa: "Lead: Para de mandar mensagem, não tenho mais interesse" — recusa explícita e direta. Excluir, motivo: "Pediu explicitamente pra não receber mais mensagens."

Conversa: "Lead: Já decidi que não vou fazer o curso, obrigado" — recusa clara, mesmo educada. Excluir, motivo: "Recusou claramente participar."

Conversa: "Lead: Esse número não é meu, era de outra pessoa" — número errado/reciclado, não é a pessoa certa. Excluir, motivo: "Lead indicou que o número não é dele."

Exemplos de quando NÃO excluir (excluir_desta_campanha: false):

Conversa: "Lead: Que legal, me conta mais sobre o curso" — demonstrou interesse, não há sinal de recusa. Não excluir.

Conversa: "Lead: Hoje não consigo falar, te respondo depois" — indisponibilidade momentânea (só para a CONVERSA agora), não é recusa do convite nem indisponibilidade pro período do evento. Não excluir.

Conversa: sem nenhuma mensagem trocada ainda, ou só mensagens antigas neutras (ex: perguntou o endereço há meses, sem recusar nada) — sem sinal de recusa. Não excluir.

Conversa: "Lead: Acho que já fui numa palestra de vocês ano passado" — é só contexto histórico, não indica recusa pro convite de agora. Não excluir.

Mais exemplos de EXCLUIR (excluir_desta_campanha: true) — motivos variados, sempre com um sinal CONCRETO de indisponibilidade/recusa/opt-out:

Conversa: "Lead: Estou grávida e minha filha nasce justo nessa época, não vou conseguir ir a nada esse mês" — indisponibilidade concreta por motivo de saúde/família. Excluir, motivo: "Disse que está grávida com parto previsto pro período, indisponível."

Conversa: "Lead: Fiquei desempregado mês passado, não tenho condição de pensar nisso agora" — dificuldade financeira concreta, momento inadequado pra convite. Excluir, motivo: "Relatou dificuldade financeira recente, não é bom momento."

Conversa: "Lead: Já me matriculei numa outra escola de filosofia, obrigado pelo contato" — já resolveu a necessidade em outro lugar. Excluir, motivo: "Já se matriculou em outra escola."

Conversa: "Lead: Minha mãe está internada, não consigo nem pensar em outra coisa agora" — indisponibilidade concreta por emergência familiar. Excluir, motivo: "Relatou emergência familiar (mãe internada), indisponível agora."

Conversa: "Lead: Vou me mudar de cidade semana que vem, não faz mais sentido" — mudança de cidade torna o convite sem sentido. Excluir, motivo: "Vai se mudar de cidade, convite não se aplica mais."

Conversa: "Lead: Para de insistir, já falei que não quero" — recusa repetida e incomodada. Excluir, motivo: "Recusou de forma incomodada, pediu pra parar de insistir."

Conversa: "Lead: Esse não é mais meu número, por favor removam" — pedido explícito de remoção/opt-out. Excluir, motivo: "Pediu remoção explícita do número."

Conversa: "Lead: Fiz uma cirurgia e estou de repouso até o mês que vem" — indisponibilidade concreta por saúde, com prazo. Excluir, motivo: "Em repouso pós-cirúrgico até o mês que vem."

Mais exemplos de NÃO excluir (excluir_desta_campanha: false) — sinal fraco, neutro, ou até positivo, mesmo quando a conversa tem alguma objeção:

Conversa: "Lead: Esse valor está um pouco salgado pra mim, mas deixa eu ver" — objeção de preço, mas sem recusa definitiva (ainda está considerando). Não excluir.

Conversa: "Lead: Trabalho até tarde, mas aos sábados consigo" — restrição de horário específica, não é recusa do convite em si (pode interessar o evento certo). Não excluir.

Conversa: "Lead: Nunca tinha ouvido falar, pode me explicar melhor?" — curiosidade genuína, sem nenhum sinal de recusa. Não excluir.

Conversa: "Lead: Hum, deixa eu pensar e te aviso" — resposta neutra/hesitante, não é recusa concreta. Não excluir.

Conversa: "Lead: Participei de um evento de vocês faz uns 2 anos, gostei bastante" — histórico positivo antigo, nenhum sinal de recusa atual. Não excluir.

Conversa: "Lead: Essa semana está corrida, mas bora ver" — corrido só nesta semana específica, sem recusar o convite de hoje (o convite é sobre outro período/evento). Não excluir.

Conversa: "Lead: Meu marido também tem interesse, vou perguntar pra ele" — engajamento positivo, potencial de trazer mais gente. Não excluir.

Conversa: só mensagens de SAÍDA (a escola mandou, o lead nunca respondeu nada) — silêncio não é recusa, é só ausência de resposta. Não excluir.

Ainda mais exemplos reais de EXCLUIR (excluir_desta_campanha: true) — variedade de motivos concretos, sempre explícitos na conversa:

Conversa: "Lead: Fui diagnosticado com depressão recentemente, não tenho energia pra compromisso novo agora" — indisponibilidade concreta por saúde mental. Excluir, motivo: "Relatou quadro de saúde que o impede de assumir compromisso novo agora."

Conversa: "Lead: Meus filhos têm aula particular no mesmo horário de vocês, nunca vai dar" — conflito de horário permanente/estrutural, não pontual. Excluir, motivo: "Conflito permanente de horário com compromisso dos filhos."

Conversa: "Lead: Não tenho mais esse número de WhatsApp, por favor parem de enviar" — pedido de opt-out, mesmo que de forma indireta. Excluir, motivo: "Pediu explicitamente pra parar de receber mensagens."

Conversa: "Lead: Infelizmente não vou poder, estou em tratamento médico fora da cidade" — indisponibilidade concreta, fora da cidade. Excluir, motivo: "Em tratamento médico fora da cidade."

Conversa: "Lead: Decidi junto com minha família que não vamos seguir com isso" — decisão de recusa já tomada e comunicada. Excluir, motivo: "Comunicou decisão de não seguir com a matrícula."

Conversa: "Lead: Perdi meu emprego e preciso focar 100% em procurar outro agora" — indisponibilidade concreta por prioridade financeira/profissional. Excluir, motivo: "Perdeu o emprego, priorizando recolocação profissional agora."

Conversa: "Lead: Já tenho uma rotina de estudos que ocupa todo meu tempo livre, não consigo encaixar mais nada" — incompatibilidade de rotina declarada, recusa implícita mas clara. Excluir, motivo: "Rotina já ocupada, sem espaço pra novo compromisso."

Conversa: "Lead: Fui convidado mas já respondi que não iria, nem sei pq estão chamando de novo" — já recusou um convite anterior, está incomodado com reenvio. Excluir, motivo: "Já recusou convite anterior e está incomodado com contato repetido."

Mais exemplos reais de NÃO excluir (excluir_desta_campanha: false) — conversa segue neutra/positiva ou a objeção é específica demais pra generalizar:

Conversa: "Lead: Topo sim, só queria saber se tem estacionamento no local" — pergunta prática, claro sinal de interesse. Não excluir.

Conversa: "Lead: Já estudei um pouco de estoicismo sozinho, bacana saber que tem curso" — interesse genuíno demonstrado. Não excluir.

Conversa: "Lead: Entendi, vou conversar com minha esposa e te aviso" — está considerando, não recusou. Não excluir.

Conversa: "Lead: Esse mês não dá, mas mês que vem olha eu lá" — adiamento voluntário com intenção futura clara, não é recusa definitiva (o convite de hoje pode ser justamente pro período que ele mencionou). Não excluir.

Conversa: "Lead: Qual a diferença entre a Abertura de Turma e a Aula Inaugural?" — pergunta de esclarecimento, interesse ativo. Não excluir.

Conversa: "Lead: Fiquei curiosa depois que vi no Instagram de vocês" — chegou por canal diferente, demonstrando interesse espontâneo. Não excluir.

Conversa: "Lead: Pode me mandar o endereço certinho?" — pedido de informação prática, sinal de intenção de comparecer. Não excluir.

Conversa: apenas uma saudação antiga sem resposta do lead (ex: "Oi, tudo bem?" mandado pela escola há meses, sem réplica) — ausência de resposta não é recusa. Não excluir.

Na DÚVIDA (sinal ambíguo, não claramente uma recusa nem claramente um "sim"): prefira excluir_desta_campanha: false (deixa seguir pro envio normal) — só exclua quando o sinal de recusa/indisponibilidade/opt-out for razoavelmente claro na conversa. Isso evita excluir à toa um bom candidato só por uma leitura exagerada.
`;

function montarPromptCacheavel(exemplosEstilo: string, hojeISO: string): string {
    const blocoExemplos = exemplosEstilo
        ? `\nExemplos REAIS de como o time já conversou com leads parecidos (só pra entender o tom/contexto do atendimento, não é sobre a decisão de excluir):\n${exemplosEstilo}\n`
        : "";
    return `Você ajuda o time de atendimento de uma escola de filosofia (Nova Acrópole) a decidir, ANTES de disparar um convite automático em massa, se uma pessoa específica deveria ser pulada desta campanha — porque ela já indicou, em algum momento da conversa de WhatsApp, que não quer ir, está indisponível no período, ou pediu pra não ser mais contatada.

${montarTabelaDiasSemana(hojeISO)}
${blocoExemplos}
${EXEMPLOS_EXCLUSAO}

Depois desta mensagem virão, pra cada lead: os dados cadastrados no CRM sobre ele, o histórico de conversa de WhatsApp (pode estar vazio, se nunca trocaram mensagem), e o nome do evento que estamos prestes a convidar ele pra hoje.

Pra CADA lead, responda com um JSON (sem texto antes ou depois) no formato exato:
{"resumo": "um resumo curto (1-3 frases) do que se sabe sobre esta pessoa a partir da conversa — ou null se não houver mensagem nenhuma pra resumir", "excluir_desta_campanha": true ou false, "motivo": "1 frase curta explicando por que excluir — ou null se excluir_desta_campanha for false"}

Regras de segurança (sempre válidas, nunca quebrar):
- NUNCA invente um motivo que não esteja na conversa de verdade.
- "resumo" é só um registro FACTUAL do que a conversa mostra (interesse, objeção, dúvida, etc.) — nunca uma opinião nem um conselho de abordagem.
- Na dúvida sobre excluir ou não, prefira NÃO excluir (excluir_desta_campanha: false) — É PIOR excluir à toa um bom candidato do que deixar passar um caso ambíguo (que o time ainda vai revisar manualmente de qualquer forma antes do envio final).`;
}

function montarPromptDinamico(nome: string, contextoCRM: string, contextoConversa: string, eventoNome: string | null): string {
    return `Lead: ${nome || "(sem nome)"}
Dados do CRM sobre este lead:
${contextoCRM}

Histórico de conversa de WhatsApp (mais antiga primeiro):
${contextoConversa}

Estamos prestes a convidar esta pessoa hoje pro evento: "${eventoNome || "(evento não especificado)"}"`;
}

async function avaliarUm(candidato: Candidato, exemplosEstilo: string, hojeISO: string): Promise<{ resumo: string | null; excluir: boolean; motivo: string | null; erro?: string }> {
    const [contextoConversa, contextoCRM] = await Promise.all([
        montarContextoConversa(candidato.pessoaIdentificador),
        montarContextoCRM(candidato.pessoaIdentificador),
    ]);

    const resultado = await chamarClaude({
        apiKey: ANTHROPIC_API_KEY,
        modelo: MODELO,
        blocoCacheavel: montarPromptCacheavel(exemplosEstilo, hojeISO),
        blocoDinamico: montarPromptDinamico(contextoCRM.nome || candidato.nome || "", contextoCRM.texto, contextoConversa, candidato.eventoNome || null),
        maxTokens: 400,
        functionName: "priorizar-convite-ia",
    });
    if (resultado.erro || !resultado.texto) return { resumo: null, excluir: false, motivo: null, erro: resultado.erro || "resposta_vazia" };

    try {
        const texto = resultado.texto.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(texto);
        const resumo = typeof parsed?.resumo === "string" && parsed.resumo.trim() ? parsed.resumo.trim() : null;
        const excluir = parsed?.excluir_desta_campanha === true;
        const motivo = excluir && typeof parsed?.motivo === "string" && parsed.motivo.trim() ? parsed.motivo.trim() : null;
        return { resumo, excluir, motivo };
    } catch (e) {
        return { resumo: null, excluir: false, motivo: null, erro: String(e) };
    }
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    let body: { candidatos?: Candidato[] };
    try {
        body = await req.json();
    } catch {
        return json({ ok: false, erro: "body_invalido" }, 400);
    }
    const candidatos = (body.candidatos || []).slice(0, LIMITE_CANDIDATOS_POR_CHAMADA);
    if (candidatos.length === 0) return json({ ok: false, erro: "sem_candidatos" }, 400);

    const exemplosEstilo = await buscarExemplosEstilo();
    const hojeISO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

    const resultados = [];
    for (const candidato of candidatos) {
        const r = await avaliarUm(candidato, exemplosEstilo, hojeISO);
        if (r.erro) {
            // Falha TÉCNICA (rede/rate-limit/JSON malformado) — nunca trata
            // como "não excluir" nem "excluir": devolve pro frontend como
            // "não avaliado", que decide o que fazer (manter na fila,
            // tentar de novo depois) sem arriscar um veredito errado.
            resultados.push({ pessoaIdentificador: candidato.pessoaIdentificador, avaliado: false, erro: r.erro });
            continue;
        }
        // Já que pagamos pela leitura, grava o resumo atualizado sozinho
        // (pedido do usuário: "já registramos o resumo da conversa") —
        // SEM aplicar tag nenhuma (decisão confirmada: exclusão é só
        // desta campanha, nunca permanente).
        if (r.resumo) {
            await supabaseAdmin.from(NOME_TABELA_LEADS)
                .update({ resumo_ia: r.resumo, resumo_ia_atualizado_em: new Date().toISOString() })
                .eq("pessoaIdentificador", candidato.pessoaIdentificador)
                .then(({ error }) => { if (error) console.warn("Falha ao gravar resumo:", error.message); });
        }
        resultados.push({ pessoaIdentificador: candidato.pessoaIdentificador, avaliado: true, resumo: r.resumo, excluirDestaCampanha: r.excluir, motivo: r.motivo });
    }

    return json({ ok: true, resultados });
});

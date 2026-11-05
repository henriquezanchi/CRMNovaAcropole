// Edge Function: campanha-responder — responde sozinho quem respondeu a um
// convite de campanha (04/11/2026, pedido do usuário, primeiro uso: Dia
// Mundial da Filosofia 2026). Prazo: até 1 minuto em horário comercial e até
// 5 minutos fora dele, sem esperar atendente.
//
// Disparo:
//   - whatsapp-webhook, em horário comercial, logo que a mensagem chega
//     ({pessoa, mensagem_id}); espera ~20s para juntar mensagens em sequência.
//   - cron a cada minuto ({acao:"varrer"}): rede de segurança e horário
//     não comercial (espera 2,5 min depois da última mensagem).
//   - {acao:"simular", conversa:[{de:"lead"|"escola", texto}], pessoa?, filial?}
//     gera a resposta sem enviar nem gravar nada (treino do robô).
//
// O robô fala como a equipe da escola, conhece o evento, a escola de origem do
// lead (endereço e próximas atividades) e as demais escolas da região, para o
// caso de a pessoa morar ou trabalhar perto de outra unidade.
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { alterarTags } from "../_shared/tags.ts";
import { montarTabelaDiasSemana } from "../_shared/calendario.ts";
import { chamarClaude } from "../_shared/anthropic.ts";
import { montarHistoricoWpp } from "../_shared/historico-wpp.ts";
import { linkMapsDaFilial } from "../_shared/filiaisInfo.ts";
import { ehRespostaAutomatica } from "../_shared/resposta-automatica.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODELO = Deno.env.get("CAMPANHA_MODELO_IA") ?? "claude-sonnet-4-5";
const MODELO_RESERVA = "claude-haiku-4-5-20251001";
const NOME_ATENDENTE = "Assistente da campanha (IA)";
const FUSO = "America/Sao_Paulo";
const LIMITE_HISTORICO = 40;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hojeBrasilia(d = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(d);
}

// Seg-sex 8h-18h, sábado 8h-12h (Brasília).
// Horário de resposta (pedido do usuário, 04/11/2026), todos os dias:
//   8h-20h responde; 20h-22h só se a janela de 24h (contada da última mensagem
//   da pessoa) fechar antes das 8h do dia seguinte, ou se a conversa estiver em
//   andamento (conversaEmAndamento); 22h-8h não responde.
//   Às 8h a varredura pega quem escreveu à noite.
export function podeResponderAgora(ultimaEntradaISO: string, agora = new Date(), conversaEmAndamento = false): boolean {
    const hora = Number(new Intl.DateTimeFormat("en-US", { timeZone: FUSO, hour: "numeric", hour12: false }).format(agora)) % 24;
    if (hora >= 8 && hora < 20) return true;
    if (hora < 20 || hora >= 22) return false;
    if (conversaEmAndamento) return true;
    const amanha = new Date(agora.getTime() + 24 * 3600 * 1000);
    const proximas8h = new Date(`${hojeBrasilia(amanha)}T08:00:00-03:00`);
    const fechaJanela = new Date(new Date(ultimaEntradaISO).getTime() + 24 * 3600 * 1000);
    return fechaJanela < proximas8h;
}

export function horarioComercial(d = new Date()): boolean {
    const partes = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, weekday: "short", hour: "numeric", hour12: false }).formatToParts(d);
    const dia = partes.find((p) => p.type === "weekday")?.value;
    const hora = Number(partes.find((p) => p.type === "hour")?.value) % 24;
    if (dia === "Sun") return false;
    if (dia === "Sat") return hora >= 8 && hora < 12;
    return hora >= 8 && hora < 18;
}

function dataBR(iso: string | null | undefined): string {
    if (!iso) return "";
    const [a, m, d] = String(iso).slice(0, 10).split("-");
    return `${d}/${m}/${a}`;
}

function listaTags(v: unknown): string[] {
    try {
        let x: unknown = v;
        for (let i = 0; i < 3 && typeof x === "string"; i++) x = JSON.parse(x);
        return Array.isArray(x) ? x.map(String) : [];
    } catch { return []; }
}

async function campanhaDoLead(pessoa: string) {
    const { data } = await supabaseAdmin.from("campanha_fila")
        .select("campanha_id, enviado_em, campanhas_whatsapp!inner(*)")
        .eq("pessoaIdentificador", pessoa).eq("status", "enviado").eq("campanhas_whatsapp.ativa", true)
        .order("enviado_em", { ascending: false }).limit(1).maybeSingle();
    return data ? (data as any).campanhas_whatsapp : null;
}

async function descreverEvento(eventoId: number) {
    const { data: ev } = await supabaseAdmin.from("eventos")
        .select("id, filial, nome, data, hora, descricao, link_inscricao, imagem_url, capacidade").eq("id", eventoId).maybeSingle();
    return ev;
}

async function escolasDaRegiao(filiais: string[], hojeISO: string): Promise<{ texto: string; links: string[]; eventos: { nome: string; link: string }[] }> {
    const { data: fs } = await supabaseAdmin.from("filiais")
        .select("nome, nome_com_preposicao, endereco, link_maps_ulisses").in("nome", filiais);
    const ate = new Date(`${hojeISO}T12:00:00Z`); ate.setUTCDate(ate.getUTCDate() + 45);
    const { data: evs } = await supabaseAdmin.from("eventos")
        .select("filial, nome, tipo, data, hora, link_inscricao")
        .in("filial", filiais).eq("ativo", true).gte("data", hojeISO).lte("data", ate.toISOString().slice(0, 10))
        .order("data");
    const texto = (fs || []).map((f: any) => {
        const proprios = (evs || []).filter((e: any) => e.filial === f.nome && !/mundial da filosofia/i.test(e.nome));
        const vistos = new Set<string>();
        const lista = proprios.filter((e: any) => { const k = `${e.nome}|${e.data}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
            .slice(0, 6)
            .map((e: any) => `   - ${dataBR(e.data)}${e.hora ? " " + String(e.hora).slice(0, 5) : ""}: ${e.nome}${e.tipo ? ` (${e.tipo})` : ""}${e.link_inscricao ? ` — inscrição: ${e.link_inscricao}` : ""}`);
        return `• Nova Acrópole ${f.nome_com_preposicao || f.nome} [${f.nome}]\n   Endereço: ${f.endereco || "não cadastrado (não informe endereço; ofereça o mapa)"} — mapa: ${linkMapsDaFilial(f)}\n   Próximas atividades:\n${lista.length ? lista.join("\n") : "   - nenhuma cadastrada"}`;
    }).join("\n");
    return {
        texto,
        links: (evs || []).map((e: any) => e.link_inscricao).filter(Boolean),
        eventos: (evs || []).map((e: any) => ({ nome: String(e.nome), link: String(e.link_inscricao || ""), data: String(e.data || "") })),
    };
}

async function contextoDoLead(pessoa: string) {
    const { data: lead } = await supabaseAdmin.from("leads_inscricoes")
        .select('"pessoaIdentificador", pessoaNome, como_prefere_ser_chamado, filial, tags, historico_eventos, resumo_ia, cidade, profissao')
        .eq("pessoaIdentificador", pessoa).maybeSingle();
    if (!lead) return null;
    const { data: memoria } = await supabaseAdmin.from("crm_memoria_conversa")
        .select("resumo, perfil, proximo_passo").eq("pessoa", pessoa).order("atualizado_em", { ascending: false }).limit(1).maybeSingle();
    return { lead, memoria };
}

async function historico(pessoa: string) {
    const { data } = await supabaseAdmin.from("mensagens_whatsapp")
        .select("id, direcao, corpo_texto, tipo, wa_status, criado_em")
        .eq("pessoaIdentificador", pessoa).order("criado_em", { ascending: false }).limit(LIMITE_HISTORICO);
    const msgs = (data || []).filter((m: any) => m.wa_status !== "falhou").reverse();
    return { msgs, ...(await montarHistoricoWpp(msgs as any)) };
}

function diaDaSemana(iso: string | null | undefined): string {
    if (!iso) return "";
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long" }).format(new Date(`${String(iso).slice(0, 10)}T12:00:00Z`));
}

function promptFixo(c: any, ev: any, hojeISO: string, escolas: string): string {
    return `Você é da equipe de atendimento da Nova Acrópole (escola de filosofia à maneira clássica, sem fins lucrativos, com cursos, palestras, atividades culturais e voluntariado). Você conversa pelo WhatsApp com pessoas que receberam um convite nosso para ${c.evento_com_artigo || "um evento"}. Sua resposta será ENVIADA AUTOMATICAMENTE, sem revisão humana. Responda como uma pessoa da escola responderia: acolhedor, simples, objetivo, sem formalidade excessiva e sem jeito de vendedor.

${montarTabelaDiasSemana(hojeISO, 35)}

# O evento (dados oficiais — use só estes)
Nome: ${ev?.nome || c.nome}
Data: ${dataBR(ev?.data)} (${diaDaSemana(ev?.data)}), às ${String(ev?.hora || "").slice(0, 5) || "(horário não cadastrado)"}
Escola: ${ev?.filial || ""}
Inscrição pelo link: ${ev?.link_inscricao || "(sem link cadastrado)"}
Descrição e programação:
${ev?.descricao || "(sem descrição)"}

# Escolas da Nova Acrópole desta campanha
${escolas}

# Instruções específicas desta campanha (valem mais que as regras gerais abaixo)
${c.config?.instrucoes || "(nenhuma)"}

# Como conduzir
- O objetivo é a pessoa ir ao evento. Quando ela demonstrar interesse ou disser que pode receber detalhes, mande o essencial em poucas linhas: o que é, data e hora, local, se é gratuito e o link de inscrição, pedindo que ela se inscreva pelo link para garantir a vaga. Nesse caso marque "enviar_arte": true (a arte do evento vai junto, uma única vez).
- Quando a pessoa disser que vai ("sim, irei", "vou sim", "pode contar comigo", "estarei lá"): comemore com alegria e calor humano (ex.: "Que alegria, Valdete! 😊"), explique que as vagas são limitadas e por isso é importante garantir a dela pelo link de inscrição, e mande na mesma mensagem o link, a data, o horário e o local. Dizer que vai NÃO é estar inscrita: o lugar só fica garantido com a inscrição no link. Marque "enviar_arte": true (se a arte ainda não foi enviada) e "situacao": "vai".
- Gratuidade: quando o evento é gratuito (veja a descrição e as instruções da campanha), diga isso com clareza sempre que falar dele. Se a pessoa hesitar ou perguntar sobre valor, reforce.
- Não repita informação que já foi enviada na conversa. Se ela já recebeu os detalhes, responda só ao que perguntou.
- A inscrição é feita pela própria pessoa no link. Você não inscreve ninguém e não confirma inscrição. Se ela disser que já se inscreveu, agradeça e diga que a esperamos.
- Perguntas sobre estacionamento, acessibilidade, levar crianças/acompanhantes, duração exata, lanche ou qualquer dado que não está acima: não invente. Diga, em primeira pessoa, que vai ver isso e já responde (ex.: "Vou ver isso pra você e já te respondo!") e marque "precisa_humano": true com o motivo. Levar acompanhante: pode convidar, e o acompanhante também se inscreve pelo link.
- Horário de término: se não estiver nos dados, nunca invente; diga que vai confirmar e marque "precisa_humano": true.
- Valores (mensalidade, preço do curso, material, descontos): nunca informe nenhum valor, nem aproximado. Diga, em primeira pessoa, que vai ver isso e já te passa, e que na aula experimental dá para conhecer tudo com calma; marque "precisa_humano": true.
- Duração, carga horária, frequência das aulas, conteúdo do curso, quem é o professor ou qualquer detalhe que não esteja nos dados acima: não diga. Responda, em primeira pessoa, que vai ver isso e já te passa, e marque "precisa_humano": true.
- Você fala como a escola ("nós", "eu"), nunca como alguém de fora: nunca diga "a equipe da escola vai te chamar/explicar", porque a pessoa já está falando com a escola. Quando você disse que ia ver algo, quem traz a resposta é uma pessoa nesta mesma conversa, não você: se a pessoa disser "pode sim"/"ok", responda só algo curto como "Combinado! Já te passo.", sem trazer a informação, e marque "precisa_humano": true. Nunca diga que já verificou, confirmou ou consultou alguém: você não consulta ninguém.
- Não suponha o que a pessoa já sabe ou já fez (ex.: "como você já conhece o curso") a menos que isso esteja nos dados.
- Se a pessoa já aceitou ("sim", "pode", "quero") a uma pergunta nossa sobre detalhes ou link, mande o link nesta mensagem; nunca pergunte de novo se pode mandar.
- Sempre que der os detalhes do evento, inclua o link de inscrição na mesma mensagem (não pergunte "posso mandar o link?") e escreva, com essas palavras, que as vagas são limitadas e por isso é importante garantir a vaga pelo link.
- Inscrição: nunca diga que não precisa se inscrever, reservar ou garantir a vaga. Todas as atividades pedem inscrição pelo link.
- Outras atividades da lista de escolas (palestras, cursos, aulas experimentais de outras datas): você só conhece nome, data, hora e link. Copie data, hora e link exatamente da linha daquela atividade (nunca troque o link pelo de outro evento, nunca use outra data). Não descreva o conteúdo além do nome, a menos que isso esteja nas instruções da campanha.
- Entrada: palestras abertas das escolas têm entrada franca (gratuita). Cursos livres, workshops, oficinas e o Curso de Filosofia para Viver não são gratuitos: não fale de valor deles.
- Curso de Filosofia para Viver: o que é gratuito é só a aula experimental. Nunca diga que a primeira aula, o curso ou a matrícula são gratuitos. Se a pessoa não puder ir à aula experimental (viagem, compromisso), diga que vai ver com a direção da escola se ela pode conhecer na primeira aula sem custo, e marque "precisa_humano": true. Nunca prometa que a primeira aula será gratuita.
- Curso de Filosofia para Viver, formato: aulas uma vez por semana, com 2 horas de duração e intervalo de 20 minutos; o curso dura de 4 a 6 meses.
- Outras cidades: a Nova Acrópole tem escolas em muitas cidades do Brasil, mas você não tem a lista nem os contatos delas. Nunca afirme que existe (ou que não existe) escola numa cidade específica: diga que ela pode procurar a unidade mais próxima no site acropole.org.br. Nunca ofereça "passar o contato".
- Endereço: use só o que está nos dados (descrição do evento, instruções da campanha ou endereço da escola). Se não estiver, diga que vai confirmar ("precisa_humano": true) e ofereça o mapa da escola.
- Escola de origem: a pessoa se aproximou da Nova Acrópole pela escola indicada como "escola de origem". Quando fizer sentido (ela gostou da ideia, perguntou sobre o curso, sobre a escola, ou disse que não pode ir ao evento mas tem interesse), conte de forma leve sobre a próxima atividade dessa escola, de preferência a abertura de turma ou a aula experimental do Curso de Filosofia para Viver, com data e link quando existirem. Uma menção por conversa, sem insistir.
- Se a pessoa disser que se mudou, que trabalha ou mora em outro bairro/setor, ou que outra unidade é mais perto, procure na lista de escolas acima a(s) mais provável(is) pela região mencionada e ofereça as atividades dessa unidade. Se não tiver certeza de qual é mais perto, cite as 2 ou 3 mais prováveis com o endereço/mapa e pergunte qual fica melhor. Registre em "escola_preferida" o nome exato entre colchetes da escola escolhida. Se ela se mudou para fora de Goiânia/Aparecida, marque "mudou_cidade": true e responda com gentileza.
- Se a pessoa não pode ir: acolha sem insistir, e se fizer sentido mencione a próxima atividade da escola de origem. Nunca pressione.
- Pedido para não receber mensagens ("pare", "me tira da lista", "não quero mais"): responda uma frase curta pedindo desculpas pelo incômodo e confirmando que não vamos mais enviar, e marque "nao_contatar": true.
- Se a mensagem mostra que o número é de outra pessoa ("não sou fulano", "número errado"): peça desculpas em uma frase e marque "numero_errado": true.
- Se a mensagem claramente não é para a escola (pix, pedido de comida, cobrança, outra empresa): responda que a mensagem parece ter vindo para o número errado, que aqui é a Nova Acrópole, e mais nada.
- Se perguntarem se é um robô: diga com naturalidade que é o atendimento da escola com apoio de um assistente automático e que uma pessoa da equipe acompanha a conversa.
- Assuntos fora do evento e da escola (religião, política, opinião pessoal, saúde): resposta breve e respeitosa; a Nova Acrópole é uma escola de filosofia, não é religião. Se insistirem, "precisa_humano": true.
- Áudio com transcrição: responda ao conteúdo transcrito. Mídia sem texto e sem transcrição: peça com leveza que a pessoa escreva.
- Mensagem automática do WhatsApp da pessoa ("Retornarei sua mensagem", "No momento não posso atender", "Obrigado pelo contato, responderemos em breve" e parecidas): "resposta": null. Não é a pessoa falando.
- Quando a pessoa só cumprimenta ("Oi", "Boa tarde") ou volta depois de uma mensagem automática, sem responder ao convite: cumprimente de volta de forma simples e natural, sem comemorar ("que bom ter seu retorno", "que alegria" são exageros aqui), e retome o convite em 1 ou 2 frases, perguntando se pode mandar os detalhes (ou mandando, se ela já tinha aceitado antes). Fale como uma pessoa da escola falaria por WhatsApp: tom calmo, no máximo uma exclamação por mensagem quando não houver motivo real de alegria.
- No WhatsApp a conversa continua ao longo de dias, sem encerrar nem reiniciar. Nunca anuncie que vai parar, encerrar ou continuar depois ("hoje não posso continuar", "volto amanhã", "vou encerrar por aqui", "amanhã retomamos"). Quando a conversa ficou parada de um dia para o outro (aviso RETOMADA), comece só com a saudação indicada (ex.: "Bom dia!") e continue de onde parou: nada de se apresentar de novo, repetir o convite do zero ou pedir desculpas pela demora. Se a pessoa se despedir, não responda ("resposta": null).
- Mensagem só de agradecimento, "ok", emoji ou despedida, sem pergunta pendente: "resposta": null (não precisa responder). Mas um "sim", "pode", "quero" respondendo a uma pergunta nossa SEMPRE merece resposta.
- Nome: chame pelo nome indicado, com a primeira letra maiúscula e as demais minúsculas. Nunca escreva o nome todo em maiúsculas.
- Formato: no máximo 6 linhas curtas; pode usar quebras de linha; no máximo 1 emoji; sem markdown com ** ou #. Nunca use travessão longo (—) no texto enviado.
- Datas: use a tabela de calendário acima; nunca calcule dia da semana de cabeça.

Responda SOMENTE com JSON válido, sem texto antes ou depois:
{"resposta": "texto" ou null, "enviar_arte": true|false, "situacao": "vai"|"talvez"|"nao_vai"|"quer_info"|"outro", "nao_contatar": true|false, "numero_errado": true|false, "mudou_cidade": true|false, "escola_preferida": "nome exato entre colchetes" ou null, "precisa_humano": true|false, "motivo_humano": "texto curto" ou null}`;
}

function promptDinamico(ctx: any, conversa: string, retomada: string | null = null): string {
    const l = ctx.lead;
    const nome = (l.como_prefere_ser_chamado || String(l.pessoaNome || "").split(" ")[0] || "").trim();
    const tags = listaTags(l.tags).filter((t) => !/^(Contato Recente|Temperatura)/.test(t));
    const eventos = Array.isArray(l.historico_eventos) ? l.historico_eventos.slice(-5).map((e: any) => `${e.evento} (${String(e.data || "").slice(0, 10)})`).join("; ") : "";
    const linhas = [
        listaTags(l.tags).includes("Campanha: Nome a conferir")
            ? "Nome para chamar: (não use nome: o número pode ser de outra pessoa; se ela quiser receber o convite, siga normalmente sem chamar pelo nome do cadastro)"
            : `Nome para chamar: ${nome || "(sem nome; não use nome)"}`,
        `Escola de origem: [${l.filial}]`,
        l.cidade ? `Cidade cadastrada: ${l.cidade}` : "",
        l.profissao ? `Profissão: ${l.profissao}` : "",
        tags.length ? `Etiquetas: ${tags.join(", ")}` : "",
        eventos ? `Atividades que já frequentou: ${eventos}` : "",
        l.resumo_ia ? `Anotações da equipe: ${String(l.resumo_ia).slice(0, 800)}` : "",
        ctx.memoria?.resumo ? `Resumo das conversas anteriores: ${String(ctx.memoria.resumo).slice(0, 800)}` : "",
    ].filter(Boolean);
    const aviso = retomada
        ? `\n\nRETOMADA: a conversa ficou parada de um dia para o outro. Comece exatamente com "${retomada}" e continue a conversa de onde parou, respondendo direto ao que a pessoa disse. Não se apresente de novo, não repita o convite do zero e não peça desculpas pela demora.`
        : "";
    return `# Sobre esta pessoa\n${linhas.join("\n")}\n\n# Conversa (mais antiga primeiro; "Escola" somos nós)\n${conversa}${aviso}\n\nEscreva a próxima mensagem da escola.`;
}

// Rede de segurança: a IA às vezes erra o dia da semana (caso real 04/11:
// "17/11 (segunda-feira)", é terça). Confere cada "DD/MM ... dia" e
// "dia ... DD/MM" próximos e troca o dia pelo certo, mantendo o formato.
const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const RE_DIA = "(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)";
export function corrigirDiasDaSemana(texto: string, hojeISO: string): string {
    const anoBase = Number(hojeISO.slice(0, 4)), mesHoje = Number(hojeISO.slice(5, 7));
    const certo = (d: number, m: number) => {
        const ano = m < mesHoje - 6 ? anoBase + 1 : anoBase; // dezembro -> janeiro
        return NOMES_DIA[new Date(Date.UTC(ano, m - 1, d)).getUTCDay()];
    };
    const trocar = (palavra: string, correto: string) => {
        const base = palavra.toLowerCase().replace("terca", "terça").replace("sabado", "sábado");
        if (base === correto) return palavra;
        return palavra[0] === palavra[0].toUpperCase() ? correto[0].toUpperCase() + correto.slice(1) : correto;
    };
    let t = texto.replace(new RegExp(String.raw`(\d{1,2})/(\d{1,2})([^\n\d]{0,25}?)` + RE_DIA, "gi"),
        (_m, d, m, meio, dia) => `${d}/${m}${meio}${trocar(dia, certo(+d, +m))}`);
    t = t.replace(new RegExp(RE_DIA + String.raw`([-a-zçá ]{0,8}[, ]{1,3}(?:dia )?)(\d{1,2})/(\d{1,2})`, "gi"),
        (_m, dia, meio, d, m) => `${trocar(dia, certo(+d, +m))}${meio}${d}/${m}`);
    return t;
}

// Rede de segurança (caso real 04/11, Simey): a pessoa já tinha aceitado e o robô
// perguntou de novo "Posso te passar o link?". Pergunta sobre mandar o link, sem
// link nenhum na resposta, vira o próprio link.
const RE_PERGUNTA_LINK = /[^.!?\n]*\b(posso|quer que eu|gostaria que eu|quer|deseja|gostaria de receber)\b[^.!?\n]{0,40}\blink\b[^?\n]*\?/i;
export function trocarPerguntaDoLink(texto: string, link: string | null | undefined): string {
    if (!link || /https?:\/\//i.test(texto) || !RE_PERGUNTA_LINK.test(texto)) return texto;
    return texto.replace(RE_PERGUNTA_LINK, (m) => `${m.match(/^\s*/)?.[0] || ""}Para garantir sua vaga, é só se inscrever pelo link:\n${link}`);
}

// Rede de segurança (caso real 04/11, Francisco): a IA citou a palestra "O dilema
// do guerreiro" com o link do Dia Mundial da Filosofia. Para cada atividade citada
// pelo nome, o primeiro link de inscrição que vem depois dela (antes de outra
// atividade) passa a ser o link cadastrado dela.
export function corrigirLinksDeAtividades(texto: string, eventos: { nome: string; link: string }[]): string {
    const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const alvo = norm(texto);
    const achados = eventos
        .filter((e) => e.nome.length >= 8 && new Set(eventos.filter((o) => norm(o.nome) === norm(e.nome)).map((o) => o.link)).size === 1)
        .map((e) => ({ ...e, pos: alvo.indexOf(norm(e.nome)) }))
        .filter((e) => e.pos >= 0)
        .filter((e, i, a) => a.findIndex((o) => o.pos === e.pos) === i)
        .sort((a, b) => a.pos - b.pos);
    let saida = texto;
    for (let i = achados.length - 1; i >= 0; i--) {
        const e = achados[i];
        const fim = i + 1 < achados.length ? achados[i + 1].pos : saida.length;
        const trecho = saida.slice(e.pos, fim);
        const m = trecho.match(/https?:\/\/\S*eventoId=\d+/);
        if (m && m[0] !== e.link) saida = saida.slice(0, e.pos) + trecho.replace(m[0], e.link) + saida.slice(fim);
    }
    return saida;
}

// Rede de segurança (caso real 05/11, Frederico): "no sábado (07/11) tem a palestra
// O Poder da Simplicidade", que é dia 21/11. Em cada linha que cita exatamente uma
// atividade da agenda (com uma única data cadastrada), toda data DD/MM diferente da
// dela é trocada pela data certa. O dia da semana é acertado depois por
// corrigirDiasDaSemana().
export function corrigirDatasDeAtividades(texto: string, eventos: { nome: string; data: string }[]): string {
    const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const unicos = eventos.filter((e) => e.nome.length >= 8 && e.data &&
        new Set(eventos.filter((o) => norm(o.nome) === norm(e.nome)).map((o) => o.data)).size === 1);
    return texto.split("\n").map((linha) => {
        const citados = [...new Map(unicos.filter((e) => norm(linha).includes(norm(e.nome))).map((e) => [norm(e.nome), e])).values()];
        if (citados.length !== 1) return linha;
        const [ano, mes, dia] = citados[0].data.slice(0, 10).split("-");
        const certa = `${dia}/${mes}`;
        return linha.replace(/\b(\d{1,2})\/(\d{1,2})(?!\/?\d)/g, (m, d, mm) =>
            (Number(d) === Number(dia) && Number(mm) === Number(mes)) ? m : certa);
    }).join("\n");
}

// Trava final antes de enviar: o robô nunca informa valor nem diz que consultou a
// equipe (ele não consulta ninguém). Devolve o motivo do bloqueio, ou null.
export function motivoBloqueioResposta(texto: string, linksPermitidos: string[] = []): string | null {
    if (/R\$\s?\d|\d+(,\d{2})?\s?reais\b/i.test(texto)) return "informou valor em dinheiro";
    if (/(confirmei|conferi|verifiquei|consultei|chequei)\b[^.!?\n]{0,30}\b(equipe|escola|secretaria|professor)/i.test(texto)) return "disse que confirmou com a equipe";
    if (/primeira aula[^.!?\n]{0,40}(gratuit|de gra[çc]a|sem custo)/i.test(texto)) return "disse que a primeira aula é gratuita";
    if (/n[ãa]o precisa[^.!?\n]{0,25}(reservar|se inscrever|inscri[çc][ãa]o|garantir)/i.test(texto)) return "disse que não precisa se inscrever";
    const permitidos = new Set(linksPermitidos.map((l) => (l.match(/eventoId=(\d+)/) || [])[1]).filter(Boolean));
    for (const m of texto.matchAll(/eventoId=(\d+)/g)) if (!permitidos.has(m[1])) return `link de inscrição desconhecido (${m[1]})`;
    return null;
}

// "Bom dia!" / "Boa tarde!" / "Boa noite!" conforme a hora em Brasília.
function saudacaoDoHorario(agora = new Date()): string {
    const hora = Number(new Intl.DateTimeFormat("en-US", { timeZone: FUSO, hour: "numeric", hour12: false }).format(agora)) % 24;
    return hora < 12 ? "Bom dia!" : hora < 18 ? "Boa tarde!" : "Boa noite!";
}

async function decidir(c: any, ev: any, ctx: any, conversa: string, hojeISO: string, retomada: string | null = null) {
    const { texto: escolas, links, eventos } = await escolasDaRegiao(c.filiais, hojeISO);
    const fixo = promptFixo(c, ev, hojeISO, escolas);
    const dinamico = promptDinamico(ctx, conversa, retomada);
    let r = await chamarClaude({ apiKey: ANTHROPIC_API_KEY, modelo: MODELO, blocoCacheavel: fixo, blocoDinamico: dinamico, maxTokens: 700, functionName: "campanha-responder" });
    if (r.erro || !r.texto) r = await chamarClaude({ apiKey: ANTHROPIC_API_KEY, modelo: MODELO_RESERVA, blocoCacheavel: fixo, blocoDinamico: dinamico, maxTokens: 700, functionName: "campanha-responder" });
    if (r.erro || !r.texto) return { erro: r.erro || "resposta_vazia" };
    const bruto = r.texto.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    try {
        const inicio = bruto.indexOf("{"), fim = bruto.lastIndexOf("}");
        const d = JSON.parse(bruto.slice(inicio, fim + 1));
        if (typeof d.resposta === "string") d.resposta = trocarPerguntaDoLink(d.resposta, c.config?.link_convite || ev?.link_inscricao);
        if (typeof d.resposta === "string") d.resposta = corrigirLinksDeAtividades(d.resposta, eventos.filter((e) => e.link));
        if (typeof d.resposta === "string") d.resposta = corrigirDatasDeAtividades(d.resposta, eventos);
        if (typeof d.resposta === "string") d.resposta = corrigirDiasDaSemana(d.resposta.replace(/\s—\s/g, ", ").replace(/\*\*/g, "").trim(), hojeISO) || null;
        d.links_permitidos = [...links, ev?.link_inscricao, c.config?.link_convite, ...(String(c.config?.instrucoes || "").match(/https?:\/\/\S+/g) || [])].filter(Boolean);
        return { decisao: d };
    } catch (e) {
        return { erro: "json_invalido: " + String(e), bruto };
    }
}

async function enviar(corpo: Record<string, unknown>) {
    const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ atendenteNome: NOME_ATENDENTE, origemEnvio: "manual", ...corpo }),
    });
    let d: any = null; try { d = await resp.json(); } catch { /* */ }
    return { ok: resp.ok && d?.ok !== false, erro: d?.detalhe?.message || d?.erro };
}

async function arteJaEnviada(pessoa: string, url: string): Promise<boolean> {
    const { data } = await supabaseAdmin.from("mensagens_whatsapp").select("id, payload_bruto")
        .eq("pessoaIdentificador", pessoa).eq("direcao", "saida").eq("tipo", "imagem").limit(20);
    return (data || []).some((m: any) => m.payload_bruto?.imagem_url === url);
}

async function aplicarDecisao(pessoa: string, c: any, ev: any, d: any, filialLead: string) {
    const etiqueta: Record<string, string> = { vai: "Campanha: Vai ao evento", talvez: "Campanha: Interessado", quer_info: "Campanha: Interessado", nao_vai: "Campanha: Não vai" };
    if (etiqueta[d.situacao]) await alterarTags(pessoa, { removerPrefixos: ["Campanha: "], adicionar: [etiqueta[d.situacao]] });
    if (c.evento_id && (d.situacao === "vai" || d.situacao === "nao_vai")) {
        await supabaseAdmin.from("evento_leads").update({ resposta_convite: d.situacao === "vai" ? "confirmado" : "recusado" })
            .eq("evento_id", c.evento_id).eq("pessoaIdentificador", pessoa).eq("origem", "crm");
    }
    if (d.mudou_cidade) await alterarTags(pessoa, { adicionar: ["Conversa: Mudou de Cidade"] });
    // Só aviso: "Contato em conferência" bloqueava todo envio e deixou sem resposta
    // quem só tinha mandado a mensagem automática da empresa (caso real 04/11).
    if (d.numero_errado) await alterarTags(pessoa, { adicionar: ["Campanha: Nome a conferir"] });
    if (d.nao_contatar) await alterarTags(pessoa, { adicionar: ["Não Contatar"] });
    if (d.precisa_humano) {
        await alterarTags(pessoa, { adicionar: ["Campanha: Falar com atendente"] });
        await supabaseAdmin.from("leads_inscricoes").update({ lembrete_em: hojeBrasilia(), lembrete_nota: `Campanha ${c.nome}: ${d.motivo_humano || "pediu atendimento"}` })
            .eq("pessoaIdentificador", pessoa);
    }
    if (d.escola_preferida && d.escola_preferida !== filialLead) {
        const nota = `Campanha ${c.nome}: prefere a unidade ${d.escola_preferida}.`;
        const { data: l } = await supabaseAdmin.from("leads_inscricoes").select("resumo_ia").eq("pessoaIdentificador", pessoa).maybeSingle();
        if (!String(l?.resumo_ia || "").includes(nota)) {
            await supabaseAdmin.from("leads_inscricoes").update({ resumo_ia: [l?.resumo_ia, nota].filter(Boolean).join("\n---\n") }).eq("pessoaIdentificador", pessoa);
        }
    }
    await supabaseAdmin.from("log_atividade").insert({
        filial: filialLead, acao: "campanha_resposta_automatica", autor: NOME_ATENDENTE, pessoa_ids: [pessoa],
        detalhes: { campanha: c.slug, situacao: d.situacao, precisa_humano: !!d.precisa_humano, escola_preferida: d.escola_preferida || null },
    });
}

// Responde a conversa de UMA pessoa, se a última mensagem ainda for dela.
async function responder(pessoa: string, mensagemId: number | null, esperaSegundos: number) {
    const c = await campanhaDoLead(pessoa);
    if (!c) return { pessoa, pulado: "fora de campanha ativa" };
    const { data: ultima } = await supabaseAdmin.from("mensagens_whatsapp")
        .select("id, direcao, tipo, criado_em").eq("pessoaIdentificador", pessoa).neq("wa_status", "falhou")
        .order("criado_em", { ascending: false }).limit(1).maybeSingle();
    if (!ultima || ultima.direcao !== "entrada") return { pessoa, pulado: "já respondida" };
    if (mensagemId && ultima.id !== mensagemId) return { pessoa, pulado: "chegou mensagem mais nova" };
    if (!podeResponderAgora(ultima.criado_em)) {
        // 20h-22h: não interrompe uma conversa em andamento (respondemos há menos de 30 min).
        const { data: nossa } = await supabaseAdmin.from("mensagens_whatsapp").select("criado_em")
            .eq("pessoaIdentificador", pessoa).eq("direcao", "saida").neq("wa_status", "falhou")
            .order("criado_em", { ascending: false }).limit(1).maybeSingle();
        const emAndamento = nossa && Date.now() - new Date(nossa.criado_em).getTime() < 30 * 60_000 && podeResponderAgora(ultima.criado_em, new Date(), true);
        if (!emAndamento) return { pessoa, pulado: "fora do horário de resposta (volta às 8h)" };
    }
    // Junta mensagens em sequência: espera um pouco depois da última.
    const falta = new Date(ultima.criado_em).getTime() + esperaSegundos * 1000 - Date.now();
    if (falta > 0) {
        await dormir(Math.min(falta, 40_000));
        const { data: nova } = await supabaseAdmin.from("mensagens_whatsapp").select("id, direcao")
            .eq("pessoaIdentificador", pessoa).neq("wa_status", "falhou").order("criado_em", { ascending: false }).limit(1).maybeSingle();
        if (!nova || nova.id !== ultima.id) return { pessoa, pulado: "chegou mensagem mais nova durante a espera" };
    }
    if (ultima.tipo === "audio") {
        // A transcrição roda a cada 2 min; aqui adiantamos para não deixar a pessoa esperando.
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/transcrever-audios-crm`, {
            method: "POST", headers: { "Content-Type": "application/json", "x-funil-token": Deno.env.get("FUNIL_ANALISE_TOKEN") || "" }, body: "{}",
        }).catch(() => {});
    }
    // Reserva presa: se a execução anterior morreu no meio (ex.: servidor
    // sobrecarregado em 04/11/2026), a reserva ficava "processando" para
    // sempre e a pessoa nunca recebia resposta. Depois de 5 min, libera.
    // Não duplica envio: antes de enviar, confere se a última mensagem ainda é dela.
    await supabaseAdmin.from("campanha_respostas_bot").delete().eq("mensagem_id", ultima.id)
        .eq("status", "processando").lt("criado_em", new Date(Date.now() - 5 * 60_000).toISOString());
    // Reserva: a chave primária impede que webhook e cron respondam a mesma mensagem.
    const { error: erroReserva } = await supabaseAdmin.from("campanha_respostas_bot")
        .insert({ mensagem_id: ultima.id, pessoaIdentificador: pessoa, campanha_id: c.id });
    if (erroReserva) return { pessoa, pulado: "já assumida" };

    const hojeISO = hojeBrasilia();
    const ev = c.evento_id ? await descreverEvento(c.evento_id) : null;
    const ctx = await contextoDoLead(pessoa);
    const h = await historico(pessoa);
    // Resposta automática do WhatsApp dela (ausência, "retornarei"...): não se
    // responde, para não parecer robô conversando com robô (caso real 04/11).
    if (ctx && ehRespostaAutomatica(h.msgs)) {
        await supabaseAdmin.from("campanha_respostas_bot").update({ status: "resposta_automatica", respondido_em: new Date().toISOString() }).eq("mensagem_id", ultima.id);
        return { pessoa, pulado: "mensagem automática do contato" };
    }
    if (!ctx) {
        await supabaseAdmin.from("campanha_respostas_bot").update({ status: "sem_lead" }).eq("mensagem_id", ultima.id);
        return { pessoa, pulado: "lead não encontrado" };
    }
    if (h.ultimaDoLeadIlegivel && ultima.tipo === "audio") {
        // Ainda sem transcrição: libera a reserva para a próxima varredura.
        await supabaseAdmin.from("campanha_respostas_bot").delete().eq("mensagem_id", ultima.id);
        return { pessoa, pulado: "áudio aguardando transcrição" };
    }
    // Retomada de um dia para o outro: nossa última mensagem foi em outro dia.
    const nossaUltima = [...h.msgs].reverse().find((m: any) => m.direcao === "saida");
    const retomada = nossaUltima && hojeBrasilia(new Date(nossaUltima.criado_em)) !== hojeISO ? saudacaoDoHorario() : null;
    const r = await decidir(c, ev, ctx, h.texto, hojeISO, retomada);
    if (r.erro) {
        await supabaseAdmin.from("campanha_respostas_bot").delete().eq("mensagem_id", ultima.id);
        return { pessoa, erro: r.erro };
    }
    const d = r.decisao;
    let status = "sem_resposta";
    const bloqueio = d.resposta ? motivoBloqueioResposta(d.resposta, d.links_permitidos || []) : null;
    if (bloqueio) {
        // Trava: não envia, e a conversa vai para atendimento humano (caso real 05/11:
        // o robô inventou "R$ 100,00" e disse que tinha confirmado com a equipe).
        status = "bloqueada: " + bloqueio;
        d.precisa_humano = true;
        d.motivo_humano = `Resposta automática bloqueada (${bloqueio}). Responder manualmente.`;
    } else if (d.resposta) {
        // Confere de novo: um atendente pode ter respondido enquanto a IA pensava.
        const { data: agora } = await supabaseAdmin.from("mensagens_whatsapp").select("id")
            .eq("pessoaIdentificador", pessoa).neq("wa_status", "falhou").order("criado_em", { ascending: false }).limit(1).maybeSingle();
        if (agora?.id !== ultima.id) status = "ultrapassada";
        else {
            // Texto (com o link) primeiro, arte depois: se a execução cair no meio,
            // o essencial já saiu (caso real 04/11: só a arte chegou e o texto não).
            const envio = await enviar({ pessoaIdentificador: pessoa, tipo: "texto", texto: d.resposta });
            status = envio.ok ? "respondida" : "falha_envio: " + String(envio.erro || "").slice(0, 200);
            if (envio.ok && d.enviar_arte && ev?.imagem_url && !(await arteJaEnviada(pessoa, ev.imagem_url))) {
                await enviar({ pessoaIdentificador: pessoa, tipo: "imagem", imagemUrl: ev.imagem_url, caption: "" });
            }
        }
    }
    await aplicarDecisao(pessoa, c, ev, d, ctx.lead.filial);
    await supabaseAdmin.from("campanha_respostas_bot").update({ status, resposta: d.resposta, decisao: d, respondido_em: new Date().toISOString() })
        .eq("mensagem_id", ultima.id);
    return { pessoa, status, situacao: d.situacao };
}

async function checarInscricoes(prazo: number) {
    const { data, error } = await supabaseAdmin.rpc("campanha_checagens_inscricao", { p_limite: 5 });
    if (error) return [{ erro: error.message }];
    const feitos: any[] = [];
    for (const k of data || []) {
        if (Date.now() > prazo) break;
        // Registra antes de enviar: a chave primária impede perguntar duas vezes.
        const { error: e1 } = await supabaseAdmin.from("campanha_checagens")
            .insert({ campanha_id: k.campanha_id, pessoaIdentificador: k.pessoa, tipo: "inscricao", status: "enviando" });
        if (e1) continue;
        const { data: c } = await supabaseAdmin.from("campanhas_whatsapp").select("*").eq("id", k.campanha_id).single();
        const ctx = await contextoDoLead(k.pessoa);
        const l = ctx?.lead;
        const base = String(l?.como_prefere_ser_chamado || String(l?.pessoaNome || "").trim().split(/\s+/)[0] || "").trim();
        const nome = base ? base.charAt(0).toUpperCase() + base.slice(1).toLowerCase() : "";
        const texto = `Oi${nome ? ", " + nome : ""}! Deu certo sua inscrição para ${c?.evento_com_artigo || "o evento"}? Se precisar de algum auxílio, é só me avisar! 😊`;
        const envio = await enviar({ pessoaIdentificador: k.pessoa, tipo: "texto", texto });
        await supabaseAdmin.from("campanha_checagens").update({ status: envio.ok ? "enviada" : "falha: " + String(envio.erro || "").slice(0, 150) })
            .eq("campanha_id", k.campanha_id).eq("pessoaIdentificador", k.pessoa).eq("tipo", "inscricao");
        feitos.push({ pessoa: k.pessoa, ok: envio.ok });
    }
    return feitos;
}

async function simular(corpo: any) {
    const { data: c } = await supabaseAdmin.from("campanhas_whatsapp").select("*").eq("slug", corpo.campanha || "dmf-2026").single();
    const ev = c.evento_id ? await descreverEvento(c.evento_id) : null;
    const ctx = corpo.pessoa ? await contextoDoLead(corpo.pessoa)
        : { lead: { pessoaNome: corpo.nome || "MARIA DAS GRAÇAS SILVA", filial: corpo.filial || "Goiânia - Jardim América", tags: [], historico_eventos: corpo.eventos || [] }, memoria: null };
    const conversa = (corpo.conversa || []).map((m: any) => `${m.de === "lead" ? "Lead" : "Escola"}: ${m.texto}`).join("\n");
    return await decidir(c, ev, ctx, conversa, hojeBrasilia(), corpo.retomada || null);
}

Deno.serve(async (req) => {
    const token = Deno.env.get("FUNIL_ANALISE_TOKEN");
    if (!token || req.headers.get("x-funil-token") !== token) return new Response("Não autorizado", { status: 401 });
    let corpo: any = {};
    try { corpo = await req.json(); } catch { /* */ }
    try {
        if (corpo.acao === "simular") return json({ ok: true, ...(await simular(corpo)) });
        if (corpo.pessoa && corpo.mensagem_id) return json({ ok: true, ...(await responder(String(corpo.pessoa), Number(corpo.mensagem_id), 20)) });
        // Varredura: horário comercial espera 25s depois da última mensagem; fora dele, 2,5 min.
        const espera = horarioComercial() ? 25 : 150;
        const { data: aguardando, error } = await supabaseAdmin.rpc("campanha_conversas_aguardando", { p_espera_segundos: espera, p_limite: 6 });
        if (error) return json({ ok: false, erro: error.message }, 500);
        const prazo = Date.now() + 110_000;
        const feitos = [];
        for (const a of aguardando || []) {
            if (Date.now() > prazo) break;
            feitos.push(await responder(a.pessoa, a.mensagem_id, 0));
        }
        // "Deu certo sua inscrição?" para quem disse que ia, 12h a 23h depois,
        // ainda sem inscrição no Ulisses (só em horário comercial, janela aberta).
        const checagens = horarioComercial() && Date.now() < prazo ? await checarInscricoes(prazo) : [];
        return json({ ok: true, feitos, checagens });
    } catch (e) {
        console.error(e);
        return json({ ok: false, erro: String((e as Error).message || e) }, 500);
    }
});

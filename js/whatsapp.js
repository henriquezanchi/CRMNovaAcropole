// ==========================================================
// Integração real com WhatsApp (Meta Cloud API)
// ==========================================================
// Substitui a antiga interface mockada. Envio passa pela Edge Function
// `whatsapp-send` (supabase/functions/whatsapp-send); mensagens recebidas
// e atualizações de status chegam via `whatsapp-webhook` gravando direto
// na tabela `mensagens_whatsapp`, que este arquivo lê e escuta em tempo
// real (Supabase Realtime). Depende de `leadsAtuais`, `filialAtual`,
// `escapeHTML` e `window.supabaseClient`, todos definidos em js/app.js
// (carregado antes deste arquivo).
//
// Templates de mensagem só existem depois de criados e aprovados no
// painel da Meta Business — a lista abaixo precisa ser preenchida com o
// NOME TÉCNICO exato de cada template aprovado (e a ordem das variáveis)
// antes de ir pra produção. Enquanto vazio, qualquer conversa fora da
// janela de 24h fica sem nenhuma forma de reabrir contato pela UI.
//
// Cada entrada de `variaveis` é { chave, label } — `chave` decide se o
// campo já vem PRÉ-PREENCHIDO (mas sempre editável) por
// preencherValorAutomatico() logo abaixo:
//   'nome'      -> primeiro nome do lead (formatado, nunca CAIXA ALTA)
//   'atendente' -> obterNomeAtendente() (já com artigo, se a pessoa quiser)
//   'filial'    -> filiais.nome_com_preposicao da filial atual (ou "de {nome}"
//                  como aproximação, se ninguém configurou ainda)
//   null        -> sem fonte automática, fica em branco pro SDR digitar
//                  (ex: nome da palestra, motivo do contato)
//
// `idioma` é o código de idioma REGISTRADO na Meta pra aquele template
// (campo "Selecione o idioma" na tela de criação) — precisa bater exato
// com o que foi aprovado, senão o envio falha (template não encontrado
// nesse idioma). Omitido = 'pt_BR' (padrão da maioria).
const TEMPLATES_WHATSAPP = [
    {
        nome: 'contato_inicial',
        label: 'Contato inicial',
        // Reaprovado pela Meta (2026-09-11) com um texto mais genérico —
        // a variável 3 deixou de ser "palestra" (algo digitado à mão) e
        // passou a ser "filial" (já vem pré-preenchida automaticamente
        // por preencherValorAutomatico(), mesmo padrão de contato_ulisses/
        // resgate_ex_aluno abaixo).
        corpoAprovado: 'Olá, {{1}}! Aqui quem fala é {{2}}, da Nova Acrópole {{3}}. Tudo bem?\n\nEstou entrando em contato pois você sempre demonstrou interesse na Filosofia, nas ideias que a Nova Acrópole tenta trazer através do curso de filosofia, das palestras, dos nossos vídeos no YouTube.',
        variaveis: [
            { chave: 'nome', label: 'nome do lead' },
            { chave: 'atendente', label: 'atendente' },
            { chave: 'filial', label: 'filial (com preposição)' },
        ],
    },
    {
        nome: 'aniversario',
        label: 'Feliz Aniversário',
        corpoAprovado: 'Olá {{1}}!\nAqui é {{2}} da Nova Acrópole {{3}}, e estou entrando em contato para lhe desejar um feliz aniversário!\n\nDesejo, em nome da nossa escola, que você tenha um dia maravilhoso, repleto de reflexões, em que seja possível recolher os melhores frutos das experiências do ano que passou, e convertê-las em sementes para semear o ano que se inicia, com muita vontade, amor e inteligência.\n\num grande abraço!',
        variaveis: [
            { chave: 'nome', label: 'nome do lead' },
            { chave: 'atendente', label: 'atendente' },
            { chave: 'filial', label: 'filial (com preposição)' },
        ],
    },
    {
        nome: 'resgate_lead_evento',
        label: 'Resgate de lead frio',
        corpoAprovado: 'Olá {{1}}! Aqui é da Nova Acrópole 🦉. \n\nNotamos seu interesse em nossos eventos de filosofia e gostaríamos muito de retomar contato. \n\nJá conhece nosso curso de Filosofia?',
        variaveis: [{ chave: 'nome', label: 'nome do lead' }],
    },
    // Os 3 abaixo usam o truque de embutir artigo/preposição DENTRO do
    // valor da variável (ex: "o Henrique", "de Barra do Garças") pra ler
    // natural no corpo aprovado — os campos 'atendente'/'filial' já vêm
    // assim pré-preenchidos automaticamente (preencherValorAutomatico()).
    {
        nome: 'contato_ulisses',
        label: 'Contato via Ulisses (nunca foi aluno)',
        corpoAprovado: 'Oi, {{1}}! Aqui é {{2}}, da Nova Acrópole {{3}}, tudo bem?\n\nVi que você participou {{4}} {{5}} recentemente.\n\nE aí, o que achou?',
        variaveis: [
            { chave: 'nome', label: 'nome do lead' },
            { chave: 'atendente', label: 'atendente (com artigo)' },
            { chave: 'filial', label: 'filial (com preposição)' },
            { chave: null, label: 'tipo do evento (com artigo, ex: da Palestra)' },
            { chave: null, label: 'nome/tema do evento (ex: "A Odisseia: ...")' },
        ],
    },
    // ⚠️ registrado na Meta com idioma English (confirmado pelo usuário,
    // não é engano) — precisa mandar `language: en_US`, senão o envio
    // falha (a Meta não encontra o template no idioma pt_BR).
    {
        nome: 'resgate_ex_aluno',
        label: 'Resgate (já foi aluno, inativo)',
        idioma: 'en_US',
        corpoAprovado: 'Oi, {{1}}!\n\nAqui é {{2}}, da Nova Acrópole {{3}}, tudo bem? Faz um tempo que você deu uma pausa na sua jornada filosófica com a gente, e sentimos sua falta!\n\nQueria saber como estão as coisas atualmente com você, os novos desafios que tem enfrentado, enfim, sobre tudo que quiser😊.\n\nEstamos sempre de portas abertas!',
        variaveis: [
            { chave: 'nome', label: 'nome do lead' },
            { chave: 'atendente', label: 'atendente (com artigo)' },
            { chave: 'filial', label: 'filial (com preposição)' },
        ],
    },
    // ⚠️ idem — registrado como English.
    {
        nome: 'contato_aluno_ativo',
        label: 'Contato com aluno atual',
        idioma: 'en_US',
        corpoAprovado: 'Oii, {{1}}! Aqui é {{2}}, da Nova Acrópole {{3}} . Estamos com {{4}} chegando e queria muito contar com você — seja participando, indicando alguém que você acha que ia gostar de divulgar. Topa conversar um pouquinho sobre isso?',
        variaveis: [
            { chave: 'nome', label: 'nome do lead' },
            { chave: 'atendente', label: 'atendente (com artigo)' },
            { chave: 'filial', label: 'filial (com preposição)' },
            { chave: null, papel: 'evento_com_artigo', label: 'evento/motivo (com artigo, ex: uma Palestra)' },
        ],
    },
    // Enviado pra análise na Meta em 2026-10-01 — AINDA NÃO APROVADO no
    // momento em que foi cadastrado aqui (print do usuário mostrava o
    // botão "Enviar para análise" ainda visível). Convite genérico pra
    // evento (não só "Palestra", apesar do nome técnico — {{4}}/{{5}} são
    // livres, cobrem qualquer tipo/data), próximo da estrutura de
    // `contato_inicial`. Pode continuar falhando com "template não
    // encontrado" até a Meta aprovar — reconferir status em "Gerenciar
    // modelos" no Business Manager antes de usar em produção.
    {
        nome: 'convite_palestra',
        label: 'Convite para evento',
        corpoAprovado: 'Olá, {{1}}!\n\nAqui quem fala é {{2}}, da Nova Acrópole {{3}}. Tudo bem?\n\nEstou entrando em contato para te convidar para {{4}} que deve acontecer no próximo dia {{5}}.\n\nPosso enviar mais detalhes sobre isso?',
        variaveis: [
            { chave: 'nome', label: 'nome do lead' },
            { chave: 'atendente', label: 'atendente' },
            { chave: 'filial', label: 'filial (com preposição)' },
            { chave: null, papel: 'evento_com_artigo', label: 'evento (com artigo, ex: a Abertura de Turma)' },
            { chave: null, papel: 'evento_data', label: 'data (ex: 01/10)' },
        ],
    },
];

// Devolve "do Jardim América"/"de Barra do Garças" pra uma filial
// específica (não a selecionada no topo) — extraída pra reuso, ver bug
// real abaixo.
function nomeFilialComPreposicao(nomeFilial) {
    const f = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).find(x => x.nome === nomeFilial);
    if (f && f.nome_com_preposicao) return f.nome_com_preposicao;
    // Sem preposição configurada em "Gerenciar Filiais" — "de {nome}"
    // é uma aproximação razoável na maioria dos casos, mas editável.
    return nomeFilial ? `de ${nomeFilial}` : '';
}

// Valor pré-preenchido pra uma variável de template, conforme sua chave —
// sempre EDITÁVEL depois (o SDR pode corrigir/trocar antes de enviar).
//
// Bug real (2026-09-28, pedido do usuário): a variável "filial" sempre
// usava `filialAtual` (a filial escolhida no seletor do topo) — errado
// desde que o WhatsApp Unificado passou a mostrar/permitir conversar com
// leads de QUALQUER filial (ver seção "Aba unificada" abaixo): um SDR
// vendo "Todas as filiais" e respondendo um lead de Barra do Garças
// mandava "...da Nova Acrópole do Jardim América" (a filial errada, só
// porque era a última selecionada no topbar). Corrigido pra sempre usar
// a filial DO PRÓPRIO LEAD (`lead.filial`), nunca a do seletor.
// Substitui {{1}}, {{2}}... pelos valores resolvidos — usado em TODO
// envio de template pra mostrar o texto de verdade no balão do chat
// (`corpo_texto`), nunca um placeholder genérico como "[Template: nome]".
// Bug real corrigido (2026-09-28): "Convidar em Massa" (API) mandava o
// placeholder cru pro `whatsapp-send` em vez de montar o preview de
// verdade — só ESTE ponto tinha esse bug, o envio individual e o de
// aniversário já montavam certo (duplicando a mesma lógica em 3
// lugares); extraído aqui pra não duplicar de novo.
function montarPreviewTemplate(tpl, params) {
    let preview = tpl.corpoAprovado || tpl.label;
    (params || []).forEach((valor, i) => { preview = preview.split(`{{${i + 1}}}`).join(valor); });
    return preview;
}

function preencherValorAutomatico(chave, leadId) {
    if (chave === 'nome') {
        const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
        return lead ? nomeParaChamar(lead) : '';
    }
    if (chave === 'atendente') {
        return obterNomeAtendente() || '';
    }
    if (chave === 'filial') {
        const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
        return nomeFilialComPreposicao(lead ? lead.filial : filialAtual);
    }
    return '';
}

let wppContatoAtivoId = null;
let canalListaWpp = null;

// ==========================================================
// Utilitários
// ==========================================================
function formatarHoraWpp(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// "HOJE"/"ONTEM"/"28 de setembro de 2026" — mesmo texto do separador de
// dia do WhatsApp real, usado por renderizarMensagens() (criarChatController).
function rotuloDataSeparadorWpp(iso) {
    const data = new Date(iso);
    const diaMsg = new Date(data); diaMsg.setHours(0, 0, 0, 0);
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
    if (diaMsg.getTime() === hoje.getTime()) return 'Hoje';
    if (diaMsg.getTime() === ontem.getTime()) return 'Ontem';
    return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function janelaAberta(mensagens) {
    const recebidas = mensagens.filter(m => m.direcao === 'entrada');
    if (recebidas.length === 0) return false;
    const ultima = recebidas[recebidas.length - 1];
    return (Date.now() - new Date(ultima.criado_em).getTime()) < 24 * 60 * 60 * 1000;
}

// Monta uma mensagem de erro mais útil que só "message" — inclui o código
// da Meta (ex: 200 "OAuthException" costuma ser acesso à API bloqueado a
// nível de APP, não um problema desta mensagem específica) e sempre
// espelha o objeto inteiro no console (F12), pra não precisar consultar o
// banco (mensagens_whatsapp.wa_status_erro) toda vez que algo falhar.
function mensagemErroWpp(data) {
    const detalhe = data?.detalhe;
    if (!detalhe) return String(data?.erro || 'erro desconhecido');
    const partes = [detalhe.message || data.erro];
    if (detalhe.code) partes.push(`código ${detalhe.code}${detalhe.type ? ' (' + detalhe.type + ')' : ''}`);
    return partes.join(' — ') + '\n\nDetalhe completo no console (F12).';
}

function statusIconHTML(m) {
    if (m.wa_status === 'falhou') {
        const motivo = m.wa_status_erro?.message || m.wa_status_erro?.title || 'Falha no envio';
        return ` <i class="fa-solid fa-triangle-exclamation msg-status msg-status-falhou" title="${escapeHTML(motivo)}"></i>`;
    }
    if (m.wa_status === 'lido') return ` <i class="fa-solid fa-check-double msg-status msg-status-lido" title="Lida"></i>`;
    if (m.wa_status === 'entregue') return ` <i class="fa-solid fa-check-double msg-status" title="Entregue"></i>`;
    return ` <i class="fa-solid fa-check msg-status" title="Enviado"></i>`;
}

// escapeHTML() preserva o caractere de quebra de linha (\n), mas o balão
// (.msg, css/style.css) não tem white-space:pre-line — sem isso, o texto
// simplesmente ignora \n/\n\n e mostra tudo numa linha só. Convertendo pra
// <br> depois de escapar, os parágrafos dos templates (ex: "aniversario",
// que tem linha em branco entre parágrafos) aparecem espaçados igual ao
// modelo aprovado na Meta (bug real relatado pelo usuário, comparando
// print da Meta com o balão renderizado no CRM).
//
// `termoBusca` (opcional, pedido do usuário 2026-09-30: "busca com
// destaque + navegação entre resultados, igual no whatsapp real") — quando
// preenchido, envolve cada ocorrência do termo com <mark>. Roda sobre o
// texto JÁ ESCAPADO (não o original), então só encontra o termo se ele não
// contiver caracteres HTML especiais (&<>"') — suficiente pra busca de
// texto comum, que é o caso de uso real.
function escapeRegExpWpp(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function destacarTermoBuscaWpp(textoEscapado, termoBusca) {
    if (!termoBusca) return textoEscapado;
    const re = new RegExp(escapeRegExpWpp(termoBusca), 'gi');
    return textoEscapado.replace(re, (m) => `<mark class="wpp-busca-mark">${m}</mark>`);
}
// Formatação de texto do WhatsApp real — pedido do usuário (2026-10-01):
// "*negrito*", "_itálico_", "~tachado~", "```monospace```". Roda DEPOIS
// do escapeHTML (os marcadores ficam como texto literal, nunca viram tag
// HTML de verdade) e ANTES da quebra de linha/destaque de busca — ordem
// importa: monospace primeiro, pra não conflitar com os outros 3.
function aplicarFormatacaoWhatsApp(texto) {
    return texto
        .replace(/```([^`\n]+)```/g, '<code>$1</code>')
        .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
        .replace(/_([^_\n]+)_/g, '<em>$1</em>')
        .replace(/~([^~\n]+)~/g, '<s>$1</s>');
}

function textoComQuebrasDeLinha(texto, termoBusca) {
    let escapado = escapeHTML(texto || '');
    escapado = aplicarFormatacaoWhatsApp(escapado);
    if (termoBusca) escapado = destacarTermoBuscaWpp(escapado, termoBusca);
    return escapado.replace(/\n/g, '<br>');
}

// ==========================================================
// Indicador de status de contato (pedido do usuário, 2026-09-28: "ao
// enviar uma mensagem através de comando no dashboard, deve haver algum
// indicativo que a mensagem foi enviada... para que eu não volte a
// entrar em contato com alguém que já entrei") — usado pelas listas de
// aniversariantes do Dashboard (js/app.js e js/visao-geral.js), que têm
// o botão "Enviar" rápido, mas serve pra qualquer lista de leads com
// botão de WhatsApp que precise do mesmo aviso.
// ==========================================================

// Busca a ÚLTIMA mensagem trocada (qualquer direção/tipo) com cada lead
// da lista — não só a de aniversário. 1 única query em lote (não 1 por
// lead) ordenada por mais recente primeiro; a 1ª ocorrência de cada
// pessoaIdentificador já é a mensagem mais recente dele.
async function obterStatusWhatsAppRecente(pessoaIds) {
    const ids = [...new Set((pessoaIds || []).filter(Boolean).map(String))];
    const mapa = new Map();
    if (ids.length === 0) return mapa;
    const { data, error } = await window.supabaseClient
        .from('mensagens_whatsapp')
        .select('pessoaIdentificador, direcao, wa_status, criado_em')
        .in('pessoaIdentificador', ids)
        .order('criado_em', { ascending: false })
        .limit(2000);
    if (error || !data) return mapa;
    data.forEach(m => {
        const chave = String(m.pessoaIdentificador);
        if (!mapa.has(chave)) mapa.set(chave, m);
    });
    return mapa;
}

// "Respondeu" (a última mensagem da conversa foi DELE — sinal mais forte
// de "já está em contato, não precisa reabordar") ou o status da NOSSA
// última mensagem (Enviado/Entregue/Lido/Falhou). `status` vem de
// obterStatusWhatsAppRecente() — undefined = nunca teve conversa, sem
// badge nenhum (não polui a lista com "nunca contatado").
function htmlBadgeStatusWpp(status) {
    if (!status) return '';
    if (status.direcao === 'entrada') {
        return `<span class="wpp-status-badge wpp-status-respondeu" title="A última mensagem da conversa foi do próprio lead — já está em contato"><i class="fa-solid fa-reply"></i> Respondeu</span>`;
    }
    const porStatus = {
        falhou: { classe: 'wpp-status-falhou', icone: 'fa-triangle-exclamation', texto: 'Falhou' },
        lido: { classe: 'wpp-status-lido', icone: 'fa-check-double', texto: 'Lido' },
        entregue: { classe: 'wpp-status-entregue', icone: 'fa-check-double', texto: 'Entregue' },
        enviado: { classe: 'wpp-status-enviado', icone: 'fa-check', texto: 'Enviado' },
    };
    const info = porStatus[status.wa_status] || porStatus.enviado;
    return `<span class="wpp-status-badge ${info.classe}" title="Última mensagem nossa: ${info.texto}"><i class="fa-solid ${info.icone}"></i> ${info.texto}</span>`;
}

// Botão de reagir (só existe pra mensagem com wa_message_id de verdade —
// falha de envio e conversa importada manualmente não têm um id real da
// Meta pra reagir em cima) e o badge com a(s) reação(ões) já aplicada(s)
// — pedido do usuário (2026-09-28): "quero poder 'reagir' às mensagens
// com emojis, como numa mensagem normal do whatsapp". Ver
// abrirSeletorReacaoWpp()/enviarReacaoWpp() mais abaixo.
function htmlBotaoReagirWpp(m) {
    if (!m.wa_message_id) return '';
    const reacaoAtendente = (m.reacoes && m.reacoes.atendente) || '';
    return `<button type="button" class="wpp-reagir-btn" data-wa-id="${escapeHTML(m.wa_message_id)}" data-reacao-atendente="${escapeHTML(reacaoAtendente)}" title="Reagir"><i class="fa-regular fa-face-smile"></i></button>`;
}

// Resumo curto de uma mensagem pra citação (barra "respondendo a"/balão
// de citação) — mesmo texto pra qualquer tipo de mídia, já que não dá
// pra mostrar a imagem inteira numa citação de 1 linha.
function previewTextoMensagemWpp(m) {
    if (m.tipo === 'imagem') return '📷 Imagem';
    if (m.tipo === 'documento') return '📄 ' + ((m.payload_bruto && m.payload_bruto.nome_arquivo) || 'Documento');
    if (m.tipo === 'audio') return '🎤 Áudio';
    return (m.corpo_texto || '').slice(0, 80);
}

// Botão de "Responder" (pedido do usuário, 2026-09-29: "igual no
// whatsapp real") — só existe pra mensagem com wa_message_id de verdade
// (a Graph API exige o id da mensagem original pra montar o `context`
// de citação; falha de envio/conversa importada não têm isso).
function htmlBotaoResponderWpp(m) {
    if (!m.wa_message_id) return '';
    return `<button type="button" class="wpp-responder-btn" data-wa-id="${escapeHTML(m.wa_message_id)}" data-preview="${escapeHTML(previewTextoMensagemWpp(m))}" data-remetente="${escapeHTML(m.direcao)}" title="Responder"><i class="fa-solid fa-reply"></i></button>`;
}

// Botão de "Encaminhar" (pedido do usuário, 2026-09-29: "igual no
// whatsapp real") — só existe pra mensagem com conteúdo reenviável
// (texto, ou mídia já com URL pública guardada em payload_bruto).
// Referencia a mensagem pelo `id` PRÓPRIO (bigint da tabela, não
// wa_message_id) — o clique busca o objeto completo em `mensagens`
// (closure do controller), não dá pra guardar um objeto num atributo
// data-*.
function htmlBotaoEncaminharWpp(m) {
    const podeEncaminhar = m.corpo_texto || (m.payload_bruto && (m.payload_bruto.imagem_url || m.payload_bruto.documento_url || m.payload_bruto.audio_url));
    if (!podeEncaminhar) return '';
    return `<button type="button" class="wpp-encaminhar-btn" data-msg-id="${m.id}" title="Encaminhar"><i class="fa-solid fa-share"></i></button>`;
}

// "Apagar/editar mensagem enviada" (pedido do usuário, 2026-09-30) — a
// Meta Cloud API NÃO tem endpoint pra editar ou apagar uma mensagem já
// enviada pelo número de negócio (isso é um recurso do app pessoal do
// WhatsApp, nunca exposto pela Business Platform) — então "editar" de
// verdade não existe, e implementar um fake seria enganoso. O que dá pra
// fazer, honestamente: OCULTAR a mensagem só na nossa tela (a mensagem
// continua entregue/visível pro lead no celular dele) — útil pra limpar um
// envio de teste/engano da nossa própria visualização. Só em mensagens de
// SAÍDA (nunca teria sentido "ocultar" o que o lead mandou).
function htmlBotaoOcultarWpp(m) {
    if (m.direcao !== 'saida') return '';
    return `<button type="button" class="wpp-ocultar-btn" data-msg-id="${m.id}" title="Ocultar esta mensagem só na nossa tela (o WhatsApp não permite apagar/editar algo já enviado — o lead continua vendo normalmente)"><i class="fa-solid fa-trash-can"></i></button>`;
}

// Citação dentro do balão (pedido do usuário, "igual no whatsapp real")
// — `quotedInfo` já vem resolvida por htmlMensagemWpp(): `{texto,
// propria}` (`propria` true = a mensagem citada era NOSSA, false = do
// lead, null = não sabe dizer — mensagem antiga fora da janela
// carregada). Sempre some se não houver contexto de resposta.
function htmlCitacaoWpp(quotedInfo) {
    if (!quotedInfo) return '';
    const rotulo = quotedInfo.propria === true ? 'Você' : quotedInfo.propria === false ? 'Lead' : 'Mensagem anterior';
    return `<div class="wpp-quote"><div class="wpp-quote-remetente">${escapeHTML(rotulo)}</div><div class="wpp-quote-texto">${escapeHTML(quotedInfo.texto)}</div></div>`;
}

// Resolve a citação de uma mensagem — nossas próprias mensagens de
// SAÍDA já guardam o preview/remetente da mensagem citada no momento do
// envio (payload_bruto.contexto_preview, ver whatsapp-send); mensagens
// de ENTRADA só trazem o `context.id` (wa_message_id) da Meta, sem
// texto — resolve contra o que já está carregado NESTA conversa
// (`mapaPorWaId`); se a mensagem citada não estiver carregada (mais
// antiga que a janela já buscada), mostra "Mensagem anterior" mesmo
// assim, sem travar.
function resolverCitacaoWpp(m, mapaPorWaId) {
    if (m.payload_bruto && m.payload_bruto.contexto_preview) {
        return { texto: m.payload_bruto.contexto_preview, propria: m.payload_bruto.contexto_remetente === 'saida' };
    }
    const ctxId = m.payload_bruto && m.payload_bruto.context && m.payload_bruto.context.id;
    if (!ctxId) return null;
    const alvo = mapaPorWaId ? mapaPorWaId.get(ctxId) : null;
    if (!alvo) return { texto: 'Mensagem anterior', propria: null };
    return { texto: previewTextoMensagemWpp(alvo), propria: alvo.direcao === 'saida' };
}
function htmlReacoesWpp(m) {
    if (!m.reacoes) return '';
    const distintos = [...new Set([m.reacoes.lead, m.reacoes.atendente].filter(Boolean))];
    if (distintos.length === 0) return '';
    return `<div class="wpp-reacao-badge">${distintos.map(e => escapeHTML(e)).join('')}</div>`;
}

function htmlMensagemWpp(m, quotedInfo, termoBusca, ativoBusca) {
    const classeDirecao = m.direcao === 'saida' ? 'msg-out' : 'msg-in';
    const classeExtra = (m.wa_status === 'falhou' ? 'msg-falhou' : '') + (ativoBusca ? ' msg-busca-ativa' : '');
    const classeReacao = (m.reacoes && (m.reacoes.lead || m.reacoes.atendente)) ? 'msg-com-reacao' : '';
    // Mensagem trazida de fora do CRM (js/importar-conversa-whatsapp.js,
    // enquanto a API do WhatsApp está bloqueada) — badge visível pra nunca
    // confundir com uma mensagem de verdade enviada/recebida pela API.
    const badgeImportada = m.importado_manualmente
        ? ' <i class="fa-solid fa-file-import" title="Importada de uma conversa feita fora do CRM" style="opacity:.6; font-size:10px;"></i>'
        : '';
    // Mensagem de imagem (Convite Compartilhável/"Nova Turma", ou anexo
    // livre do compose bar, ver enviarComAnexo()) — a URL não vem de
    // volta na resposta da Meta, foi guardada em payload_bruto na hora
    // do envio (ver whatsapp-send).
    const imagemUrl = m.tipo === 'imagem' ? (m.payload_bruto && m.payload_bruto.imagem_url) : null;
    // Mensagem de documento (anexo livre — PDF/Word/Excel etc., ver
    // enviarComAnexo()) — mesmo raciocínio, mas sem preview de imagem:
    // um cartão clicável com ícone + nome do arquivo, igual o WhatsApp real.
    const documento = m.tipo === 'documento' ? (m.payload_bruto || {}) : null;
    // Áudio recebido (voice note) — pedido do usuário ("não consigo ouvir
    // áudio pelo crm"): antes só mostrava o texto placeholder
    // "[Áudio recebido]", sem nenhuma mídia de verdade. A URL é baixada da
    // Graph API e re-hospedada no Storage pelo próprio webhook (ver
    // baixarEArmazenarMidiaRecebida(), supabase/functions/whatsapp-webhook)
    // — se por algum motivo a mídia não puder ser baixada (token, rede),
    // `audio_url` fica ausente e cai no texto normal, sem quebrar nada.
    const audioUrl = m.tipo === 'audio' ? (m.payload_bruto && m.payload_bruto.audio_url) : null;
    // Vídeo/figurinha recebidos e localização compartilhada — pedido do
    // usuário (2026-09-29, "implemente tudo que for possível"). Vídeo/
    // figurinha seguem o MESMO mecanismo de mídia baixada/re-hospedada
    // (whatsapp-webhook); localização vem com lat/long direto no
    // payload (sem mídia pra baixar), sempre disponível.
    const videoUrl = m.tipo === 'video' ? (m.payload_bruto && m.payload_bruto.video_url) : null;
    const stickerUrl = m.tipo === 'sticker' ? (m.payload_bruto && m.payload_bruto.sticker_url) : null;
    const localizacao = m.tipo === 'localizacao' ? (m.payload_bruto && m.payload_bruto.location) : null;
    // Contato compartilhado (vCard) — pedido do usuário (2026-10-01):
    // "quando alguém compartilhar um contato, abra uma conversa e a
    // possibilidade de preencher os dados do lead e salvar". O payload
    // da Meta (`msg.contacts`) já vem preservado por completo em
    // `payload_bruto` desde sempre (ver whatsapp-webhook/extrairTexto) —
    // só nunca tinha ação nenhuma em cima dele, só o texto "📇 Contato
    // compartilhado: Nome — Telefone".
    const contatosCompartilhados = (m.tipo === 'outro' && Array.isArray(m.payload_bruto?.contacts)) ? m.payload_bruto.contacts : null;
    const corpoHTML = contatosCompartilhados
        ? contatosCompartilhados.map((c) => {
            const nome = c.name?.formatted_name || c.name?.first_name || 'Contato sem nome';
            const telefoneDigits = ((c.phones || [])[0]?.wa_id || (c.phones || [])[0]?.phone || '').replace(/\D/g, '');
            return `<div style="display:flex; align-items:center; gap:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:8px; margin-bottom:4px;">
                <i class="fa-solid fa-address-card" style="font-size:20px; color:var(--na-green-dark);"></i>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; font-size:12px;">${escapeHTML(nome)}</div>
                    <div style="font-size:11px; color:#64748b;">${escapeHTML(telefoneDigits || 'sem telefone')}</div>
                    ${telefoneDigits ? `<div style="display:flex; gap:6px; margin-top:4px; flex-wrap:wrap;">
                        <button class="btn-primary" style="font-size:10.5px; padding:3px 7px;" onclick="cadastrarContatoWppEConvidar('${escapeHTML(nome).replace(/'/g, "\\'")}', '${telefoneDigits}', '${escapeHTML(m.filial || '').replace(/'/g, "\\'")}', this)"><i class="fa-solid fa-paper-plane"></i> Cadastrar e Convidar</button>
                        <button class="btn-toggle" style="font-size:10.5px; padding:3px 7px;" onclick="salvarContatoWppComoLead('${escapeHTML(nome).replace(/'/g, "\\'")}', '${telefoneDigits}')"><i class="fa-solid fa-user-plus"></i> Salvar como Lead</button>
                        <button class="btn-secondary" style="font-size:10.5px; padding:3px 7px;" onclick="abrirChatNaoIdentificado('${telefoneDigits}')"><i class="fa-brands fa-whatsapp"></i> Abrir Conversa</button>
                    </div>` : ''}
                </div>
            </div>`;
        }).join('')
        : imagemUrl
        ? `<img src="${escapeHTML(imagemUrl)}" alt="Imagem" style="max-width:100%; border-radius:6px; display:block; margin-bottom:${m.corpo_texto ? '4px' : '0'};">${m.corpo_texto ? textoComQuebrasDeLinha(m.corpo_texto, termoBusca) : ''}`
        : documento
        ? `<a href="${escapeHTML(documento.documento_url || '#')}" target="_blank" rel="noopener" style="display:flex; align-items:center; gap:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:8px; text-decoration:none; color:inherit; margin-bottom:${m.corpo_texto ? '4px' : '0'};">
            <i class="fa-solid fa-file-arrow-down" style="font-size:22px; color:var(--na-green-dark);"></i>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; font-size:12px;">${escapeHTML(documento.nome_arquivo || 'Documento')}</span>
          </a>${m.corpo_texto ? textoComQuebrasDeLinha(m.corpo_texto, termoBusca) : ''}`
        : audioUrl
        ? `<audio controls preload="none" style="max-width:220px; height:38px;"><source src="${escapeHTML(audioUrl)}"></audio>`
        : videoUrl
        ? `<video controls preload="metadata" style="max-width:100%; border-radius:6px; display:block; max-height:260px;"><source src="${escapeHTML(videoUrl)}"></video>${m.corpo_texto ? textoComQuebrasDeLinha(m.corpo_texto, termoBusca) : ''}`
        : stickerUrl
        ? `<img src="${escapeHTML(stickerUrl)}" alt="Figurinha" style="max-width:120px; display:block;">`
        : localizacao
        ? `<a href="https://www.google.com/maps?q=${localizacao.latitude},${localizacao.longitude}" target="_blank" rel="noopener" style="display:flex; align-items:center; gap:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:8px; text-decoration:none; color:inherit;">
            <i class="fa-solid fa-location-dot" style="font-size:22px; color:#dc2626;"></i>
            <span style="font-size:12px;"><strong>${escapeHTML(localizacao.name || 'Localização compartilhada')}</strong>${localizacao.address ? `<br><span style="color:#64748b;">${escapeHTML(localizacao.address)}</span>` : ''}</span>
          </a>`
        : textoComQuebrasDeLinha(m.corpo_texto, termoBusca);
    // Nome do usuário logado (js/usuarios.js) que enviou esta mensagem —
    // pedido do usuário ("no whatsapp precisa aparecer o nome do usuário
    // que está logado"). Só existe em mensagens de SAÍDA a partir da
    // migração migracao_whatsapp_atendente.sql; mensagens antigas/de
    // entrada não têm.
    const atendenteHTML = (m.direcao === 'saida' && m.atendente_nome)
        ? `<div class="msg-atendente">${escapeHTML(m.atendente_nome)}</div>`
        : '';
    return `
        <div class="msg ${classeDirecao} ${classeExtra} ${classeReacao}" data-msg-db-id="${m.id}">
            ${htmlBotaoReagirWpp(m)}
            ${htmlBotaoResponderWpp(m)}
            ${htmlBotaoEncaminharWpp(m)}
            ${htmlBotaoOcultarWpp(m)}
            ${htmlCitacaoWpp(quotedInfo)}
            ${corpoHTML}
            ${atendenteHTML}
            <div class="msg-time">${badgeImportada}${formatarHoraWpp(m.criado_em)}${m.direcao === 'saida' ? statusIconHTML(m) : ''}</div>
            ${htmlReacoesWpp(m)}
        </div>
    `;
}

// Exportar conversa (.txt) — pedido do usuário (2026-09-30): "útil pra
// LGPD, auditoria ou repasse formal de atendimento". Busca o HISTÓRICO
// INTEIRO (não só os 200 já carregados na tela) e gera um arquivo no
// MESMO formato que "Importar Conversa" já sabe ler de volta (`DD/MM/AAAA
// HH:MM - Remetente: texto`) — simetria de propósito, o export de um CRM
// já é o import válido pro outro. Mensagens ocultadas (ver
// ocultarMensagemWpp()) NÃO entram — já que a intenção de ocultar é
// "sumir da nossa visualização".
async function exportarConversaWppTxt(leadId, nomeLead) {
    const { data, error } = await window.supabaseClient
        .from('mensagens_whatsapp')
        .select('direcao, corpo_texto, criado_em, tipo, oculta_em, atendente_nome')
        .eq('pessoaIdentificador', leadId)
        .order('criado_em', { ascending: true });
    if (error) { alert('Erro ao exportar: ' + error.message); return; }
    const mensagens = (data || []).filter(m => !m.oculta_em);
    if (mensagens.length === 0) { alert('Esta conversa não tem mensagens pra exportar.'); return; }

    const linhas = mensagens.map(m => {
        const data = new Date(m.criado_em);
        const carimbo = `${String(data.getDate()).padStart(2, '0')}/${String(data.getMonth() + 1).padStart(2, '0')}/${data.getFullYear()} ${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`;
        const remetente = m.direcao === 'saida' ? (m.atendente_nome || 'Atendente') : (nomeLead || 'Lead');
        return `${carimbo} - ${remetente}: ${m.corpo_texto || `[${m.tipo || 'mensagem'}]`}`;
    });

    const blob = new Blob([linhas.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversa-${(nomeLead || 'lead').replace(/[^a-zA-Z0-9]/g, '_')}-${leadId}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// ==========================================================
// Reações (emoji) — mesmo conjunto de reação rápida que o WhatsApp
// mostra por padrão. Reagir de novo com o MESMO emoji remove a reação
// (toggle), igual o app real. Um único picker flutuante compartilhado
// (mesmo padrão de _containerPopupWpp() em notificacoes.js) — reposicionado
// perto do botão clicado a cada abertura.
// ==========================================================
const EMOJIS_REACAO_WPP = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function _containerSeletorReacaoWpp() {
    let el = document.getElementById('wppReacaoPicker');
    if (!el) {
        el = document.createElement('div');
        el.id = 'wppReacaoPicker';
        el.className = 'wpp-reacao-picker';
        document.body.appendChild(el);
    }
    return el;
}

function fecharSeletorReacaoWpp() {
    const el = document.getElementById('wppReacaoPicker');
    if (el) el.style.display = 'none';
}

function abrirSeletorReacaoWpp(botaoEl, reacaoAtual, aoEscolher) {
    const picker = _containerSeletorReacaoWpp();
    picker.innerHTML = EMOJIS_REACAO_WPP.map(e =>
        `<button type="button" class="wpp-reacao-opcao${e === reacaoAtual ? ' ativa' : ''}" data-emoji="${e}">${e}</button>`
    ).join('');
    const rect = botaoEl.getBoundingClientRect();
    picker.style.display = 'flex';
    picker.style.top = `${Math.max(8, rect.top - 44)}px`;
    picker.style.left = `${Math.min(window.innerWidth - 260, Math.max(8, rect.left - 90))}px`;
    picker.querySelectorAll('.wpp-reacao-opcao').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const emoji = btn.dataset.emoji;
            fecharSeletorReacaoWpp();
            aoEscolher(emoji === reacaoAtual ? '' : emoji);
        });
    });
    setTimeout(() => document.addEventListener('click', fecharSeletorReacaoWpp, { once: true }), 0);
}

// ==========================================================
// Emoji picker pra DIGITAR (diferente do de reação acima) — pedido do
// usuário (2026-09-30): o botão de carinha já existia no compose bar, mas
// não abria nada. Insere no cursor do <textarea>, não só no fim do texto.
// ==========================================================
const EMOJIS_DIGITAR_WPP = ['😀', '😂', '😍', '😊', '🙏', '👍', '👏', '🎉', '❤️', '🔥', '😢', '😮', '🤔', '😉', '🙌', '💪', '✅', '⭐', '📌', '📅', '☕', '🦉', '🌟', '😅', '🥳', '👋', '🤝', '💬', '📞', '📷'];

function _containerEmojiDigitarWpp() {
    let el = document.getElementById('wppEmojiDigitarPicker');
    if (!el) {
        el = document.createElement('div');
        el.id = 'wppEmojiDigitarPicker';
        el.className = 'wpp-emoji-digitar-picker';
        document.body.appendChild(el);
    }
    return el;
}
function fecharEmojiDigitarWpp() {
    const el = document.getElementById('wppEmojiDigitarPicker');
    if (el) el.style.display = 'none';
}
// Insere texto no CURSOR de um <textarea> (não só no fim) — compartilhado
// entre o emoji picker e as Respostas Rápidas (ver abaixo).
function inserirTextoNoInputWpp(inputEl, texto) {
    if (!inputEl) return;
    const inicio = inputEl.selectionStart ?? inputEl.value.length;
    const fim = inputEl.selectionEnd ?? inputEl.value.length;
    inputEl.value = inputEl.value.slice(0, inicio) + texto + inputEl.value.slice(fim);
    const novaPos = inicio + texto.length;
    inputEl.focus();
    inputEl.setSelectionRange(novaPos, novaPos);
    if (typeof ajustarAlturaTextareaWpp === 'function') ajustarAlturaTextareaWpp(inputEl);
}
function inserirEmojiNoInputWpp(inputEl, emoji) {
    inserirTextoNoInputWpp(inputEl, emoji);
    fecharEmojiDigitarWpp();
}

// ==========================================================
// Respostas rápidas prontas (canned responses) — pedido do usuário
// (2026-09-30): frases de FAQ pra colar com 1 clique, sem precisar de
// template aprovado pela Meta (lento pra editar). Catálogo compartilhado
// (respostas_rapidas_whatsapp, migracao_respostas_rapidas_whatsapp.sql),
// com placeholders resolvidos na hora de inserir (não gravados
// resolvidos no catálogo) — mesmo espírito de {nome}/{atendente}/{filial}
// já usados em outros textos do app.
// ==========================================================
let respostasRapidasCache = null;
function resolverRespostaRapida(texto, leadId) {
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
    if (!lead) return texto;
    const filialObj = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).find(f => f.nome === lead.filial) || {};
    return texto
        .replaceAll('{nome}', typeof nomeParaChamar === 'function' ? nomeParaChamar(lead) : (lead.pessoaNome || ''))
        .replaceAll('{atendente}', (typeof obterNomeAtendente === 'function' ? obterNomeAtendente() : '') || '')
        .replaceAll('{filial}', nomeFilialComPreposicao(lead.filial))
        .replaceAll('{endereco}', filialObj.endereco || '(endereço ainda não cadastrado em Gerenciar Filiais)')
        .replaceAll('{valor_mensalidade}', filialObj.valor_mensalidade != null ? String(filialObj.valor_mensalidade) : '(valor não cadastrado)')
        // Pedido do usuário (2026-10-01): "coloque o link do maps na
        // resposta rápida sobre o endereço, conforme cada filial" — gerado
        // na hora a partir do PRÓPRIO endereço cadastrado (sem precisar de
        // lat/long nem campo novo no banco): link de busca do Google Maps,
        // funciona em qualquer endereço de texto livre.
        // Pedido do usuário (2026-10-01): "podemos pegar o link do maps no
        // ulisses" — `filialObj.link_maps_ulisses` (sincronizado 1x/dia
        // via scraper/importar-ulisses-api.js, GET /facade/filial/{id}) é
        // um link de PIN exato, preferido sobre o link gerado por busca de
        // texto quando já estiver disponível.
        .replaceAll('{link_maps}', filialObj.link_maps_ulisses || (filialObj.endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(filialObj.endereco)}` : '(endereço ainda não cadastrado em Gerenciar Filiais)'));
}

// Pedido do usuário (2026-10-05/06): "quero poder encaminhar a foto do
// evento também nas respostas rápidas" — hoje uma resposta só insere
// TEXTO na caixa. Quando a resposta está linkada a um TIPO de evento
// (`resposta.tipo_evento`, catálogo `tipos_evento` — não dá pra linkar a
// um evento_id fixo, já que o catálogo de respostas é GLOBAL e um
// evento é sempre de 1 filial só), acha sozinho o evento desse tipo mais
// próximo (ainda não passado) na filial do LEAD sendo respondido — mesmo
// princípio já usado por `enviarConviteAberturaTurmaFilial()` (lá,
// hardcoded pro tipo "Abertura de Turma" e só pra gaveta; aqui,
// generalizado pra qualquer tipo e qualquer tela, por isso busca o
// evento DIRETO no banco em vez de reaproveitar `eventosAtuais`, que só
// cobre a filial escolhida no topbar — no WhatsApp Unificado o lead pode
// ser de outra). Achando e ele tendo `imagem_url`, ENVIA DE VERDADE
// (mesmo caminho de "Convite Compartilhável"/"Nova Turma",
// `whatsapp-send` tipo:'imagem') — a legenda é o texto da resposta já
// com os placeholders resolvidos. Devolve `true` quando já tratou o
// clique de ponta a ponta (enviou, ou mostrou um erro definitivo) —
// `false` quando não achou evento/foto, ou o atendente cancelou o envio,
// pra quem chamou cair de volta no comportamento de sempre (preencher a
// caixa com o texto).
async function tentarEnviarRespostaRapidaComFoto(resposta, leadId) {
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
    if (!lead || !lead.filial) return false;

    const hojeISO = new Date().toISOString().slice(0, 10);
    const { data: candidatosEvento } = await window.supabaseClient
        .from('eventos')
        .select('id, nome, data, data_limite_inscricao, imagem_url')
        .eq('filial', lead.filial)
        .eq('tipo', resposta.tipo_evento)
        .eq('ativo', true)
        .order('data', { ascending: true });
    const evento = (candidatosEvento || [])
        .filter(ev => (ev.data_limite_inscricao || ev.data) >= hojeISO)
        .sort((a, b) => a.data.localeCompare(b.data))[0];
    if (!evento || !evento.imagem_url) return false;

    const dataFormatada = (typeof formatarDataEvento === 'function') ? formatarDataEvento(evento.data) : evento.data;
    const caption = resolverRespostaRapida(resposta.texto, leadId);
    const primeiroNome = (typeof nomeParaChamar === 'function') ? nomeParaChamar(lead) : (lead.pessoaNome || 'o lead');

    if (!confirm(`Esta resposta está linkada ao evento "${evento.nome}" (${dataFormatada}), que tem foto cadastrada.\n\nEnviar a FOTO DE VERDADE + a legenda abaixo pra ${primeiroNome}, em vez de só preencher a caixa?\n\nLegenda: "${caption}"`)) return false;

    const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
        body: { pessoaIdentificador: leadId, tipo: 'imagem', imagemUrl: evento.imagem_url, caption, atendenteNome: (typeof obterNomeAtendente === 'function') ? obterNomeAtendente() : '' }
    });
    if (error) { alert('Erro ao enviar: ' + error.message); return true; }
    if (!data.ok) {
        if (data.erro === 'janela_fechada') {
            alert('Essa conversa está fora da janela de 24h — não dá pra enviar uma foto agora. Aqui está o texto, pra mandar de outra forma:\n\n' + caption);
        } else {
            console.error('Erro ao enviar resposta rápida com foto:', data.detalhe || data.erro);
            alert('Não foi possível enviar: ' + (typeof mensagemErroWpp === 'function' ? mensagemErroWpp(data) : (data.erro || 'erro desconhecido')));
        }
        return true;
    }

    if (typeof moverParaAbordagemAposEnvio === 'function') {
        moverParaAbordagemAposEnvio(leadId).catch(e => console.warn('Erro ao mover lead pra Abordagem após envio:', e.message));
    }
    // Recarrega a conversa que estiver aberta (gaveta OU WhatsApp
    // Unificado, qualquer uma que seja a atual) pra já mostrar a foto
    // enviada — mesmo padrão dual-contexto de confirmarNumeroErradoWpp().
    if (typeof chatDrawer !== 'undefined' && typeof currentLeadId !== 'undefined' && String(currentLeadId) === String(leadId)) {
        await chatDrawer.abrir(leadId);
    } else if (typeof chatWpp !== 'undefined' && typeof wppContatoAtivoId !== 'undefined' && String(wppContatoAtivoId) === String(leadId)) {
        await chatWpp.abrir(leadId);
    }
    return true;
}

// ==========================================================
// Consultar mensalidade de todas as filiais, sem sair do WhatsApp
// Unificado (pedido do usuário, 2026-10-01: "preciso saber o valor de
// contribuição da filial do lead (e pode consultar de outra filial) com
// facilidade no whatsapp unificado... como mandamos mensagens em massa,
// não faz sentido ficar indo de um em um responder" via a gaveta). Usa o
// mesmo `filiaisDisponiveis` já carregado (resolverRespostaRapida() acima
// já lê de lá) — nenhuma consulta nova ao banco. Reaproveita o MESMO
// painel flutuante (overlay+caixa) já usado por "Encaminhar mensagem"/
// "Gerenciar Respostas Rápidas".
// ==========================================================
function _containerMensalidadesWpp() {
    let el = document.getElementById('wppMensalidadesPanel');
    if (!el) {
        el = document.createElement('div');
        el.id = 'wppMensalidadesPanel';
        el.className = 'wpp-encaminhar-panel';
        document.body.appendChild(el);
    }
    return el;
}
function fecharMensalidadesWpp() {
    const el = document.getElementById('wppMensalidadesPanel');
    if (el) el.remove();
}
function abrirMensalidadesFiliaisWpp(leadId) {
    fecharMensalidadesWpp();
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
    const lista = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []);
    const panel = _containerMensalidadesWpp();
    panel.innerHTML = `
        <div class="wpp-encaminhar-overlay"></div>
        <div class="wpp-encaminhar-caixa" style="width:360px; max-height:80vh; overflow-y:auto;">
            <div class="wpp-encaminhar-titulo">Mensalidade por Filial <button type="button" class="wpp-encaminhar-fechar"><i class="fa-solid fa-xmark"></i></button></div>
            <div style="display:flex; flex-direction:column; gap:6px;">
                ${lista.length === 0 ? '<p style="font-size:12px; color:var(--text-muted);">Nenhuma filial cadastrada.</p>' : lista.map(f => {
                    const ehFilialDoLead = !!(lead && lead.filial === f.nome);
                    const valor = f.valor_mensalidade != null
                        ? `R$ ${Number(f.valor_mensalidade).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                        : '<span style="color:var(--text-muted);">não cadastrado</span>';
                    return `
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 8px; border-radius:6px; ${ehFilialDoLead ? 'background:#ecfdf5; border:1px solid var(--na-green);' : 'border:1px solid var(--border-color);'}">
                            <span style="font-size:12px; font-weight:${ehFilialDoLead ? '700' : '500'};">${escapeHTML(f.nome)}${ehFilialDoLead ? ' <span style="font-size:10px; color:var(--na-green);">(filial deste lead)</span>' : ''}</span>
                            <span style="font-size:12px; font-weight:600; white-space:nowrap;">${valor}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    panel.querySelector('.wpp-encaminhar-overlay').addEventListener('click', fecharMensalidadesWpp);
    panel.querySelector('.wpp-encaminhar-fechar').addEventListener('click', fecharMensalidadesWpp);
}

function _containerRespostasRapidasWpp() {
    let el = document.getElementById('wppRespostasRapidasPicker');
    if (!el) {
        el = document.createElement('div');
        el.id = 'wppRespostasRapidasPicker';
        el.className = 'wpp-respostas-rapidas-picker';
        document.body.appendChild(el);
    }
    return el;
}
function fecharRespostasRapidasWpp() {
    const el = document.getElementById('wppRespostasRapidasPicker');
    if (el) el.style.display = 'none';
}
async function abrirRespostasRapidasWpp(botaoEl, inputEl, leadId) {
    if (respostasRapidasCache === null) {
        const { data } = await window.supabaseClient.from('respostas_rapidas_whatsapp').select('*').order('ordem');
        respostasRapidasCache = data || [];
    }
    const picker = _containerRespostasRapidasWpp();
    picker.innerHTML = (respostasRapidasCache.length === 0 ? '<div style="padding:8px 10px; font-size:11px; color:var(--text-muted);">Nenhuma resposta cadastrada.</div>' : '')
        + respostasRapidasCache.map(r => `<button type="button" class="wpp-resposta-rapida-item" data-id="${r.id}">${escapeHTML(r.atalho)}</button>`).join('')
        + `<button type="button" class="wpp-resposta-rapida-item wpp-resposta-rapida-gerenciar"><i class="fa-solid fa-gear"></i> Gerenciar respostas</button>`;
    const rect = botaoEl.getBoundingClientRect();
    picker.style.display = 'flex';
    picker.style.top = `${Math.max(8, rect.top - Math.min(280, 36 * (respostasRapidasCache.length + 1) + 40))}px`;
    picker.style.left = `${Math.min(window.innerWidth - 260, Math.max(8, rect.left - 60))}px`;
    picker.querySelectorAll('.wpp-resposta-rapida-item:not(.wpp-resposta-rapida-gerenciar)').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const r = respostasRapidasCache.find(x => String(x.id) === btn.dataset.id);
            fecharRespostasRapidasWpp();
            if (!r) return;
            // Pedido do usuário (2026-10-05): "quero poder encaminhar a
            // foto do evento também nas respostas rápidas" — se esta
            // resposta está linkada a um tipo de evento, tenta mandar a
            // foto de verdade primeiro; só cai pro comportamento de
            // sempre (preencher a caixa) se não achar evento/foto, ou se
            // o atendente cancelar o envio.
            if (r.tipo_evento && await tentarEnviarRespostaRapidaComFoto(r, leadId)) return;
            inserirTextoNoInputWpp(inputEl, resolverRespostaRapida(r.texto, leadId));
        });
    });
    const btnGerenciar = picker.querySelector('.wpp-resposta-rapida-gerenciar');
    if (btnGerenciar) btnGerenciar.addEventListener('click', (ev) => { ev.stopPropagation(); fecharRespostasRapidasWpp(); abrirGerenciarRespostasRapidasWpp(); });
    setTimeout(() => document.addEventListener('click', fecharRespostasRapidasWpp, { once: true }), 0);
}

// "Gerenciar Respostas Rápidas" — reaproveita o mesmo overlay+caixa
// flutuante já usado por "Encaminhar mensagem" (.wpp-encaminhar-panel),
// em vez de criar markup estático novo em index.html.
function _containerGerenciarRespostasRapidasWpp() {
    let el = document.getElementById('wppGerenciarRespostasPanel');
    if (!el) {
        el = document.createElement('div');
        el.id = 'wppGerenciarRespostasPanel';
        el.className = 'wpp-encaminhar-panel';
        document.body.appendChild(el);
    }
    return el;
}
function fecharGerenciarRespostasRapidasWpp() {
    const el = document.getElementById('wppGerenciarRespostasPanel');
    if (el) el.remove();
}
async function abrirGerenciarRespostasRapidasWpp() {
    fecharGerenciarRespostasRapidasWpp();
    const { data } = await window.supabaseClient.from('respostas_rapidas_whatsapp').select('*').order('ordem');
    respostasRapidasCache = data || [];
    // Catálogo de tipos de evento (pro <select> "Foto do evento" abaixo)
    // — reaproveita TIPOS_EVENTO já carregado globalmente (js/eventos.js);
    // sem nada carregado ainda (corrida de boot), busca agora.
    if ((typeof TIPOS_EVENTO === 'undefined' || !TIPOS_EVENTO || TIPOS_EVENTO.length === 0) && typeof carregarTiposEvento === 'function') {
        await carregarTiposEvento();
    }
    const panel = _containerGerenciarRespostasRapidasWpp();
    panel.innerHTML = `
        <div class="wpp-encaminhar-overlay"></div>
        <div class="wpp-encaminhar-caixa" style="width:420px; max-height:80vh; overflow-y:auto;">
            <div class="wpp-encaminhar-titulo">Gerenciar Respostas Rápidas <button type="button" class="wpp-encaminhar-fechar"><i class="fa-solid fa-xmark"></i></button></div>
            <p style="font-size:11px; color:var(--text-muted); margin:0 0 8px;">Placeholders disponíveis: <code>{nome}</code> <code>{atendente}</code> <code>{filial}</code> <code>{endereco}</code> <code>{valor_mensalidade}</code> <code>{link_maps}</code></p>
            <p style="font-size:11px; color:var(--text-muted); margin:0 0 8px;">Linkar a um "Tipo de Evento" (pedido do usuário, 2026-10-05): ao clicar, o CRM acha sozinho o evento desse tipo mais próximo na filial do lead — achando foto cadastrada nele, manda a FOTO DE VERDADE + este texto como legenda, em vez de só preencher a caixa.</p>
            <div id="wppRespostasRapidasLista" style="display:flex; flex-direction:column; gap:8px;"></div>
            <button type="button" class="btn-secondary" style="margin-top:10px; width:100%;" onclick="adicionarRespostaRapidaWpp()"><i class="fa-solid fa-plus"></i> Nova resposta</button>
        </div>
    `;
    panel.querySelector('.wpp-encaminhar-overlay').addEventListener('click', fecharGerenciarRespostasRapidasWpp);
    panel.querySelector('.wpp-encaminhar-fechar').addEventListener('click', fecharGerenciarRespostasRapidasWpp);
    renderizarListaRespostasRapidasWpp();
}
function renderizarListaRespostasRapidasWpp() {
    const lista = document.getElementById('wppRespostasRapidasLista');
    if (!lista) return;
    const tiposDisponiveis = (typeof TIPOS_EVENTO !== 'undefined' ? TIPOS_EVENTO : []);
    lista.innerHTML = respostasRapidasCache.length === 0 ? '<p style="font-size:12px; color:var(--text-muted);">Nenhuma resposta cadastrada ainda.</p>' : respostasRapidasCache.map(r => `
        <div style="border:1px solid var(--border-color); border-radius:6px; padding:8px;">
            <input type="text" value="${escapeHTML(r.atalho)}" data-id="${r.id}" class="resposta-rapida-atalho" style="width:100%; margin-bottom:4px; padding:5px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px; font-weight:600; box-sizing:border-box;">
            <textarea data-id="${r.id}" class="resposta-rapida-texto" style="width:100%; height:60px; padding:5px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px; font-family:inherit; box-sizing:border-box;">${escapeHTML(r.texto)}</textarea>
            <select data-id="${r.id}" class="resposta-rapida-tipo-evento" style="width:100%; margin-top:4px; padding:5px; border:1px solid #cbd5e1; border-radius:4px; font-size:11px; box-sizing:border-box;">
                <option value="">Sem foto de evento (só texto)</option>
                ${tiposDisponiveis.map(t => `<option value="${escapeHTML(t)}" ${r.tipo_evento === t ? 'selected' : ''}>📷 Foto do evento: ${escapeHTML(t)}</option>`).join('')}
            </select>
            <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:4px;">
                <button class="btn-add-tag" onclick="salvarRespostaRapidaWpp('${r.id}')"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
                <button class="btn-add-tag" style="color:#b91c1c;" onclick="removerRespostaRapidaWpp('${r.id}')"><i class="fa-solid fa-trash"></i> Remover</button>
            </div>
        </div>
    `).join('');
}
async function salvarRespostaRapidaWpp(id) {
    const atalho = document.querySelector(`.resposta-rapida-atalho[data-id="${id}"]`).value.trim();
    const texto = document.querySelector(`.resposta-rapida-texto[data-id="${id}"]`).value.trim();
    const tipoEventoEl = document.querySelector(`.resposta-rapida-tipo-evento[data-id="${id}"]`);
    const tipoEvento = tipoEventoEl ? (tipoEventoEl.value || null) : null;
    if (!atalho || !texto) { alert('Preencha o atalho e o texto.'); return; }
    const { error } = await window.supabaseClient.from('respostas_rapidas_whatsapp').update({ atalho, texto, tipo_evento: tipoEvento }).eq('id', id);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    const r = respostasRapidasCache.find(x => String(x.id) === String(id));
    if (r) { r.atalho = atalho; r.texto = texto; r.tipo_evento = tipoEvento; }
}
async function removerRespostaRapidaWpp(id) {
    if (!confirm('Remover esta resposta rápida?')) return;
    const { error } = await window.supabaseClient.from('respostas_rapidas_whatsapp').delete().eq('id', id);
    if (error) { alert('Erro: ' + error.message); return; }
    respostasRapidasCache = respostasRapidasCache.filter(x => String(x.id) !== String(id));
    renderizarListaRespostasRapidasWpp();
}
async function adicionarRespostaRapidaWpp() {
    const ordem = respostasRapidasCache.length;
    const { data, error } = await window.supabaseClient.from('respostas_rapidas_whatsapp').insert({ atalho: 'Nova resposta', texto: '', ordem }).select().single();
    if (error) { alert('Erro: ' + error.message); return; }
    respostasRapidasCache.push(data);
    renderizarListaRespostasRapidasWpp();
}
function abrirEmojiPickerDigitarWpp(botaoEl, inputEl) {
    const picker = _containerEmojiDigitarWpp();
    picker.innerHTML = EMOJIS_DIGITAR_WPP.map(e => `<button type="button" class="wpp-emoji-opcao" data-emoji="${e}">${e}</button>`).join('');
    const rect = botaoEl.getBoundingClientRect();
    picker.style.display = 'grid';
    picker.style.top = `${Math.max(8, rect.top - 190)}px`;
    picker.style.left = `${Math.min(window.innerWidth - 260, Math.max(8, rect.left - 40))}px`;
    picker.querySelectorAll('.wpp-emoji-opcao').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            inserirEmojiNoInputWpp(inputEl, btn.dataset.emoji);
        });
    });
    setTimeout(() => document.addEventListener('click', fecharEmojiDigitarWpp, { once: true }), 0);
}

// ==========================================================
// Encaminhar mensagem (pedido do usuário, 2026-09-29: "igual no
// whatsapp real") — busca um lead destino (cross-filial, qualquer
// filial) e reenvia o MESMO conteúdo como uma mensagem nova. A Graph
// API não tem um "flag de encaminhado" pra mensagem de SAÍDA — chega pro
// destinatário como uma mensagem normal, sem o rótulo "Encaminhada" que
// o app nativo mostra (limitação da API, não do CRM).
// ==========================================================
function _containerEncaminharWpp() {
    let el = document.getElementById('wppEncaminharPanel');
    if (!el) {
        el = document.createElement('div');
        el.id = 'wppEncaminharPanel';
        el.className = 'wpp-encaminhar-panel';
        document.body.appendChild(el);
    }
    return el;
}

function fecharEncaminharWpp() {
    const el = document.getElementById('wppEncaminharPanel');
    if (el) el.remove();
}

function abrirSeletorEncaminharWpp(msg) {
    fecharEncaminharWpp();
    const panel = _containerEncaminharWpp();
    panel.innerHTML = `
        <div class="wpp-encaminhar-overlay"></div>
        <div class="wpp-encaminhar-caixa">
            <div class="wpp-encaminhar-titulo">Encaminhar mensagem <button type="button" class="wpp-encaminhar-fechar"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="wpp-encaminhar-preview">${escapeHTML(previewTextoMensagemWpp(msg))}</div>
            <input type="text" class="wpp-encaminhar-busca" placeholder="Buscar lead por nome (qualquer filial)...">
            <div class="wpp-encaminhar-resultados"></div>
        </div>
    `;
    panel.querySelector('.wpp-encaminhar-overlay').addEventListener('click', fecharEncaminharWpp);
    panel.querySelector('.wpp-encaminhar-fechar').addEventListener('click', fecharEncaminharWpp);

    const busca = panel.querySelector('.wpp-encaminhar-busca');
    const resultados = panel.querySelector('.wpp-encaminhar-resultados');
    let timer = null;
    busca.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const termo = busca.value.trim();
            if (!termo) { resultados.innerHTML = ''; return; }
            const { data } = await window.supabaseClient
                .from('leads_inscricoes')
                .select('pessoaIdentificador, pessoaNome, filial')
                .ilike('pessoaNome', `%${termo}%`)
                .is('lixeira_em', null)
                .not('pessoaTelefoneNumero', 'is', null)
                .limit(15);
            resultados.innerHTML = (data || []).length > 0
                ? data.map(l => `
                    <div class="wpp-encaminhar-item" data-id="${l.pessoaIdentificador}" data-nome="${escapeHTML(l.pessoaNome || '')}">
                        <div style="font-size:12.5px;">${escapeHTML(l.pessoaNome || 'Sem nome')}</div>
                        <div style="font-size:10px; color:var(--text-muted);"><i class="fa-solid fa-building"></i> ${escapeHTML(l.filial || 'sem filial')}</div>
                    </div>
                `).join('')
                : '<div style="font-size:11px; color:var(--text-muted); padding:8px;">Nenhum lead encontrado.</div>';
            resultados.querySelectorAll('.wpp-encaminhar-item').forEach(item => {
                item.addEventListener('click', () => confirmarEncaminharWpp(msg, item.dataset.id, item.dataset.nome));
            });
        }, 250);
    });
    busca.focus();
}

async function confirmarEncaminharWpp(msg, leadIdDestino, nomeDestino) {
    if (!confirm(`Encaminhar esta mensagem pra ${nomeDestino}?`)) return;
    fecharEncaminharWpp();

    let body;
    if (msg.tipo === 'imagem' && msg.payload_bruto?.imagem_url) {
        body = { pessoaIdentificador: leadIdDestino, tipo: 'imagem', imagemUrl: msg.payload_bruto.imagem_url, atendenteNome: obterNomeAtendente() };
    } else if (msg.tipo === 'documento' && msg.payload_bruto?.documento_url) {
        body = { pessoaIdentificador: leadIdDestino, tipo: 'documento', documentoUrl: msg.payload_bruto.documento_url, nomeArquivo: msg.payload_bruto.nome_arquivo, atendenteNome: obterNomeAtendente() };
    } else if (msg.tipo === 'audio' && msg.payload_bruto?.audio_url) {
        body = { pessoaIdentificador: leadIdDestino, tipo: 'audio', audioUrl: msg.payload_bruto.audio_url, atendenteNome: obterNomeAtendente() };
    } else {
        body = { pessoaIdentificador: leadIdDestino, tipo: 'texto', texto: msg.corpo_texto, atendenteNome: obterNomeAtendente() };
    }

    const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', { body });
    if (error || !data || data.ok === false) {
        alert('Não foi possível encaminhar: ' + (error ? error.message : mensagemErroWpp(data)));
        return;
    }
    moverParaAbordagemAposEnvio(leadIdDestino).catch(e => console.warn('Erro ao mover lead pra Abordagem após envio:', e.message));
}

async function enviarReacaoWpp(leadId, mensagemAlvoId, emoji) {
    if (!leadId || !mensagemAlvoId) return;
    const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
        body: { pessoaIdentificador: leadId, tipo: 'reacao', mensagemAlvoId, emoji, atendenteNome: obterNomeAtendente() }
    });
    if (error || !data || data.ok === false) {
        alert('Não foi possível reagir: ' + mensagemErroWpp(data || { erro: error?.message }));
    }
}

// Bug real corrigido (2026-09-30, "o que pode melhorar" — histórico
// limitado a 200 mensagens sem paginação): a query original ordenava
// ASCENDENTE + limit(200) — ou seja, buscava as 200 mensagens MAIS
// ANTIGAS da conversa, não as mais recentes. Numa conversa com mais de
// 200 mensagens, isso mostraria o início de anos atrás em vez do que
// aconteceu ontem. Corrigido: busca as mais RECENTES (`ascending:
// false` + limit) e inverte no fim pra devolver em ordem cronológica
// normal. `antesDe` (opcional) pagina pra trás — ver
// `carregarMaisAntigas()` em criarChatController().
const TAMANHO_PAGINA_HISTORICO_WPP = 200;
async function carregarHistoricoMensagens(pessoaIdentificador, antesDe) {
    if (!pessoaIdentificador) return [];
    let query = window.supabaseClient
        .from('mensagens_whatsapp')
        .select('*')
        .eq('pessoaIdentificador', pessoaIdentificador)
        .order('criado_em', { ascending: false })
        .limit(TAMANHO_PAGINA_HISTORICO_WPP);
    if (antesDe) query = query.lt('criado_em', antesDe);
    const { data, error } = await query;
    if (error) { console.error('Erro ao carregar histórico do WhatsApp:', error); return []; }
    return (data || []).reverse();
}

// ==========================================================
// Controller de chat reaproveitável — instanciado uma vez pra aba
// unificada e uma vez pra gaveta lateral do lead, sem duplicar lógica.
// ==========================================================
// Auto-crescimento do <textarea> de mensagem (pedido do usuário,
// 2026-09-29, junto do Ctrl+Enter pra nova linha) — cresce conforme o
// texto ganha linhas, até o limite de `max-height` do CSS (.chat-input),
// onde passa a rolar em vez de continuar crescendo.
function ajustarAlturaTextareaWpp(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

// Confirmação de leitura ativa (pedido do usuário, 2026-09-29: "implemente
// tudo que for possível") — marca a última mensagem RECEBIDA do lead como
// lida na Meta (whatsapp-marcar-lido), pra ele ver o ✓✓ azul, igual o
// WhatsApp real quando alguém abre a conversa. `wppMensagensMarcadasLidas`
// evita repetir a chamada pra mesma mensagem em reaberturas seguidas da
// mesma sessão (idempotente do lado da Meta de qualquer jeito, mas sem
// necessidade de bater na API de novo à toa).
const wppMensagensMarcadasLidas = new Set();
function marcarUltimaMensagemComoLidaWpp(leadId, mensagensCarregadas) {
    if (!leadId || !mensagensCarregadas || mensagensCarregadas.length === 0) return;
    const ultimaRecebida = [...mensagensCarregadas].reverse().find(m => m.direcao === 'entrada' && m.wa_message_id);
    if (!ultimaRecebida || wppMensagensMarcadasLidas.has(ultimaRecebida.wa_message_id)) return;
    wppMensagensMarcadasLidas.add(ultimaRecebida.wa_message_id);
    window.supabaseClient.functions.invoke('whatsapp-marcar-lido', {
        body: { pessoaIdentificador: leadId, waMessageId: ultimaRecebida.wa_message_id }
    }).catch(e => console.warn('Erro ao marcar mensagem como lida:', e.message));
}

function criarChatController({ messagesId, inputAreaId }) {
    let leadId = null;
    let mensagens = [];
    let canal = null;
    let anexoPendente = null; // { file, tipo: 'imagem'|'documento'|'audio' } — ver selecionarAnexo()
    // "Responder a uma mensagem específica" (pedido do usuário, 2026-09-29:
    // "igual no whatsapp real") — { waId, preview, remetente: 'saida'|'entrada' }
    // do balão clicado; null = não está respondendo nada em particular.
    let respondendoA = null;
    // Busca dentro da conversa aberta — pedido do usuário (2026-09-29:
    // "implemente tudo que for possível"; refinado 2026-09-30: "busca com
    // destaque + navegação entre resultados, igual no whatsapp real").
    // NUNCA esconde o resto da conversa, só destaca cada ocorrência
    // (<mark>) e deixa navegar entre elas com ⌃/⌄, mostrando "posição/total".
    // Bug real corrigido (2026-10-01, "a pesquisa não está retornando
    // palavras que sei que estão em algumas conversas"): a busca rodava
    // só sobre os balões já carregados no navegador (limite de 200 de
    // carregarHistoricoMensagens()) — uma palavra numa mensagem mais
    // antiga, ainda não paginada, nunca era encontrada, embora existisse
    // de verdade na conversa. `agendarBuscaCompletaBanco()` complementa
    // isso buscando no BANCO (toda a conversa, sem limite de 200) e
    // mesclando os resultados em `mensagens` antes de renderizar — a
    // busca local (instantânea, sem round-trip) continua rodando
    // primeiro, pra não travar a digitação.
    let termoBusca = '';
    let buscaMatches = []; // mensagens (na ordem cronológica) que batem com termoBusca
    let buscaIndiceAtual = null; // índice dentro de buscaMatches — null = ainda não escolhido nesta busca
    let buscaTimeoutId = null;
    // Paginação de mensagens antigas (pedido do usuário, 2026-09-30: "o
    // que pode melhorar" — histórico sem paginação, corta em 200). `true`
    // até um carregamento devolver MENOS que uma página cheia (sinal de
    // que chegou ao início da conversa).
    let temMaisAntigas = true;

    const el = (id) => document.getElementById(id);

    // Clique delegado no CONTAINER (não nos balões — o innerHTML é
    // reconstruído a cada renderizarMensagens(), um listener por balão se
    // perderia) pro botão de reagir/responder. Ligado 1x na criação do
    // controller, sobrevive a qualquer re-render.
    const containerMsgsParaReacao = el(messagesId);
    if (containerMsgsParaReacao) {
        containerMsgsParaReacao.addEventListener('click', (e) => {
            const btnReagir = e.target.closest('.wpp-reagir-btn');
            if (btnReagir && leadId) {
                e.stopPropagation();
                const waId = btnReagir.dataset.waId;
                abrirSeletorReacaoWpp(btnReagir, btnReagir.dataset.reacaoAtendente || '', (emoji) => {
                    enviarReacaoWpp(leadId, waId, emoji);
                });
                return;
            }
            const btnResponder = e.target.closest('.wpp-responder-btn');
            if (btnResponder) {
                e.stopPropagation();
                respondendoA = { waId: btnResponder.dataset.waId, preview: btnResponder.dataset.preview, remetente: btnResponder.dataset.remetente };
                atualizarBarraRespondendo();
                const input = el(inputAreaId)?.querySelector('.chat-input');
                if (input) input.focus();
                return;
            }
            const btnEncaminhar = e.target.closest('.wpp-encaminhar-btn');
            if (btnEncaminhar) {
                e.stopPropagation();
                const msg = mensagens.find(x => String(x.id) === btnEncaminhar.dataset.msgId);
                if (msg) abrirSeletorEncaminharWpp(msg);
                return;
            }
            const btnCarregarAntigas = e.target.closest('.wpp-carregar-antigas-btn');
            if (btnCarregarAntigas) {
                e.stopPropagation();
                carregarMaisAntigas();
                return;
            }
            // `leadId` (não `mensagens.find`) — mesma cautela já usada no
            // botão de reagir acima: este container (`wppMessages`) é
            // compartilhado com o mini-chat de "não identificado"
            // (carregarERenderizarChatNaoIdentificado(), fora deste
            // controller); sem essa guarda, ocultar uma mensagem ali
            // chamaria renderizarMensagens() DESTE controller (chatWpp,
            // com leadId nulo nesse momento) e apagaria a visualização do
            // mini-chat por engano.
            const btnOcultar = e.target.closest('.wpp-ocultar-btn');
            if (btnOcultar && leadId) {
                e.stopPropagation();
                ocultarMensagemWpp(Number(btnOcultar.dataset.msgId));
            }
        });
    }

    // "Ocultar" (ver htmlBotaoOcultarWpp() acima) — só na nossa tela, nunca
    // no WhatsApp do lead. `mensagens_whatsapp` ganhou a coluna
    // `oculta_em` (migracao_whatsapp_pin_arquivar_ocultar.sql) + uma
    // policy de UPDATE pública pra isso, mesmo modelo de acesso do resto
    // do projeto.
    async function ocultarMensagemWpp(msgId) {
        if (!confirm('Ocultar esta mensagem só na nossa tela?\n\nO WhatsApp da Meta não permite apagar ou editar uma mensagem já enviada — o lead continua vendo ela normalmente no celular dele. Isso só limpa a nossa visualização no CRM.')) return;
        const agora = new Date().toISOString();
        const { error } = await window.supabaseClient.from('mensagens_whatsapp').update({ oculta_em: agora }).eq('id', msgId);
        if (error) { alert('Erro ao ocultar: ' + error.message); return; }
        const idx = mensagens.findIndex(m => m.id === msgId);
        if (idx >= 0) mensagens[idx] = { ...mensagens[idx], oculta_em: agora };
        renderizarMensagens(true);
    }

    // "Carregar mensagens anteriores" (pedido do usuário, 2026-09-30) —
    // busca a PRÓXIMA página pra trás (mensagens mais antigas que a
    // primeira já carregada) e prepende, preservando a posição visual de
    // rolagem (sem isso, o navegador rolaria pro topo/fundo sozinho ao
    // crescer o conteúdo ACIMA do que já estava visível).
    async function carregarMaisAntigas() {
        if (!leadId || mensagens.length === 0 || !temMaisAntigas) return;
        const container = el(messagesId);
        const alturaAntes = container ? container.scrollHeight : 0;
        const scrollAntes = container ? container.scrollTop : 0;

        const maisAntigas = await carregarHistoricoMensagens(leadId, mensagens[0].criado_em);
        temMaisAntigas = maisAntigas.length === TAMANHO_PAGINA_HISTORICO_WPP;
        mensagens = [...maisAntigas, ...mensagens];
        renderizarMensagens(true);

        if (container) container.scrollTop = scrollAntes + (container.scrollHeight - alturaAntes);
    }

    // Injeta/remove a barra "Respondendo a..." acima da caixa de texto,
    // SEM re-renderizar a área de input inteira (evitaria perder o foco/
    // valor já digitado no <input>, ou a referência do elemento em uso
    // por enviarTexto() no meio de um envio). Chamada ao clicar
    // "Responder" e ao cancelar/enviar.
    function atualizarBarraRespondendo() {
        const container = el(inputAreaId);
        if (!container) return;
        const barraAntiga = container.querySelector('.wpp-respondendo-bar');
        if (barraAntiga) barraAntiga.remove();
        if (!respondendoA) return;
        const rotulo = respondendoA.remetente === 'saida' ? 'Respondendo a você' : 'Respondendo ao lead';
        const barra = document.createElement('div');
        barra.className = 'wpp-respondendo-bar';
        barra.innerHTML = `
            <div class="wpp-respondendo-info">
                <div class="wpp-respondendo-remetente">${escapeHTML(rotulo)}</div>
                <div class="wpp-respondendo-preview">${escapeHTML(respondendoA.preview || '')}</div>
            </div>
            <button type="button" class="wpp-respondendo-cancelar"><i class="fa-solid fa-xmark"></i></button>
        `;
        barra.querySelector('.wpp-respondendo-cancelar').addEventListener('click', () => {
            respondendoA = null;
            atualizarBarraRespondendo();
        });
        container.insertBefore(barra, container.firstChild);
    }

    // "Fidelidade ao WhatsApp real" (pedido do usuário, 2026-09-28) — o
    // real separa o dia entre grupos de mensagens com um "pill" central
    // ("HOJE"/"ONTEM"/data). Calculado aqui, não guardado — é só leitura.
    function renderizarMensagens(preservarScroll) {
        const container = el(messagesId);
        if (!container) return;
        // "Ocultar mensagem" (ver ocultarMensagemWpp()) — nunca desenhada,
        // mas continua em `mensagens` (referência/citação de outra
        // mensagem ainda precisa achar ela em mapaPorWaId).
        const visiveis = mensagens.filter(m => !m.oculta_em);
        if (visiveis.length === 0) {
            container.innerHTML = '<div style="text-align:center; font-size:11px; color:#64748b; margin-top:20px;">Nenhuma mensagem ainda. Envie a primeira abaixo.</div>';
            atualizarContadorBusca();
            return;
        }
        const mapaPorWaId = new Map(mensagens.filter(x => x.wa_message_id).map(x => [x.wa_message_id, x]));

        // Busca dentro da conversa: NUNCA esconde o resto (diferente da
        // versão anterior) — destaca cada ocorrência e permite navegar
        // entre elas, igual o WhatsApp real.
        if (termoBusca) {
            buscaMatches = visiveis.filter(m => (m.corpo_texto || '').toLowerCase().includes(termoBusca));
            if (buscaIndiceAtual === null || buscaIndiceAtual >= buscaMatches.length) buscaIndiceAtual = buscaMatches.length - 1;
        } else {
            buscaMatches = [];
            buscaIndiceAtual = null;
        }
        atualizarContadorBusca();

        // "Carregar mensagens anteriores" (pedido do usuário, 2026-09-30)
        // — só aparece sem busca ativa (não faz sentido paginar pra trás
        // no meio de uma navegação por resultados).
        let html = (!termoBusca && temMaisAntigas)
            ? `<div style="text-align:center; padding:6px 0 12px;"><button type="button" class="wpp-carregar-antigas-btn" style="background:none; border:1px solid var(--border-color); border-radius:14px; padding:5px 14px; font-size:11px; color:var(--text-muted); cursor:pointer;"><i class="fa-solid fa-arrow-up"></i> Carregar mensagens anteriores</button></div>`
            : '';
        let ultimoDia = null;
        const alvoAtivo = termoBusca && buscaMatches[buscaIndiceAtual] ? buscaMatches[buscaIndiceAtual].id : null;
        visiveis.forEach(m => {
            const diaAtual = new Date(m.criado_em).toDateString();
            if (diaAtual !== ultimoDia) {
                html += `<div class="wpp-date-divider"><span>${escapeHTML(rotuloDataSeparadorWpp(m.criado_em))}</span></div>`;
                ultimoDia = diaAtual;
            }
            html += htmlMensagemWpp(m, resolverCitacaoWpp(m, mapaPorWaId), termoBusca, m.id === alvoAtivo);
        });
        container.innerHTML = html;
        if (termoBusca && buscaMatches.length > 0) {
            rolarParaResultadoBusca();
        } else if (!preservarScroll) {
            container.scrollTop = container.scrollHeight;
        }
    }

    // Rola até o resultado ATUAL da busca (buscaIndiceAtual) e navega
    // entre resultados (⌃/⌄ na barra) — pedido do usuário (2026-09-30):
    // "igual no whatsapp real".
    function rolarParaResultadoBusca() {
        const alvo = buscaMatches[buscaIndiceAtual];
        if (!alvo) return;
        const container = el(messagesId);
        const elAlvo = container ? container.querySelector(`[data-msg-db-id="${alvo.id}"]`) : null;
        if (elAlvo) elAlvo.scrollIntoView({ block: 'center' });
    }
    function irParaResultadoBusca(delta) {
        if (buscaMatches.length === 0) return;
        buscaIndiceAtual = (buscaIndiceAtual + delta + buscaMatches.length) % buscaMatches.length;
        renderizarMensagens(true);
    }

    // Barra de busca dentro da conversa — injetada/removida ACIMA de
    // `.chat-messages` (sibling, não dentro — pra não ser apagada a cada
    // renderizarMensagens()). Alternada pelo botão de lupa no cabeçalho
    // (ver htmlBotaoBuscaConversaWpp() e o onclick ligado em ambos os
    // cabeçalhos, WhatsApp Unificado e gaveta).
    function toggleBuscaConversa() {
        const barraExistente = document.getElementById(messagesId + '-busca-bar');
        if (barraExistente) { barraExistente.remove(); termoBusca = ''; buscaIndiceAtual = null; renderizarMensagens(); return; }

        const container = el(messagesId);
        if (!container || !container.parentElement) return;
        const barra = document.createElement('div');
        barra.id = messagesId + '-busca-bar';
        barra.className = 'wpp-busca-bar';
        barra.innerHTML = `
            <i class="fa-solid fa-magnifying-glass" style="color:var(--text-muted); font-size:12px;"></i>
            <input type="text" class="wpp-busca-input" placeholder="Buscar nesta conversa...">
            <button type="button" class="wpp-busca-prev" title="Resultado anterior"><i class="fa-solid fa-chevron-up"></i></button>
            <span class="wpp-busca-contador"></span>
            <button type="button" class="wpp-busca-next" title="Próximo resultado"><i class="fa-solid fa-chevron-down"></i></button>
            <button type="button" class="wpp-busca-fechar"><i class="fa-solid fa-xmark"></i></button>
        `;
        container.parentElement.insertBefore(barra, container);
        const input = barra.querySelector('.wpp-busca-input');
        input.addEventListener('input', () => {
            termoBusca = input.value.trim().toLowerCase();
            buscaIndiceAtual = null; // busca nova — volta pro resultado mais recente
            renderizarMensagens();
            agendarBuscaCompletaBanco();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); irParaResultadoBusca(e.shiftKey ? -1 : 1); }
        });
        barra.querySelector('.wpp-busca-prev').addEventListener('click', () => irParaResultadoBusca(-1));
        barra.querySelector('.wpp-busca-next').addEventListener('click', () => irParaResultadoBusca(1));
        barra.querySelector('.wpp-busca-fechar').addEventListener('click', () => {
            barra.remove();
            termoBusca = '';
            buscaIndiceAtual = null;
            renderizarMensagens();
        });
        input.focus();
    }

    // Debounce de 350ms (evita 1 query por tecla) — busca no banco a
    // conversa INTEIRA (sem o limite de 200 do histórico carregado) e
    // mescla em `mensagens` quem ainda não estava presente, na posição
    // cronológica certa, antes de recalcular buscaMatches/renderizar.
    function agendarBuscaCompletaBanco() {
        if (buscaTimeoutId) clearTimeout(buscaTimeoutId);
        if (!termoBusca || !leadId) return;
        const termoDaVez = termoBusca;
        buscaTimeoutId = setTimeout(async () => {
            if (termoBusca !== termoDaVez || !leadId) return; // termo mudou/conversa trocou enquanto esperava
            const { data, error } = await window.supabaseClient
                .from('mensagens_whatsapp')
                .select('*')
                .eq('pessoaIdentificador', leadId)
                .ilike('corpo_texto', `%${termoDaVez}%`)
                .is('oculta_em', null)
                .order('criado_em', { ascending: true })
                .limit(200);
            if (error || termoBusca !== termoDaVez || !leadId) return; // ainda válido depois do round-trip?
            if (!data || data.length === 0) return;

            const idsJaCarregados = new Set(mensagens.map(m => m.id));
            const novas = data.filter(m => !idsJaCarregados.has(m.id));
            if (novas.length === 0) return;

            mensagens = [...mensagens, ...novas].sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
            buscaIndiceAtual = null; // resultados novos entraram — recomeça do mais recente
            renderizarMensagens();
        }, 350);
    }

    function atualizarContadorBusca() {
        const contador = document.querySelector(`#${messagesId}-busca-bar .wpp-busca-contador`);
        if (!contador) return;
        if (!termoBusca) { contador.textContent = ''; return; }
        contador.textContent = buscaMatches.length === 0 ? 'Nenhum resultado' : `${buscaIndiceAtual + 1}/${buscaMatches.length}`;
        const prevBtn = document.querySelector(`#${messagesId}-busca-bar .wpp-busca-prev`);
        const nextBtn = document.querySelector(`#${messagesId}-busca-bar .wpp-busca-next`);
        if (prevBtn) prevBtn.disabled = buscaMatches.length <= 1;
        if (nextBtn) nextBtn.disabled = buscaMatches.length <= 1;
    }

    function htmlSeletorTemplate() {
        if (TEMPLATES_WHATSAPP.length === 0) {
            return `<div class="wpp-template-hint" style="padding:10px 14px;"><i class="fa-solid fa-lock"></i> Conversa fora da janela de 24h e nenhum modelo de mensagem configurado ainda em TEMPLATES_WHATSAPP (js/whatsapp.js).</div>`;
        }
        const opcoes = TEMPLATES_WHATSAPP.map((t, i) => `<option value="${i}">${escapeHTML(t.label)}</option>`).join('');
        return `
            <div class="wpp-template-picker">
                <div class="wpp-template-hint"><i class="fa-solid fa-lock"></i> Fora da janela de 24h — escolha um modelo aprovado pra iniciar/retomar a conversa.</div>
                <select class="wpp-template-select">${opcoes}</select>
                <div class="wpp-template-vars"></div>
                <button type="button" class="btn-primary wpp-template-enviar" style="align-self:flex-end;">Enviar Modelo</button>
            </div>
        `;
    }

    function ligarHandlersTemplate(container) {
        const select = container.querySelector('.wpp-template-select');
        if (!select) return; // sem templates configurados — nada pra ligar
        const varsEl = container.querySelector('.wpp-template-vars');
        const botao = container.querySelector('.wpp-template-enviar');

        function montarCamposVariaveis() {
            const tpl = TEMPLATES_WHATSAPP[Number(select.value)];
            varsEl.innerHTML = (tpl.variaveis || []).map((v) => {
                const valor = preencherValorAutomatico(v.chave, leadId);
                return `<input type="text" class="wpp-template-var" placeholder="${escapeHTML(v.label)}" value="${escapeHTML(valor)}">`;
            }).join('');
        }
        montarCamposVariaveis();
        select.addEventListener('change', montarCamposVariaveis);

        botao.addEventListener('click', async () => {
            const tpl = TEMPLATES_WHATSAPP[Number(select.value)];
            const params = [...varsEl.querySelectorAll('.wpp-template-var')].map(i => i.value.trim());
            if (tpl.variaveis?.length && params.some(p => !p)) { alert('Preencha todas as variáveis do modelo.'); return; }

            const preview = montarPreviewTemplate(tpl, params);
            const contexto = respondendoA;
            respondendoA = null;
            atualizarBarraRespondendo();

            botao.disabled = true;
            const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
                body: {
                    pessoaIdentificador: leadId, tipo: 'template', templateNome: tpl.nome, templateIdioma: tpl.idioma || 'pt_BR', templateParams: params, templatePreview: preview, atendenteNome: obterNomeAtendente(),
                    ...(contexto ? { contextoMessageId: contexto.waId, contextoPreview: contexto.preview, contextoRemetente: contexto.remetente } : {}),
                }
            });
            botao.disabled = false;

            if (error) { alert('Erro ao enviar modelo: ' + error.message); return; }
            if (!data.ok) {
                console.error('Erro ao enviar modelo (WhatsApp):', data.detalhe || data.erro);
                alert('Não foi possível enviar o modelo: ' + mensagemErroWpp(data));
                return;
            }
            await recarregarHistorico();
            // Pedido do usuário: mandar mensagem já tira o lead de uma
            // coluna fria (ver moverParaAbordagemAposEnvio()).
            moverParaAbordagemAposEnvio(leadId).catch(e => console.warn('Erro ao mover lead pra Abordagem após envio:', e.message));
        });
    }

    function renderizarAreaInputTemplate() {
        const container = el(inputAreaId);
        if (!container) return;
        container.innerHTML = htmlSeletorTemplate();
        ligarHandlersTemplate(container);
        atualizarBarraRespondendo();
    }

    // Anexar foto/documento (pedido do usuário, 2026-09-28: "máximo de
    // funcionalidades iguais ao WhatsApp real") — igual o WhatsApp de
    // verdade, escolher um arquivo mostra uma PRÉVIA antes de enviar (a
    // caixa de texto já existente vira a legenda); só clicando
    // enviar/Enter é que sobe pro Supabase Storage (bucket
    // `whatsapp-midia`, público — ver migracao_storage_whatsapp_midia.sql)
    // e manda de verdade via `whatsapp-send`. Some sozinho ao mudar de
    // conversa (não persiste entre leads).
    // `tipoForcado` (opcional) — usado pela gravação de áudio abaixo, que
    // já sabe que o resultado é 'audio' (não dá pra adivinhar isso pelo
    // `file.type` de um Blob genérico do MediaRecorder).
    function selecionarAnexo(file, tipoForcado) {
        anexoPendente = { file, tipo: tipoForcado || (file.type.startsWith('image/') ? 'imagem' : 'documento') };
        atualizarPreviewAnexo();
    }
    function removerAnexo() {
        anexoPendente = null;
        atualizarPreviewAnexo();
    }
    function atualizarPreviewAnexo() {
        const container = el(inputAreaId);
        const previewEl = container ? container.querySelector('.wpp-anexo-preview') : null;
        if (!previewEl) return;
        if (!anexoPendente) { previewEl.style.display = 'none'; previewEl.innerHTML = ''; return; }
        previewEl.style.display = 'flex';
        if (anexoPendente.tipo === 'audio') {
            previewEl.innerHTML = `<i class="fa-solid fa-microphone" style="font-size:18px; color:var(--na-green-dark); flex-shrink:0;"></i><audio controls src="${URL.createObjectURL(anexoPendente.file)}" style="height:32px; flex:1;"></audio><i class="fa-solid fa-xmark remover"></i>`;
            previewEl.querySelector('.remover').addEventListener('click', removerAnexo);
            return;
        }
        const nomeArquivo = anexoPendente.file.name;
        const miniatura = anexoPendente.tipo === 'imagem'
            ? `<img src="${URL.createObjectURL(anexoPendente.file)}" alt="">`
            : `<i class="fa-solid fa-file-lines" style="font-size:22px; color:var(--text-muted); flex-shrink:0;"></i>`;
        previewEl.innerHTML = `${miniatura}<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHTML(nomeArquivo)}</span><i class="fa-solid fa-xmark remover"></i>`;
        previewEl.querySelector('.remover').addEventListener('click', removerAnexo);
    }

    // Gravar áudio no navegador (pedido do usuário, 2026-09-30) — clique
    // pra começar, clique de novo pra parar; o resultado entra no MESMO
    // fluxo de anexo (preview + enviarComAnexo(), ver mais abaixo), só com
    // tipo forçado 'audio'. Reaproveita `whatsapp-send` tipo:'audio', que
    // já existia (usado pra encaminhar áudio recebido).
    //
    // Limitação real, não escondida: o formato gravado depende do que o
    // NAVEGADOR suporta via MediaRecorder — tentamos, em ordem de
    // preferência, os formatos que a Graph API da Meta aceita de verdade
    // pra áudio (mp4/ogg); se o navegador só souber gravar webm (comum no
    // Chrome/Edge hoje), a Meta pode rejeitar ou não tocar como voice note
    // de verdade no celular do lead — não testado contra todos os
    // navegadores nesta sessão.
    let mediaRecorder = null;
    let mediaChunks = [];
    let mediaStream = null;
    let recordingTimer = null;
    let recordingSeconds = 0;

    function mimeTypeSuportadoAudioWpp() {
        if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
        const candidatos = ['audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
        return candidatos.find(t => MediaRecorder.isTypeSupported(t)) || '';
    }

    function atualizarBotaoGravacaoWpp(gravando) {
        const container = el(inputAreaId);
        const btn = container ? container.querySelector('.btn-audio-toggle') : null;
        if (!btn) return;
        btn.classList.toggle('gravando', gravando);
        btn.innerHTML = gravando
            ? '<i class="fa-solid fa-stop"></i> <span class="wpp-audio-timer">0:00</span>'
            : '<i class="fa-solid fa-microphone"></i>';
    }
    function atualizarTimerGravacaoWpp() {
        const container = el(inputAreaId);
        const span = container ? container.querySelector('.wpp-audio-timer') : null;
        if (!span) return;
        const m = Math.floor(recordingSeconds / 60), s = recordingSeconds % 60;
        span.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }
    function pararGravacaoSeAtiva(descartar) {
        if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            if (descartar) mediaChunks = [];
            mediaRecorder.stop();
        }
    }
    async function alternarGravacaoAudioWpp() {
        if (mediaRecorder && mediaRecorder.state === 'recording') { pararGravacaoSeAtiva(false); return; }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('Este navegador não permite gravar áudio (getUserMedia indisponível).');
            return;
        }
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            alert('Não foi possível acessar o microfone: ' + (e.message || e));
            return;
        }
        const mimeType = mimeTypeSuportadoAudioWpp();
        mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
        mediaChunks = [];
        recordingSeconds = 0;
        mediaRecorder.addEventListener('dataavailable', (e) => { if (e.data.size > 0) mediaChunks.push(e.data); });
        mediaRecorder.addEventListener('stop', () => {
            if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
            atualizarBotaoGravacaoWpp(false);
            if (mediaChunks.length === 0) return; // gravação descartada (troca de conversa) ou vazia
            const tipoFinal = mediaRecorder.mimeType || 'audio/webm';
            const blob = new Blob(mediaChunks, { type: tipoFinal });
            const extensao = tipoFinal.includes('mp4') ? 'm4a' : tipoFinal.includes('ogg') ? 'ogg' : 'webm';
            const file = new File([blob], `audio-${Date.now()}.${extensao}`, { type: tipoFinal });
            selecionarAnexo(file, 'audio');
        });
        mediaRecorder.start();
        atualizarBotaoGravacaoWpp(true);
        recordingTimer = setInterval(() => { recordingSeconds++; atualizarTimerGravacaoWpp(); }, 1000);
    }

    // `forcarRecriar` (padrão false) — pedido do usuário (2026-10-05):
    // "ao dar enter... voltar o cursor para o campo de digitar. [...]
    // percebi que ele está voltando, mas a tela atualiza alguns
    // milissegundos depois do enter, e isso tira do campo de digitação".
    // Causa real: esta função sempre reconstruía o <textarea> do zero
    // (innerHTML inteiro) toda vez que era chamada — inclusive pelo
    // Realtime (INSERT da própria mensagem que acabamos de mandar
    // ecoando de volta, segundos depois de `enviarTexto()` já ter
    // devolvido o foco pra caixa) — um <textarea> NOVO nunca está
    // focado, mesmo substituindo o antigo no mesmo lugar visual. Agora,
    // se o container JÁ tem a caixa de texto livre (mesmo modo, mesma
    // conversa) e a janela continua aberta, a função não mexe no DOM —
    // só atualiza a barra "Respondendo a..." — preservando foco/cursor/
    // rascunho digitado. Só reconstrói de propósito quando MUDA de
    // conversa (abrir() sempre chama com forcarRecriar=true, já que
    // trocar de lead precisa limpar qualquer rascunho da conversa
    // anterior) ou quando o MODO muda (ex: janela fechou/abriu).
    function renderizarAreaInput(forcarRecriar) {
        const container = el(inputAreaId);
        if (!container) return;

        if (!forcarRecriar && janelaAberta(mensagens) && container.querySelector('.chat-input')) {
            atualizarBarraRespondendo();
            return;
        }

        anexoPendente = null; // troca de conversa (recarregarHistorico() chama isto de novo) nunca deveria manter um anexo pendente de OUTRO lead

        if (janelaAberta(mensagens)) {
            container.innerHTML = `
                <div class="wpp-anexo-preview" style="display:none;"></div>
                <div class="chat-input-row">
                    <button type="button" class="btn-anexo-toggle" style="background: none; border: none; font-size: 18px; color: var(--text-muted); cursor: pointer;" title="Anexar foto ou documento"><i class="fa-solid fa-paperclip"></i></button>
                    <input type="file" class="wpp-anexo-input" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" hidden>
                    <button type="button" class="btn-emoji-toggle" style="background: none; border: none; font-size: 20px; color: var(--text-muted); cursor: pointer;" title="Emojis"><i class="fa-regular fa-face-smile"></i></button>
                    <button type="button" class="btn-resposta-rapida-toggle" style="background: none; border: none; font-size: 17px; color: var(--text-muted); cursor: pointer;" title="Respostas rápidas"><i class="fa-solid fa-bolt"></i></button>
                    <textarea class="chat-input" rows="1" placeholder="Digite uma mensagem..."></textarea>
                    <button type="button" class="btn-audio-toggle" title="Gravar áudio"><i class="fa-solid fa-microphone"></i></button>
                    <button type="button" class="btn-send"><i class="fa-solid fa-paper-plane"></i></button>
                </div>
            `;
            const input = container.querySelector('.chat-input');
            const botao = container.querySelector('.btn-send');
            const anexoBtn = container.querySelector('.btn-anexo-toggle');
            const anexoInput = container.querySelector('.wpp-anexo-input');
            const emojiBtn = container.querySelector('.btn-emoji-toggle');
            const respostaRapidaBtn = container.querySelector('.btn-resposta-rapida-toggle');
            const audioBtn = container.querySelector('.btn-audio-toggle');
            const disparar = () => enviarMensagem(input);
            botao.addEventListener('click', disparar);
            // Enter sozinho envia (mesmo comportamento de sempre). Shift+Enter
            // (padrão real do WhatsApp — corrigido 2026-10-01, era Ctrl+Enter
            // por engano) insere quebra de linha — inserida NA MÃO (não
            // confiando no padrão do navegador, que não é garantido em todo
            // browser/SO) pra funcionar de forma confiável e já redimensionar
            // a caixa na hora.
            input.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                if (!e.shiftKey) { e.preventDefault(); disparar(); return; }
                e.preventDefault();
                const ini = input.selectionStart, fim = input.selectionEnd;
                input.value = input.value.slice(0, ini) + '\n' + input.value.slice(fim);
                input.selectionStart = input.selectionEnd = ini + 1;
                ajustarAlturaTextareaWpp(input);
            });
            input.addEventListener('input', () => ajustarAlturaTextareaWpp(input));
            anexoBtn.addEventListener('click', () => anexoInput.click());
            anexoInput.addEventListener('change', () => {
                if (anexoInput.files[0]) selecionarAnexo(anexoInput.files[0]);
                anexoInput.value = ''; // permite escolher o MESMO arquivo de novo depois de remover
            });
            emojiBtn.addEventListener('click', () => abrirEmojiPickerDigitarWpp(emojiBtn, input));
            respostaRapidaBtn.addEventListener('click', () => abrirRespostasRapidasWpp(respostaRapidaBtn, input, leadId));
            audioBtn.addEventListener('click', () => alternarGravacaoAudioWpp());
        } else {
            renderizarAreaInputTemplate();
            return;
        }
        atualizarBarraRespondendo();
    }

    // Decide entre texto livre e anexo (foto/documento, legenda = o texto
    // digitado) — ponto único chamado pelo botão de enviar/Enter.
    async function enviarMensagem(input) {
        if (anexoPendente) { await enviarComAnexo(input); return; }
        await enviarTexto(input);
    }

    async function enviarTexto(input) {
        const texto = input.value.trim();
        if (!texto || !leadId) return;
        const contexto = respondendoA;
        respondendoA = null;
        atualizarBarraRespondendo();
        input.value = '';
        ajustarAlturaTextareaWpp(input);
        input.disabled = true;

        const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
            body: {
                pessoaIdentificador: leadId, tipo: 'texto', texto, atendenteNome: obterNomeAtendente(),
                ...(contexto ? { contextoMessageId: contexto.waId, contextoPreview: contexto.preview, contextoRemetente: contexto.remetente } : {}),
            }
        });
        input.disabled = false;
        input.focus();

        if (error) { alert('Erro ao enviar mensagem: ' + error.message); input.value = texto; return; }
        if (!data.ok) {
            if (data.erro === 'janela_fechada') {
                alert('Essa conversa está fora da janela de 24h — escolha um modelo aprovado pra reabrir o contato.');
                renderizarAreaInputTemplate();
            } else {
                console.error('Erro ao enviar mensagem (WhatsApp):', data.detalhe || data.erro);
                alert('Não foi possível enviar: ' + mensagemErroWpp(data));
            }
            return;
        }
        await recarregarHistorico();
        moverParaAbordagemAposEnvio(leadId).catch(e => console.warn('Erro ao mover lead pra Abordagem após envio:', e.message));
    }

    async function enviarComAnexo(input) {
        if (!leadId || !anexoPendente) return;
        const anexo = anexoPendente;
        const legenda = input.value.trim();
        const contexto = respondendoA;
        respondendoA = null;
        atualizarBarraRespondendo();
        input.value = '';
        input.disabled = true;
        anexoPendente = null;
        atualizarPreviewAnexo();

        try {
            const nomeSeguro = anexo.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const caminho = `${leadId}/${Date.now()}-${nomeSeguro}`;
            const { error: erroUpload } = await window.supabaseClient.storage
                .from('whatsapp-midia')
                .upload(caminho, anexo.file, { contentType: anexo.file.type || 'application/octet-stream' });
            if (erroUpload) { alert('Erro ao subir o arquivo: ' + erroUpload.message); input.disabled = false; input.focus(); return; }

            const { data: urlData } = window.supabaseClient.storage.from('whatsapp-midia').getPublicUrl(caminho);
            const url = urlData.publicUrl;

            const contextoBody = contexto ? { contextoMessageId: contexto.waId, contextoPreview: contexto.preview, contextoRemetente: contexto.remetente } : {};
            // Áudio (gravado no navegador, ver alternarGravacaoAudioWpp()) —
            // a Graph API não aceita legenda em mensagem de áudio, então
            // `legenda` (o que a pessoa digitou por engano na caixa
            // enquanto o player de preview aparecia) é simplesmente
            // ignorada aqui, igual o WhatsApp real (voice note não tem
            // legenda).
            const body = anexo.tipo === 'imagem'
                ? { pessoaIdentificador: leadId, tipo: 'imagem', imagemUrl: url, caption: legenda || undefined, atendenteNome: obterNomeAtendente(), ...contextoBody }
                : anexo.tipo === 'audio'
                ? { pessoaIdentificador: leadId, tipo: 'audio', audioUrl: url, atendenteNome: obterNomeAtendente(), ...contextoBody }
                : { pessoaIdentificador: leadId, tipo: 'documento', documentoUrl: url, nomeArquivo: anexo.file.name, caption: legenda || undefined, atendenteNome: obterNomeAtendente(), ...contextoBody };

            const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', { body });
            input.disabled = false;
            input.focus();
            if (error) { alert('Erro ao enviar anexo: ' + error.message); return; }
            if (!data.ok) {
                if (data.erro === 'janela_fechada') {
                    alert('Essa conversa está fora da janela de 24h — anexo só funciona dentro da janela, igual texto livre.');
                    renderizarAreaInputTemplate();
                } else {
                    console.error('Erro ao enviar anexo (WhatsApp):', data.detalhe || data.erro);
                    alert('Não foi possível enviar: ' + mensagemErroWpp(data));
                }
                return;
            }
            await recarregarHistorico();
            moverParaAbordagemAposEnvio(leadId).catch(e => console.warn('Erro ao mover lead pra Abordagem após envio:', e.message));
        } catch (e) {
            input.disabled = false;
            input.focus();
            alert('Erro inesperado ao enviar anexo: ' + (e.message || e));
        }
    }

    async function recarregarHistorico() {
        if (!leadId) return;
        mensagens = await carregarHistoricoMensagens(leadId);
        temMaisAntigas = mensagens.length === TAMANHO_PAGINA_HISTORICO_WPP;
        renderizarMensagens();
        renderizarAreaInput();
    }

    // Força a área de envio a mostrar o seletor de template (mesmo DENTRO
    // da janela de 24h, onde o padrão seria texto livre) já com um modelo
    // específico pré-selecionado — usado pelo clique em "Aniversariantes
    // de Hoje" (Agenda do Dia), que deve abrir a gaveta pronta pra mandar
    // o template "aniversario" sem o SDR precisar procurar na lista.
    function selecionarTemplatePorNome(nomeTemplate) {
        const idx = TEMPLATES_WHATSAPP.findIndex(t => t.nome === nomeTemplate);
        if (idx < 0) return;
        renderizarAreaInputTemplate();
        const container = el(inputAreaId);
        const select = container ? container.querySelector('.wpp-template-select') : null;
        if (!select) return;
        select.value = String(idx);
        select.dispatchEvent(new Event('change'));
    }

    async function abrir(pessoaIdentificador, templateNomeForcado) {
        if (canal) { window.supabaseClient.removeChannel(canal); canal = null; }
        pararGravacaoSeAtiva(true); // trocar de conversa no meio de uma gravação descarta ela
        leadId = pessoaIdentificador;
        mensagens = [];
        respondendoA = null; // trocar de conversa cancela qualquer "respondendo a" pendente
        termoBusca = '';
        buscaIndiceAtual = null;
        const barraBuscaAntiga = document.getElementById(messagesId + '-busca-bar');
        if (barraBuscaAntiga) barraBuscaAntiga.remove();

        const containerMsgs = el(messagesId);
        if (containerMsgs) containerMsgs.innerHTML = '<div style="text-align:center; font-size:11px; color:#64748b; margin-top:20px;">Carregando conversa...</div>';

        mensagens = await carregarHistoricoMensagens(leadId);
        temMaisAntigas = mensagens.length === TAMANHO_PAGINA_HISTORICO_WPP;
        renderizarMensagens();
        renderizarAreaInput(true); // troca de conversa — sempre reconstrói, nunca herda rascunho/foco da conversa anterior
        if (templateNomeForcado) selecionarTemplatePorNome(templateNomeForcado);
        // Confirmação de leitura ativa (pedido do usuário, 2026-09-29):
        // marca a última mensagem RECEBIDA como lida na Meta (✓✓ azul do
        // lado do lead) ao abrir a conversa — cobre WhatsApp Unificado E
        // gaveta, já que os 2 usam este mesmo abrir(). Fire-and-forget.
        marcarUltimaMensagemComoLidaWpp(leadId, mensagens);

        canal = window.supabaseClient
            .channel(`wpp-chat-${messagesId}-${leadId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensagens_whatsapp', filter: `pessoaIdentificador=eq.${leadId}` }, (payload) => {
                if (!mensagens.some(m => m.id === payload.new.id)) mensagens.push(payload.new);
                mensagens.sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
                renderizarMensagens();
                renderizarAreaInput();
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mensagens_whatsapp', filter: `pessoaIdentificador=eq.${leadId}` }, (payload) => {
                const idx = mensagens.findIndex(m => m.id === payload.new.id);
                if (idx >= 0) mensagens[idx] = payload.new;
                renderizarMensagens();
            })
            .subscribe();
    }

    function fechar() {
        if (canal) { window.supabaseClient.removeChannel(canal); canal = null; }
        pararGravacaoSeAtiva(true);
        leadId = null;
        mensagens = [];
    }

    // Pré-preenche a caixa de texto livre com um texto pronto (ex: convite
    // de Abertura de Turma) — só funciona dentro da janela de 24h, onde
    // existe texto livre pra preencher; fora dela, devolve false pra quem
    // chamou avisar o usuário (fora da janela só dá pra enviar template).
    function preencherTexto(texto) {
        const container = el(inputAreaId);
        const input = container ? container.querySelector('.chat-input') : null;
        if (!input) return false;
        input.value = texto;
        input.focus();
        return true;
    }

    return { abrir, fechar, preencherTexto, selecionarTemplatePorNome, toggleBuscaConversa };
}

const chatWpp = criarChatController({ messagesId: 'wppMessages', inputAreaId: 'wppChatInputArea' });
const chatDrawer = criarChatController({ messagesId: 'drawer-messages', inputAreaId: 'drawerChatInputArea' });

// Pedido do usuário (2026-09-28): "coloque uma opção de 'mandar mensagem
// de aniversário' para todos os leads que aparecem no dashboard como
// 'Aniversariantes de Hoje'" — dispara o template "aniversario" DIRETO
// da lista (sem precisar abrir a gaveta primeiro), usada tanto pelo card
// cross-filial "Aniversariantes de Hoje" (js/visao-geral.js) quanto pelo
// card por filial "Aniversariantes do Mês" (js/app.js, só nos itens de
// HOJE). Recebe nome/filial já prontos (evita 1 query extra — quem chama
// já tem esses dados da própria lista) e o elemento do botão, pra dar
// feedback visual (spinner/"Enviado") sem precisar re-renderizar a
// lista inteira.
async function enviarAniversarioRapido(leadId, nomeLead, filialLead, botaoEl) {
    const tpl = TEMPLATES_WHATSAPP.find(t => t.nome === 'aniversario');
    if (!tpl) { alert('Template "aniversario" ainda não está configurado em TEMPLATES_WHATSAPP (js/whatsapp.js).'); return; }

    const nome = nomeLead || 'esse lead';
    if (!confirm(`Mandar "Feliz Aniversário" pra ${nome} agora?`)) return;

    if (botaoEl) { botaoEl.disabled = true; botaoEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
    try {
        const atendente = obterNomeAtendente() || '';
        const filial = nomeFilialComPreposicao(filialLead);
        const params = [nome, atendente, filial];
        const preview = montarPreviewTemplate(tpl, params);

        const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
            body: { pessoaIdentificador: leadId, tipo: 'template', templateNome: tpl.nome, templateIdioma: tpl.idioma || 'pt_BR', templateParams: params, templatePreview: preview, atendenteNome: atendente }
        });
        if (error || !data || data.ok === false) {
            alert('Não foi possível enviar: ' + mensagemErroWpp(data || { erro: error?.message }));
            if (botaoEl) { botaoEl.disabled = false; botaoEl.innerHTML = '<i class="fa-brands fa-whatsapp"></i> Enviar'; }
            return;
        }
        if (botaoEl) botaoEl.innerHTML = '<i class="fa-solid fa-check"></i> Enviado';
        moverParaAbordagemAposEnvio(leadId).catch(e => console.warn('Erro ao mover lead pra Abordagem após envio:', e.message));
    } catch (e) {
        alert('Erro inesperado ao enviar: ' + (e.message || e));
        if (botaoEl) { botaoEl.disabled = false; botaoEl.innerHTML = '<i class="fa-brands fa-whatsapp"></i> Enviar'; }
    }
}

// ==========================================================
// CONVITE PADRÃO PARA EVENTOS (botão na gaveta do lead)
// ==========================================================
// Vale pra QUALQUER evento cadastrado na Agenda, não só Abertura de Turma
// — a pessoa escolhe o evento num seletor, e o texto final leva o nome de
// quem está mandando, o nome da filial, o evento/data escolhidos e (se
// houver) os interesses do lead conforme as tags da família "Interesses /
// Origem". Dois textos-base conforme o lead já é aluno ativo ou não —
// ajuste livremente, são só um ponto de partida.
// Quebrado em parágrafos curtos (linha em branco entre cada um) — pedido
// do usuário (2026-09-15), depois de ver o texto real chegando tudo
// espremido numa linha só. Sem emoji de propósito — o emoji chegava
// corrompido (mojibake, "�") no texto pré-preenchido do link wa.me (ver
// "Convites em massa via wa.me"); mais simples remover do que tentar
// diagnosticar um problema de encoding numa dependência externa (URL do
// WhatsApp). `{filial}` aqui já vem COM a preposição (ex: "do Garavelo",
// "de Barra do Garças" — mesmo valor de preencherValorAutomatico('filial'),
// que já é usado nos templates aprovados da Meta), por isso o texto não
// tem mais um "-" fixo antes dela.
const CONVITE_EVENTO_NAO_ALUNO = `Olá, {nome}!

Aqui é {atendente}, da Nova Acrópole {filial}, tudo bem?

Vai rolar {evento}{quando} e eu queria muito te convidar pra vir!{interesses}

Posso te passar mais detalhes?`;
const CONVITE_EVENTO_ATIVO = `Olá, {nome}!

Aqui é {atendente}, da Nova Acrópole {filial}, tudo bem?

Vai rolar {evento}{quando}, e você é muito importante nesse momento! Você pode: 1) encaminhar esse convite pra quem você acha que ia gostar de conhecer; 2) me passar o telefone de alguém que valeria a pena a gente chamar pessoalmente; ou 3) topar ser voluntário(a) no dia, ajudando a receber o pessoal.

Me conta o que topa fazer?`;

// Variantes SEM auto-apresentação — pedido do usuário (2026-09-29):
// "Reparei que vc criou uma mensagem em que eu me apresento de novo, e
// isso não é necessário pois estamos respondendo uma mensagem já
// iniciada". Usadas só por "Convidar (Janela Aberta)" (o único fluxo que
// SEMPRE responde uma conversa já em andamento, nunca um contato frio) —
// ver montarTextoConviteEvento(), parâmetro `semApresentacao`.
const CONVITE_EVENTO_NAO_ALUNO_SEM_APRESENTACAO = `Aproveitando que a gente já está conversando — vai rolar {evento}{quando} e eu queria muito te convidar pra vir!{interesses}

Posso te passar mais detalhes?`;
const CONVITE_EVENTO_ATIVO_SEM_APRESENTACAO = `Aproveitando que a gente já está conversando — vai rolar {evento}{quando}, e você é muito importante nesse momento! Você pode: 1) encaminhar esse convite pra quem você acha que ia gostar de conhecer; 2) me passar o telefone de alguém que valeria a pena a gente chamar pessoalmente; ou 3) topar ser voluntário(a) no dia, ajudando a receber o pessoal.

Me conta o que topa fazer?`;

// Nome de quem está mandando. Prioriza o usuário LOGADO (js/usuarios.js,
// login nominal por conta) — nesse caso não pergunta nada, o nome já é o
// da conta. Só cai no prompt() antigo (localStorage próprio, sem login)
// pra sessões que ainda não fizeram o login novo — mantido só de
// transição, tende a desaparecer conforme todo mundo passar a logar.
const CHAVE_STORAGE_NOME_ATENDENTE = 'crm_na_nome_atendente';
const TEXTO_PROMPT_NOME_ATENDENTE = 'Como você quer aparecer nas mensagens pros leads?\n\nPode escrever com artigo, do jeito que soa mais natural pra você (ex: "o Henrique", "a Lilica"), ou só o nome puro (ex: "Henrique") — o que você digitar aqui entra EXATAMENTE assim em todo lugar que precisar do seu nome (convites, modelos de WhatsApp).';
function obterNomeAtendente() {
    const logado = typeof usuarioLogado === 'function' ? usuarioLogado() : null;
    if (logado && logado.nome) return logado.nome;

    let nome = localStorage.getItem(CHAVE_STORAGE_NOME_ATENDENTE);
    if (!nome) {
        nome = prompt(TEXTO_PROMPT_NOME_ATENDENTE + '\n\n(fica salvo só neste navegador — dá pra mudar depois clicando no lápis ao lado do botão de convite)');
        if (nome && nome.trim()) {
            nome = nome.trim();
            localStorage.setItem(CHAVE_STORAGE_NOME_ATENDENTE, nome);
        }
    }
    return nome || '';
}
function alterarNomeAtendente() {
    const atual = localStorage.getItem(CHAVE_STORAGE_NOME_ATENDENTE) || '';
    const novo = prompt(TEXTO_PROMPT_NOME_ATENDENTE, atual);
    if (novo === null) return; // cancelou
    const limpo = novo.trim();
    if (limpo) localStorage.setItem(CHAVE_STORAGE_NOME_ATENDENTE, limpo);
    else localStorage.removeItem(CHAVE_STORAGE_NOME_ATENDENTE);
}

// Navegação cruzada entre a gaveta do lead (Kanban) e o WhatsApp
// Unificado (pedido do usuário, 2026-09-29): "no whatsapp unificado tem
// que ter tudo que tem na gaveta do lead... uma opção, se isso ficar
// complicado, é ter um botão que me leve pra gaveta, e outro na gaveta
// que leve pro whatsapp unificado" — dado o tamanho da gaveta (Eventos/
// Como Abordar/Resumo/Lembrete/Tags/Contato/Histórico/Vínculo Familiar),
// duplicar tudo dentro da aba WhatsApp seria muito trabalho pra manter
// sincronizado; navegação direta resolve o mesmo problema de fundo (não
// perder acesso a nada) com uma fração do esforço.
function abrirConversaNoWppUnificado(leadId) {
    if (!leadId) return;
    if (typeof fecharGaveta === 'function') fecharGaveta();
    switchModule('tab-whatsapp', 'WhatsApp Unificado', 'Caixa de entrada centralizada');
    abrirChatWpp(leadId);
}

function abrirFichaCompletaDoWpp(leadId) {
    if (!leadId || typeof abrirGaveta !== 'function') return;
    abrirGaveta(leadId);
}

// Se o evento escolhido no seletor tem evento.data no PASSADO mas ainda
// aparece na lista (só é possível quando data_limite_inscricao vai além
// da própria data — hoje, só "Abertura de Turma" usa isso, ver
// dataEfetivaLimite() em js/eventos.js), é porque a turma já começou mas
// continua aceitando matrícula, com aulas semanais. Convidar alguém pra
// vir "no dia X" (já passado) não faz sentido — convidamos pra próxima
// ocorrência do MESMO dia da semana em vez da data original do evento.
const FRASE_DIA_SEMANA = ['todo domingo', 'toda segunda-feira', 'toda terça-feira', 'toda quarta-feira', 'toda quinta-feira', 'toda sexta-feira', 'todo sábado'];
function proximaOcorrenciaMesmoDiaSemana(dataISO) {
    const [ano, mes, dia] = dataISO.split('-').map(Number);
    const diaSemanaAlvo = new Date(ano, mes - 1, dia).getDay();

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    let diasParaSomar = (diaSemanaAlvo - hoje.getDay() + 7) % 7;
    if (diasParaSomar === 0) diasParaSomar = 7; // nunca sugere "hoje" — pode já ter passado no dia

    const proxima = new Date(hoje);
    proxima.setDate(proxima.getDate() + diasParaSomar);
    const iso = `${proxima.getFullYear()}-${String(proxima.getMonth() + 1).padStart(2, '0')}-${String(proxima.getDate()).padStart(2, '0')}`;
    return { iso, diaSemana: diaSemanaAlvo };
}

// Abre o mini-seletor de evento (só eventos ainda não "passados" da
// filial atual, mesmo critério de dataEfetivaLimite() usado no resto da
// Agenda — js/eventos.js) logo abaixo do cabeçalho do chat da gaveta.
// Mesmo bug do "+Convidar" da gaveta "Eventos (Convites)" (js/eventos.js,
// corrigido 2026-09-17) — `eventosAtuais` só carrega ao abrir a Agenda ou
// trocar de filial; sem isso, uma sessão que só usa Kanban/gaveta via um
// lead novo nunca teria evento nenhum pra oferecer aqui.
async function abrirSeletorConviteEvento() {
    if (typeof currentLeadId === 'undefined' || !currentLeadId) return;
    const select = document.getElementById('drawerConviteEventoSelect');
    const form = document.getElementById('drawerConviteEventoForm');
    if (!select || !form) return;

    if (typeof carregarEventos === 'function') await carregarEventos();

    const hojeISO = new Date().toISOString().slice(0, 10);
    const lista = (typeof eventosAtuais !== 'undefined' ? eventosAtuais : [])
        .filter(ev => (typeof dataEfetivaLimite === 'function' ? dataEfetivaLimite(ev) : ev.data) >= hojeISO)
        .slice()
        .sort((a, b) => (a.data + (a.hora || '')).localeCompare(b.data + (b.hora || '')));

    if (lista.length === 0) {
        alert('Nenhum evento futuro cadastrado pra esta filial ainda — cadastre um na aba Agenda antes de convidar.');
        return;
    }

    select.innerHTML = lista.map(ev => `<option value="${ev.id}">${escapeHTML(ev.nome)} — ${typeof formatarDataEvento === 'function' ? formatarDataEvento(ev.data) : ev.data}</option>`).join('');
    form.style.display = 'flex';
    atualizarBotaoConviteFoto();
}

function fecharSeletorConviteEvento() {
    const form = document.getElementById('drawerConviteEventoForm');
    if (form) form.style.display = 'none';
}

function confirmarConviteEvento() {
    const select = document.getElementById('drawerConviteEventoSelect');
    const eventoId = select ? Number(select.value) : null;
    const evento = (typeof eventosAtuais !== 'undefined' ? eventosAtuais : []).find(e => e.id === eventoId);
    fecharSeletorConviteEvento();
    if (evento) enviarConviteEvento(evento);
}

// Só mostra "Compartilhar Foto" quando o evento escolhido no <select> tem
// imagem cadastrada (imagem_url — vem do catálogo sincronizado do
// Ulisses ou cadastrada na mão na Agenda) — sem imagem, não tem o que
// compartilhar.
function atualizarBotaoConviteFoto() {
    const select = document.getElementById('drawerConviteEventoSelect');
    const btnFoto = document.getElementById('drawerConviteEventoBtnFoto');
    if (!select || !btnFoto) return;
    const evento = (typeof eventosAtuais !== 'undefined' ? eventosAtuais : []).find(e => e.id === Number(select.value));
    btnFoto.style.display = (evento && evento.imagem_url) ? 'inline-flex' : 'none';
}

// "Convite Compartilhável": manda a FOTO de verdade do evento (Graph API
// image.link — a Meta busca a imagem nessa URL, o destinatário recebe uma
// mensagem de mídia real, nunca um link de texto pra clicar) + legenda
// curta, já pronta pra a pessoa repassar no Status do WhatsApp/Stories do
// Instagram (o próprio WhatsApp tem um botão de compartilhar nativo em
// qualquer imagem recebida — não precisamos reinventar isso). Diferente
// de "Gerar Texto" (só preenche a caixa, nunca envia sozinho), este botão
// ENVIA de verdade — por isso pede confirmação antes.
async function confirmarConviteComFoto() {
    const select = document.getElementById('drawerConviteEventoSelect');
    const eventoId = select ? Number(select.value) : null;
    const evento = (typeof eventosAtuais !== 'undefined' ? eventosAtuais : []).find(e => e.id === eventoId);
    if (!evento || !evento.imagem_url) return;
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(currentLeadId));
    if (!lead) return;

    const primeiroNome = nomeParaChamar(lead);
    const dataFormatada = (typeof formatarDataEvento === 'function') ? formatarDataEvento(evento.data) : evento.data;
    const caption = `📢 ${evento.nome} — ${dataFormatada}! Compartilhe no seu Status do WhatsApp ou nos Stories do Instagram e ajude a divulgar 💙`;

    if (!confirm(`Enviar a foto do evento "${evento.nome}" pra ${primeiroNome}, pronta pra ela compartilhar no Status/Stories?\n\nLegenda: "${caption}"`)) return;
    fecharSeletorConviteEvento();

    const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
        body: { pessoaIdentificador: currentLeadId, tipo: 'imagem', imagemUrl: evento.imagem_url, caption, atendenteNome: obterNomeAtendente() }
    });
    if (error) { alert('Erro ao enviar: ' + error.message); return; }
    if (!data.ok) {
        if (data.erro === 'janela_fechada') {
            alert('Essa conversa está fora da janela de 24h — não dá pra enviar uma foto agora fora da janela (só template aprovado funciona fora dela, e templates não têm imagem configurada ainda). Espere a pessoa mandar mensagem pra reabrir a janela.');
        } else {
            console.error('Erro ao enviar convite com foto:', data.detalhe || data.erro);
            alert('Não foi possível enviar: ' + mensagemErroWpp(data));
        }
        return;
    }
    await chatDrawer.abrir(currentLeadId); // recarrega o chat pra já mostrar a foto enviada
    moverParaAbordagemAposEnvio(currentLeadId).catch(e => console.warn('Erro ao mover lead pra Abordagem após envio:', e.message));
}

// "Nova Turma" (botão próprio na gaveta, só pra Ativos — ver
// btnConviteAberturaTurma em index.html/abrirGaveta() em js/app.js):
// pedido do usuário (2026-09-19) — "encaminhar para os ativos uma
// mensagem com imagem, link e texto sobre a próxima abertura de turma da
// filial dele, que ele possa encaminhar para seus contatos e seus
// grupos". Diferente do seletor genérico "Convidar pra Evento" (lista
// TODOS os eventos futuros, exige escolher um manualmente), este botão
// já acha sozinho a Abertura de Turma certa da filial ATUAL (mesma
// filial do lead, já que a gaveta só abre com o Kanban filtrado por
// ela) — zero busca manual. Reaproveita 100% `montarTextoConviteEvento()`
// (o lead já é Ativo, então cai automaticamente no texto
// CONVITE_EVENTO_ATIVO — "encaminhe pra quem você acha que ia gostar...")
// e só ACRESCENTA o link de inscrição (`eventos.link_inscricao`,
// alimentado automaticamente pelo scraper via API — ver CLAUDE.md, "API
// oficial do Ulisses") no final, satisfazendo os 3 pedidos junto:
// imagem + link + texto.
async function enviarConviteAberturaTurmaFilial() {
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(currentLeadId));
    if (!lead) return;

    if (typeof carregarEventos === 'function') await carregarEventos();
    const hojeISO = new Date().toISOString().slice(0, 10);
    const evento = (typeof eventosAtuais !== 'undefined' ? eventosAtuais : [])
        .filter(ev => ev.tipo === 'Abertura de Turma')
        .filter(ev => (typeof dataEfetivaLimite === 'function' ? dataEfetivaLimite(ev) : ev.data) >= hojeISO)
        .sort((a, b) => a.data.localeCompare(b.data))[0];

    if (!evento) {
        alert('Nenhuma Abertura de Turma futura cadastrada pra esta filial ainda — a sincronização automática do Ulisses (5h da manhã) ou o cadastro manual na Agenda resolvem isso.');
        return;
    }

    const caption = montarTextoConviteEvento(lead, evento)
        + (evento.link_inscricao ? `\n\nInscreva-se ou indique alguém: ${evento.link_inscricao}` : '');
    const dataFormatada = (typeof formatarDataEvento === 'function') ? formatarDataEvento(evento.data) : evento.data;
    const primeiroNome = nomeParaChamar(lead);

    // Sem imagem cadastrada no evento (raro — normalmente vem do
    // catálogo do Ulisses), cai pro mesmo comportamento de "Gerar Texto":
    // só preenche a caixa, não envia sozinho.
    if (!evento.imagem_url) {
        const preencheu = chatDrawer.preencherTexto(caption);
        if (!preencheu) alert('Essa conversa está fora da janela de 24h, então não dá pra preencher o campo de texto livre. Aqui está o texto pra copiar manualmente:\n\n' + caption);
        return;
    }

    if (!confirm(`Enviar convite (foto + link) da próxima Abertura de Turma ("${evento.nome}", ${dataFormatada}) pra ${primeiroNome}, pronto pra encaminhar pros contatos e grupos dele(a)?`)) return;

    const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
        body: { pessoaIdentificador: currentLeadId, tipo: 'imagem', imagemUrl: evento.imagem_url, caption, atendenteNome: obterNomeAtendente() }
    });
    if (error) { alert('Erro ao enviar: ' + error.message); return; }
    if (!data.ok) {
        if (data.erro === 'janela_fechada') {
            alert('Essa conversa está fora da janela de 24h — não dá pra enviar uma foto agora (só template aprovado funciona fora dela). Aqui está o texto, pra mandar de outra forma:\n\n' + caption);
        } else {
            console.error('Erro ao enviar convite de Abertura de Turma:', data.detalhe || data.erro);
            alert('Não foi possível enviar: ' + mensagemErroWpp(data));
        }
        return;
    }
    await chatDrawer.abrir(currentLeadId); // recarrega o chat pra já mostrar a foto enviada
    moverParaAbordagemAposEnvio(currentLeadId).catch(e => console.warn('Erro ao mover lead pra Abordagem após envio:', e.message));
}

// Monta o texto final do convite pra QUALQUER lead + evento — extraído de
// enviarConviteEvento() pra ser reaproveitado também pelo disparo em massa
// via link wa.me (ver "Convites em massa via wa.me" mais abaixo), sem
// duplicar a lógica de {nome}/{atendente}/{quando}/{interesses}.
// `templateCustom` opcional (pedido do usuário, 2026-09-15: "permita eu
// escrever/editar o texto base que será enviado através do link") —
// quando informado, SUBSTITUI a escolha automática entre
// CONVITE_EVENTO_ATIVO/CONVITE_EVENTO_NAO_ALUNO (usado pelo disparo em
// massa via wa.me, onde a pessoa edita 1 texto pra todo o lote antes de
// gerar os links); sem ele, comportamento de sempre (convite individual
// da gaveta).
function montarTextoConviteEvento(lead, evento, templateCustom, semApresentacao) {
    const tagsLead = (typeof parseTags === 'function' ? parseTags(lead.tags) : []).map(t => t.trim()).filter(Boolean);
    const ehAtivo = tagsLead.includes('Ativo') || tagsLead.includes('Aluno Ativo');
    const primeiroNome = nomeParaChamar(lead);
    const atendente = obterNomeAtendente();

    // Interesses — só as tags da família "Interesses / Origem" (mesma
    // classificação já usada pra colorir o badge da tag, ver FAMILIAS_TAG
    // em js/app.js), não qualquer tag (não faz sentido citar "Sem Telefone"
    // ou "Lead Forte 1" como "interesse" num convite).
    const interesses = (typeof identificarFamiliaTag === 'function')
        ? tagsLead.filter(t => identificarFamiliaTag(t).label === 'Interesses / Origem')
        : [];
    const fraseInteresses = interesses.length > 0 ? ` Vi aqui que você já demonstrou interesse em: ${interesses.join(', ')}.` : '';

    const horaFormatada = evento.hora && typeof formatarHoraEvento === 'function' ? formatarHoraEvento(evento.hora) : '';
    const hojeISO = new Date().toISOString().slice(0, 10);

    let quando;
    if (evento.data < hojeISO) {
        // A data do evento em si já passou, mas ele continua "ativo" pra
        // convite (data_limite_inscricao) — turma já rolando, aulas
        // semanais. Convida pra próxima ocorrência do mesmo dia da semana.
        const { iso: proximaISO, diaSemana } = proximaOcorrenciaMesmoDiaSemana(evento.data);
        const dataProximaFormatada = (typeof formatarDataEvento === 'function') ? formatarDataEvento(proximaISO) : proximaISO;
        quando = ` — as aulas são ${FRASE_DIA_SEMANA[diaSemana]}${horaFormatada ? ', às ' + horaFormatada : ''}, e a próxima é dia ${dataProximaFormatada}`;
    } else {
        const dataFormatada = (typeof formatarDataEvento === 'function') ? formatarDataEvento(evento.data) : evento.data;
        quando = ` no dia ${dataFormatada}${horaFormatada ? ' às ' + horaFormatada : ''}`;
    }

    // replaceAll (não replace) — texto CUSTOM editado à mão pode repetir
    // um placeholder mais de 1 vez; com replace() simples, só a 1ª
    // ocorrência seria trocada, deixando "{nome}" literal na 2ª.
    const base = templateCustom
        || (semApresentacao
            ? (ehAtivo ? CONVITE_EVENTO_ATIVO_SEM_APRESENTACAO : CONVITE_EVENTO_NAO_ALUNO_SEM_APRESENTACAO)
            : (ehAtivo ? CONVITE_EVENTO_ATIVO : CONVITE_EVENTO_NAO_ALUNO));
    return base
        .replaceAll('{nome}', primeiroNome)
        .replaceAll('{atendente}', atendente || 'a equipe da Nova Acrópole')
        .replaceAll('{filial}', nomeFilialComPreposicao(lead.filial))
        .replaceAll('{evento}', evento.nome)
        .replaceAll('{quando}', quando)
        .replaceAll('{interesses}', fraseInteresses)
        .replaceAll('{linkInscricao}', evento.link_inscricao || '');
}

// Só preenche a caixa de texto do chat da gaveta (não envia sozinho) —
// o SDR revisa e manda, igual qualquer outra mensagem. Só funciona dentro
// da janela de 24h (preencherTexto() devolve false fora dela, já que nesse
// caso só dá pra enviar por template aprovado); nesse caso, mostra o texto
// num alert pra copiar manualmente.
function enviarConviteEvento(evento) {
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(currentLeadId));
    if (!lead) return;

    const texto = montarTextoConviteEvento(lead, evento);
    const preencheu = chatDrawer.preencherTexto(texto);
    if (!preencheu) {
        alert('Essa conversa está fora da janela de 24h, então não dá pra preencher o campo de texto livre (precisa de um template aprovado). Aqui está o texto do convite pra copiar manualmente:\n\n' + texto);
    }
}

// ==========================================================
// Convites em massa via link wa.me (WhatsApp pessoal, enquanto a API da
// Meta está bloqueada — ver CLAUDE.md "Bloqueio da API do WhatsApp")
// ==========================================================
// Pedido do usuário: disparar convite pra dezenas de leads de uma vez, do
// PRÓPRIO WhatsApp pessoal, sem risco de bloqueio e sem gastar com gateway
// terceiro. A ideia: gerar 1 link "click to chat" (wa.me/55DDDNUMERO?text=...)
// por lead selecionado, já com o convite personalizado preenchido — clicar
// no link abre o WhatsApp Web (logado com o número pessoal) com o texto
// pronto na caixa de digitação, e quem manda de verdade é a pessoa, com um
// clique em Enviar. Isso é TECNICAMENTE idêntico a digitar a mensagem na
// mão (zero automação) — é o que evita risco de bloqueio, não o "gerenciador"
// usado. Depois do disparo, a conversa (se exportada do celular) entra no
// CRM pelo fluxo que já existe, "Importar Conversa de WhatsApp"
// (js/importar-conversa-whatsapp.js) — nada novo precisa ser construído
// pra sincronizar de volta.
// Bug real relatado pelo usuário (2026-09-15): "só está aparecendo os
// eventos quando eu clico na tela de Eventos" — `eventosAtuais` só é
// carregado ao abrir a aba Agenda ou ao TROCAR de filial
// (`trocarFilial()`, js/app.js); numa sessão nova, sem nunca ter feito
// nenhuma das duas coisas, `eventosAtuais` fica vazio pra sempre, e este
// botão (acessado direto do Kanban) achava que a filial não tinha
// nenhum evento futuro. Corrigido buscando os eventos aqui também,
// sempre, antes de checar a lista — garante que está sempre atual (pode
// ter sido cadastrado 1 evento novo agora mesmo, em outra aba).
async function iniciarConvitesWhatsAppEmMassa() {
    if (typeof cardsSelecionados === 'undefined' || cardsSelecionados.size === 0) {
        alert('Selecione 1 ou mais leads no Kanban antes (checkbox no canto de cada card).');
        return;
    }

    // Pedido do usuário (2026-09-17): "se eu sair dessa tela, consigo
    // voltar?" — antes, reabrir esta tela (mesmo só fechando sem querer no
    // X/clicando fora) sempre voltava pro passo 1 (escolher evento) e
    // descartava a lista de links já gerada + quem já tinha sido marcado
    // como enviado. Se já existe um lote gerado nesta sessão, só reabre o
    // modal de onde parou — só reinicia do zero pelo botão explícito
    // "Começar um novo lote" (reiniciarConviteLote()) dentro do resultado.
    const resultadoExistente = document.getElementById('conviteLoteResultado');
    if (resultadoExistente && resultadoExistente.innerHTML.trim() !== '') {
        document.getElementById('modalConviteLote').classList.add('open');
        document.getElementById('overlayModalConviteLote').classList.add('active');
        return;
    }

    const select = document.getElementById('conviteLoteEventoSelect');
    if (!select) return;

    if (typeof carregarEventos === 'function') await carregarEventos();

    const hojeISO = new Date().toISOString().slice(0, 10);
    const lista = (typeof eventosAtuais !== 'undefined' ? eventosAtuais : [])
        .filter(ev => (typeof dataEfetivaLimite === 'function' ? dataEfetivaLimite(ev) : ev.data) >= hojeISO)
        .slice()
        .sort((a, b) => (a.data + (a.hora || '')).localeCompare(b.data + (b.hora || '')));

    if (lista.length === 0) {
        alert('Nenhum evento futuro cadastrado pra esta filial ainda — cadastre um na aba Agenda antes de convidar.');
        return;
    }

    select.innerHTML = lista.map(ev => `<option value="${ev.id}">${escapeHTML(ev.nome)} — ${typeof formatarDataEvento === 'function' ? formatarDataEvento(ev.data) : ev.data}</option>`).join('');

    await carregarModelosMensagemWpp();
    montarSelectModelosConviteLote();
    aplicarModeloConviteLote();

    document.getElementById('conviteLoteEscolha').style.display = 'block';
    document.getElementById('conviteLoteResultado').style.display = 'none';
    document.getElementById('conviteLoteResultado').innerHTML = '';
    document.getElementById('modalConviteLote').classList.add('open');
    document.getElementById('overlayModalConviteLote').classList.add('active');
}

function fecharModalConviteLote() {
    document.getElementById('modalConviteLote').classList.remove('open');
    document.getElementById('overlayModalConviteLote').classList.remove('active');
}

// ==========================================================
// Modelos de mensagem (tabela modelos_mensagem_whatsapp) — pedido do
// usuário (2026-09-15): "eu quero poder editar as mensagens base, para
// não ter que editar de um por um" + "uma mensagem pronta, sem ter que
// escrever nada". Substituiu o texto único salvo em localStorage (versão
// anterior do mesmo dia) por modelos COMPARTILHADOS (banco, mesmo padrão
// de tags_sugeridas/tipos_evento — RLS pública), editáveis em "Gerenciar
// Mensagens", com {linkInscricao} preenchido automaticamente quando o
// evento tem esse campo cadastrado na Agenda (migracao_link_inscricao_evento.sql).
// ==========================================================
const CHAVE_STORAGE_MODELO_CONVITE_LOTE = 'crm_na_modelo_convite_lote_id';
let modelosMensagemWpp = [];

// Best-effort: sem a migração rodada, cai num fallback embutido (os 2
// textos que já existiam hardcoded) — nunca trava o recurso.
const MODELOS_MENSAGEM_FALLBACK = [
    { id: 'fallback-nao-aluno', nome: 'Convite Geral (Não-Aluno)', texto: CONVITE_EVENTO_NAO_ALUNO },
    { id: 'fallback-ativo', nome: 'Divulgação (Aluno Ativo)', texto: CONVITE_EVENTO_ATIVO },
];

async function carregarModelosMensagemWpp() {
    const { data, error } = await window.supabaseClient
        .from('modelos_mensagem_whatsapp')
        .select('*')
        .order('ordem', { ascending: true });
    if (error) {
        console.warn('Não foi possível carregar modelos_mensagem_whatsapp (rode migracao_modelos_mensagem_whatsapp.sql se ainda não rodou) — usando modelos padrão embutidos.', error.message);
        modelosMensagemWpp = MODELOS_MENSAGEM_FALLBACK;
        return;
    }
    modelosMensagemWpp = (data && data.length > 0) ? data : MODELOS_MENSAGEM_FALLBACK;
}

function montarSelectModelosConviteLote() {
    const select = document.getElementById('conviteLoteModeloSelect');
    if (!select) return;
    const ultimoUsadoId = localStorage.getItem(CHAVE_STORAGE_MODELO_CONVITE_LOTE);
    select.innerHTML = modelosMensagemWpp.map(m => `<option value="${escapeHTML(String(m.id))}">${escapeHTML(m.nome)}</option>`).join('');
    if (ultimoUsadoId && modelosMensagemWpp.some(m => String(m.id) === ultimoUsadoId)) {
        select.value = ultimoUsadoId;
    }
}

// Carrega o texto do modelo selecionado na caixa editável — chamada ao
// abrir a tela, ao trocar o `<select>` de modelo, e pelo botão "Recarregar
// modelo" (descarta qualquer edição feita só pra este envio).
function aplicarModeloConviteLote() {
    const select = document.getElementById('conviteLoteModeloSelect');
    const textarea = document.getElementById('conviteLoteTextoBase');
    if (!select || !textarea) return;
    const modelo = modelosMensagemWpp.find(m => String(m.id) === select.value) || modelosMensagemWpp[0];
    textarea.value = modelo ? modelo.texto : CONVITE_EVENTO_NAO_ALUNO;
}

// Tela "Gerenciar Mensagens" — editar/criar/remover modelos direto do
// CRM, sem sessão de código nova (mesmo padrão de "Gerenciar Tipos de
// Evento"/"Gerenciar Tags"). Precisa da migração rodada (tabela de
// verdade) — sem ela, os fallbacks embutidos não têm `id` numérico real
// pra salvar, então avisa em vez de tentar gravar algo que não existe.
async function abrirGerenciarModelosMensagem() {
    await carregarModelosMensagemWpp();
    renderizarListaModelosMensagem();
    document.getElementById('modalModelosMensagem').classList.add('open');
    document.getElementById('overlayModalModelosMensagem').classList.add('active');
}
function fecharGerenciarModelosMensagem() {
    document.getElementById('modalModelosMensagem').classList.remove('open');
    document.getElementById('overlayModalModelosMensagem').classList.remove('active');
    // Reflete qualquer edição/remoção feita na tela de gerenciar de volta
    // no seletor da tela de convite (se estiver aberta por trás).
    montarSelectModelosConviteLote();
}

function renderizarListaModelosMensagem() {
    const container = document.getElementById('modelosMensagemLista');
    if (!container) return;
    if (modelosMensagemWpp.length === 0 || String(modelosMensagemWpp[0].id).startsWith('fallback-')) {
        container.innerHTML = '<p style="font-size:12px; color:var(--danger,#dc2626);">Rode migracao_modelos_mensagem_whatsapp.sql no Supabase pra poder editar/criar modelos aqui — por enquanto só os modelos padrão embutidos estão disponíveis (não editáveis).</p>';
        return;
    }
    container.innerHTML = modelosMensagemWpp.map(m => `
        <div style="border:1px solid var(--border-color); border-radius:8px; padding:10px; margin-bottom:10px;">
            <input type="text" value="${escapeHTML(m.nome)}" id="modeloMensagemNome-${m.id}" style="width:100%; font-weight:600; padding:6px; margin-bottom:6px;">
            <textarea id="modeloMensagemTexto-${m.id}" style="width:100%; min-height:100px; padding:8px; font-family:inherit; font-size:13px; margin-bottom:6px;">${escapeHTML(m.texto)}</textarea>
            <div style="display:flex; justify-content:flex-end; gap:6px;">
                <button class="btn-secondary" style="font-size:11px; padding:4px 10px;" onclick="removerModeloMensagem(${m.id})"><i class="fa-solid fa-trash"></i> Remover</button>
                <button class="btn-primary" style="font-size:11px; padding:4px 10px;" onclick="salvarModeloMensagem(${m.id})"><i class="fa-solid fa-check"></i> Salvar</button>
            </div>
        </div>
    `).join('');
}

async function salvarModeloMensagem(id) {
    const nome = document.getElementById(`modeloMensagemNome-${id}`).value.trim();
    const texto = document.getElementById(`modeloMensagemTexto-${id}`).value;
    if (!nome || !texto.trim()) { alert('Nome e texto não podem ficar vazios.'); return; }
    const { error } = await window.supabaseClient.from('modelos_mensagem_whatsapp').update({ nome, texto }).eq('id', id);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    await carregarModelosMensagemWpp();
    renderizarListaModelosMensagem();
}

async function removerModeloMensagem(id) {
    if (!confirm('Remover este modelo de mensagem? Não afeta convites já enviados.')) return;
    const { error } = await window.supabaseClient.from('modelos_mensagem_whatsapp').delete().eq('id', id);
    if (error) { alert('Erro ao remover: ' + error.message); return; }
    await carregarModelosMensagemWpp();
    renderizarListaModelosMensagem();
}

async function adicionarModeloMensagem() {
    const nome = prompt('Nome do novo modelo (ex: "Convite Palestra Gratuita"):');
    if (!nome || !nome.trim()) return;
    const maiorOrdem = modelosMensagemWpp.reduce((max, m) => Math.max(max, m.ordem || 0), -1);
    const { error } = await window.supabaseClient.from('modelos_mensagem_whatsapp').insert({
        nome: nome.trim(),
        texto: 'Olá, {nome}!\n\nAqui é {atendente}, da Nova Acrópole {filial}, tudo bem?\n\nVai rolar {evento}{quando}!',
        ordem: maiorOrdem + 1,
    });
    if (error) { alert('Erro ao criar modelo: ' + error.message); return; }
    await carregarModelosMensagemWpp();
    renderizarListaModelosMensagem();
}

// Mesma heurística por substring já usada em encontrarColunaRecontato()
// (js/eventos.js)/"Matriculados" — nunca cria a coluna sozinha, só avisa
// no console se não achar. "Abordagem" já é o nome da 2ª coluna padrão do
// Kanban (colunasPadrao(), js/app.js: key "Abordagem", label "Em
// Abordagem"), mas o time pode ter renomeado — por isso busca por
// substring nas duas, não por chave fixa.
function encontrarColunaAbordagem() {
    if (typeof columnsConfig === 'undefined') return null;
    const normalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const col = columnsConfig.find(c => normalizar(c.key).includes('ABORDAGEM') || normalizar(c.label).includes('ABORDAGEM'));
    return col ? col.key : null;
}

// Pedido do usuário (2026-09-28): "depois que eu mandar uma mensagem para
// um lead, ele deve ser movido para outra coluna (em abordagem)... leads
// que tem conversa no whatsapp não devem ficar em leads frios". Chamada
// depois de QUALQUER envio de verdade que tenha saído (chat individual —
// texto ou template —, convite em massa via link OU via API) — nunca
// puxa de volta um lead que já avançou (Matriculado, Perdido etc.), só
// tira quem ainda está preso na PRIMEIRA coluna do funil (a "fria", nunca
// trabalhada — mandar mensagem já é, por definição, ter trabalhado o
// lead). Busca o `funil_agencia` ATUAL direto no banco, não em
// `leadsAtuais` — o lead pode ser de OUTRA filial (WhatsApp Unificado
// agora é cross-filial) e nem estar carregado ali.
async function moverParaAbordagemAposEnvio(leadId) {
    if (typeof columnsConfig === 'undefined' || columnsConfig.length === 0) return;
    const colunaFria = columnsConfig[0].key;
    const colunaAbordagem = encontrarColunaAbordagem();
    if (!colunaAbordagem || colunaAbordagem === colunaFria) return;

    const { data: lead } = await window.supabaseClient
        .from(typeof NOME_TABELA !== 'undefined' ? NOME_TABELA : 'leads_inscricoes')
        .select('funil_agencia')
        .eq('pessoaIdentificador', leadId)
        .maybeSingle();
    if (!lead || lead.funil_agencia !== colunaFria) return;

    await moverLeadsParaColuna([leadId], colunaAbordagem);
}

// Bug real (2026-09-28, achado logo depois do bloqueio geral da API cair —
// só aí os erros POR NÚMERO puderam finalmente aparecer): um número local
// de 8 dígitos começando com 2/3/4/5 é SEMPRE telefone FIXO no plano de
// numeração da Anatel — nunca foi celular, nunca teve/vai ter WhatsApp.
// Mesma regra usada em `montarNumeroE164()` (supabase/functions/_shared/telefone.ts,
// que trata o mesmo bug do lado do envio real via API) — aqui é a versão
// client-side, usada pelos 2 fluxos de convite em massa (link wa.me e API).
function numeroPareceFixo(ddd, numero) {
    const numeroLimpo = String(numero || '').replace(/\D/g, '');
    return numeroLimpo.length === 8 && !/^[6-9]/.test(numeroLimpo);
}

// Só dígitos de DDI+DDD+número — formato exigido pelo link wa.me (sem
// espaço, traço ou "+"). Assume Brasil (55), já que é o único país
// atendido hoje. Número de 8 dígitos que PARECE celular (prefixo 6-9,
// só esqueceu o 9º dígito) ganha o "9" na frente — mesma completude já
// aplicada no envio real via API (montarNumeroE164()); fixo (2-5) nunca
// ganha, e é rejeitado ANTES de gerar um link que a pessoa ia clicar e
// só descobrir depois, no WhatsApp Web, que o número não existe.
function telefoneParaWaMe(lead) {
    const ddd = String(lead.pessoaTelefoneDDD || '').replace(/\D/g, '');
    let numero = String(lead.pessoaTelefoneNumero || '').replace(/\D/g, '');
    if (!ddd || !numero) return null;
    if (numero.length === 8) {
        if (numeroPareceFixo(ddd, numero)) return null;
        numero = '9' + numero;
    }
    return `55${ddd}${numero}`;
}

let conviteLoteEventoAtual = null; // usado por marcarContatoWhatsAppLoteEnviado() abaixo, pra não precisar embutir o nome do evento (pode ter aspas) dentro de um atributo onchange

async function gerarLinksConviteLote() {
    const select = document.getElementById('conviteLoteEventoSelect');
    const eventoId = select ? Number(select.value) : null;
    const evento = (typeof eventosAtuais !== 'undefined' ? eventosAtuais : []).find(e => e.id === eventoId);
    if (!evento) return;
    conviteLoteEventoAtual = evento;

    // Texto que está na caixa agora (o modelo escolhido, com ou sem
    // ajuste manual só pra este envio) — o modelo em si (persistente) só
    // muda de verdade em "Gerenciar Mensagens"; aqui só lembramos QUAL
    // modelo foi usado por último, pra já vir selecionado da próxima vez.
    const textareaTexto = document.getElementById('conviteLoteTextoBase');
    const textoBase = (textareaTexto ? textareaTexto.value : '').trim() || CONVITE_EVENTO_NAO_ALUNO;
    const selectModelo = document.getElementById('conviteLoteModeloSelect');
    if (selectModelo && selectModelo.value) localStorage.setItem(CHAVE_STORAGE_MODELO_CONVITE_LOTE, selectModelo.value);

    const idsBrutos = Array.from(cardsSelecionados);
    const check30Dias = document.getElementById('conviteLoteExcluir30DiasCheck');
    const { validos: ids, excluidos } = await filtrarExclusaoInteligenteWpp(idsBrutos, { excluir30Dias: !check30Dias || check30Dias.checked });
    const linhas = [];
    let semTelefone = 0;
    const vinculos = [];

    ids.forEach(id => {
        const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(id));
        if (!lead) return;
        const numeroWaMe = telefoneParaWaMe(lead);
        if (!numeroWaMe) { semTelefone++; return; }

        const texto = montarTextoConviteEvento(lead, evento, textoBase);
        const link = `https://wa.me/${numeroWaMe}?text=${encodeURIComponent(texto)}`;
        linhas.push({ id, nome: lead.pessoaNome || 'Sem nome', link });
        vinculos.push({ evento_id: eventoId, pessoaIdentificador: lead.pessoaIdentificador, origem: 'crm' });
    });

    // Já registra o convite em evento_leads (resposta_convite default
    // 'pendente', mesmo default do convite manual na gaveta) — assim o
    // "Follow-up de Eventos" do Dashboard e o resumo de participantes do
    // evento já enxergam quem foi convidado, mesmo antes de qualquer
    // resposta. ignoreDuplicates: nunca sobrescreve um vínculo que já
    // existe (ex: alguém que já tinha respondido "recusado").
    if (vinculos.length > 0) {
        await window.supabaseClient
            .from(typeof NOME_TABELA_EVENTO_LEADS !== 'undefined' ? NOME_TABELA_EVENTO_LEADS : 'evento_leads')
            .upsert(vinculos, { onConflict: 'evento_id,pessoaIdentificador', ignoreDuplicates: true });
    }

    const avisoSemTelefone = semTelefone > 0
        ? `<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-triangle-exclamation"></i> ${semTelefone} lead(s) sem telefone válido pra WhatsApp (sem número cadastrado, ou telefone fixo) foram ignorados.</p>`
        : '';

    document.getElementById('conviteLoteResultado').innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
            <p style="font-size:12px; color:var(--text-muted); margin:0;">Clique em cada link — ele abre o WhatsApp Web já com o convite pronto, você só confere e aperta Enviar. Marque conforme for enviando: isso grava no Log de Atividade quem foi contatado de verdade, pra aparecer no relatório. Fechar esta tela não perde a lista — reabrir por "Convidar (Link)" volta exatamente aqui.</p>
            <button type="button" class="btn-secondary" style="font-size:11px; padding:4px 8px; white-space:nowrap;" onclick="reiniciarConviteLote()"><i class="fa-solid fa-rotate-left"></i> Novo lote</button>
        </div>
        ${htmlAvisoExclusaoInteligenteWpp(excluidos)}
        ${avisoSemTelefone}
        <div style="display:flex; flex-direction:column; gap:6px; max-height:340px; overflow-y:auto;">
            ${linhas.map(l => `
                <div style="display:flex; align-items:center; gap:8px; padding:8px; border:1px solid var(--border-color); border-radius:6px;" id="conviteLoteLinha-${l.id}">
                    <input type="checkbox" onchange="marcarContatoWhatsAppLoteEnviado('${l.id}', this.checked)">
                    <span style="flex:1; font-size:13px;">${escapeHTML(l.nome)}</span>
                    <button class="icon-btn" title="Marcar telefone pra conferir depois (não apaga o número — pode ser só erro de digitação)" onclick="marcarTelefoneParaVerificarLote('${l.id}')"><i class="fa-solid fa-magnifying-glass"></i></button>
                    <a href="${l.link}" target="_blank" rel="noopener" class="btn-secondary" style="text-decoration:none; font-size:12px; padding:6px 10px;"><i class="fa-brands fa-whatsapp"></i> Abrir</a>
                </div>
            `).join('')}
        </div>
    `;
    document.getElementById('conviteLoteEscolha').style.display = 'none';
    document.getElementById('conviteLoteResultado').style.display = 'block';

    if (linhas.length === 0) {
        alert('Nenhum lead selecionado tem telefone cadastrado — não há link pra gerar.');
    }
}

// Descarta o lote atual (links + marcações) e volta pro passo 1 (escolher
// evento/modelo) — único jeito de reiniciar de propósito, já que reabrir o
// modal normalmente preserva o lote em andamento (ver comentário em
// iniciarConvitesWhatsAppEmMassa()).
function reiniciarConviteLote() {
    const resultado = document.getElementById('conviteLoteResultado');
    resultado.innerHTML = '';
    resultado.style.display = 'none';
    document.getElementById('conviteLoteEscolha').style.display = 'block';
}

// Tag própria pra "esse telefone parece errado, mas não temos certeza" —
// pedido do usuário (2026-09-17): "muitos deles estão apenas com erro de
// digitação perceptível". Diferente de "Telefone Inválido" (que já
// significa "confirmamos que não presta, apagamos"), esta NUNCA apaga o
// número — só sinaliza pra alguém conferir com calma depois (ex: comparar
// com o cadastro do Ulisses, tentar 1 dígito trocado). Cai na família
// "Cadastro" (mesma cor de "Sem Telefone"/"Sem E-mail" — ver FAMILIAS_TAG,
// js/app.js).
const TAG_CONFERIR_TELEFONE = 'Conferir Telefone';

// Mesma heurística por substring já usada em encontrarColunaAbordagem()/
// encontrarColunaRecontato() — nunca cria a coluna sozinha, só avisa se não
// achar. Aceita "Verificar"/"Conferir" (a família da tag) ou "Atualizar
// Cadastro" (nome já citado no CLAUDE.md como sugestão pra esse caso).
function encontrarColunaVerificarTelefone() {
    if (typeof columnsConfig === 'undefined') return null;
    const normalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const col = columnsConfig.find(c => {
        const chave = normalizar(c.key), rotulo = normalizar(c.label);
        return chave.includes('VERIFICAR') || rotulo.includes('VERIFICAR')
            || chave.includes('CONFERIR') || rotulo.includes('CONFERIR')
            || chave.includes('ATUALIZAR CADASTRO') || rotulo.includes('ATUALIZAR CADASTRO');
    });
    return col ? col.key : null;
}

// Marca o telefone pra CONFERIR depois — pedido do usuário (2026-09-17):
// a versão anterior (marcarTelefoneInvalidoLote) apagava o número na hora,
// mas boa parte dos casos reais é só erro de digitação perceptível (1
// dígito trocado), não um número que realmente não existe mais. Agora
// NUNCA mexe no telefone — só aplica a tag TAG_CONFERIR_TELEFONE e move o
// lead pra uma coluna dedicada de conferência (encontrarColunaVerificarTelefone()),
// pra alguém revisar com calma sem perder o dado original.
async function marcarTelefoneParaVerificarLote(pessoaId) {
    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(pessoaId));
    if (leadIndex === -1) return;
    const lead = leadsAtuais[leadIndex];
    if (!confirm(`Marcar o telefone de ${lead.pessoaNome} pra conferir depois? O número CONTINUA no cadastro — só ganha a tag "${TAG_CONFERIR_TELEFONE}" e sai desta lista.`)) return;

    let tagsArray = parseTags(lead.tags).map(t => t.trim()).filter(Boolean);
    if (!tagsArray.includes(TAG_CONFERIR_TELEFONE)) tagsArray.push(TAG_CONFERIR_TELEFONE);
    lead.tags = JSON.stringify(tagsArray);

    const { error } = await window.supabaseClient
        .from(NOME_TABELA)
        .update({ tags: lead.tags })
        .eq('pessoaIdentificador', pessoaId);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }

    // Mesmo motivo de sempre: telefone suspeito também significa que a
    // gente NEM CHEGOU a entrar em contato de verdade — o vínculo
    // "pendente" criado em evento_leads quando o link foi gerado (ver
    // gerarLinksConviteLote()) não deveria contar nesse caso.
    if (conviteLoteEventoAtual) {
        await window.supabaseClient
            .from(typeof NOME_TABELA_EVENTO_LEADS !== 'undefined' ? NOME_TABELA_EVENTO_LEADS : 'evento_leads')
            .delete()
            .eq('evento_id', conviteLoteEventoAtual.id)
            .eq('pessoaIdentificador', pessoaId);
        if (typeof carregarResumoParticipantes === 'function' && typeof eventosAtuais !== 'undefined') {
            carregarResumoParticipantes(eventosAtuais);
        }
    }

    const colunaVerificar = encontrarColunaVerificarTelefone();
    if (colunaVerificar) {
        await moverLeadsParaColuna([pessoaId], colunaVerificar);
    } else {
        alert(`Tag "${TAG_CONFERIR_TELEFONE}" aplicada, mas não encontrei nenhuma coluna com "Verificar"/"Conferir" no nome pra mover o lead automaticamente — crie uma em "Gerenciar Colunas" (o lead continua na coluna atual por enquanto).`);
    }

    // O link wa.me já gerado não faz mais sentido nesta lista (o objetivo
    // agora é conferir o número antes de tentar de novo) — tira a linha.
    const linha = document.getElementById('conviteLoteLinha-' + pessoaId);
    if (linha) linha.remove();
    renderizarCards();
}

// Pedido do usuário (2026-09-15): mover pra Abordagem SÓ quando a
// caixinha é marcada de verdade (confirmando que mandou), não no momento
// de gerar os links — antes movia todo mundo assim que o link era criado,
// mesmo que a pessoa nunca tivesse clicado em "Abrir"/mandado nada.
async function marcarContatoWhatsAppLoteEnviado(pessoaId, marcado) {
    const linha = document.getElementById('conviteLoteLinha-' + pessoaId);
    if (linha) linha.style.opacity = marcado ? '0.45' : '1';
    if (!marcado || !conviteLoteEventoAtual) return;

    if (typeof registrarLogAtividade === 'function') {
        registrarLogAtividade('convite_whatsapp_link', {
            pessoaIds: [pessoaId],
            detalhes: { evento: conviteLoteEventoAtual.nome, canal: 'wa.me (WhatsApp pessoal)' },
        });
    }

    // Só move quem ainda está na coluna fria (ver moverParaAbordagemAposEnvio())
    // — nunca puxa de volta um lead que já avançou pra uma coluna mais adiante.
    await moverParaAbordagemAposEnvio(pessoaId);
}

// ==========================================================
// Convites em massa via API oficial da Meta (templates aprovados) —
// pedido do usuário (2026-09-28): "disparar convites para eventos em
// massa via API, conforme os modelos aprovados no meta". Diferente de
// "Convidar (Link)" (wa.me, zero automação de verdade), isto chama
// `whatsapp-send` de verdade, 1 vez por lead — só funciona com um
// TEMPLATE JÁ APROVADO (TEMPLATES_WHATSAPP, texto fixo, NÃO editável
// aqui — mudar o texto exige nova aprovação na Meta, diferente dos
// "Modelos de Mensagem" livres usados no link wa.me). Testado ao vivo
// em 2026-09-28 (curl direto contra whatsapp-send, lead de teste
// próprio): a API continua bloqueada ("API access blocked", ver
// CLAUDE.md "Bloqueio da API do WhatsApp") — o botão avisa isso antes
// de enviar, e cada linha do relatório final mostra o erro REAL da
// Meta por lead, mas a automação em si já está pronta pra funcionar no
// instante em que a Meta desbloquear, sem precisar de nenhuma mudança
// de código.
// ==========================================================

let conviteApiEventoAtual = null;
let conviteApiPreviaAtual = { templateIndice: 0, linhas: [] };

// Seleção "por segmento" (2026-09-28, pedido do usuário depois de
// reunião com a Ediliene: "enviar mensagens mais abertas para um número
// muito grande de pessoas" — não escala selecionar checkbox por checkbox
// num Kanban paginado). Busca TODA a filial que tem a tag escolhida
// direto no banco (RPC leads_por_tag_filial(), migracao_rpc_leads_por_tag.sql),
// não só quem já está carregado em leadsAtuais.
let conviteApiModoSelecao = 'kanban';
let conviteApiSegmentoLeads = [];

// Filtro inteligente — pedido do usuário (2026-10-08, vendo a tela de
// "Convidar via API"): "não ficar robotizado... não enviar pra quem já
// disse que não iria, ou que está viajando, ou que pediu pra excluir o
// número". Reaproveita sinais que JÁ existem, sem custo novo nenhum de
// IA: a classificação automática de resposta a convite
// (classificar-resposta-convite, cron 15 min) já aplica "Convite: Não
// Pode Ir"/"Convite: Sem Interesse"; "Contato Recente: 7 dias" (ver
// migracao_tags_contato_recente.sql) evita recontato cedo demais;
// "Não Contatar" é a tag manual pra opt-out leve ("me tira da lista").
// Usado por QUALQUER disparo em massa (Link/API/Janela Aberta/Prioridade
// Inteligente) — 1 ponto único, não duplicado em cada fluxo. Estas 4
// SEMPRE excluem, nunca são opcionais.
const TAGS_EXCLUSAO_CAMPANHA_WPP = ['Não Contatar', 'Convite: Não Pode Ir', 'Convite: Sem Interesse', 'Contato Recente: 7 dias'];

// "Contato Recente: 30 dias" (8-30 dias atrás) é OPCIONAL, diferente das
// 4 acima — pedido do usuário (2026-10-08): "excluir, mas deixa um
// 'check' marcado por padrão... garantindo ao SDR a liberdade de manter,
// caso queira". Cada tela de disparo em massa tem seu próprio checkbox
// "Evitar quem já falamos nos últimos 30 dias" (marcado por padrão),
// repassado como `excluir30Dias` pra esta função.
const TAG_EXCLUSAO_30_DIAS_OPCIONAL = 'Contato Recente: 30 dias';

// Busca tags FRESCAS direto do banco (nunca confia só no que já está em
// `leadsAtuais`, que pode estar desatualizado — e o modo "segmento" do
// Convidar API nem devolve `tags`, ver leads_por_tag_filial()). Devolve
// `{validos, excluidos}` — `excluidos` já vem com o motivo (qual tag
// bateu), pra mostrar na tela sem esconder a decisão.
async function filtrarExclusaoInteligenteWpp(ids, { excluir30Dias = true } = {}) {
    const unicos = [...new Set((ids || []).map(String))];
    if (unicos.length === 0) return { validos: [], excluidos: [] };
    const tagsExclusao = excluir30Dias ? [...TAGS_EXCLUSAO_CAMPANHA_WPP, TAG_EXCLUSAO_30_DIAS_OPCIONAL] : TAGS_EXCLUSAO_CAMPANHA_WPP;
    const { data } = await window.supabaseClient.from(NOME_TABELA).select('pessoaIdentificador, pessoaNome, tags').in('pessoaIdentificador', unicos);
    const mapa = new Map((data || []).map(r => [String(r.pessoaIdentificador), r]));
    const validos = [];
    const excluidos = [];
    for (const id of unicos) {
        const r = mapa.get(id);
        const tags = r ? parseTags(r.tags).map(t => String(t).trim()) : [];
        const motivo = tagsExclusao.find(t => tags.includes(t));
        if (motivo) excluidos.push({ id, nome: r ? r.pessoaNome : id, motivo });
        else validos.push(id);
    }
    return { validos, excluidos };
}

// HTML padrão do aviso "N excluído(s) automaticamente" — reaproveitado
// nos 3 pontos de disparo em massa, pra não repetir o mesmo markup.
function htmlAvisoExclusaoInteligenteWpp(excluidos) {
    if (!excluidos || excluidos.length === 0) return '';
    return `<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-shield-halved"></i> ${excluidos.length} lead(s) excluído(s) automaticamente (já disseram que não vão, pediram pra não ser contatados, ou já falamos com eles recentemente). <details style="margin-top:4px;"><summary style="cursor:pointer;">Ver quem e por quê</summary>${excluidos.map(e => `${escapeHTML(e.nome)} — <em>${escapeHTML(e.motivo)}</em>`).join('<br>')}</details></p>`;
}

// Tags mais úteis pra uma campanha de convite — sistema (sempre existem)
// + catálogo customizado (TAGS_SUGERIDAS, já carregado globalmente).
function popularTagsConviteApiSegmento() {
    const select = document.getElementById('conviteApiTagSelect');
    if (!select) return;
    const tagsSistema = ['Lead Forte 1', 'Lead Forte 2', 'Lead Forte 3', 'Jornada: Descoberta', 'Jornada: Interesse Emergente', 'Jornada: Engajado', 'Ativo', 'Inativo'];
    const catalogo = typeof TAGS_SUGERIDAS !== 'undefined' ? TAGS_SUGERIDAS : [];
    const todas = [...new Set([...tagsSistema, ...catalogo])];
    select.innerHTML = todas.map(t => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`).join('');
}

function atualizarModoSelecaoConviteApi() {
    const modoEl = document.querySelector('input[name="conviteApiModoSelecao"]:checked');
    conviteApiModoSelecao = modoEl ? modoEl.value : 'kanban';
    const area = document.getElementById('conviteApiSegmentoArea');
    if (area) area.style.display = conviteApiModoSelecao === 'segmento' ? 'block' : 'none';
}

// Busca paginada (1000 em 1000, mesmo padrão de sempre — o PostgREST
// corta em 1000 mesmo dentro de uma função) por TODA a filial atual com
// a tag escolhida. Mescla os leads encontrados em `leadsAtuais` (mesmo
// padrão de `abrirResultadoBuscaGlobal()`) pra `preencherValorAutomatico()`
// conseguir resolver nome/filial de cada um sem precisar duplicar essa
// lógica aqui.
async function buscarLeadsPorSegmentoConviteApi() {
    const tagSelect = document.getElementById('conviteApiTagSelect');
    const resultadoEl = document.getElementById('conviteApiSegmentoResultado');
    const tag = tagSelect ? tagSelect.value : '';
    if (!tag || !filialAtual) return;
    if (resultadoEl) resultadoEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Buscando...';

    const encontrados = [];
    let offset = 0;
    const passo = 1000;
    while (true) {
        const { data, error } = await window.supabaseClient.rpc('leads_por_tag_filial', { p_filial: filialAtual, p_tag: tag, p_limite: passo, p_offset: offset });
        if (error) { if (resultadoEl) resultadoEl.innerHTML = `<span style="color:#b91c1c;">Erro ao buscar: ${escapeHTML(error.message)}</span>`; return; }
        encontrados.push(...(data || []));
        if (!data || data.length < passo) break;
        offset += passo;
    }

    conviteApiSegmentoLeads = encontrados;
    const idsJaEmLeadsAtuais = new Set(leadsAtuais.map(l => String(l.pessoaIdentificador)));
    const novos = encontrados.filter(l => !idsJaEmLeadsAtuais.has(String(l.pessoaIdentificador)));
    if (novos.length > 0) leadsAtuais = [...leadsAtuais, ...novos];

    if (resultadoEl) {
        resultadoEl.innerHTML = encontrados.length > 0
            ? `<i class="fa-solid fa-users"></i> ${encontrados.length} lead(s) encontrado(s) com a tag "${escapeHTML(tag)}" em ${escapeHTML(filialAtual)}.`
            : `Nenhum lead com essa tag em ${escapeHTML(filialAtual)}.`;
    }
}

async function iniciarConviteApiEmMassa() {
    const temSelecaoKanban = typeof cardsSelecionados !== 'undefined' && cardsSelecionados.size > 0;
    // Sem seleção no Kanban, já abre direto no modo "buscar por tag" —
    // não bloqueia mais o recurso a "primeiro selecione no Kanban".
    conviteApiModoSelecao = temSelecaoKanban ? 'kanban' : 'segmento';
    conviteApiSegmentoLeads = [];

    if (typeof carregarEventos === 'function') await carregarEventos();

    const hojeISO = new Date().toISOString().slice(0, 10);
    const lista = (typeof eventosAtuais !== 'undefined' ? eventosAtuais : [])
        .filter(ev => (typeof dataEfetivaLimite === 'function' ? dataEfetivaLimite(ev) : ev.data) >= hojeISO)
        .slice()
        .sort((a, b) => (a.data + (a.hora || '')).localeCompare(b.data + (b.hora || '')));

    const selectEvento = document.getElementById('conviteApiEventoSelect');
    if (selectEvento) {
        selectEvento.innerHTML = '<option value="">(sem evento vinculado)</option>'
            + lista.map(ev => `<option value="${ev.id}">${escapeHTML(ev.nome)} — ${typeof formatarDataEvento === 'function' ? formatarDataEvento(ev.data) : ev.data}</option>`).join('');
    }

    const selectTemplate = document.getElementById('conviteApiTemplateSelect');
    if (selectTemplate) {
        selectTemplate.innerHTML = TEMPLATES_WHATSAPP.map((t, i) => `<option value="${i}">${escapeHTML(t.label)}</option>`).join('');
    }
    atualizarTemplateConviteApi();

    const contagemKanbanEl = document.getElementById('conviteApiContagemKanban');
    if (contagemKanbanEl) contagemKanbanEl.textContent = String(typeof cardsSelecionados !== 'undefined' ? cardsSelecionados.size : 0);
    const radioKanban = document.querySelector('input[name="conviteApiModoSelecao"][value="kanban"]');
    const radioSegmento = document.querySelector('input[name="conviteApiModoSelecao"][value="segmento"]');
    if (radioKanban) radioKanban.checked = conviteApiModoSelecao === 'kanban';
    if (radioSegmento) radioSegmento.checked = conviteApiModoSelecao === 'segmento';
    popularTagsConviteApiSegmento();
    atualizarModoSelecaoConviteApi();
    const resultadoSegmentoEl = document.getElementById('conviteApiSegmentoResultado');
    if (resultadoSegmentoEl) resultadoSegmentoEl.innerHTML = '';

    document.getElementById('conviteApiEscolha').style.display = 'block';
    document.getElementById('conviteApiPrevia').style.display = 'none';
    document.getElementById('conviteApiPrevia').innerHTML = '';
    document.getElementById('conviteApiResultado').style.display = 'none';
    document.getElementById('conviteApiResultado').innerHTML = '';
    document.getElementById('modalConviteLoteApi').classList.add('open');
    document.getElementById('overlayModalConviteLoteApi').classList.add('active');
}

function fecharModalConviteLoteApi() {
    document.getElementById('modalConviteLoteApi').classList.remove('open');
    document.getElementById('overlayModalConviteLoteApi').classList.remove('active');
}

// Calcula o valor automático de 1 campo manual a partir do evento
// escolhido na tela, conforme o "papel" declarado em TEMPLATES_WHATSAPP
// (ver bullet acima) — 'evento_com_artigo' monta "a Abertura de
// Turma"/"o Workshop..." via montarEventoComArtigo() (js/eventos.js,
// usa o artigo cadastrado em "Gerenciar Tipos" pro tipo daquele evento);
// 'evento_data' formata a data do evento como "DD/MM". Sem evento
// escolhido (ou sem papel reconhecido), devolve '' — o campo fica em
// branco, editável à mão, como já era antes.
function valorAutomaticoCampoManualConviteApi(papel, evento) {
    if (!evento) return '';
    if (papel === 'evento_com_artigo') return typeof montarEventoComArtigo === 'function' ? montarEventoComArtigo(evento) : evento.nome;
    if (papel === 'evento_data') return typeof formatarDataCurtaEvento === 'function' ? formatarDataCurtaEvento(evento.data) : '';
    return '';
}

// Ao trocar de template OU de evento: mostra o texto aprovado (fixo, só
// leitura) e monta 1 campo de texto por variável "manual" (chave: null)
// — essas valem pra TODOS os selecionados neste envio. Pedido do usuário
// (2026-10-05): campos ligados ao evento escolhido (evento/data) devem
// se preencher SOZINHOS, sem digitar nada — só os campos sem "papel"
// reconhecido (ex: "tipo do evento"/"tema" de contato_ulisses, que falam
// de um evento PASSADO via Ulisses, não do evento futuro selecionado
// aqui) continuam em branco, exigindo digitação manual como antes.
function atualizarTemplateConviteApi() {
    const selectTemplate = document.getElementById('conviteApiTemplateSelect');
    const corpoEl = document.getElementById('conviteApiCorpoAprovado');
    const camposEl = document.getElementById('conviteApiCamposManuais');
    const avisoIdioma = document.getElementById('conviteApiAvisoIdioma');
    if (!selectTemplate || !corpoEl || !camposEl) return;

    const tpl = TEMPLATES_WHATSAPP[Number(selectTemplate.value) || 0];
    if (!tpl) return;

    corpoEl.textContent = tpl.corpoAprovado;
    if (avisoIdioma) avisoIdioma.style.display = (tpl.idioma && tpl.idioma !== 'pt_BR') ? 'block' : 'none';

    const selectEvento = document.getElementById('conviteApiEventoSelect');
    const eventoEscolhido = selectEvento ? (typeof eventosAtuais !== 'undefined' ? eventosAtuais : []).find(e => String(e.id) === selectEvento.value) : null;

    const manuais = tpl.variaveis.map((v, i) => ({ ...v, indice: i })).filter(v => v.chave === null);
    camposEl.innerHTML = manuais.map(v => {
        const automatico = v.papel && eventoEscolhido;
        const valor = automatico ? valorAutomaticoCampoManualConviteApi(v.papel, eventoEscolhido) : '';
        const dica = automatico ? ' <span style="font-weight:400; color:var(--text-muted);">(preenchido a partir do evento escolhido — editável)</span>' : '';
        return `
        <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">${escapeHTML(v.label)}${dica}</label>
        <input type="text" id="conviteApiManual-${v.indice}" style="width:100%; padding:8px; margin-bottom:8px; box-sizing:border-box;" value="${escapeHTML(valor)}">
    `;
    }).join('');
}

// Constrói a lista final (1 linha por lead selecionado, com os params
// já resolvidos pra {{1}}, {{2}}...) e mostra pra revisão ANTES de
// disparar qualquer envio de verdade — diferente do link wa.me (onde
// quem aperta "Enviar" de fato é a pessoa), aqui o clique final já
// dispara a automação, então a revisão prévia + confirm() explícito no
// passo seguinte importam mais.
async function gerarPreviaConviteApiLote() {
    const selectTemplate = document.getElementById('conviteApiTemplateSelect');
    const tpl = TEMPLATES_WHATSAPP[Number(selectTemplate.value) || 0];
    if (!tpl) return;

    const selectEvento = document.getElementById('conviteApiEventoSelect');
    const eventoId = selectEvento && selectEvento.value ? Number(selectEvento.value) : null;
    conviteApiEventoAtual = eventoId ? (typeof eventosAtuais !== 'undefined' ? eventosAtuais : []).find(e => e.id === eventoId) : null;

    const valoresManuais = {};
    tpl.variaveis.forEach((v, i) => {
        if (v.chave === null) {
            const input = document.getElementById(`conviteApiManual-${i}`);
            valoresManuais[i] = input ? input.value.trim() : '';
        }
    });

    // Fonte da lista de candidatos — "Kanban" (seleção manual de sempre)
    // ou "segmento" (busca por tag em toda a filial,
    // buscarLeadsPorSegmentoConviteApi(), pedido do usuário 2026-09-28).
    // O "Disparo Inteligente do Dia" (pedido do usuário 2026-10-08) é um
    // fluxo PRÓPRIO, separado deste modal (ver enviarGrupoPrioridadeInteligente()),
    // que só reaproveita o ENVIO final (confirmarEnviarConviteApiLote()) —
    // nunca passa por esta função.
    const idsBrutos = conviteApiModoSelecao === 'segmento'
        ? conviteApiSegmentoLeads.map(l => String(l.pessoaIdentificador))
        : Array.from(cardsSelecionados);

    // Quem já confirmou presença nesse evento não precisa ser convidado
    // de novo — só verificado quando um evento foi escolhido.
    let idsJaConfirmados = new Set();
    if (eventoId && idsBrutos.length > 0) {
        const { data: jaConfirmados } = await window.supabaseClient
            .from('evento_leads')
            .select('pessoaIdentificador')
            .eq('evento_id', eventoId)
            .eq('resposta_convite', 'confirmado')
            .in('pessoaIdentificador', idsBrutos);
        idsJaConfirmados = new Set((jaConfirmados || []).map(r => String(r.pessoaIdentificador)));
    }

    // Filtro inteligente (ver filtrarExclusaoInteligenteWpp() acima) — modo
    // "prioridade" já aplica isso sozinho ao montar a fila, mas reaplicar
    // aqui não faz mal nenhum (idempotente) e cobre os outros 2 modos, que
    // nunca tinham essa checagem antes.
    const check30DiasApi = document.getElementById('conviteApiExcluir30DiasCheck');
    const { validos: ids, excluidos } = await filtrarExclusaoInteligenteWpp(idsBrutos.filter(id => !idsJaConfirmados.has(String(id))), { excluir30Dias: !check30DiasApi || check30DiasApi.checked });

    const linhas = [];
    let semTelefone = 0;
    let jaConfirmadosIgnorados = idsBrutos.length - ids.length - excluidos.length; // aproximação: o que sobrou fora de ids/excluidos veio do corte de confirmados acima

    ids.forEach(id => {
        const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(id));
        if (!lead) return;
        if (!lead.pessoaTelefoneDDD || !lead.pessoaTelefoneNumero) { semTelefone++; return; }
        // Número de 8 dígitos começando com 2-5 é telefone FIXO (Anatel) —
        // nunca teve WhatsApp, nunca vale a pena gastar uma chamada de API
        // que vai só voltar "Message Undeliverable" (bug real achado
        // 2026-09-28, ver montarNumeroE164() no backend).
        if (numeroPareceFixo(lead.pessoaTelefoneDDD, lead.pessoaTelefoneNumero)) { semTelefone++; return; }

        const params = tpl.variaveis.map((v, i) => v.chave === null
            ? (valoresManuais[i] || '')
            : (preencherValorAutomatico(v.chave, id) || ''));

        linhas.push({ pessoaIdentificador: id, nome: lead.pessoaNome || 'Sem nome', params });
    });

    conviteApiPreviaAtual = { templateIndice: Number(selectTemplate.value) || 0, linhas };

    const avisoSemTelefone = semTelefone > 0
        ? `<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-triangle-exclamation"></i> ${semTelefone} lead(s) sem telefone válido pra WhatsApp (sem número cadastrado, ou telefone fixo) foram ignorados.</p>`
        : '';
    const avisoJaConfirmados = jaConfirmadosIgnorados > 0
        ? `<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-circle-check"></i> ${jaConfirmadosIgnorados} lead(s) já confirmados nesse evento foram ignorados (não precisam de convite de novo).</p>`
        : '';
    const avisoExclusaoInteligente = htmlAvisoExclusaoInteligenteWpp(excluidos);

    document.getElementById('conviteApiEscolha').style.display = 'none';
    const previaEl = document.getElementById('conviteApiPrevia');
    previaEl.style.display = 'block';
    previaEl.innerHTML = `
        ${avisoExclusaoInteligente}
        ${avisoSemTelefone}
        ${avisoJaConfirmados}
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">Vai enviar <strong>"${escapeHTML(tpl.label)}"</strong> pra ${linhas.length} lead(s) de verdade, pela API. Confira os nomes antes de confirmar:</p>
        <div style="max-height:220px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px; padding:6px; margin-bottom:12px;">
            ${linhas.map(l => `<div style="font-size:12px; padding:4px 6px;">${escapeHTML(l.nome)}</div>`).join('') || '<p style="font-size:12px; color:var(--text-muted); padding:6px;">Nenhum lead com telefone entre os selecionados.</p>'}
        </div>
        <div style="display:flex; gap:8px;">
            <button class="btn-secondary" onclick="voltarEscolhaConviteApi()"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
            <button class="btn-primary" style="flex:1;" onclick="confirmarEnviarConviteApiLote()" ${linhas.length === 0 ? 'disabled' : ''}><i class="fa-solid fa-paper-plane"></i> Enviar Agora (via API)</button>
        </div>
    `;
}

function voltarEscolhaConviteApi() {
    document.getElementById('conviteApiEscolha').style.display = 'block';
    document.getElementById('conviteApiPrevia').style.display = 'none';
}

// Dispara de verdade — 1 chamada whatsapp-send por lead, em lotes
// pequenos (evita disparar centenas de requisições simultâneas de uma
// vez). Cada resultado (sucesso ou o erro real da Meta) vira 1 linha do
// relatório final; sucesso também vincula evento_leads (origem 'crm' —
// é só um convite, não uma inscrição confirmada no Ulisses, mesmo
// princípio de gerarLinksConviteLote()) e registra em log_atividade.
// Bug real confirmado em produção (2026-10-05): a Meta mandou um aviso
// de violação de política mesmo com volume DIÁRIO baixo (58 mensagens) —
// investigando `mensagens_whatsapp` direto, o problema nunca foi o
// TOTAL, foi a TAXA: `TAMANHO_LOTE_CONVITE_API=5` + `Promise.all()`
// mandava 5 mensagens praticamente SIMULTÂNEAS (confirmado: 31 de 57
// intervalos entre envios consecutivos no dia foram < 2s, o menor foi
// 4ms), com texto de TEMPLATE idêntico pra dezenas de destinatários
// novos em sequência — exatamente o padrão que os sistemas de detecção
// de spam/qualidade da Meta tratam como disparo em massa automatizado,
// independente do volume total do dia. Corrigido: lote de 1 (serializa,
// nunca 2+ chamadas concorrentes) + pausa entre cada envio individual —
// não é garantia formal de taxa (a Meta tem seus próprios limites por
// número/qualidade, ver `messaging_limit` no WhatsApp Manager), só
// elimina a assinatura de "rajada" que motivou o aviso.
const TAMANHO_LOTE_CONVITE_API = 1;

// Pedido do usuário (2026-10-08): "o total de contatos hoje começa em
// 250 (o limite diário da API da Meta)... quero mais respiro entre uma
// mensagem e outra, mas tem que levar no máximo 1 hora no total" — a
// pausa fixa de 1,5s (rápida demais pra "respirar" de verdade) virou um
// intervalo-ALVO calibrado pra 250 mensagens caberem em ~1h: 3.600.000ms
// / 249 intervalos (250 mensagens têm 249 "espaços" entre si) ≈ 14.458ms
// (~14,5s) entre cada envio — quase 10x mais espaçado que antes.
// Generalizado pra qualquer N (não só 250): um disparo MENOR usa o MESMO
// intervalo-alvo e termina bem antes de 1h (sem problema, não tem
// porquê esticar artificialmente pra preencher a hora toda); um disparo
// MAIOR que 250 encurta o intervalo o suficiente pra nunca estourar o
// teto de 1h — nunca mais rápido que isso seria arriscar a mesma rajada
// que já gerou o aviso de violação de política.
const TEMPO_MAXIMO_ENVIO_MASSA_MS = 60 * 60 * 1000; // 1h — teto absoluto, nunca ultrapassado
const PAUSA_ALVO_ENVIO_MASSA_MS = Math.round(TEMPO_MAXIMO_ENVIO_MASSA_MS / 249); // ~14.458ms, calibrado pra 250 msgs/1h

function calcularPausaEnvioMassa(totalMensagens) {
    if (totalMensagens <= 1) return 0;
    const pausaParaCaberNoTeto = TEMPO_MAXIMO_ENVIO_MASSA_MS / (totalMensagens - 1);
    return Math.min(PAUSA_ALVO_ENVIO_MASSA_MS, pausaParaCaberNoTeto);
}

// Indicador de progresso FLUTUANTE, persistente mesmo com o modal
// fechado (pedido do usuário, 2026-10-06: "fechar essa tela interrompe
// o envio?" — NÃO interrompe, o loop de envio roda independente do
// modal estar aberto/visível; o problema era só UX — fechar o modal
// escondia o ÚNICO lugar que mostrava o progresso, dando a falsa
// impressão de que o serviço parou). Reaproveita o MESMO container
// (#wppPopupContainer, _containerPopupWpp() em js/notificacoes.js) já
// usado pelo popup de "mensagem recebida" — canto inferior direito,
// nunca bloqueia o meio da tela.
function atualizarProgressoEnvioMassa(idOperacao, { titulo, atual, total, concluido }) {
    const container = typeof _containerPopupWpp === 'function' ? _containerPopupWpp() : document.body;
    let el = document.getElementById(`progressoEnvioWpp-${idOperacao}`);
    if (!el) {
        el = document.createElement('div');
        el.id = `progressoEnvioWpp-${idOperacao}`;
        el.className = 'wpp-progresso-toast';
        container.appendChild(el);
    }
    const pct = total > 0 ? Math.round((atual / total) * 100) : 0;
    el.innerHTML = `
        <div class="wpp-progresso-toast-topo"><i class="fa-solid fa-paper-plane"></i> ${escapeHTML(titulo || 'Enviando mensagens')}</div>
        <div class="wpp-progresso-toast-barra"><div class="wpp-progresso-toast-barra-fill" style="width:${pct}%"></div></div>
        <div class="wpp-progresso-toast-texto">${concluido ? 'Concluído' : 'Enviando'}... (${atual}/${total})</div>
    `;
    if (concluido) setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 6000);
}
function pausarWpp(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Envia 1 template aprovado pra uma lista de leads já com params
// resolvidos, em lotes pequenos — extraída pra ser compartilhada entre o
// envio de 1 grupo só (via modal "Convidar API") e o envio de TODOS os
// grupos do "Disparo Inteligente do Dia" de uma vez (ver
// enviarTodosGruposPrioridadeInteligente()). `idProgresso` é opcional —
// quando ausente, quem chama controla o próprio indicador de progresso
// via `onProgresso` (necessário pra somar o progresso de vários grupos
// num único indicador, em vez de cada grupo resetar o indicador do
// zero). `pausaMs` também é opcional — por padrão calibra o intervalo
// pelo TAMANHO DESTA lista (`calcularPausaEnvioMassa()`); quem dispara
// pra VÁRIOS grupos em sequência (enviarTodosGruposPrioridadeInteligente())
// passa um `pausaMs` já calculado pelo TOTAL agregado de todos os
// grupos juntos — senão cada grupo recalcularia sozinho achando que é
// "o disparo inteiro", e a soma de vários grupos de ~14,5s cada
// facilmente estouraria o teto de 1h pensado pro disparo do dia INTEIRO.
async function enviarTemplateApiLote(tpl, linhas, { idProgresso, titulo, eventoAtual, onProgresso, pausaMs } = {}) {
    const pausa = typeof pausaMs === 'number' ? pausaMs : calcularPausaEnvioMassa(linhas.length);
    const resultados = [];
    for (let i = 0; i < linhas.length; i += TAMANHO_LOTE_CONVITE_API) {
        const lote = linhas.slice(i, i + TAMANHO_LOTE_CONVITE_API);
        const respostas = await Promise.all(lote.map(async (l) => {
            try {
                const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
                    body: {
                        pessoaIdentificador: l.pessoaIdentificador,
                        tipo: 'template',
                        templateNome: tpl.nome,
                        templateIdioma: tpl.idioma || 'pt_BR',
                        templateParams: l.params,
                        templatePreview: montarPreviewTemplate(tpl, l.params),
                        atendenteNome: (typeof obterNomeAtendente === 'function' ? obterNomeAtendente() : '') || '',
                        origemEnvio: 'campanha',
                    },
                });
                if (error || !data || data.ok === false) {
                    return { ...l, ok: false, erro: (data && data.detalhe && data.detalhe.message) || error?.message || data?.erro || 'erro desconhecido' };
                }
                return { ...l, ok: true };
            } catch (e) {
                return { ...l, ok: false, erro: e.message || String(e) };
            }
        }));
        resultados.push(...respostas);
        if (idProgresso) atualizarProgressoEnvioMassa(idProgresso, { titulo, atual: resultados.length, total: linhas.length });
        if (typeof onProgresso === 'function') onProgresso(resultados.length, linhas.length);
        if (i + TAMANHO_LOTE_CONVITE_API < linhas.length) await pausarWpp(pausa);
    }
    if (idProgresso) atualizarProgressoEnvioMassa(idProgresso, { titulo, atual: resultados.length, total: linhas.length, concluido: true });

    const sucesso = resultados.filter(r => r.ok);
    const falha = resultados.filter(r => !r.ok);

    // Vincula evento_leads só pra quem o envio de fato saiu (nunca cria
    // um "convidado" fantasma pra quem a Meta rejeitou). 2 modos: UM
    // evento só pra TODO o lote (`eventoAtual`, fluxo normal de
    // "Convidar API" — 1 evento escolhido vale pra todo mundo) OU 1
    // evento POR LEAD (`l.eventoId`, usado pelo "Disparo Inteligente do
    // Dia" quando o mesmo motivo/bucket junta filiais com datas/eventos
    // diferentes — ver enviarGrupoPrioridadeInteligente()).
    if (sucesso.length > 0) {
        const vinculos = sucesso
            .map(r => ({ evento_id: eventoAtual ? eventoAtual.id : r.eventoId, pessoaIdentificador: r.pessoaIdentificador, origem: 'crm' }))
            .filter(v => v.evento_id);
        if (vinculos.length > 0) {
            await window.supabaseClient
                .from(typeof NOME_TABELA_EVENTO_LEADS !== 'undefined' ? NOME_TABELA_EVENTO_LEADS : 'evento_leads')
                .upsert(vinculos, { onConflict: 'evento_id,pessoaIdentificador', ignoreDuplicates: true });
        }
    }

    if (typeof registrarLogAtividade === 'function' && (sucesso.length > 0 || falha.length > 0)) {
        const nomesEventos = eventoAtual ? [eventoAtual.nome] : [...new Set(sucesso.map(r => r.eventoNome).filter(Boolean))];
        registrarLogAtividade('convite_whatsapp_api_lote', {
            pessoaIds: sucesso.map(r => r.pessoaIdentificador),
            detalhes: { template: tpl.label, evento: nomesEventos.length > 0 ? nomesEventos.join(', ') : null, enviados: sucesso.length, falhas: falha.length },
        });
    }

    // Pedido do usuário: mandar mensagem já tira o lead de uma coluna
    // fria — só quem ainda estava lá, nunca puxa de volta quem já avançou.
    await Promise.all(sucesso.map(r => moverParaAbordagemAposEnvio(r.pessoaIdentificador)));

    return { resultados, sucesso, falha };
}

async function confirmarEnviarConviteApiLote() {
    const { templateIndice, linhas } = conviteApiPreviaAtual;
    const tpl = TEMPLATES_WHATSAPP[templateIndice];
    if (!tpl || linhas.length === 0) return;

    if (!confirm(`Confirma o envio automático de "${tpl.label}" para ${linhas.length} lead(s) agora, via API da Meta? Essa ação não pode ser desfeita.`)) return;

    const previaEl = document.getElementById('conviteApiPrevia');
    const resultadoEl = document.getElementById('conviteApiResultado');
    previaEl.style.display = 'none';
    resultadoEl.style.display = 'block';
    resultadoEl.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Enviando em segundo plano — acompanhe o progresso no canto da tela, pode fechar esta tela sem interromper.</p>';

    const { resultados, sucesso, falha } = await enviarTemplateApiLote(tpl, linhas, {
        idProgresso: 'conviteApi',
        titulo: 'Convidar (API)',
        eventoAtual: conviteApiEventoAtual,
    });

    resultadoEl.innerHTML = `
        <p style="font-size:13px; margin-bottom:8px;"><strong>${sucesso.length} enviado(s)</strong>${falha.length > 0 ? `, <strong style="color:#991b1b;">${falha.length} falhou(aram)</strong>` : ''}.</p>
        <div style="max-height:280px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px; padding:6px; margin-bottom:12px;">
            ${resultados.map(r => `
                <div style="display:flex; justify-content:space-between; gap:8px; padding:5px 6px; font-size:12px; border-bottom:1px dashed var(--border-color);">
                    <span>${escapeHTML(r.nome)}</span>
                    <span style="color:${r.ok ? 'var(--na-green-dark)' : '#991b1b'}; text-align:right;">${r.ok ? '<i class="fa-solid fa-check"></i> Enviado' : `<i class="fa-solid fa-xmark"></i> ${escapeHTML(String(r.erro))}`}</span>
                </div>
            `).join('')}
        </div>
        <button class="btn-secondary" onclick="fecharModalConviteLoteApi()">Fechar</button>
    `;
}

// ==========================================================
// Convidar (Janela Aberta) — pedido URGENTE do usuário (2026-09-28):
// "quero uma opção agora, urgente, para convidar as pessoas que estão
// com a janela aberta (agora mesmo) para a abertura de turma que
// acontecerá na semana que vem (tem que ser personalizado por filial)".
//
// Diferente de "Convidar (API)" (sempre template aprovado, funciona
// mesmo fora da janela), aqui é TEXTO LIVRE — a pessoa acabou de
// mandar mensagem, a janela já está aberta, não precisa de template.
// "Personalizado por filial" já é resolvido de graça por
// `montarTextoConviteEvento()` (usa `lead.filial`, não `filialAtual` —
// bug já corrigido antes nesta sessão), buscando a Abertura de Turma
// mais próxima CADASTRADA PRA CADA FILIAL especificamente (cada unidade
// pode ter uma data diferente).
// ==========================================================
let conviteJanelaAbertaCandidatos = [];
let conviteJanelaAbertaExcluidosInteligente = [];

async function carregarProximaAberturaTurmaPorFilial() {
    const hojeISO = new Date().toISOString().slice(0, 10);
    const { data, error } = await window.supabaseClient
        .from('eventos')
        .select('id, nome, filial, data, hora, link_inscricao, data_limite_inscricao')
        .eq('tipo', 'Abertura de Turma')
        .eq('ativo', true)
        .gte('data', hojeISO)
        .order('data', { ascending: true });
    if (error) return new Map();
    const porFilial = new Map();
    (data || []).forEach(ev => { if (!porFilial.has(ev.filial)) porFilial.set(ev.filial, ev); });
    return porFilial;
}

async function iniciarConviteJanelaAberta() {
    const modal = document.getElementById('modalConviteJanelaAberta');
    const overlay = document.getElementById('overlayModalConviteJanelaAberta');
    const corpoEl = document.getElementById('conviteJanelaAbertaCorpo');
    if (corpoEl) corpoEl.innerHTML = '<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Buscando conversas com janela aberta...</p>';
    if (modal) modal.classList.add('open');
    if (overlay) overlay.classList.add('active');

    // 1) TODA conversa (qualquer filial) cuja última mensagem foi do
    // lead e a janela de 24h ainda não fechou.
    const { data: conversas, error: erroConversas } = await window.supabaseClient
        .from('vw_wpp_conversas')
        .select('"pessoaIdentificador", ultima_mensagem_em, ultima_direcao, filial');
    if (erroConversas) { if (corpoEl) corpoEl.innerHTML = '<p style="color:#b91c1c; font-size:12px;">Erro ao buscar conversas.</p>'; return; }

    const agora = Date.now();
    const abertas = (conversas || [])
        .filter(c => c.ultima_direcao === 'entrada')
        .map(c => ({ ...c, horasRestantes: 24 - (agora - new Date(c.ultima_mensagem_em).getTime()) / 3600000 }))
        .filter(c => c.horasRestantes > 0);

    if (abertas.length === 0) {
        if (corpoEl) corpoEl.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhuma conversa com janela aberta agora.</p>';
        conviteJanelaAbertaCandidatos = [];
        return;
    }

    // 2) Próxima Abertura de Turma de CADA filial envolvida.
    const eventosPorFilial = await carregarProximaAberturaTurmaPorFilial();

    // 3) Garante que os leads estão em leadsAtuais (mesmo padrão de
    // abrirResultadoBuscaGlobal()) pra montarTextoConviteEvento() ler
    // tags/nome/filial mesmo de leads de OUTRAS filiais.
    const idsFaltando = abertas.map(c => String(c.pessoaIdentificador)).filter(id => !leadsAtuais.some(l => String(l.pessoaIdentificador) === id));
    if (idsFaltando.length > 0) {
        const { data: leadsFaltando } = await window.supabaseClient.from(NOME_TABELA).select('*').in('pessoaIdentificador', idsFaltando);
        if (leadsFaltando && leadsFaltando.length > 0) leadsAtuais = [...leadsAtuais, ...leadsFaltando];
    }

    // 4) Monta candidatos — só quem tem Abertura de Turma futura
    // cadastrada pra sua PRÓPRIA filial.
    const candidatos = [];
    let semEventoNaFilial = 0;
    abertas.forEach(c => {
        const evento = eventosPorFilial.get(c.filial);
        if (!evento) { semEventoNaFilial++; return; }
        const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(c.pessoaIdentificador));
        if (!lead) return;
        candidatos.push({
            pessoaIdentificador: c.pessoaIdentificador,
            nome: lead.pessoaNome || 'Sem nome',
            filial: c.filial,
            evento,
            horasRestantes: c.horasRestantes,
            texto: montarTextoConviteEvento(lead, evento, null, true),
        });
    });

    // 5) Exclui quem já confirmou presença na Abertura de Turma da
    // própria filial — não convidar de novo quem já vai.
    let semConfirmado = candidatos;
    if (candidatos.length > 0) {
        const eventoIds = [...new Set(candidatos.map(c => c.evento.id))];
        const { data: jaConfirmados } = await window.supabaseClient
            .from('evento_leads')
            .select('"pessoaIdentificador", evento_id')
            .in('evento_id', eventoIds)
            .eq('resposta_convite', 'confirmado');
        const setConfirmados = new Set((jaConfirmados || []).map(r => `${r.evento_id}:${r.pessoaIdentificador}`));
        semConfirmado = candidatos.filter(c => !setConfirmados.has(`${c.evento.id}:${c.pessoaIdentificador}`));
    }

    // 6) Filtro inteligente (ver filtrarExclusaoInteligenteWpp() acima) —
    // mesmo quem acabou de responder pode já ter dito "não vou" ou pedido
    // pra não ser contatado numa conversa anterior.
    const check30DiasJanela = document.getElementById('conviteJanelaAbertaExcluir30DiasCheck');
    const { validos: idsValidos, excluidos: excluidosInteligente } = await filtrarExclusaoInteligenteWpp(semConfirmado.map(c => c.pessoaIdentificador), { excluir30Dias: !check30DiasJanela || check30DiasJanela.checked });
    const setValidos = new Set(idsValidos.map(String));
    conviteJanelaAbertaCandidatos = semConfirmado.filter(c => setValidos.has(String(c.pessoaIdentificador)));
    conviteJanelaAbertaExcluidosInteligente = excluidosInteligente;

    renderizarPreviaConviteJanelaAberta(semEventoNaFilial, abertas.length);
}

function renderizarPreviaConviteJanelaAberta(semEventoNaFilial, totalAbertas) {
    const corpoEl = document.getElementById('conviteJanelaAbertaCorpo');
    if (!corpoEl) return;

    const avisoSemEvento = semEventoNaFilial > 0
        ? `<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-triangle-exclamation"></i> ${semEventoNaFilial} conversa(s) com janela aberta ignorada(s) — a filial deles não tem uma Abertura de Turma futura cadastrada na Agenda.</p>`
        : '';
    const avisoExclusaoInteligente = htmlAvisoExclusaoInteligenteWpp(conviteJanelaAbertaExcluidosInteligente);

    if (conviteJanelaAbertaCandidatos.length === 0) {
        corpoEl.innerHTML = `${avisoSemEvento}${avisoExclusaoInteligente}<p style="font-size:12px; color:var(--text-muted);">Nenhum candidato pra convidar agora (de ${totalAbertas} conversa(s) com janela aberta).</p><button class="btn-secondary" onclick="fecharModalConviteJanelaAberta()">Fechar</button>`;
        return;
    }

    corpoEl.innerHTML = `
        ${avisoSemEvento}
        ${avisoExclusaoInteligente}
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">Vai enviar de verdade pra <strong>${conviteJanelaAbertaCandidatos.length}</strong> lead(s), cada um com o texto personalizado da Abertura de Turma da própria filial:</p>
        <div style="max-height:280px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px; padding:6px; margin-bottom:12px;">
            ${conviteJanelaAbertaCandidatos.map((c, i) => `
                <div style="display:flex; align-items:flex-start; gap:6px; margin-bottom:4px;">
                    <details style="flex:1;">
                        <summary style="font-size:12px; cursor:pointer;">
                            <strong>${escapeHTML(c.nome)}</strong> · ${escapeHTML(c.filial)} · ${escapeHTML(c.evento.nome)}
                            <span style="color:var(--text-muted);">(${Math.round(c.horasRestantes)}h restantes na janela)</span>
                        </summary>
                        <textarea style="width:100%; font-size:11.5px; white-space:pre-line; background:#f8fafc; padding:6px; border-radius:6px; margin-top:4px; border:1px solid var(--border-color); resize:vertical; min-height:80px; box-sizing:border-box;" oninput="editarTextoCandidatoConviteJanelaAberta(${i}, this.value)">${escapeHTML(c.texto)}</textarea>
                    </details>
                    <button class="icon-btn danger" title="Remover este da lista (ex: número reciclado, não é o lead de verdade)" onclick="removerCandidatoConviteJanelaAberta(${i})"><i class="fa-solid fa-xmark"></i></button>
                </div>
            `).join('')}
        </div>
        <div style="display:flex; gap:8px;">
            <button class="btn-secondary" onclick="fecharModalConviteJanelaAberta()">Cancelar</button>
            <button class="btn-primary" style="flex:1;" onclick="confirmarConviteJanelaAberta()"><i class="fa-solid fa-paper-plane"></i> Enviar Agora pra ${conviteJanelaAbertaCandidatos.length}</button>
        </div>
    `;
}

function removerCandidatoConviteJanelaAberta(indice) {
    conviteJanelaAbertaCandidatos.splice(indice, 1);
    renderizarPreviaConviteJanelaAberta(0, conviteJanelaAbertaCandidatos.length);
}

// Pedido do usuário (2026-09-29): "libere a mensagem para edição" — o
// texto de cada candidato agora é uma caixa editável antes de enviar,
// não mais só leitura. Edita SÓ o array em memória (sem re-render — um
// re-render a cada tecla perderia o foco/cursor do textarea).
function editarTextoCandidatoConviteJanelaAberta(indice, novoTexto) {
    if (conviteJanelaAbertaCandidatos[indice]) conviteJanelaAbertaCandidatos[indice].texto = novoTexto;
}

async function confirmarConviteJanelaAberta() {
    const candidatos = conviteJanelaAbertaCandidatos;
    if (candidatos.length === 0) return;
    if (!confirm(`Confirma o envio de verdade pra ${candidatos.length} lead(s) agora? Essa ação não pode ser desfeita.`)) return;

    const corpoEl = document.getElementById('conviteJanelaAbertaCorpo');
    if (corpoEl) corpoEl.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Enviando em segundo plano — acompanhe o progresso no canto inferior direito, pode fechar esta tela sem interromper.</p>';

    const resultados = [];
    // Lote de 1 + pausa calibrada por calcularPausaEnvioMassa() (mesma
    // correção de 2026-10-05/2026-10-08 do envio em massa via template,
    // ver TAMANHO_LOTE_CONVITE_API/PAUSA_ALVO_ENVIO_MASSA_MS acima) —
    // evita a mesma assinatura de "rajada" que motivou um aviso de
    // violação de política da Meta, e garante o mesmo teto de 1h pro
    // disparo inteiro, não só por lote individual.
    const TAMANHO_LOTE = 1;
    const pausaMs = calcularPausaEnvioMassa(candidatos.length);
    for (let i = 0; i < candidatos.length; i += TAMANHO_LOTE) {
        const lote = candidatos.slice(i, i + TAMANHO_LOTE);
        const respostas = await Promise.all(lote.map(async (c) => {
            try {
                const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
                    body: { pessoaIdentificador: c.pessoaIdentificador, tipo: 'texto', texto: c.texto, atendenteNome: (typeof obterNomeAtendente === 'function' ? obterNomeAtendente() : '') || '', origemEnvio: 'campanha' },
                });
                if (error || !data || data.ok === false) return { ...c, ok: false, erro: (data && data.detalhe && data.detalhe.message) || data?.erro || error?.message || 'erro desconhecido' };
                return { ...c, ok: true };
            } catch (e) {
                return { ...c, ok: false, erro: String(e.message || e) };
            }
        }));
        resultados.push(...respostas);
        atualizarProgressoEnvioMassa('conviteJanelaAberta', { titulo: 'Convidar (Janela Aberta)', atual: resultados.length, total: candidatos.length });
        if (i + TAMANHO_LOTE < candidatos.length) await pausarWpp(pausaMs);
    }
    atualizarProgressoEnvioMassa('conviteJanelaAberta', { titulo: 'Convidar (Janela Aberta)', atual: resultados.length, total: candidatos.length, concluido: true });

    const sucesso = resultados.filter(r => r.ok);
    const falha = resultados.filter(r => !r.ok);

    if (sucesso.length > 0) {
        await window.supabaseClient.from('evento_leads').upsert(
            sucesso.map(r => ({ evento_id: r.evento.id, pessoaIdentificador: r.pessoaIdentificador, origem: 'crm', resposta_convite: 'pendente' })),
            { onConflict: 'evento_id,pessoaIdentificador', ignoreDuplicates: true }
        );
        if (typeof registrarLogAtividade === 'function') {
            registrarLogAtividade('convite_janela_aberta', { pessoaIds: sucesso.map(r => r.pessoaIdentificador), detalhes: { enviados: sucesso.length, falhas: falha.length } });
        }
        await Promise.all(sucesso.map(r => moverParaAbordagemAposEnvio(r.pessoaIdentificador)));
    }

    const corpoElFinal = document.getElementById('conviteJanelaAbertaCorpo');
    if (corpoElFinal) {
        corpoElFinal.innerHTML = `
            <p style="font-size:13px; margin-bottom:8px;"><strong>${sucesso.length} enviado(s)</strong>${falha.length > 0 ? `, <strong style="color:#991b1b;">${falha.length} falhou(aram)</strong>` : ''}.</p>
            <div style="max-height:280px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px; padding:6px; margin-bottom:12px;">
                ${resultados.map(r => `
                    <div style="display:flex; justify-content:space-between; gap:8px; padding:5px 6px; font-size:12px; border-bottom:1px dashed var(--border-color);">
                        <span>${escapeHTML(r.nome)}</span>
                        <span style="color:${r.ok ? 'var(--na-green-dark)' : '#991b1b'}; text-align:right;">${r.ok ? '<i class="fa-solid fa-check"></i> Enviado' : `<i class="fa-solid fa-xmark"></i> ${escapeHTML(String(r.erro))}`}</span>
                    </div>
                `).join('')}
            </div>
            <button class="btn-secondary" onclick="fecharModalConviteJanelaAberta()">Fechar</button>
        `;
    }
}

function fecharModalConviteJanelaAberta() {
    document.getElementById('modalConviteJanelaAberta').classList.remove('open');
    document.getElementById('overlayModalConviteJanelaAberta').classList.remove('active');
}

// ==========================================================
// Disparo Inteligente do Dia — pedido do usuário (2026-10-08): "não
// ficar robotizado... priorizar por evento mais próximo (Abertura de
// Turma > Aula Inaugural > lembrete de quem já confirmou), e distribuir
// o número de contatos que temos por dia entre as filiais que estamos
// trabalhando". Correção no MEIO da sessão: cota fixa por filial "limita
// demais" — em vez disso, a cota é calculada proporcionalmente à
// contagem de leads FRIOS de cada filial (quem tem mais trabalho
// acumulado recebe mais cota), sempre editável na hora do disparo
// manual; um futuro disparo por cronjob usaria o mesmo cálculo sem a
// etapa de ajuste manual.
//
// 3 camadas, da mais barata pra mais cara: Camada 1 (grátis — tags +
// proximidade de evento, pontuarCandidatoPrioridade()); Camada 2 (grátis
// — reaproveita resumo_ia já existente se ainda "fresco", pula quem não
// precisa de leitura nova); Camada 3 (custa IA — lê a conversa de
// verdade via priorizar-convite-ia, registrando o resumo sozinho, só pra
// quem a Camada 2 não resolveu). Quem a Camada 3 excluir é REPOSTO
// automaticamente por quem está na fila de reserva (RESERVA_PRIORIDADE),
// reanalisado em LOTE (nunca 1 por 1) — ver
// analisarGrupoComIaPrioridade()/analisarLoteComIaPrioridade().
//
// Reaproveita 100% o envio real de "Convidar (API)"
// (confirmarEnviarConviteApiLote()) — a fila é organizada por MOTIVO
// (bucket: Abertura de Turma/Aula Inaugural/Lembrete), agregando TODAS
// as filiais que precisam do mesmo motivo hoje num único grupo — 1 só
// template/"Analisar com IA"/"Enviar" pra todo mundo daquele motivo
// (pedido do usuário, 2026-10-08: "não é necessário criar três modelos,
// três telas, três botões... já pressupõe que será tudo igual"). Cada
// candidato carrega seu PRÓPRIO evento/filial, então o envio continua
// resolvendo nome do evento/data corretos por lead mesmo vindo de
// filiais/datas diferentes dentro do mesmo motivo.
// ==========================================================
let convitePrioridadeConfig = [];
let convitePrioridadeBuckets = [];

const LABELS_BUCKET_PRIORIDADE = {
    abertura: 'Convidar pra Abertura de Turma',
    aula_inaugural: 'Convidar pra Aula Inaugural',
    lembrete: 'Lembrete — já confirmou presença',
};

function abrirConvitePrioridadeInteligente() {
    const filiais = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []);
    const listaEl = document.getElementById('prioridadeFiliaisLista');
    if (listaEl) {
        // Default: filiais com Módulo 2 (Máquina/SDR) contratado — é a
        // melhor proxy já existente de "filiais que estamos trabalhando"
        // (ver calcularValorFixoModulo2()/modulo2_contratado).
        listaEl.innerHTML = filiais.map(f => `
            <label style="display:flex; align-items:center; gap:6px; font-size:12px; padding:3px 0;">
                <input type="checkbox" class="prioridade-filial-check" value="${escapeHTML(f.nome)}" ${f.modulo2_contratado !== false ? 'checked' : ''}>
                ${escapeHTML(f.nome)}
            </label>
        `).join('') || '<p style="font-size:12px; color:var(--text-muted);">Nenhuma filial cadastrada.</p>';
    }
    document.getElementById('prioridadeCotaResultado').innerHTML = '';
    document.getElementById('prioridadeEtapaConfig').style.display = 'block';
    document.getElementById('prioridadeEtapaFila').style.display = 'none';
    document.getElementById('modalConvitePrioridade').classList.add('open');
    document.getElementById('overlayModalConvitePrioridade').classList.add('active');
}

function fecharModalConvitePrioridade() {
    document.getElementById('modalConvitePrioridade').classList.remove('open');
    document.getElementById('overlayModalConvitePrioridade').classList.remove('active');
}

// Conta leads FRIOS (1ª coluna do funil — mesma noção já usada em
// moverParaAbordagemAposEnvio()) de cada filial marcada, e distribui o
// total diário PROPORCIONALMENTE a essa contagem. Resultado fica numa
// tabela editável linha a linha antes de montar a fila de verdade — só
// o disparo MANUAL passa por essa edição; um cronjob futuro chamaria
// este mesmo cálculo e seguiria direto pra montarFilaPrioridadeInteligente()
// sem esperar ajuste nenhum.
async function calcularCotaProporcionalPrioridade() {
    const checks = Array.from(document.querySelectorAll('.prioridade-filial-check:checked')).map(c => c.value);
    const totalInput = document.getElementById('prioridadeTotalDiario');
    const total = Math.max(1, Number(totalInput ? totalInput.value : 0) || 100);
    const colunaFria = (typeof columnsConfig !== 'undefined' && columnsConfig[0]) ? columnsConfig[0].key : 'Frios';

    const resultadoEl = document.getElementById('prioridadeCotaResultado');
    if (!resultadoEl) return;
    if (checks.length === 0) { resultadoEl.innerHTML = '<p style="font-size:12px; color:#b91c1c;">Marque pelo menos 1 filial.</p>'; return; }
    resultadoEl.innerHTML = '<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Contando leads frios de cada filial...</p>';

    const contagens = await Promise.all(checks.map(async f => {
        const { count } = await window.supabaseClient.from(NOME_TABELA).select('*', { count: 'exact', head: true }).eq('filial', f).eq('funil_agencia', colunaFria);
        return { filial: f, frios: count || 0 };
    }));
    const somaFrios = contagens.reduce((s, c) => s + c.frios, 0) || 1;
    convitePrioridadeConfig = contagens.map(c => ({ ...c, cota: c.frios > 0 ? Math.max(1, Math.round(total * c.frios / somaFrios)) : 0 }));

    resultadoEl.innerHTML = `
        <table class="tabela-relatorio" style="max-width:100%;">
            <thead><tr><th>Filial</th><th>Leads Frios</th><th>Cota hoje</th></tr></thead>
            <tbody>
                ${convitePrioridadeConfig.map((c, i) => `
                    <tr>
                        <td>${escapeHTML(c.filial)}</td>
                        <td>${c.frios}</td>
                        <td><input type="number" min="0" value="${c.cota}" style="width:70px; padding:4px;" onchange="convitePrioridadeConfig[${i}].cota = Math.max(0, Number(this.value)||0)"></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <p style="font-size:11px; color:var(--text-muted); margin-top:6px;">Calculado proporcionalmente aos leads frios de cada filial — edite qualquer valor antes de montar a fila.</p>
        <button class="btn-primary" style="margin-top:10px;" onclick="montarFilaPrioridadeInteligente()"><i class="fa-solid fa-list-check"></i> Montar fila de hoje</button>
    `;
}

// Camada 1 de pontuação (grátis): quanto mais perto o evento, mais
// pontos (até +300), somado ao sinal de engajamento que já existe em
// tags (Lead Forte/Jornada/já pediu informação sobre um convite).
function pontuarCandidatoPrioridade(tags, diasAteEvento) {
    let pontos = Math.max(0, 60 - diasAteEvento) * 5;
    if (tags.includes('Lead Forte 1')) pontos += 150;
    else if (tags.includes('Lead Forte 2')) pontos += 90;
    else if (tags.includes('Lead Forte 3')) pontos += 40;
    if (tags.includes('Jornada: Engajado')) pontos += 60;
    if (tags.includes('Convite: Pediu Informação')) pontos += 80;
    return pontos;
}

// Pedido do usuário (2026-10-08): "ele deve excluir alguém quando der
// incompatibilidade [a IA], e deve puxar o próximo da fila... imagino
// que já deva ter uma fila em segundo plano de mais umas 10 ou 15
// pessoas". Cada grupo busca sempre `limite + RESERVA_PRIORIDADE`
// candidatos (mesma query, sem custo extra nenhum — já estava trazendo a
// base inteira da filial) e devolve os excedentes como `reserva`, pronta
// pra REPOR quem a Camada 3 (IA) excluir depois — ver
// analisarGrupoComIaPrioridade().
const RESERVA_PRIORIDADE = 15;

// Monta 1 grupo "ainda não inscrito no evento X" pra 1 filial — busca
// quem JÁ tem qualquer vínculo em evento_leads (nunca convidar de novo,
// mesmo quem já recusou — isso já é coberto pelo filtro inteligente, mas
// não faz sentido convidar de novo nem quem só está "pendente"), aplica
// pontuação + filtro inteligente, corta pela cota restante da filial.
async function montarGrupoNaoInscritoPrioridade(filial, bucket, evento, limite, excluir30Dias) {
    const diasAte = Math.max(0, Math.round((new Date(evento.data) - new Date()) / 86400000));

    const { data: vinculados } = await window.supabaseClient.from('evento_leads').select('pessoaIdentificador').eq('evento_id', evento.id);
    const setVinculados = new Set((vinculados || []).map(r => String(r.pessoaIdentificador)));

    const brutos = [];
    let de = 0;
    while (true) {
        const { data } = await window.supabaseClient.from(NOME_TABELA)
            .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero, tags')
            .eq('filial', filial).is('lixeira_em', null)
            .not('pessoaTelefoneNumero', 'is', null)
            .order('pessoaIdentificador', { ascending: true })
            .range(de, de + 999);
        if (!data || data.length === 0) break;
        brutos.push(...data);
        if (data.length < 1000) break;
        de += 1000;
    }

    const pool = brutos
        .filter(l => !setVinculados.has(String(l.pessoaIdentificador)))
        .filter(l => l.pessoaTelefoneDDD && l.pessoaTelefoneNumero && !numeroPareceFixo(l.pessoaTelefoneDDD, l.pessoaTelefoneNumero))
        .map(l => {
            const tags = parseTags(l.tags).map(t => String(t).trim());
            return { pessoaIdentificador: l.pessoaIdentificador, nome: l.pessoaNome, score: pontuarCandidatoPrioridade(tags, diasAte) };
        });

    const { validos, excluidos } = await filtrarExclusaoInteligenteWpp(pool.map(p => p.pessoaIdentificador), { excluir30Dias });
    const setValidos = new Set(validos.map(String));
    // Cada candidato carrega sua PRÓPRIA filial/evento (não só o grupo) —
    // necessário pra agregar por MOTIVO (bucket) entre várias filiais ao
    // mesmo tempo, já que cada uma tem seu próprio evento/data (ver
    // montarFilaPrioridadeInteligente()). Corta em `limite +
    // RESERVA_PRIORIDADE` — os primeiros `limite` viram candidatos reais,
    // o excedente vira `reserva` (fila de reposição pra Camada 3/IA).
    const comInfo = pool.filter(p => setValidos.has(String(p.pessoaIdentificador))).sort((a, b) => b.score - a.score)
        .slice(0, limite + RESERVA_PRIORIDADE)
        .map(c => ({ ...c, filial, eventoId: evento.id, eventoNome: evento.nome, eventoData: evento.data }));
    const final = comInfo.slice(0, limite);
    const reserva = comInfo.slice(limite);

    return { filial, bucket, eventoId: evento.id, eventoNome: evento.nome, eventoData: evento.data, candidatos: final, reserva, excluidos };
}

// Monta o grupo "lembrete" — quem já confirmou presença num evento
// próximo (qualquer tipo) da filial, pra reforçar endereço/dúvidas antes
// do evento. Só olha o evento MAIS PRÓXIMO com confirmados (simplificação
// deliberada — se a filial tiver 2+ eventos próximos com gente
// confirmada ao mesmo tempo, só o mais próximo entra nesta rodada).
async function montarGrupoLembretePrioridade(filial, eventosProximos, limite, excluir30Dias) {
    if (eventosProximos.length === 0) return { filial, bucket: 'lembrete', eventoId: null, eventoNome: null, eventoData: null, candidatos: [], reserva: [], excluidos: [] };
    const eventoIds = eventosProximos.map(e => e.id);

    const { data: confirmados } = await window.supabaseClient.from('evento_leads')
        .select('pessoaIdentificador, evento_id').in('evento_id', eventoIds).eq('resposta_convite', 'confirmado');
    if (!confirmados || confirmados.length === 0) return { filial, bucket: 'lembrete', eventoId: null, eventoNome: null, eventoData: null, candidatos: [], reserva: [], excluidos: [] };

    const eventoAlvoId = eventoIds[0]; // eventosProximos já vem ordenado por data asc
    const idsCandidatos = [...new Set(confirmados.filter(c => c.evento_id === eventoAlvoId).map(c => String(c.pessoaIdentificador)))];
    if (idsCandidatos.length === 0) return { filial, bucket: 'lembrete', eventoId: null, eventoNome: null, eventoData: null, candidatos: [], reserva: [], excluidos: [] };

    const { data: leadsInfo } = await window.supabaseClient.from(NOME_TABELA).select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero').in('pessoaIdentificador', idsCandidatos);
    const mapaLeads = new Map((leadsInfo || []).map(l => [String(l.pessoaIdentificador), l]));

    const pool = idsCandidatos
        .map(id => mapaLeads.get(id))
        .filter(l => l && l.pessoaTelefoneDDD && l.pessoaTelefoneNumero && !numeroPareceFixo(l.pessoaTelefoneDDD, l.pessoaTelefoneNumero))
        .map(l => ({ pessoaIdentificador: l.pessoaIdentificador, nome: l.pessoaNome, score: 0 }));

    const { validos, excluidos } = await filtrarExclusaoInteligenteWpp(pool.map(p => p.pessoaIdentificador), { excluir30Dias });
    const setValidos = new Set(validos.map(String));
    const eventoInfo = eventosProximos.find(e => e.id === eventoAlvoId);
    const comInfo = pool.filter(p => setValidos.has(String(p.pessoaIdentificador))).slice(0, limite + RESERVA_PRIORIDADE)
        .map(c => ({ ...c, filial, eventoId: eventoAlvoId, eventoNome: eventoInfo ? eventoInfo.nome : null, eventoData: eventoInfo ? eventoInfo.data : null }));
    const final = comInfo.slice(0, limite);
    const reserva = comInfo.slice(limite);

    return { filial, bucket: 'lembrete', eventoId: eventoAlvoId, eventoNome: eventoInfo ? eventoInfo.nome : null, eventoData: eventoInfo ? eventoInfo.data : null, candidatos: final, reserva, excluidos };
}

// Ordem fixa dos motivos (buckets), do mais urgente pro menos.
const ORDEM_BUCKETS_PRIORIDADE = ['abertura', 'aula_inaugural', 'lembrete'];

// Template padrão por motivo — pedido do usuário (2026-10-08): "o
// disparo inteligente também deveria ter visto que temos abertura de
// turma em 3 unidades hoje... e já propor envio de convite para a
// abertura de turma", em vez de sempre abrir no 1º template da lista
// (genérico demais) e exigir escolher manualmente toda vez. "abertura"/
// "aula_inaugural" são convite pra um evento futuro -> "Convite para
// evento" (convite_palestra) encaixa bem; "lembrete" não tem um
// template dedicado aprovado ainda, cai no 1º automatizável disponível.
function templatePadraoParaBucket(bucket) {
    if (bucket === 'abertura' || bucket === 'aula_inaugural') {
        const idx = TEMPLATES_WHATSAPP.findIndex(t => t.nome === 'convite_palestra' && templatePrioridadeEAutomatizavel(t));
        if (idx >= 0) return idx;
    }
    const idxSeguro = TEMPLATES_WHATSAPP.findIndex(t => templatePrioridadeEAutomatizavel(t));
    return idxSeguro >= 0 ? idxSeguro : 0;
}

// Monta a fila completa — pra CADA filial configurada, aloca sua cota
// NESTA ORDEM: Abertura de Turma > Aula Inaugural > Lembrete (a cota só
// "desce" pro próximo balde se sobrar depois do anterior). Pedido do
// usuário (2026-10-08): "não é necessário criar três modelos, três
// telas, três botões... o disparo inteligente já pressupõe que será
// tudo igual para todos os [leads do dia]" — em vez de 1 card por
// (filial × motivo), as filiais são AGREGADAS por MOTIVO (bucket): 1 só
// template/"Analisar com IA"/"Enviar" pra TODAS as filiais que
// precisarem do MESMO tipo de convite hoje (ex: 3 filiais com Abertura
// de Turma viram 1 card só, "Convidar pra Abertura de Turma", com todos
// os 240 leads juntos). Cada candidato carrega sua PRÓPRIA filial/evento
// (ver montarGrupoNaoInscritoPrioridade()/montarGrupoLembretePrioridade()),
// então o envio continua resolvendo nome do evento/data corretos por
// lead, mesmo vindo de filiais/datas diferentes dentro do mesmo motivo.
async function montarFilaPrioridadeInteligente() {
    const hojeISO = new Date().toISOString().slice(0, 10);
    const checkExcluir30Dias = document.getElementById('prioridadeExcluir30DiasCheck');
    const excluir30Dias = !checkExcluir30Dias || checkExcluir30Dias.checked;
    const candidatosPorBucket = { abertura: [], aula_inaugural: [], lembrete: [] };
    const excluidosPorBucket = { abertura: [], aula_inaugural: [], lembrete: [] };
    const reservaPorBucket = { abertura: [], aula_inaugural: [], lembrete: [] };

    for (const cfg of convitePrioridadeConfig) {
        if (!cfg.cota || cfg.cota <= 0) continue;
        let cotaRestante = cfg.cota;

        const { data: eventosFilial } = await window.supabaseClient
            .from('eventos')
            .select('id, nome, tipo, data')
            .eq('filial', cfg.filial)
            .eq('ativo', true)
            .gte('data', hojeISO)
            .order('data', { ascending: true });
        const lista = eventosFilial || [];

        const eventoAbertura = lista.find(e => e.tipo === 'Abertura de Turma');
        const eventoAula = lista.find(e => e.tipo === 'Aula Inaugural');
        const eventosProximos10Dias = lista.filter(e => Math.round((new Date(e.data) - new Date(hojeISO)) / 86400000) <= 10);

        if (cotaRestante > 0 && eventoAbertura) {
            const g = await montarGrupoNaoInscritoPrioridade(cfg.filial, 'abertura', eventoAbertura, cotaRestante, excluir30Dias);
            if (g.candidatos.length > 0) {
                candidatosPorBucket.abertura.push(...g.candidatos);
                excluidosPorBucket.abertura.push(...g.excluidos);
                reservaPorBucket.abertura.push(...(g.reserva || []));
                cotaRestante -= g.candidatos.length;
            }
        }
        if (cotaRestante > 0 && eventoAula) {
            const g = await montarGrupoNaoInscritoPrioridade(cfg.filial, 'aula_inaugural', eventoAula, cotaRestante, excluir30Dias);
            if (g.candidatos.length > 0) {
                candidatosPorBucket.aula_inaugural.push(...g.candidatos);
                excluidosPorBucket.aula_inaugural.push(...g.excluidos);
                reservaPorBucket.aula_inaugural.push(...(g.reserva || []));
                cotaRestante -= g.candidatos.length;
            }
        }
        if (cotaRestante > 0) {
            const g = await montarGrupoLembretePrioridade(cfg.filial, eventosProximos10Dias, cotaRestante, excluir30Dias);
            if (g.candidatos.length > 0) {
                candidatosPorBucket.lembrete.push(...g.candidatos);
                excluidosPorBucket.lembrete.push(...g.excluidos);
                reservaPorBucket.lembrete.push(...(g.reserva || []));
                cotaRestante -= g.candidatos.length;
            }
        }
    }

    convitePrioridadeBuckets = ORDEM_BUCKETS_PRIORIDADE
        .filter(bucket => candidatosPorBucket[bucket].length > 0)
        .map(bucket => ({
            bucket,
            candidatos: candidatosPorBucket[bucket],
            reserva: reservaPorBucket[bucket],
            excluidos: excluidosPorBucket[bucket],
            templateIndice: templatePadraoParaBucket(bucket),
            analisadoIa: false,
            excluidosIa: [],
        }));
    renderizarFilaPrioridadeInteligente();
}

// Bug real, confirmado em produção (2026-10-08): "Disparo Inteligente do
// Dia" não tem NENHUM passo de preenchimento manual (diferente do modal
// normal "Convidar API", que mostra um <input> por variável sem fonte
// automática) — um template com campo `chave:null` SEM `papel`
// reconhecido (ex: "contato_ulisses", que fala de um evento PASSADO via
// Ulisses, não do evento futuro deste grupo) sempre resolvia pra string
// vazia aqui, e a própria Meta recusa o envio inteiro nesse caso
// ("required parameter is missing") — confirmado: falhou pra TODOS os
// destinatários de um disparo de teste. Corrigido restringindo os
// templates OFERECIDOS nesta tela a só os totalmente automatizáveis
// (toda variável com `chave` reconhecida OU `papel` ligado ao evento do
// grupo) — nunca deixa escolher um que nunca teria como funcionar aqui.
function templatePrioridadeEAutomatizavel(tpl) {
    return tpl.variaveis.every(v => v.chave !== null || v.papel);
}

// Última linha de defesa (além do filtro acima) — confere se os params
// dos campos MANUAIS (chave:null) realmente saíram preenchidos antes de
// disparar de verdade. Confere TODAS as linhas (não só a 1ª) — um bucket
// agora agrega filiais com eventos DIFERENTES entre si (mesmo motivo,
// datas distintas), então um evento sem nome/data numa filial específica
// não é pego só olhando o 1º candidato do lote. Nunca deveria disparar
// com o filtro de template já em vigor, mas é barato conferir antes de
// gastar uma chamada de API que a Meta rejeitaria de qualquer forma.
function paramsManuaisPrioridadeOk(tpl, linhas) {
    return linhas.every(l => tpl.variaveis.every((v, i) => v.chave !== null || (l.params[i] && String(l.params[i]).trim() !== '')));
}

// Resumo "Filial (N lead(s)) · evento (data)" por filial dentro de um
// bucket já agregado — pra deixar claro, de relance, quais unidades e
// eventos foram juntados sob o mesmo motivo (ex: "Jardim América —
// Novas turmas... (08/10) · 209 · Setor Oeste — Novas turmas... (08/10)
// · 22"), sem precisar abrir "Ver quem" pra descobrir.
function resumoFiliaisBucketPrioridade(bucket) {
    const porFilial = new Map();
    bucket.candidatos.forEach(c => {
        if (!porFilial.has(c.filial)) porFilial.set(c.filial, { eventoNome: c.eventoNome, eventoData: c.eventoData, qtd: 0 });
        porFilial.get(c.filial).qtd++;
    });
    return [...porFilial.entries()].map(([filial, info]) => {
        const dataFmt = info.eventoData && typeof formatarDataCurtaEvento === 'function' ? formatarDataCurtaEvento(info.eventoData) : info.eventoData;
        const sufixoEvento = info.eventoNome ? ` — ${escapeHTML(info.eventoNome)}${dataFmt ? ` (${escapeHTML(dataFmt)})` : ''}` : '';
        return `${escapeHTML(filial)}${sufixoEvento} · ${info.qtd}`;
    }).join(' &nbsp;·&nbsp; ');
}

function renderizarFilaPrioridadeInteligente() {
    document.getElementById('prioridadeEtapaConfig').style.display = 'none';
    const etapaFila = document.getElementById('prioridadeEtapaFila');
    etapaFila.style.display = 'block';

    if (convitePrioridadeBuckets.length === 0) {
        etapaFila.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhum candidato encontrado pra hoje (cota zerada, ou sem evento futuro cadastrado nas filiais escolhidas).</p><button class="btn-secondary" onclick="abrirConvitePrioridadeInteligente()">Voltar</button>';
        return;
    }

    const totalGeral = convitePrioridadeBuckets.reduce((s, b) => s + b.candidatos.length, 0);

    etapaFila.innerHTML = `
        <button class="btn-secondary" style="margin-bottom:10px;" onclick="abrirConvitePrioridadeInteligente()"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
        ${totalGeral > 0 ? `<button class="btn-primary" style="width:100%; margin-bottom:14px;" onclick="enviarTodosGruposPrioridadeInteligente()"><i class="fa-solid fa-paper-plane"></i> Enviar pra todos os motivos de uma vez (${totalGeral})</button>` : ''}
        ${convitePrioridadeBuckets.map((b, i) => `
            <div style="border:1px solid var(--border-color); border-radius:8px; padding:12px; margin-bottom:12px;">
                <div style="font-weight:700; font-size:13px; margin-bottom:4px;">${escapeHTML(LABELS_BUCKET_PRIORIDADE[b.bucket])}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px;">${resumoFiliaisBucketPrioridade(b)} &nbsp;·&nbsp; <strong>${b.candidatos.length} lead(s) no total</strong>${b.excluidos && b.excluidos.length ? ` · ${b.excluidos.length} excluído(s) automaticamente` : ''}</div>
                <select id="prioridadeTemplate-${i}" style="width:100%; padding:6px; margin-bottom:8px; box-sizing:border-box;" onchange="convitePrioridadeBuckets[${i}].templateIndice = Number(this.value); atualizarPreviewCardPrioridade(${i});">
                    ${TEMPLATES_WHATSAPP.map((t, ti) => templatePrioridadeEAutomatizavel(t) ? `<option value="${ti}" ${ti === b.templateIndice ? 'selected' : ''}>${escapeHTML(t.label)}</option>` : '').join('')}
                </select>
                <div id="prioridadePreview-${i}"></div>
                <details style="margin-bottom:8px;"><summary style="font-size:11px; cursor:pointer; color:var(--text-muted);">Ver quem (${b.candidatos.length})</summary>
                    <div style="max-height:140px; overflow-y:auto; font-size:11px; margin-top:4px;">${b.candidatos.map(c => `${escapeHTML(c.nome || 'Sem nome')} <span style="color:var(--text-muted);">— ${escapeHTML(c.filial)}</span>`).join('<br>')}</div>
                </details>
                ${b.excluidosIa && b.excluidosIa.length > 0 ? `<p style="font-size:11px; color:var(--text-muted); margin-bottom:8px;"><i class="fa-solid fa-robot"></i> IA excluiu ${b.excluidosIa.length} desta campanha (sem tag permanente)${b.totalRepostosIa ? ` — ${b.totalRepostosIa} repost${b.totalRepostosIa === 1 ? 'o' : 'os'} automaticamente da reserva` : ''}${b.reserva && b.reserva.length > 0 ? `, ${b.reserva.length} ainda na reserva` : b.reserva ? ', reserva esgotada' : ''}: <details style="margin-top:2px;"><summary style="cursor:pointer;">Ver quem e por quê</summary>${b.excluidosIa.map(e => `${escapeHTML(e.nome || 'Sem nome')} — <em>${escapeHTML(e.motivo || '')}</em>`).join('<br>')}</details></p>` : ''}
                <div style="display:flex; gap:8px;">
                    ${!b.analisadoIa ? `<button id="prioridadeBtnIa-${i}" class="btn-secondary" style="font-size:12px;" onclick="analisarGrupoComIaPrioridade(${i})"><i class="fa-solid fa-wand-magic-sparkles"></i> Analisar com IA</button>` : `<span style="font-size:11px; color:var(--text-muted); align-self:center;"><i class="fa-solid fa-circle-check"></i> Já analisado por IA</span>`}
                    <button class="btn-secondary" style="font-size:12px; flex:1;" onclick="enviarGrupoPrioridadeInteligente(${i})"><i class="fa-solid fa-paper-plane"></i> Enviar só esta (${g.candidatos.length})</button>
                </div>
            </div>
        `).join('')}
    `;

    // Preview de cada card é async (pode precisar buscar o lead de
    // exemplo no banco) — dispara todas sem esperar, cada uma escreve no
    // seu próprio <div>, sem travar a renderização da lista inteira.
    convitePrioridadeBuckets.forEach((b, i) => { if (b.candidatos.length > 0) atualizarPreviewCardPrioridade(i); });
}

// Mostra um MODELO REAL de como a mensagem vai chegar — pedido do
// usuário depois de ver a tela sem nenhuma prévia do texto, só o nome do
// template ("seria bom mostrar um modelo da mensagem, para garantir").
// Usa o 1º candidato do bucket como exemplo (nome/filial/evento PRÓPRIOS
// dele, já que um bucket agrega filiais diferentes) e reaproveita a
// MESMA resolução de variáveis automáticas já usada no envio de verdade
// (preencherValorAutomatico()/valorAutomaticoCampoManualConviteApi()) —
// nunca mostra um texto fictício, é exatamente o que vai sair.
async function atualizarPreviewCardPrioridade(indice) {
    const b = convitePrioridadeBuckets[indice];
    const previewEl = document.getElementById(`prioridadePreview-${indice}`);
    if (!b || !previewEl) return;
    const tpl = TEMPLATES_WHATSAPP[b.templateIndice];
    if (!tpl || b.candidatos.length === 0) { previewEl.innerHTML = ''; return; }

    previewEl.innerHTML = '<p style="font-size:11px; color:var(--text-muted); margin-bottom:8px;"><i class="fa-solid fa-spinner fa-spin"></i> Montando modelo da mensagem...</p>';

    const exemplo = b.candidatos[0];
    if (!leadsAtuais.some(l => String(l.pessoaIdentificador) === String(exemplo.pessoaIdentificador))) {
        const { data } = await window.supabaseClient.from(NOME_TABELA).select('*').eq('pessoaIdentificador', exemplo.pessoaIdentificador).maybeSingle();
        if (data) leadsAtuais = [...leadsAtuais, data];
    }

    // Confere se o bucket/template ainda é o mesmo (o usuário pode ter
    // trocado de template de novo enquanto esta busca rodava).
    const bAtual = convitePrioridadeBuckets[indice];
    if (!bAtual || bAtual.templateIndice !== b.templateIndice) return;

    const eventoInfoParaManual = exemplo.eventoId ? { id: exemplo.eventoId, nome: exemplo.eventoNome, data: exemplo.eventoData } : null;
    const params = tpl.variaveis.map(v => v.chave === null
        ? valorAutomaticoCampoManualConviteApi(v.papel, eventoInfoParaManual)
        : (preencherValorAutomatico(v.chave, exemplo.pessoaIdentificador) || ''));
    const texto = montarPreviewTemplate(tpl, params);

    if (!document.getElementById(`prioridadePreview-${indice}`)) return; // card pode ter sido removido/re-renderizado nesse meio tempo
    previewEl.innerHTML = `
        <div style="background:#eef7ee; border:1px solid var(--border-color); border-radius:8px; padding:8px 10px; font-size:12px; white-space:pre-wrap; margin-bottom:8px;">
            <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px; font-weight:600;"><i class="fa-solid fa-eye"></i> Modelo real da mensagem (exemplo: ${escapeHTML(exemplo.nome || 'lead')} — ${escapeHTML(exemplo.filial || '')}):</div>
            ${escapeHTML(texto).replace(/\n/g, '<br>')}
        </div>
    `;
}

// Camada 2 (grátis — só lê o que já existe, sem IA): pula quem já tem
// resumo_ia mais NOVO que a última mensagem da conversa (nada mudou desde
// a última leitura). Camada 3 (ler de verdade, custa IA): só pros
// restantes, via priorizar-convite-ia — grava o resumo sozinho (já que
// estamos pagando pela leitura) e, quando acha sinal claro de recusa/
// opt-out, tira o lead SÓ desta campanha (decisão confirmada com o
// usuário: nunca aplica tag permanente sozinha).
//
// Roda Camada 2+3 sobre UM LOTE específico de candidatos (não o bucket
// inteiro) — devolve os que a IA mandou excluir desse lote (ids), e
// ACUMULA o motivo em `acumuladorExcluidosIa` (array passado por
// referência). Extraída pra ser reaproveitada tanto na 1ª leitura quanto
// nas rodadas de REPOSIÇÃO (ver analisarGrupoComIaPrioridade() abaixo).
async function analisarLoteComIaPrioridade(lote, acumuladorExcluidosIa) {
    if (lote.length === 0) return [];
    const ids = lote.map(c => String(c.pessoaIdentificador));
    const [{ data: leadsInfo }, { data: conversas }] = await Promise.all([
        window.supabaseClient.from(NOME_TABELA).select('pessoaIdentificador, resumo_ia_atualizado_em').in('pessoaIdentificador', ids),
        window.supabaseClient.from('vw_wpp_conversas').select('"pessoaIdentificador", ultima_mensagem_em').in('pessoaIdentificador', ids),
    ]);
    const mapaResumo = new Map((leadsInfo || []).map(l => [String(l.pessoaIdentificador), l.resumo_ia_atualizado_em]));
    const mapaConversa = new Map((conversas || []).map(c => [String(c.pessoaIdentificador), c.ultima_mensagem_em]));

    const precisamLeitura = lote.filter(c => {
        const ultimaMsg = mapaConversa.get(String(c.pessoaIdentificador));
        if (!ultimaMsg) return false; // sem conversa nenhuma — nada pra ler, não custa nada
        const resumoEm = mapaResumo.get(String(c.pessoaIdentificador));
        return !resumoEm || new Date(resumoEm) < new Date(ultimaMsg);
    });
    if (precisamLeitura.length === 0) return [];

    const { data, error } = await window.supabaseClient.functions.invoke('priorizar-convite-ia', {
        body: { candidatos: precisamLeitura.map(c => ({ pessoaIdentificador: c.pessoaIdentificador, nome: c.nome, eventoNome: c.eventoNome })) },
    });
    if (error || !data || data.ok === false) {
        throw new Error((data && data.erro) || (error && error.message) || 'desconhecido');
    }

    const idsExcluidos = [];
    (data.resultados || []).forEach(r => {
        if (r.avaliado && r.excluirDestaCampanha) {
            idsExcluidos.push(String(r.pessoaIdentificador));
            const candidato = lote.find(c => String(c.pessoaIdentificador) === String(r.pessoaIdentificador));
            acumuladorExcluidosIa.push({ nome: candidato ? candidato.nome : r.pessoaIdentificador, motivo: r.motivo });
        }
    });
    return idsExcluidos;
}

// Pedido do usuário (2026-10-08): "ele deve excluir alguém quando der
// incompatibilidade, e deve puxar o próximo da fila, e rodar novamente a
// leitura com IA para saber se ele serve... rodar a leitura com as 10 ou
// 15 (se rodar de uma em uma perdemos tempo)". Loop: analisa o bucket
// inteiro; pra cada exclusão, puxa UMA REPOSIÇÃO da `reserva` (já
// buscada/pontuada/filtrada junto com os candidatos originais — ver
// RESERVA_PRIORIDADE), e roda a Camada 2+3 de novo só NOS RECÉM-PUXADOS
// (nunca reanalisa quem já passou), em LOTE (todos os repostos da rodada
// de uma vez, não um por um). Repete até não sobrar exclusão nenhuma
// nesta rodada, ou a reserva acabar, com um teto de segurança de rodadas
// pra nunca rodar pra sempre.
const MAX_RODADAS_REPOSICAO_IA = 6;
async function analisarGrupoComIaPrioridade(indice) {
    const b = convitePrioridadeBuckets[indice];
    if (!b || b.candidatos.length === 0) return;

    const btn = document.getElementById(`prioridadeBtnIa-${indice}`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Lendo conversas...'; }

    let candidatosAtuais = b.candidatos.slice();
    let reserva = (b.reserva || []).slice();
    const excluidosIaTotal = (b.excluidosIa || []).slice();
    let totalRepostos = 0;

    try {
        let lote = candidatosAtuais;
        for (let rodada = 0; rodada < MAX_RODADAS_REPOSICAO_IA; rodada++) {
            const idsExcluidos = await analisarLoteComIaPrioridade(lote, excluidosIaTotal);
            if (idsExcluidos.length === 0) break; // ninguém excluído nesta rodada — terminou
            const setExcl = new Set(idsExcluidos);
            candidatosAtuais = candidatosAtuais.filter(c => !setExcl.has(String(c.pessoaIdentificador)));
            if (reserva.length === 0) break; // sem mais reserva pra repor

            const reposicao = reserva.slice(0, idsExcluidos.length);
            reserva = reserva.slice(idsExcluidos.length);
            candidatosAtuais = candidatosAtuais.concat(reposicao);
            totalRepostos += reposicao.length;
            if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Repondo ${reposicao.length} da reserva e reanalisando...`;
            lote = reposicao; // próxima rodada só analisa quem é NOVO
        }
    } catch (e) {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Erro — tentar de novo'; }
        alert('Erro ao analisar com IA: ' + e.message);
        return;
    }

    b.candidatos = candidatosAtuais;
    b.reserva = reserva;
    b.excluidosIa = excluidosIaTotal;
    b.totalRepostosIa = (b.totalRepostosIa || 0) + totalRepostos;
    b.analisadoIa = true;
    renderizarFilaPrioridadeInteligente();
}

// Reaproveita 100% o pipeline de envio já existente de "Convidar (API)"
// (confirmarEnviarConviteApiLote()) — só popula as mesmas variáveis
// globais que aquele fluxo já espera (conviteApiPreviaAtual/
// conviteApiEventoAtual) e abre o MESMO modal de revisão, já na etapa
// "revisar antes de enviar" — nunca duplica a lógica de envio/relatório/
// log/mover-pra-Abordagem. Envia pra TODAS as filiais deste MOTIVO de
// uma vez (não é mais 1 filial por vez) — cada candidato já carrega seu
// PRÓPRIO evento (ver montarGrupoNaoInscritoPrioridade()), então
// `conviteApiEventoAtual` fica `null` (sem evento único pro lote
// inteiro) e enviarTemplateApiLote() vincula evento_leads por LINHA. Pra
// mandar TODOS os motivos de uma vez só, ver
// enviarTodosGruposPrioridadeInteligente() abaixo.
async function enviarGrupoPrioridadeInteligente(indice) {
    const b = convitePrioridadeBuckets[indice];
    const tpl = TEMPLATES_WHATSAPP[b.templateIndice];
    if (!tpl || b.candidatos.length === 0) return;

    const idsFaltando = b.candidatos.map(c => String(c.pessoaIdentificador)).filter(id => !leadsAtuais.some(l => String(l.pessoaIdentificador) === id));
    if (idsFaltando.length > 0) {
        const { data } = await window.supabaseClient.from(NOME_TABELA).select('*').in('pessoaIdentificador', idsFaltando);
        if (data && data.length > 0) leadsAtuais = [...leadsAtuais, ...data];
    }

    // Campos "manuais" do template (chave:null, ex: evento/data) são
    // resolvidos a partir do evento de CADA candidato (não 1 só pro
    // bucket inteiro — filiais diferentes no mesmo motivo podem ter
    // datas diferentes).
    const todasLinhas = b.candidatos.map(c => {
        const eventoInfoParaManual = c.eventoId ? { id: c.eventoId, nome: c.eventoNome, data: c.eventoData } : null;
        return {
            pessoaIdentificador: c.pessoaIdentificador,
            nome: c.nome || 'Sem nome',
            eventoId: c.eventoId,
            eventoNome: c.eventoNome,
            params: tpl.variaveis.map(v => v.chave === null
                ? valorAutomaticoCampoManualConviteApi(v.papel, eventoInfoParaManual)
                : (preencherValorAutomatico(v.chave, c.pessoaIdentificador) || '')),
        };
    });
    // Checagem POR LEAD (não mais por grupo inteiro) — um bucket junta
    // filiais com eventos diferentes, então só o candidato específico
    // sem dado do evento é descartado, nunca a fila inteira.
    const linhas = todasLinhas.filter(l => paramsManuaisPrioridadeOk(tpl, [l]));
    const puladas = todasLinhas.length - linhas.length;
    if (linhas.length === 0) {
        alert(`Não dá pra enviar "${tpl.label}" aqui — falta um dado do evento em todos os candidatos. Escolha outro template ou confira se o evento tem nome/data cadastrados na Agenda.`);
        return;
    }

    conviteApiPreviaAtual = { templateIndice: b.templateIndice, linhas };
    conviteApiEventoAtual = null;

    fecharModalConvitePrioridade();
    document.getElementById('modalConviteLoteApi').classList.add('open');
    document.getElementById('overlayModalConviteLoteApi').classList.add('active');
    document.getElementById('conviteApiEscolha').style.display = 'none';
    document.getElementById('conviteApiResultado').style.display = 'none';
    const previaEl = document.getElementById('conviteApiPrevia');
    previaEl.style.display = 'block';
    previaEl.innerHTML = `
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">Vai enviar <strong>"${escapeHTML(tpl.label)}"</strong> pra ${linhas.length} lead(s) de verdade, pela API (${escapeHTML(LABELS_BUCKET_PRIORIDADE[b.bucket])}: ${resumoFiliaisBucketPrioridade(b)})${puladas > 0 ? ` — ${puladas} pulado(s) por falta de dado do evento` : ''}.</p>
        <div style="background:#eef7ee; border:1px solid var(--border-color); border-radius:8px; padding:8px 10px; font-size:12px; white-space:pre-wrap; margin-bottom:8px;">
            <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px; font-weight:600;"><i class="fa-solid fa-eye"></i> Modelo real (exemplo: ${escapeHTML(linhas[0].nome)}):</div>
            ${escapeHTML(montarPreviewTemplate(tpl, linhas[0].params)).replace(/\n/g, '<br>')}
        </div>
        <div style="display:flex; gap:8px;">
            <button class="btn-secondary" onclick="fecharModalConviteLoteApi()">Cancelar</button>
            <button class="btn-primary" style="flex:1;" onclick="confirmarEnviarConviteApiLote()"><i class="fa-solid fa-paper-plane"></i> Enviar Agora (via API)</button>
        </div>
    `;
}

// Pedido do usuário: 1 clique só pra disparar pra TODOS os motivos
// (buckets) da fila de uma vez, em vez de abrir o modal de revisão 1 por
// 1. Reaproveita o MESMO enviarTemplateApiLote() usado por
// confirmarEnviarConviteApiLote() (texto aprovado, lotes pequenos,
// pausa entre lotes, evento_leads/log_atividade/mover pra Abordagem) —
// só roda uma vez por bucket, em sequência (nunca em paralelo — mesma
// cautela já documentada sobre rajada de envio disparando auditoria da
// Meta), acumulando 1 relatório final com todos os motivos juntos.
async function enviarTodosGruposPrioridadeInteligente() {
    const buckets = convitePrioridadeBuckets.filter(b => b.candidatos.length > 0 && TEMPLATES_WHATSAPP[b.templateIndice]);
    if (buckets.length === 0) return;
    const totalGeral = buckets.reduce((s, b) => s + b.candidatos.length, 0);
    if (!confirm(`Confirma o envio automático pra ${totalGeral} lead(s), de TODOS os ${buckets.length} motivo(s) acima, via API da Meta? Essa ação não pode ser desfeita.`)) return;

    const etapaFila = document.getElementById('prioridadeEtapaFila');
    etapaFila.innerHTML = '<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Enviando pra todos os motivos de uma vez — acompanhe o progresso no canto da tela, pode fechar esta janela sem interromper o envio.</p>';

    const idsFaltando = [...new Set(buckets.flatMap(b => b.candidatos.map(c => String(c.pessoaIdentificador))))]
        .filter(id => !leadsAtuais.some(l => String(l.pessoaIdentificador) === id));
    if (idsFaltando.length > 0) {
        const { data } = await window.supabaseClient.from(NOME_TABELA).select('*').in('pessoaIdentificador', idsFaltando);
        if (data && data.length > 0) leadsAtuais = [...leadsAtuais, ...data];
    }

    // Monta os params de cada bucket ANTES de enviar qualquer coisa —
    // como um bucket agora pode juntar filiais com eventos diferentes, a
    // checagem é POR LEAD (não mais por grupo inteiro): só o candidato
    // específico sem dado do evento é pulado, os outros do mesmo motivo
    // seguem normalmente (mesma rede de segurança de
    // enviarGrupoPrioridadeInteligente(), ver paramsManuaisPrioridadeOk()).
    const planoEnvio = [];
    const puladosPorMotivo = {};
    for (const b of buckets) {
        const tpl = TEMPLATES_WHATSAPP[b.templateIndice];
        const todasLinhas = b.candidatos.map(c => {
            const eventoInfoParaManual = c.eventoId ? { id: c.eventoId, nome: c.eventoNome, data: c.eventoData } : null;
            return {
                pessoaIdentificador: c.pessoaIdentificador,
                nome: c.nome || 'Sem nome',
                eventoId: c.eventoId,
                eventoNome: c.eventoNome,
                params: tpl.variaveis.map(v => v.chave === null
                    ? valorAutomaticoCampoManualConviteApi(v.papel, eventoInfoParaManual)
                    : (preencherValorAutomatico(v.chave, c.pessoaIdentificador) || '')),
            };
        });
        const linhas = todasLinhas.filter(l => paramsManuaisPrioridadeOk(tpl, [l]));
        const puladas = todasLinhas.length - linhas.length;
        if (puladas > 0) puladosPorMotivo[b.bucket] = (puladosPorMotivo[b.bucket] || 0) + puladas;
        if (linhas.length > 0) planoEnvio.push({ b, tpl, linhas });
    }

    const totalPlanejado = planoEnvio.reduce((s, p) => s + p.linhas.length, 0);
    // Pausa calculada pelo TOTAL agregado de todos os motivos juntos (não
    // por motivo individual) — senão cada bucket recalcularia sozinho
    // achando que é "o disparo inteiro" e a soma de vários motivos
    // facilmente estouraria o teto de 1h pensado pro disparo do DIA
    // inteiro (ver comentário de enviarTemplateApiLote()).
    const pausaMs = calcularPausaEnvioMassa(totalPlanejado);
    let baseAcumulada = 0;
    const relatorioPorMotivo = [];
    for (let idx = 0; idx < planoEnvio.length; idx++) {
        const { b, tpl, linhas } = planoEnvio[idx];
        const base = baseAcumulada;
        const { sucesso, falha } = await enviarTemplateApiLote(tpl, linhas, {
            pausaMs,
            onProgresso: (atualGrupo) => atualizarProgressoEnvioMassa('prioridadeTodos', { titulo: 'Disparo Inteligente do Dia', atual: base + atualGrupo, total: totalPlanejado }),
        });
        baseAcumulada += linhas.length;
        relatorioPorMotivo.push({ label: LABELS_BUCKET_PRIORIDADE[b.bucket], sucesso: sucesso.length, falha: falha.length });
        // Pausa também na TRANSIÇÃO entre motivos (senão o último envio de
        // 1 motivo e o 1º do próximo saem sem respiro nenhum entre si,
        // já que o loop interno de enviarTemplateApiLote() só pausa ENTRE
        // itens do MESMO motivo).
        if (idx < planoEnvio.length - 1) await pausarWpp(pausaMs);
    }
    if (totalPlanejado > 0) atualizarProgressoEnvioMassa('prioridadeTodos', { titulo: 'Disparo Inteligente do Dia', atual: totalPlanejado, total: totalPlanejado, concluido: true });

    etapaFila.innerHTML = `
        <p style="font-size:13px; margin-bottom:8px;"><strong>Envio concluído pra todos os motivos.</strong></p>
        <div style="border:1px solid var(--border-color); border-radius:6px; padding:8px; margin-bottom:12px;">
            ${relatorioPorMotivo.map(r => `
                <div style="display:flex; justify-content:space-between; gap:8px; padding:5px 0; font-size:12px; border-bottom:1px dashed var(--border-color);">
                    <span>${escapeHTML(r.label)}</span>
                    <span>${r.sucesso} enviado(s)${r.falha > 0 ? `, <span style="color:#991b1b;">${r.falha} falhou(aram)</span>` : ''}</span>
                </div>
            `).join('')}
            ${Object.entries(puladosPorMotivo).map(([bucket, qtd]) => `
                <div style="display:flex; justify-content:space-between; gap:8px; padding:5px 0; font-size:12px; border-bottom:1px dashed var(--border-color);">
                    <span>${escapeHTML(LABELS_BUCKET_PRIORIDADE[bucket])}</span>
                    <span style="color:#991b1b;"><i class="fa-solid fa-triangle-exclamation"></i> ${qtd} pulado(s) — faltou um dado do evento</span>
                </div>
            `).join('')}
        </div>
        <button class="btn-secondary" onclick="fecharModalConvitePrioridade()">Fechar</button>
    `;
}

// ==========================================================
// Aba unificada — lista de conversas
// ==========================================================
// Pedido do usuário (2026-09-28): "eu quero que tenha exatamente isso, um
// whatsapp unificado para todas as filiais, mas que identifique qual
// filial pertence cada lead, e que possa filtrar por filiais". Antes,
// essa aba filtrava por `filialAtual` por baixo dos panos — nem era
// unificada de verdade, só mostrava a conversa da filial selecionada no
// topo (a mesma raiz do bug da variável "filial" corrigido acima). Agora
// é SEMPRE todas as filiais por padrão, com um filtro OPCIONAL
// (`#wppFiltroFilialSelect`) pra restringir a 1 quando fizer sentido.
let wppFiltroFilial = '';

function iniciarEscutaGlobalWpp() {
    if (canalListaWpp) return;
    canalListaWpp = window.supabaseClient
        .channel('wpp-lista-global')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensagens_whatsapp' }, () => {
            const tab = document.getElementById('tab-whatsapp');
            if (tab && tab.classList.contains('active')) {
                const searchEl = document.getElementById('wppSearch');
                renderizarContatosWpp(searchEl ? searchEl.value : '');
            }
        })
        .subscribe();
}

function popularFiltroFilialWpp() {
    const select = document.getElementById('wppFiltroFilialSelect');
    if (!select || select.dataset.populado === '1') return;
    const lista = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []);
    if (lista.length === 0) return; // ainda não carregou — tenta de novo na próxima renderização
    select.innerHTML = '<option value="">Todas as filiais</option>'
        + lista.map(f => `<option value="${escapeHTML(f.nome)}">${escapeHTML(f.nome)}</option>`).join('');
    select.dataset.populado = '1';
}

// "Não lida" — client-side, por navegador (localStorage), sem tabela
// nova: última vez que ESTE navegador abriu a conversa de cada lead.
// Mensagem de ENTRADA mais nova que isso = negrito + bolinha verde,
// mesmo sinal visual do WhatsApp real. Marcada como lida ao abrir o chat
// (marcarConversaLidaWpp()).
const CHAVE_WPP_ULTIMA_LEITURA = 'crm_na_wpp_ultima_leitura';
function obterUltimasLeiturasWpp() {
    try { return JSON.parse(localStorage.getItem(CHAVE_WPP_ULTIMA_LEITURA)) || {}; } catch { return {}; }
}
function marcarConversaLidaWpp(leadId) {
    try {
        const mapa = obterUltimasLeiturasWpp();
        mapa[String(leadId)] = new Date().toISOString();
        localStorage.setItem(CHAVE_WPP_ULTIMA_LEITURA, JSON.stringify(mapa));
    } catch { /* localStorage indisponível (aba privada etc.) — só perde o indicador, nunca quebra a tela */ }
}
function conversaNaoLidaWpp(conversa) {
    if (!conversa || conversa.ultima_direcao !== 'entrada') return false;
    const ultimaLeitura = obterUltimasLeiturasWpp()[String(conversa.pessoaIdentificador)];
    return !ultimaLeitura || new Date(conversa.ultima_mensagem_em) > new Date(ultimaLeitura);
}

// Timer regressivo de 24h (pedido do usuário, 2026-09-28, depois de
// reunião com a Ediliene, Jardim América): "não podemos deixar esfriar
// para não fechar a conversa (de acordo com as regras do Meta API, eu
// posso conversar livremente se a pessoa tiver me mandando uma mensagem
// nas últimas 24h)". Só aparece quando a ÚLTIMA mensagem da conversa foi
// do LEAD (`ultima_direcao === 'entrada'`) — é exatamente aí que a janela
// de 24h está correndo; depois que respondemos, o problema muda de
// figura (é ele que precisa responder de novo), então o timer some.
// Reaproveita 100% `vw_wpp_conversas` (já consultada por
// renderizarContatosWpp()) — nenhuma coluna/tabela nova precisou existir
// só pra isso.
// Extraído do corpo de htmlTimerJanelaWpp() pra reuso em ordenar/filtrar a
// lista de conversas (item 3 do pedido do usuário, 2026-09-29) — null
// quando a janela nem está correndo (última mensagem foi NOSSA).
function horasRestantesJanelaWpp(conversa) {
    if (!conversa || conversa.ultima_direcao !== 'entrada') return null;
    const horasPassadas = (Date.now() - new Date(conversa.ultima_mensagem_em).getTime()) / 3600000;
    return 24 - horasPassadas;
}

function htmlTimerJanelaWpp(conversa) {
    if (!conversa || conversa.ultima_direcao !== 'entrada') return '';
    const restante = horasRestantesJanelaWpp(conversa);
    if (restante <= 0) {
        return `<div class="wpp-timer-janela wpp-timer-fechada" title="Janela de 24h da Meta já fechou — só um modelo aprovado consegue reabrir a conversa"><i class="fa-solid fa-lock"></i> Janela fechada</div>`;
    }
    const horas = Math.floor(restante);
    const minutos = Math.floor((restante - horas) * 60);
    const classe = restante < 4 ? 'wpp-timer-critico' : restante < 12 ? 'wpp-timer-atencao' : 'wpp-timer-ok';
    return `<div class="wpp-timer-janela ${classe}" title="Tempo restante antes da janela de 24h da Meta fechar — depois disso só um modelo aprovado reabre a conversa"><i class="fa-solid fa-clock"></i> ${horas}h${String(minutos).padStart(2, '0')} restantes</div>`;
}

// Pin/fixar e arquivar (pedido do usuário, 2026-09-30: "igual no whatsapp
// real") — colunas novas em `leads_inscricoes` (migracao_whatsapp_pin_arquivar_ocultar.sql),
// já que cada lead tem no máximo 1 conversa de WhatsApp (1:1). Fixada
// sempre sobe pro topo (ver ordenação em renderizarContatosWpp()),
// independente do modo de ordenação escolhido; arquivada some da lista
// principal por padrão (checkbox "Ver arquivadas").
function htmlContatoWpp(lead, conversa, temSugestaoIa) {
    const id = lead.pessoaIdentificador;
    const ativo = String(id) === String(wppContatoAtivoId) ? 'active' : '';
    const naoLida = conversaNaoLidaWpp(conversa);
    const fixado = !!lead.wpp_fixado;
    const arquivado = !!lead.wpp_arquivado;
    const silenciado = !!(lead.wpp_silenciado_ate && new Date(lead.wpp_silenciado_ate) > new Date());
    const preview = conversa
        ? `${conversa.ultima_direcao === 'saida' ? 'Você: ' : ''}${(conversa.ultimo_texto || '').slice(0, 40)}`
        : 'Toque para iniciar conversa';
    return `
        <div class="wpp-contact-item ${ativo} ${naoLida ? 'nao-lida' : ''}" onclick="abrirChatWpp('${id}')">
            <div class="wpp-contact-avatar"><i class="fa-solid fa-user"></i></div>
            <div class="wpp-contact-info" style="flex:1;">
                <div class="wpp-contact-name">${fixado ? '<i class="fa-solid fa-thumbtack" style="font-size:9px; color:var(--na-green-dark);" title="Fixada"></i> ' : ''}${silenciado ? '<i class="fa-solid fa-bell-slash" style="font-size:9px; color:var(--text-muted);" title="Silenciada"></i> ' : ''}${escapeHTML(lead.pessoaNome || 'Sem nome')}${temSugestaoIa ? ' <i class="fa-solid fa-wand-magic-sparkles" style="color:#1d4ed8; font-size:10px;" title="Sugestão de resposta da IA pronta pra revisar"></i>' : ''}</div>
                <div class="wpp-contact-phone">${escapeHTML(preview)}</div>
                <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                    ${lead.filial ? `<div style="font-size:9px; color:var(--text-muted);"><i class="fa-solid fa-building"></i> ${escapeHTML(lead.filial)}</div>` : ''}
                    ${htmlBadgeAtendenteWpp(lead)}
                </div>
                ${htmlTimerJanelaWpp(conversa)}
            </div>
            <div class="wpp-contact-acoes">
                <button type="button" class="wpp-pin-btn ${fixado ? 'ativo' : ''}" title="${fixado ? 'Desafixar' : 'Fixar'} conversa" onclick="event.stopPropagation(); alternarFixarConversaWpp('${id}', ${fixado})"><i class="fa-solid fa-thumbtack"></i></button>
                <button type="button" class="wpp-pin-btn ${silenciado ? 'ativo' : ''}" title="Silenciar/reativar notificações" onclick="event.stopPropagation(); abrirMenuSilenciarWpp(this, '${id}', ${silenciado})"><i class="fa-solid ${silenciado ? 'fa-bell-slash' : 'fa-bell'}"></i></button>
                <button type="button" class="wpp-archive-btn ${arquivado ? 'ativo' : ''}" title="${arquivado ? 'Desarquivar' : 'Arquivar'} conversa" onclick="event.stopPropagation(); alternarArquivarConversaWpp('${id}', ${arquivado})"><i class="fa-solid fa-box-archive"></i></button>
            </div>
            ${naoLida ? '<div class="wpp-contact-nao-lida-dot"></div>' : ''}
        </div>
    `;
}

async function alternarFixarConversaWpp(leadId, estavaFixado) {
    const novoValor = !estavaFixado;
    const { error } = await window.supabaseClient
        .from(typeof NOME_TABELA !== 'undefined' ? NOME_TABELA : 'leads_inscricoes')
        .update({ wpp_fixado: novoValor })
        .eq('pessoaIdentificador', leadId);
    if (error) { alert('Erro ao ' + (novoValor ? 'fixar' : 'desafixar') + ': ' + error.message); return; }
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
    if (lead) lead.wpp_fixado = novoValor;
    const searchEl = document.getElementById('wppSearch');
    renderizarContatosWpp(searchEl ? searchEl.value : '');
}

async function alternarArquivarConversaWpp(leadId, estavaArquivado) {
    const novoValor = !estavaArquivado;
    const { error } = await window.supabaseClient
        .from(typeof NOME_TABELA !== 'undefined' ? NOME_TABELA : 'leads_inscricoes')
        .update({ wpp_arquivado: novoValor })
        .eq('pessoaIdentificador', leadId);
    if (error) { alert('Erro ao ' + (novoValor ? 'arquivar' : 'desarquivar') + ': ' + error.message); return; }
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
    if (lead) lead.wpp_arquivado = novoValor;
    const searchEl = document.getElementById('wppSearch');
    renderizarContatosWpp(searchEl ? searchEl.value : '');
}

// "Silenciar" conversa (pedido do usuário, 2026-09-30) — snooze de
// NOTIFICAÇÃO, diferente de arquivar: enquanto `wpp_silenciado_ate` está
// no futuro, o sino/popup de "mensagem recebida" não dispara pra esse
// lead (ver iniciarNotificacoesWhatsAppGlobais(), js/notificacoes.js),
// mas o indicador de "não lida" continua normal — mesmo comportamento do
// WhatsApp real (silenciado ≠ lido).
const OPCOES_SILENCIAR_WPP = [
    { rotulo: '1 hora', horas: 1 },
    { rotulo: '8 horas', horas: 8 },
    { rotulo: '24 horas', horas: 24 },
    { rotulo: '7 dias', horas: 24 * 7 },
];
function _containerMenuSilenciarWpp() {
    let el = document.getElementById('wppSilenciarMenu');
    if (!el) {
        el = document.createElement('div');
        el.id = 'wppSilenciarMenu';
        el.className = 'wpp-silenciar-menu';
        document.body.appendChild(el);
    }
    return el;
}
function fecharMenuSilenciarWpp() {
    const el = document.getElementById('wppSilenciarMenu');
    if (el) el.style.display = 'none';
}
function abrirMenuSilenciarWpp(botaoEl, leadId, jaSilenciado) {
    const menu = _containerMenuSilenciarWpp();
    const opcoes = jaSilenciado
        ? [{ rotulo: 'Reativar notificações', horas: 0 }]
        : OPCOES_SILENCIAR_WPP;
    menu.innerHTML = opcoes.map(o => `<button type="button" class="wpp-silenciar-opcao" data-horas="${o.horas}">${escapeHTML(o.rotulo)}</button>`).join('');
    const rect = botaoEl.getBoundingClientRect();
    menu.style.display = 'flex';
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.min(window.innerWidth - 160, rect.left)}px`;
    menu.querySelectorAll('.wpp-silenciar-opcao').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            fecharMenuSilenciarWpp();
            const horas = Number(btn.dataset.horas);
            const novoValor = horas > 0 ? new Date(Date.now() + horas * 3600000).toISOString() : null;
            const { error } = await window.supabaseClient
                .from(typeof NOME_TABELA !== 'undefined' ? NOME_TABELA : 'leads_inscricoes')
                .update({ wpp_silenciado_ate: novoValor })
                .eq('pessoaIdentificador', leadId);
            if (error) { alert('Erro: ' + error.message); return; }
            const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
            if (lead) lead.wpp_silenciado_ate = novoValor;
            const searchEl = document.getElementById('wppSearch');
            renderizarContatosWpp(searchEl ? searchEl.value : '');
        });
    });
    setTimeout(() => document.addEventListener('click', fecharMenuSilenciarWpp, { once: true }), 0);
}

// "Minhas conversas" (pedido do usuário, 2026-09-30: fila/distribuição
// automática entre atendentes) — filtro client-side sobre
// `wpp_atendente_responsavel` (atribuído automaticamente pelo
// whatsapp-webhook, por menor carga, na 1ª mensagem de cada lead novo —
// nunca reatribui uma conversa já em andamento sozinho).
function htmlBadgeAtendenteWpp(lead) {
    if (!lead.wpp_atendente_responsavel) return '';
    return `<span class="wpp-atendente-badge" title="Responsável por esta conversa"><i class="fa-solid fa-user"></i> ${escapeHTML(lead.wpp_atendente_responsavel)}</span>`;
}

function htmlContatoNaoIdentificadoWpp(m) {
    const ativo = String(m.telefone_whatsapp) === String(wppTelefoneNaoIdentAtivo) ? 'active' : '';
    return `
        <div class="wpp-contact-item ${ativo}" onclick="abrirChatNaoIdentificado('${m.telefone_whatsapp}')">
            <div class="wpp-contact-avatar" style="background:#f59e0b;"><i class="fa-solid fa-question"></i></div>
            <div class="wpp-contact-info" style="flex:1;">
                <div class="wpp-contact-name">${escapeHTML(m.telefone_whatsapp)}</div>
                <div class="wpp-contact-phone">${escapeHTML((m.corpo_texto || '').slice(0, 40))}</div>
            </div>
            <button class="btn-add-tag" style="flex-shrink:0;" onclick="event.stopPropagation(); vincularConversaNaoIdentificada('${m.telefone_whatsapp}')">Vincular</button>
        </div>
    `;
}

// Bug real relatado pelo usuário (2026-09-29): clicar numa conversa "não
// identificada" não abria nada — só existia o botão "Vincular" (que exige
// já saber o nome). Sem abrir, não dava pra LER o histórico nem RESPONDER
// antes de descobrir quem é. Agora a linha inteira abre uma mini-visão de
// chat própria (não reaproveita `criarChatController()` — ele é montado
// em torno de um `pessoaIdentificador` fixo pro Realtime/templates/anexos,
// e aqui não há lead nenhum ainda) — só histórico + texto livre.
let wppTelefoneNaoIdentAtivo = null;
let wppCanalNaoIdent = null;
let wppCanalSugestaoIa = null;

async function abrirChatNaoIdentificado(telefone) {
    wppContatoAtivoId = null;
    wppTelefoneNaoIdentAtivo = telefone;
    if (chatWpp && chatWpp.fechar) chatWpp.fechar();
    if (wppCanalSugestaoIa) { window.supabaseClient.removeChannel(wppCanalSugestaoIa); wppCanalSugestaoIa = null; }
    const blocoTags = document.getElementById('wppChatTagsBlock');
    if (blocoTags) blocoTags.innerHTML = '';
    const blocoSugestao = document.getElementById('wppSugestaoIaBox');
    if (blocoSugestao) blocoSugestao.innerHTML = '';

    const searchEl = document.getElementById('wppSearch');
    renderizarContatosWpp(searchEl ? searchEl.value : '');

    const header = document.getElementById('wppChatHeader');
    if (header) {
        header.innerHTML = `
            <div style="width: 36px; height: 36px; background: #f59e0b; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; color: white;"><i class="fa-solid fa-question"></i></div>
            <div style="flex:1;">
                <div style="font-size: 13px; font-weight: 600;">${escapeHTML(telefone)}</div>
                <div style="font-size: 11px; color: #b45309;"><i class="fa-solid fa-triangle-exclamation"></i> Número não identificado</div>
            </div>
            <button class="btn-add-tag" onclick="vincularConversaNaoIdentificada('${telefone}')">Vincular a um lead</button>
        `;
    }

    await carregarERenderizarChatNaoIdentificado(telefone);
}

async function carregarERenderizarChatNaoIdentificado(telefone) {
    const container = document.getElementById('wppMessages');
    if (container) container.innerHTML = '<div style="text-align:center; font-size:11px; color:#64748b; margin-top:20px;">Carregando conversa...</div>';

    const { data } = await window.supabaseClient
        .from('mensagens_whatsapp')
        .select('*')
        .eq('telefone_whatsapp', telefone)
        .order('criado_em', { ascending: true });
    const mensagens = data || [];

    if (container) {
        if (mensagens.length === 0) {
            container.innerHTML = '<div style="text-align:center; font-size:11px; color:#64748b; margin-top:20px;">Nenhuma mensagem ainda.</div>';
        } else {
            const mapaPorWaId = new Map(mensagens.filter(x => x.wa_message_id).map(x => [x.wa_message_id, x]));
            let html = '';
            let ultimoDia = null;
            mensagens.forEach(m => {
                const diaAtual = new Date(m.criado_em).toDateString();
                if (diaAtual !== ultimoDia) {
                    html += `<div class="wpp-date-divider"><span>${escapeHTML(rotuloDataSeparadorWpp(m.criado_em))}</span></div>`;
                    ultimoDia = diaAtual;
                }
                html += htmlMensagemWpp(m, resolverCitacaoWpp(m, mapaPorWaId));
            });
            container.innerHTML = html;
            container.scrollTop = container.scrollHeight;
        }
    }

    // Se a última mensagem ficou ambígua (2+ leads com o mesmo telefone,
    // ver whatsapp-webhook), mostra escolha rápida por quem já foi
    // identificado como candidato — evita ter que digitar o nome de novo.
    const ultimaComCandidatos = [...mensagens].reverse().find(m => m.payload_bruto && Array.isArray(m.payload_bruto.candidatos_ambiguos));
    renderizarAreaInputNaoIdentificado(telefone, ultimaComCandidatos ? ultimaComCandidatos.payload_bruto.candidatos_ambiguos : null);

    if (wppCanalNaoIdent) { window.supabaseClient.removeChannel(wppCanalNaoIdent); wppCanalNaoIdent = null; }
    wppCanalNaoIdent = window.supabaseClient
        .channel(`wpp-naoident-${telefone}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensagens_whatsapp', filter: `telefone_whatsapp=eq.${telefone}` }, () => {
            if (wppTelefoneNaoIdentAtivo === telefone) carregarERenderizarChatNaoIdentificado(telefone);
        })
        .subscribe();
}

function renderizarAreaInputNaoIdentificado(telefone, candidatosAmbiguos) {
    const container = document.getElementById('wppChatInputArea');
    if (!container) return;

    let quickPick = '';
    if (candidatosAmbiguos && candidatosAmbiguos.length > 0) {
        quickPick = `
            <div style="padding:8px 12px; background:#fef3c7; border-radius:8px; margin-bottom:8px; font-size:12px;">
                <div style="font-weight:600; margin-bottom:6px; color:#92400e;"><i class="fa-solid fa-triangle-exclamation"></i> Esse telefone bate com ${candidatosAmbiguos.length} leads diferentes (provável cadastro duplicado entre filiais) — escolha quem respondeu:</div>
                ${candidatosAmbiguos.map(c => `<button class="btn-add-tag" style="margin:2px 4px 2px 0;" onclick="vincularConversaNaoIdentificadaPorId('${telefone}', '${c.pessoaIdentificador}')">${escapeHTML(c.pessoaNome || ('#' + c.pessoaIdentificador))} — ${escapeHTML(c.filial || 'sem filial')}</button>`).join('')}
            </div>`;
    }

    container.innerHTML = `
        ${quickPick}
        <div class="chat-input-row">
            <input type="text" class="chat-input" id="wppNaoIdentInput" placeholder="Responder (ainda sem saber quem é)...">
            <button type="button" class="btn-send" id="wppNaoIdentEnviar"><i class="fa-solid fa-paper-plane"></i></button>
        </div>
    `;
    const input = container.querySelector('#wppNaoIdentInput');
    const botao = container.querySelector('#wppNaoIdentEnviar');
    const disparar = () => enviarTextoNaoIdentificado(telefone);
    if (botao) botao.addEventListener('click', disparar);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') disparar(); });
}

async function enviarTextoNaoIdentificado(telefone) {
    const input = document.getElementById('wppNaoIdentInput');
    if (!input) return;
    const texto = input.value.trim();
    if (!texto) return;
    input.value = '';
    input.disabled = true;

    const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
        body: { telefoneWhatsapp: telefone, tipo: 'texto', texto, atendenteNome: obterNomeAtendente() }
    });
    input.disabled = false;
    input.focus();

    if (error) { alert('Erro ao enviar mensagem: ' + error.message); input.value = texto; return; }
    if (!data.ok) {
        console.error('Erro ao enviar mensagem (não identificado):', data.detalhe || data.erro);
        alert('Não foi possível enviar: ' + mensagemErroWpp(data));
        return;
    }
    await carregarERenderizarChatNaoIdentificado(telefone);
}

// Vincula direto por id (sem digitar nome) — usado pela escolha rápida
// entre candidatos ambíguos (ver renderizarAreaInputNaoIdentificado()).
async function vincularConversaNaoIdentificadaPorId(telefone, pessoaIdentificador) {
    if (!confirm('Vincular todo o histórico deste número a este lead?')) return;
    const { data: lead } = await window.supabaseClient
        .from('leads_inscricoes')
        .select('filial')
        .eq('pessoaIdentificador', pessoaIdentificador)
        .maybeSingle();
    const { error } = await window.supabaseClient
        .from('mensagens_whatsapp')
        .update({ pessoaIdentificador, filial: lead ? lead.filial : null })
        .eq('telefone_whatsapp', telefone)
        .is('pessoaIdentificador', null);
    if (error) { alert('Erro ao vincular: ' + error.message); return; }
    wppTelefoneNaoIdentAtivo = null;
    if (wppCanalNaoIdent) { window.supabaseClient.removeChannel(wppCanalNaoIdent); wppCanalNaoIdent = null; }
    abrirChatWpp(pessoaIdentificador);
}

// ==========================================================
// Tags direto no WhatsApp Unificado (pedido do usuário, 2026-09-29):
// "dentro da área de whatsapp unificado, permita as tags (ver, incluir,
// remover, alterar)" — antes só dava pra ver/editar tags abrindo a gaveta
// do lead no Kanban. Reaproveita as mesmas funções puras já usadas lá
// (parseTags/classeVisualTag/TAGS_SUGERIDAS/registrarLogAtividade,
// js/app.js) mas com fluxo próprio (opera por `leadId` explícito, não o
// `currentLeadId` global da gaveta) — não reaproveita renderDrawerTags()/
// confirmarNovaTag()/removerTag() diretamente porque são amarradas a
// elementos DOM (`drawer-tags`, `drawer-tag-form`) e ao lead da gaveta.
// ==========================================================
function renderizarTagsWpp(leadId) {
    const container = document.getElementById('wppChatTagsBlock');
    if (!container) return;
    if (!leadId) { container.innerHTML = ''; return; }
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
    if (!lead) { container.innerHTML = ''; return; }

    const tags = (typeof parseTags === 'function' ? parseTags(lead.tags) : []);
    const badges = tags.map((t, i) => {
        const tagLimpa = (t || '').trim();
        if (!tagLimpa) return '';
        const classe = typeof classeVisualTag === 'function' ? classeVisualTag(tagLimpa) : '';
        return `<span class="tag ${classe}" style="font-size:10.5px; padding:4px 8px; display:inline-flex; align-items:center; gap:4px;">${escapeHTML(tagLimpa)} <i class="fa-solid fa-xmark" style="cursor:pointer;" onclick="removerTagWpp('${leadId}', ${i})" title="Remover tag"></i></span>`;
    }).join('');

    // Toggle de sugestão de IA por CONVERSA (pedido do usuário,
    // 2026-09-29) — `ia_sugestao_resposta` é nullable: null = segue o
    // padrão da FILIAL (ver "Gerenciar Filiais", js/app.js); true/false =
    // decisão explícita pra ESTE lead, independente do resto da filial.
    const valorToggle = lead.ia_sugestao_resposta === true ? 'ligado' : lead.ia_sugestao_resposta === false ? 'desligado' : 'padrao';

    container.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center; padding:6px 12px; border-bottom:1px solid var(--border-color); background:#fafafa;">
            ${badges}
            <button class="btn-add-tag" style="font-size:10.5px; padding:3px 8px;" onclick="abrirFormNovaTagWpp('${leadId}')"><i class="fa-solid fa-plus"></i> Tag</button>
            <span id="wppTagFormInline" style="display:none; gap:4px; align-items:center;">
                <input type="text" id="wppTagInput" list="tagsSugeridasList" placeholder="Nova tag..." style="font-size:11px; padding:3px 6px; width:150px;" onkeydown="if(event.key==='Enter') confirmarNovaTagWpp('${leadId}'); if(event.key==='Escape') document.getElementById('wppTagFormInline').style.display='none';">
                <button class="btn-add-tag" style="font-size:10.5px;" onclick="confirmarNovaTagWpp('${leadId}')">OK</button>
            </span>
            <span style="margin-left:auto; display:flex; align-items:center; gap:4px; font-size:10.5px; color:var(--text-muted);">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Sugestão de IA:
                <select onchange="alternarSugestaoIaLead('${leadId}', this.value)" style="font-size:10.5px; padding:2px 4px;">
                    <option value="padrao" ${valorToggle === 'padrao' ? 'selected' : ''}>Padrão da filial</option>
                    <option value="ligado" ${valorToggle === 'ligado' ? 'selected' : ''}>Ativada nesta conversa</option>
                    <option value="desligado" ${valorToggle === 'desligado' ? 'selected' : ''}>Desativada nesta conversa</option>
                </select>
            </span>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center; padding:4px 12px 6px; border-bottom:1px solid var(--border-color); background:#fafafa; font-size:10.5px;">
            ${lead.lembrete_em
                ? `<span class="tag" style="background:#fef3c7; color:#92400e; display:inline-flex; align-items:center; gap:4px;"><i class="fa-solid fa-clock"></i> ${formatarDataBRWpp(lead.lembrete_em)}${lead.lembrete_nota ? ' — ' + escapeHTML(lead.lembrete_nota) : ''} <i class="fa-solid fa-pen" style="cursor:pointer;" onclick="abrirLembreteWpp(this, '${leadId}')" title="Editar lembrete"></i> <i class="fa-solid fa-xmark" style="cursor:pointer;" onclick="salvarLembreteWpp('${leadId}', null, null)" title="Remover lembrete"></i></span>`
                : `<button class="btn-add-tag" style="font-size:10.5px; padding:3px 8px;" onclick="abrirLembreteWpp(this, '${leadId}')"><i class="fa-solid fa-clock"></i> Lembrete</button>`
            }
            <button class="btn-secondary" style="margin-left:auto; font-size:10.5px; padding:3px 8px; color:#991b1b;" onclick="excluirLeadWpp('${leadId}')" title="Mover pra Lixeira (30 dias pra restaurar)"><i class="fa-solid fa-trash"></i> Excluir Lead</button>
        </div>
    `;
}

// Pedido do usuário (2026-10-01): "preciso encaminhar contatos no crm...
// importar os contatos ou cadastrar, e depois encaminhar para as
// pessoas interessadas" — fluxo de 1 clique: cadastra o contato
// compartilhado (vCard) direto como lead (sem passar pelo modal manual —
// já temos nome/telefone confiáveis da própria Meta) e já entra no MESMO
// fluxo de "Convidar (Link)" já existente (wa.me, zero risco de API,
// ainda mais importante agora com o número sinalizado por spam — ver
// conversa sobre o bloqueio da conta) pra mandar o convite de evento na
// hora. Nunca cria duplicado: se já existir um lead com esse telefone,
// reaproveita em vez de cadastrar de novo.
async function cadastrarContatoWppEConvidar(nome, telefoneDigits, filial, botaoEl) {
    if (botaoEl) { botaoEl.disabled = true; botaoEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }

    let resto = telefoneDigits || '';
    if (resto.startsWith('55') && resto.length >= 12) resto = resto.slice(2);
    const ddd = resto.slice(0, 2);
    const numero = resto.slice(2);

    try {
        const { data: existente } = await window.supabaseClient
            .from('leads_inscricoes')
            .select('pessoaIdentificador, pessoaNome, filial')
            .eq('pessoaTelefoneDDD', ddd)
            .eq('pessoaTelefoneNumero', numero)
            .is('lixeira_em', null)
            .limit(1)
            .maybeSingle();

        let leadId;
        if (existente) {
            leadId = existente.pessoaIdentificador;
        } else {
            const idsExistentes = new Set((typeof leadsAtuais !== 'undefined' ? leadsAtuais : []).map(l => String(l.pessoaIdentificador)));
            do { leadId = String((typeof BASE_ID_LEAD_MANUAL !== 'undefined' ? BASE_ID_LEAD_MANUAL : 985000000) + Math.floor(Math.random() * 4900000)); } while (idsExistentes.has(leadId));

            const registro = {
                pessoaIdentificador: leadId,
                pessoaNome: nome || 'Sem nome',
                pessoaTelefoneDDD: ddd,
                pessoaTelefoneNumero: numero,
                pessoaEmail: '',
                pessoaStatus: '', telemarketingStatus: '', eventoNome: '', eventoData: '',
                historico_eventos: [],
                tags: JSON.stringify([typeof TAG_LEAD_MANUAL !== 'undefined' ? TAG_LEAD_MANUAL : 'CRM', 'Indicação de Aluno', 'Sem E-mail']),
                funil_agencia: (typeof columnsConfig !== 'undefined' && columnsConfig[0]) ? columnsConfig[0].key : 'Frios',
                filial: filial || (typeof filialAtual !== 'undefined' ? filialAtual : ''),
            };
            const { error } = await window.supabaseClient.from('leads_inscricoes').insert(registro);
            if (error) { alert('Erro ao cadastrar o contato: ' + error.message); if (botaoEl) { botaoEl.disabled = false; botaoEl.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Cadastrar e Convidar'; } return; }

            if (typeof leadsAtuais !== 'undefined') leadsAtuais = [...leadsAtuais, registro];
            if (typeof registrarLogAtividade === 'function') registrarLogAtividade('criar_lead_manual', { pessoaIds: [leadId], detalhes: { nome, origem: 'contato_whatsapp_compartilhado' } });
        }

        if (typeof cardsSelecionados !== 'undefined') {
            cardsSelecionados.clear();
            cardsSelecionados.add(String(leadId));
        }
        // "Convidar (Link)" lista os eventos da filial SELECIONADA NO
        // TOPO (filialAtual), não da filial deste lead especificamente —
        // limitação pré-existente desse fluxo (pensado pra uso dentro do
        // Kanban de 1 filial por vez). Como o WhatsApp Unificado é
        // cross-filial, avisa quando as duas divergem, pra não escolher
        // sem querer um evento de outra unidade.
        const filialLead = filial || (typeof filialAtual !== 'undefined' ? filialAtual : '');
        if (typeof filialAtual !== 'undefined' && filialLead && filialLead !== filialAtual) {
            alert(`Atenção: esta pessoa é da filial "${filialLead}", mas a tela está mostrando eventos de "${filialAtual}" (a filial selecionada no topo). No próximo passo, confira se o evento escolhido é mesmo de "${filialLead}" antes de gerar o link.`);
        }
        if (typeof iniciarConvitesWhatsAppEmMassa === 'function') await iniciarConvitesWhatsAppEmMassa();
    } finally {
        if (botaoEl) { botaoEl.disabled = false; botaoEl.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Cadastrar e Convidar'; }
    }
}

// Pedido do usuário (2026-10-01): "quando alguém compartilhar um
// contato, abra uma conversa e a possibilidade de preencher os dados do
// lead e salvar" — reaproveita o modal "Novo Lead" já existente
// (abrirNovoLeadManual(), js/app.js), só pré-preenchido com o que veio
// na vCard. DDD/telefone separados a partir do E.164 bruto (assume
// Brasil, DDI 55 — mesma suposição já usada no resto do projeto pra
// número de WhatsApp).
function salvarContatoWppComoLead(nome, telefoneDigits) {
    if (typeof abrirNovoLeadManual !== 'function') { alert('Função de Novo Lead não disponível nesta tela.'); return; }
    abrirNovoLeadManual();
    document.getElementById('novoLeadManualNome').value = nome || '';
    let resto = telefoneDigits || '';
    if (resto.startsWith('55') && resto.length >= 12) resto = resto.slice(2);
    document.getElementById('novoLeadManualDDD').value = resto.slice(0, 2);
    document.getElementById('novoLeadManualTelefone').value = resto.slice(2);
}

function formatarDataBRWpp(dataISO) {
    if (!dataISO) return '';
    const d = new Date(dataISO + 'T00:00:00');
    if (isNaN(d.getTime())) return dataISO;
    return d.toLocaleDateString('pt-BR');
}

// Lembrete de follow-up (snooze) direto do WhatsApp Unificado — pedido do
// usuário (2026-10-01): "coloque o snooze no whatsapp unificado". Mesmo
// par de colunas já usado na gaveta (leads_inscricoes.lembrete_em/
// lembrete_nota, migracao_lembrete_lead.sql) — função paralela porque a
// gaveta (salvarLembreteLead, js/app.js) é amarrada a elementos DOM
// próprios dela (#drawer-lembrete-data etc.), mesmo padrão já usado pelas
// tags neste arquivo.
//
// Popover com <input type="date"> de verdade (pedido do usuário,
// 2026-10-05: "libere um calendário para marcarmos a data. Digitar assim
// é incômodo") — antes usava 2 prompt() encadeados (data digitada à mão
// + nota), único lugar do app que ainda pedia data por texto pra isso (a
// gaveta já usava <input type="date"> desde sempre). Mesmo padrão visual/
// de posicionamento do menu de silenciar conversa (abrirMenuSilenciarWpp).
function _containerLembretePopoverWpp() {
    let el = document.getElementById('wppLembretePopover');
    if (!el) {
        el = document.createElement('div');
        el.id = 'wppLembretePopover';
        el.className = 'wpp-lembrete-popover';
        document.body.appendChild(el);
    }
    return el;
}
function fecharLembretePopoverWpp() {
    const el = document.getElementById('wppLembretePopover');
    if (el) el.style.display = 'none';
}

function abrirLembreteWpp(botaoEl, leadId) {
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
    if (!lead) return;

    const pop = _containerLembretePopoverWpp();
    pop.innerHTML = `
        <label style="font-size:11px; font-weight:600; display:block; margin-bottom:4px;">Lembrar de voltar a falar em:</label>
        <input type="date" id="wppLembretePopoverData" value="${escapeHTML(lead.lembrete_em || '')}" style="width:100%; padding:6px; margin-bottom:8px; box-sizing:border-box;">
        <input type="text" id="wppLembretePopoverNota" placeholder="Nota (opcional) — ex: retornar depois do fim de semana" value="${escapeHTML(lead.lembrete_nota || '')}" style="width:100%; padding:6px; margin-bottom:8px; box-sizing:border-box;">
        <div style="display:flex; gap:6px;">
            <button type="button" class="btn-primary" style="font-size:11px; padding:5px 10px; flex:1;" id="wppLembretePopoverSalvar"><i class="fa-solid fa-check"></i> Salvar</button>
            ${lead.lembrete_em ? `<button type="button" class="btn-secondary" style="font-size:11px; padding:5px 10px;" id="wppLembretePopoverRemover">Remover</button>` : ''}
        </div>
    `;

    const rect = botaoEl.getBoundingClientRect();
    pop.style.display = 'block';
    pop.style.top = `${rect.bottom + 4}px`;
    pop.style.left = `${Math.min(window.innerWidth - 240, Math.max(4, rect.left))}px`;

    // Nunca deixa um clique DENTRO do popover (inclusive abrir o
    // calendário nativo do <input type="date">) fechar ele sozinho — só
    // o listener global abaixo, registrado fora deste elemento, fecha.
    pop.querySelectorAll('input').forEach(inp => inp.addEventListener('click', (ev) => ev.stopPropagation()));

    document.getElementById('wppLembretePopoverSalvar').addEventListener('click', (ev) => {
        ev.stopPropagation();
        const data = document.getElementById('wppLembretePopoverData').value || null;
        const nota = document.getElementById('wppLembretePopoverNota').value.trim() || null;
        fecharLembretePopoverWpp();
        salvarLembreteWpp(leadId, data, nota);
    });
    const btnRemover = document.getElementById('wppLembretePopoverRemover');
    if (btnRemover) {
        btnRemover.addEventListener('click', (ev) => {
            ev.stopPropagation();
            fecharLembretePopoverWpp();
            salvarLembreteWpp(leadId, null, null);
        });
    }

    setTimeout(() => document.addEventListener('click', fecharLembretePopoverWpp, { once: true }), 0);
}

async function salvarLembreteWpp(leadId, data, nota) {
    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(leadId));
    if (leadIndex !== -1) { leadsAtuais[leadIndex].lembrete_em = data; leadsAtuais[leadIndex].lembrete_nota = nota; }
    renderizarTagsWpp(leadId);
    if (typeof renderizarCards === 'function') renderizarCards();

    const { error } = await window.supabaseClient.from('leads_inscricoes').update({ lembrete_em: data, lembrete_nota: nota }).eq('pessoaIdentificador', leadId);
    if (error) { alert('Erro ao salvar lembrete: ' + error.message); return; }
    if (typeof registrarLogAtividade === 'function') {
        registrarLogAtividade('lembrete_salvo', { pessoaIds: [String(leadId)], detalhes: { data, nota, origem: 'whatsapp_unificado' } });
    }
}

// Excluir lead (mover pra Lixeira) direto do WhatsApp Unificado — pedido
// do usuário (2026-10-01). Reaproveita a MESMA regra de retenção de
// sempre (soft-delete 30 dias, ver "Lixeira de Leads") — nunca apaga
// definitivo na hora.
async function excluirLeadWpp(leadId) {
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
    const nome = lead ? (lead.pessoaNome || 'este lead') : 'este lead';
    if (!confirm(`Mover "${nome}" pra lixeira? Fica lá por 30 dias (dá pra restaurar até lá) e depois é apagado definitivamente.`)) return;

    const { error } = await window.supabaseClient.from('leads_inscricoes').update({ lixeira_em: new Date().toISOString() }).eq('pessoaIdentificador', leadId);
    if (error) { alert('Erro ao mover pra lixeira: ' + error.message); return; }

    leadsAtuais = leadsAtuais.filter(l => String(l.pessoaIdentificador) !== String(leadId));
    if (typeof registrarLogAtividade === 'function') {
        registrarLogAtividade('mover_lixeira', { pessoaIds: [String(leadId)], detalhes: { origem: 'whatsapp_unificado' } });
    }
    if (typeof atualizarContagemLixeira === 'function') atualizarContagemLixeira();
    if (typeof renderizarCards === 'function') renderizarCards();

    wppContatoAtivoId = null;
    const header = document.getElementById('wppChatHeader');
    if (header) header.innerHTML = '';
    const tagsBlock = document.getElementById('wppChatTagsBlock');
    if (tagsBlock) tagsBlock.innerHTML = '';
    const msgs = document.getElementById('wppMessages');
    if (msgs) msgs.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted);">Lead movido pra lixeira.</div>';
    const inputArea = document.getElementById('wppChatInputArea');
    if (inputArea) inputArea.innerHTML = '';
    const searchEl = document.getElementById('wppSearch');
    renderizarContatosWpp(searchEl ? searchEl.value : '');
}

// Pedido do usuário (2026-10-06): "recebo algumas respostas de pessoas
// dizendo que aquele whatsapp não é da pessoa que procuro... sem apagar o
// lead, já que em muitos casos tem mais de um número cadastrado". Botão
// único (mesma função, chamada tanto do cabeçalho do WhatsApp Unificado
// quanto do cabeçalho da gaveta do lead) — resolve em 2 efeitos, sem
// apagar nada:
// 1. O telefone atual (o que causou o match errado) é removido do
//    cadastro + tag "Telefone Inválido"/"Sem Telefone" — mesmo efeito de
//    marcarTelefoneInvalido() (js/app.js, só pra gaveta), reescrito aqui
//    sem depender dos <input> da gaveta estarem na tela.
// 2. TODA a conversa (mensagens_whatsapp já vinculada a este lead) volta
//    a ser "Não Identificada" (pessoaIdentificador/filial = null) —
//    reaproveita o fluxo "Vincular" que já existe pra esse estado, pra
//    religar com a pessoa certa depois (nenhuma mensagem é apagada). Usa
//    a policy de UPDATE já existente em mensagens_whatsapp ("ocultar
//    mensagem enviada", using(true) with check(true), sem restrição de
//    linha — ver migracao_whatsapp_pin_arquivar_ocultar.sql) — não
//    precisa de migração nem Edge Function nova.
async function confirmarNumeroErradoWpp(leadId) {
    if (!leadId) return;
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
    const nome = lead ? (lead.pessoaNome || 'este lead') : 'este lead';
    const telefoneAtual = lead ? `${lead.pessoaTelefoneDDD || ''} ${lead.pessoaTelefoneNumero || ''}`.trim() : '';
    if (!confirm(
        `Esse WhatsApp não é de "${nome}"?\n\n` +
        `O telefone${telefoneAtual ? ` (${telefoneAtual})` : ''} vai ser removido do cadastro deste lead — fica a tag "Telefone Inválido". "${nome}" continua existindo normalmente no CRM, só sem este telefone/conversa.`
    )) return;

    // Pedido do usuário (2026-10-06): "não vejo a opção de marcar o
    // problema do whatsapp ter passado para outra pessoa no CRM" — se o
    // SDR já sabe quem é a pessoa certa (já cadastrada), reatribui a
    // conversa DIRETO pra ela, sem passar pelo passo intermediário de
    // "Não Identificados" (que continua existindo como fallback, pra
    // quando ainda não se sabe quem é).
    let novoLead = null;
    if (confirm('Você já sabe quem é a pessoa certa, e ela JÁ está cadastrada no CRM?\n\nSe sim, vamos buscar pelo nome e reatribuir a conversa direto pra ela. Se não tiver certeza, cancele aqui — a conversa vai pra "Não Identificados" pra decidir depois.')) {
        const nomeBusca = prompt('Digite o nome (ou parte do nome) da pessoa certa:');
        if (nomeBusca && nomeBusca.trim()) {
            const termo = nomeBusca.trim();
            const { data: candidatos, error: erroBusca } = await window.supabaseClient
                .from('leads_inscricoes')
                .select('pessoaIdentificador, pessoaNome, filial, pessoaTelefoneDDD, pessoaTelefoneNumero')
                .ilike('pessoaNome', `%${termo}%`)
                .is('lixeira_em', null)
                .limit(10);
            if (erroBusca) {
                alert('Erro ao buscar: ' + erroBusca.message);
            } else if (!candidatos || candidatos.length === 0) {
                alert('Nenhum lead encontrado com esse nome — a conversa vai pra "Não Identificados".');
            } else if (candidatos.length > 1) {
                alert(`Encontrei ${candidatos.length} leads com esse nome — seja mais específico da próxima vez:\n` +
                    candidatos.map(c => `${c.pessoaNome} (${c.filial || 'sem filial'})`).join('\n') +
                    `\n\nA conversa vai pra "Não Identificados" por enquanto.`);
            } else {
                novoLead = candidatos[0];
            }
        }
    }

    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(leadId));
    let tagsArray = leadIndex !== -1 ? parseTags(leadsAtuais[leadIndex].tags).map(t => t.trim()).filter(Boolean) : [];
    if (!tagsArray.includes('Telefone Inválido')) tagsArray.push('Telefone Inválido');
    if (!tagsArray.includes('Sem Telefone')) tagsArray.push('Sem Telefone');
    const tagsJson = JSON.stringify(tagsArray);

    const nomeTabela = typeof NOME_TABELA !== 'undefined' ? NOME_TABELA : 'leads_inscricoes';
    const { error: erroLead } = await window.supabaseClient
        .from(nomeTabela)
        .update({ pessoaTelefoneDDD: '', pessoaTelefoneNumero: '', tags: tagsJson })
        .eq('pessoaIdentificador', leadId);
    if (erroLead) { alert('Erro ao limpar telefone: ' + erroLead.message); return; }

    let mensagemFinal;
    if (novoLead) {
        const { error: erroReatrib } = await window.supabaseClient
            .from('mensagens_whatsapp')
            .update({ pessoaIdentificador: novoLead.pessoaIdentificador, filial: novoLead.filial })
            .eq('pessoaIdentificador', leadId);
        if (erroReatrib) alert('Telefone removido, mas não consegui reatribuir a conversa: ' + erroReatrib.message);

        // Se a pessoa certa ainda não tem telefone cadastrado, já grava
        // este número nela — assim as PRÓXIMAS mensagens dela casam
        // sozinhas, sem precisar repetir esta ação. Se ela já tiver um
        // telefone diferente, não mexe (não arrisca sobrescrever um dado
        // bom já confirmado).
        if (!novoLead.pessoaTelefoneDDD && !novoLead.pessoaTelefoneNumero && telefoneAtual) {
            const [dddAntigo, numeroAntigo] = telefoneAtual.split(' ');
            if (dddAntigo && numeroAntigo) {
                await window.supabaseClient
                    .from(nomeTabela)
                    .update({ pessoaTelefoneDDD: dddAntigo, pessoaTelefoneNumero: numeroAntigo })
                    .eq('pessoaIdentificador', novoLead.pessoaIdentificador);
            }
        }
        if (typeof registrarLogAtividade === 'function') {
            registrarLogAtividade('whatsapp_reatribuido', { pessoaIds: [String(leadId), String(novoLead.pessoaIdentificador)], detalhes: { telefoneRemovido: telefoneAtual || null, reatribuidoPara: novoLead.pessoaNome } });
        }
        mensagemFinal = `Pronto! Telefone removido de "${nome}" e a conversa foi reatribuída direto pra "${novoLead.pessoaNome}".`;
    } else {
        const { error: erroMsgs } = await window.supabaseClient
            .from('mensagens_whatsapp')
            .update({ pessoaIdentificador: null, filial: null })
            .eq('pessoaIdentificador', leadId);
        if (erroMsgs) alert('Telefone removido, mas não consegui desvincular a conversa: ' + erroMsgs.message);
        if (typeof registrarLogAtividade === 'function') {
            registrarLogAtividade('whatsapp_numero_errado', { pessoaIds: [String(leadId)], detalhes: { telefoneRemovido: telefoneAtual || null } });
        }
        mensagemFinal = 'Pronto! Telefone removido e conversa movida pra "Não Identificados".';
    }

    if (leadIndex !== -1) {
        leadsAtuais[leadIndex].pessoaTelefoneDDD = '';
        leadsAtuais[leadIndex].pessoaTelefoneNumero = '';
        leadsAtuais[leadIndex].tags = tagsJson;
    }
    if (typeof renderizarCards === 'function') renderizarCards();

    // Atualiza a gaveta, se for a mesma pessoa e estiver aberta
    if (typeof currentLeadId !== 'undefined' && String(currentLeadId) === String(leadId)) {
        const dddInput = document.getElementById('drawer-tel-ddd'); if (dddInput) dddInput.value = '';
        const numInput = document.getElementById('drawer-tel-numero'); if (numInput) numInput.value = '';
        if (typeof renderDrawerTags === 'function') renderDrawerTags();
        const headerDrawer = document.getElementById('drawer-chat-header');
        if (headerDrawer) headerDrawer.innerText = `${nome} (sem telefone)`;
        const msgsDrawer = document.getElementById('drawer-messages');
        if (msgsDrawer) msgsDrawer.innerHTML = `<div style="padding:40px; text-align:center; color:var(--text-muted);">${novoLead ? `Conversa reatribuída pra "${escapeHTML(novoLead.pessoaNome)}".` : 'Conversa desvinculada — veja em "Não Identificados" no WhatsApp Unificado.'}</div>`;
        const inputAreaDrawer = document.getElementById('drawerChatInputArea');
        if (inputAreaDrawer) inputAreaDrawer.innerHTML = '';
    }

    // Atualiza o WhatsApp Unificado, se for a mesma conversa aberta
    if (String(wppContatoAtivoId) === String(leadId)) {
        wppContatoAtivoId = null;
        const headerWpp = document.getElementById('wppChatHeader');
        if (headerWpp) headerWpp.innerHTML = '';
        const tagsBlockWpp = document.getElementById('wppChatTagsBlock');
        if (tagsBlockWpp) tagsBlockWpp.innerHTML = '';
        const msgsWpp = document.getElementById('wppMessages');
        if (msgsWpp) msgsWpp.innerHTML = `<div style="padding:40px; text-align:center; color:var(--text-muted);">${novoLead ? `Conversa reatribuída pra "${escapeHTML(novoLead.pessoaNome)}".` : 'Conversa desvinculada — veja em "Não Identificados".'}</div>`;
        const inputAreaWpp = document.getElementById('wppChatInputArea');
        if (inputAreaWpp) inputAreaWpp.innerHTML = '';
    }
    const searchEl = document.getElementById('wppSearch');
    if (typeof renderizarContatosWpp === 'function') renderizarContatosWpp(searchEl ? searchEl.value : '');

    alert(mensagemFinal);
}

async function alternarSugestaoIaLead(leadId, valor) {
    const novoValor = valor === 'ligado' ? true : valor === 'desligado' ? false : null;
    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(leadId));
    if (leadIndex !== -1) leadsAtuais[leadIndex].ia_sugestao_resposta = novoValor;
    const { error } = await window.supabaseClient.from('leads_inscricoes').update({ ia_sugestao_resposta: novoValor }).eq('pessoaIdentificador', leadId);
    if (error) alert('Erro ao salvar: ' + error.message);
}

// ==========================================================
// Sugestão de resposta por IA (pedido do usuário, 2026-09-29): "Crie uma
// sugestão de resposta com IA para cada lead que respondeu (eu preciso
// autorizar o envio dessa sugestão)". Detecção 100% determinística
// (RPC mensagens_candidatas_sugestao_resposta(), respeitando os 2
// toggles acima) roda por cron (sugerir-resposta-whatsapp, a cada 15
// min) e só grava com status='pendente' — a IA nunca envia sozinha, só
// escreve o rascunho; aqui é só ler/mostrar o que já foi gravado e
// autorizar/editar o envio.
// ==========================================================
async function carregarSugestaoIaWpp(leadId) {
    const container = document.getElementById('wppSugestaoIaBox');
    if (!container) return;
    if (!leadId) { container.innerHTML = ''; return; }

    const { data } = await window.supabaseClient
        .from('sugestoes_resposta_wpp')
        .select('*')
        .eq('pessoaIdentificador', leadId)
        .eq('status', 'pendente')
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!data) { container.innerHTML = ''; return; }

    container.innerHTML = `
        <div style="margin:0 12px 8px; padding:8px 10px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px;">
            <div style="font-size:11px; font-weight:600; color:#1d4ed8; margin-bottom:4px;"><i class="fa-solid fa-wand-magic-sparkles"></i> Sugestão de resposta (IA) — revise antes de enviar</div>
            ${data.sugestao_resposta
                ? `<textarea id="wppSugestaoTexto" style="width:100%; font-size:12px; padding:6px; border-radius:6px; border:1px solid #bfdbfe; resize:vertical; min-height:50px; box-sizing:border-box;">${escapeHTML(data.sugestao_resposta)}</textarea>`
                : `<div style="font-size:11px; color:var(--text-muted); margin-bottom:6px;">A IA não conseguiu gerar um texto pra esta mensagem — escreva a resposta na caixa abaixo, ou descarte esta sugestão.</div>`
            }
            <div style="display:flex; gap:6px; margin-top:6px;">
                ${data.sugestao_resposta ? `<button class="btn-primary" style="font-size:11px; padding:4px 10px;" onclick="enviarSugestaoIaWpp(${data.id}, '${leadId}')"><i class="fa-solid fa-paper-plane"></i> Enviar</button>` : ''}
                <button class="btn-secondary" style="font-size:11px; padding:4px 10px;" onclick="descartarSugestaoIaWpp(${data.id}, '${leadId}')">Descartar</button>
            </div>
        </div>
        ${data.lembrete_sugerido_data ? `
        <div style="margin:0 12px 8px; padding:8px 10px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px;">
            <div style="font-size:11px; font-weight:600; color:#92400e; margin-bottom:4px;"><i class="fa-solid fa-clock"></i> A IA detectou uma data de retorno — criar lembrete?</div>
            <div style="font-size:12px; margin-bottom:6px;"><strong>${formatarDataBRWpp(data.lembrete_sugerido_data)}</strong> — ${escapeHTML(data.lembrete_sugerido_motivo || '')}</div>
            <div style="display:flex; gap:6px;">
                <button class="btn-primary" style="font-size:11px; padding:4px 10px;" onclick="aplicarLembreteSugeridoWpp(${data.id}, '${leadId}', '${data.lembrete_sugerido_data}', '${escapeHTML(data.lembrete_sugerido_motivo || '').replace(/'/g, "\\'")}')"><i class="fa-solid fa-check"></i> Criar Lembrete</button>
                <button class="btn-secondary" style="font-size:11px; padding:4px 10px;" onclick="ignorarLembreteSugeridoWpp(${data.id}, '${leadId}')">Ignorar</button>
            </div>
        </div>` : ''}
    `;
}

// Aplica a sugestão de lembrete que a IA detectou (data futura mencionada
// pelo lead pra ser recontatado) — pedido do usuário (2026-10-01): "quero
// que a IA já crie um snooze para essa data, e registre o motivo no
// resumo". Cria o lembrete (mesma coluna de sempre) E concatena o motivo
// no Resumo/Anotações (nunca sobrescreve o que já tem escrito).
async function aplicarLembreteSugeridoWpp(sugestaoId, leadId, data, motivo) {
    await salvarLembreteWpp(leadId, data, motivo || null);

    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
    const resumoAtual = (lead && lead.resumo_ia) ? lead.resumo_ia.trim() : '';
    const notaNova = `[IA, ${new Date().toLocaleDateString('pt-BR')}] ${motivo || 'Lembrete criado a partir de data mencionada na conversa.'}`;
    const resumoFinal = resumoAtual ? `${resumoAtual}\n${notaNova}` : notaNova;

    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(leadId));
    if (leadIndex !== -1) leadsAtuais[leadIndex].resumo_ia = resumoFinal;
    await window.supabaseClient.from('leads_inscricoes').update({ resumo_ia: resumoFinal }).eq('pessoaIdentificador', leadId);

    // Limpa a sugestão de lembrete desta linha (nunca a própria sugestão de
    // TEXTO, que continua disponível pra enviar normalmente) — senão o
    // bloco amarelo reapareceria de novo ao recarregar.
    await window.supabaseClient.from('sugestoes_resposta_wpp').update({ lembrete_sugerido_data: null, lembrete_sugerido_motivo: null }).eq('id', sugestaoId);
    await carregarSugestaoIaWpp(leadId);
}

async function ignorarLembreteSugeridoWpp(sugestaoId, leadId) {
    await window.supabaseClient.from('sugestoes_resposta_wpp').update({ lembrete_sugerido_data: null, lembrete_sugerido_motivo: null }).eq('id', sugestaoId);
    await carregarSugestaoIaWpp(leadId);
}

async function enviarSugestaoIaWpp(id, leadId) {
    const textarea = document.getElementById('wppSugestaoTexto');
    const texto = textarea ? textarea.value.trim() : '';
    if (!texto) return;

    const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
        body: { pessoaIdentificador: leadId, tipo: 'texto', texto, atendenteNome: obterNomeAtendente() }
    });
    if (error || !data || data.ok === false) {
        alert('Não foi possível enviar: ' + (error ? error.message : mensagemErroWpp(data)));
        return;
    }

    await window.supabaseClient.from('sugestoes_resposta_wpp').update({ status: 'enviada' }).eq('id', id);
    await carregarSugestaoIaWpp(leadId);
    if (String(wppContatoAtivoId) === String(leadId)) await chatWpp.abrir(leadId);
    moverParaAbordagemAposEnvio(leadId).catch(e => console.warn('Erro ao mover lead pra Abordagem após envio:', e.message));
}

async function descartarSugestaoIaWpp(id, leadId) {
    await window.supabaseClient.from('sugestoes_resposta_wpp').update({ status: 'descartada' }).eq('id', id);
    await carregarSugestaoIaWpp(leadId);
}

function abrirFormNovaTagWpp(leadId) {
    const span = document.getElementById('wppTagFormInline');
    const input = document.getElementById('wppTagInput');
    if (!span || !input) return;
    span.style.display = 'inline-flex';
    input.value = '';
    input.focus();
}

async function confirmarNovaTagWpp(leadId) {
    const input = document.getElementById('wppTagInput');
    if (!input) return;
    const novaTagText = input.value.trim();
    if (!novaTagText) return;

    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(leadId));
    if (leadIndex === -1) return;
    let tagsArray = parseTags(leadsAtuais[leadIndex].tags).map(t => t.trim()).filter(Boolean);

    if (tagsArray.includes(novaTagText)) { alert('Esse lead já tem essa tag.'); return; }
    if (typeof TAG_LEAD_MANUAL !== 'undefined' && novaTagText === TAG_LEAD_MANUAL) {
        alert('A tag "CRM" só é aplicada automaticamente ao criar um lead pelo botão "Novo Lead" — não dá pra adicionar à mão.');
        return;
    }
    // Mesma regra de exclusão mútua já usada na gaveta (confirmarNovaTag(), js/app.js).
    if (novaTagText === 'Ativo') tagsArray = tagsArray.filter(t => t !== 'Inativo' && t !== 'Ex-Aluno (Inativo)');
    else if (novaTagText === 'Inativo') tagsArray = tagsArray.filter(t => t !== 'Ativo' && t !== 'Aluno Ativo');

    tagsArray.push(novaTagText);
    leadsAtuais[leadIndex].tags = JSON.stringify(tagsArray);
    renderizarTagsWpp(leadId);
    if (typeof renderizarCards === 'function') renderizarCards();

    await window.supabaseClient
        .from('leads_inscricoes')
        .update({ tags: JSON.stringify(tagsArray) })
        .eq('pessoaIdentificador', leadId);

    if (typeof registrarLogAtividade === 'function') {
        registrarLogAtividade('tag_adicionar', { pessoaIds: [String(leadId)], detalhes: { tag: novaTagText, origem: 'whatsapp_unificado' } });
    }
}

async function removerTagWpp(leadId, index) {
    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(leadId));
    if (leadIndex === -1) return;
    let tagsArray = parseTags(leadsAtuais[leadIndex].tags);
    const tagRemovida = tagsArray[index];
    if (typeof TAG_LEAD_MANUAL !== 'undefined' && tagRemovida === TAG_LEAD_MANUAL) {
        alert('A tag "CRM" é permanente — só some se o lead inteiro for apagado.');
        return;
    }

    tagsArray.splice(index, 1);
    leadsAtuais[leadIndex].tags = JSON.stringify(tagsArray);
    renderizarTagsWpp(leadId);
    if (typeof renderizarCards === 'function') renderizarCards();

    await window.supabaseClient
        .from('leads_inscricoes')
        .update({ tags: JSON.stringify(tagsArray) })
        .eq('pessoaIdentificador', leadId);

    if (typeof registrarLogAtividade === 'function') {
        registrarLogAtividade('tag_remover', { pessoaIds: [String(leadId)], detalhes: { tag: tagRemovida, origem: 'whatsapp_unificado' } });
    }
}

async function renderizarContatosWpp(filtro = '') {
    const lista = document.getElementById('wppContactList');
    if (!lista) return;
    iniciarEscutaGlobalWpp();
    popularFiltroFilialWpp();

    const selectFilial = document.getElementById('wppFiltroFilialSelect');
    wppFiltroFilial = selectFilial ? selectFilial.value : '';

    const termo = (filtro || '').trim().toLowerCase();

    let queryConversas = window.supabaseClient
        .from('vw_wpp_conversas')
        .select('*')
        .order('ultima_mensagem_em', { ascending: false })
        .limit(200);
    if (wppFiltroFilial) queryConversas = queryConversas.eq('filial', wppFiltroFilial);
    const { data: conversas } = await queryConversas;
    const conversasValidas = conversas || [];
    const idsComConversa = new Set(conversasValidas.map(c => String(c.pessoaIdentificador)));

    const mapaLeads = new Map(leadsAtuais.map(l => [String(l.pessoaIdentificador), l]));
    const idsFaltando = conversasValidas.map(c => c.pessoaIdentificador).filter(id => !mapaLeads.has(String(id)));
    if (idsFaltando.length > 0) {
        const { data: extras } = await window.supabaseClient
            .from('leads_inscricoes')
            .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero, filial, wpp_fixado, wpp_arquivado, wpp_silenciado_ate, wpp_atendente_responsavel')
            .in('pessoaIdentificador', idsFaltando);
        (extras || []).forEach(l => mapaLeads.set(String(l.pessoaIdentificador), l));
    }

    let contatosExistentes = conversasValidas
        .map(c => ({ conversa: c, lead: mapaLeads.get(String(c.pessoaIdentificador)) }))
        .filter(c => c.lead)
        .filter(c => !termo || (c.lead.pessoaNome || '').toLowerCase().includes(termo));

    // Pin/arquivar (pedido do usuário, 2026-09-30) — arquivada some da
    // lista principal por padrão, só volta com "Ver arquivadas" marcado.
    const selectVerArquivadas = document.getElementById('wppVerArquivadas');
    if (!(selectVerArquivadas && selectVerArquivadas.checked)) {
        contatosExistentes = contatosExistentes.filter(c => !c.lead.wpp_arquivado);
    }

    // "Minhas conversas" (pedido do usuário, 2026-09-30, fila/distribuição
    // automática) — filtra por quem está logado (obterNomeAtendente()),
    // comparando com wpp_atendente_responsavel (atribuído sozinho pelo
    // whatsapp-webhook na 1ª mensagem de cada lead novo).
    const selectMinhasConversas = document.getElementById('wppMinhasConversas');
    if (selectMinhasConversas && selectMinhasConversas.checked) {
        const meuNome = typeof obterNomeAtendente === 'function' ? obterNomeAtendente() : null;
        contatosExistentes = contatosExistentes.filter(c => meuNome && c.lead.wpp_atendente_responsavel === meuNome);
    }

    // Ordenar/filtrar (pedido do usuário, 2026-09-29): "coloque uma forma
    // de ordenar e filtrar as conversas (não lidas, respostas mais
    // recentes, dentro da janela, etc.)". A query já vem ordenada por
    // mais recente (o padrão) — os outros modos reordenam em memória
    // sobre o que já foi buscado, sem bater no banco de novo.
    const selectSoJanela = document.getElementById('wppFiltroSoJanelaAberta');
    if (selectSoJanela && selectSoJanela.checked) {
        contatosExistentes = contatosExistentes.filter(c => {
            const restante = horasRestantesJanelaWpp(c.conversa);
            return restante !== null && restante > 0;
        });
    }

    // Badge de "sugestão de IA pronta" + insumo do modo "Prioridade" —
    // buscado ANTES de ordenar (o modo prioridade usa isso pra pontuar),
    // reaproveitado depois pro badge de cada card (não busca 2x).
    let idsComSugestaoPendente = new Set();
    if (contatosExistentes.length > 0) {
        const { data: pendentes } = await window.supabaseClient
            .from('sugestoes_resposta_wpp')
            .select('"pessoaIdentificador"')
            .eq('status', 'pendente')
            .in('pessoaIdentificador', contatosExistentes.map(c => c.lead.pessoaIdentificador));
        idsComSugestaoPendente = new Set((pendentes || []).map(p => String(p.pessoaIdentificador)));
    }

    const selectOrdenar = document.getElementById('wppOrdenarSelect');
    const modoOrdenar = selectOrdenar ? selectOrdenar.value : 'prioridade';
    if (modoOrdenar === 'prioridade') {
        // "Bot" de priorização (pedido do usuário, 2026-09-29): "organizar
        // a ordem de resposta por prioridade de forma inteligente e
        // automática" — combina os sinais que já existem no CRM (nunca
        // um cálculo obscuro/só-da-IA): sugestão de IA pronta pra revisar
        // pesa mais que tudo (já tem uma resposta pronta, só falta
        // autorizar); depois janela fechando (urgência real de prazo);
        // depois Lead Forte (potencial de conversão); depois não lida.
        const pontuar = ({ conversa, lead }) => {
            let pontos = 0;
            if (idsComSugestaoPendente.has(String(lead.pessoaIdentificador))) pontos += 1000;
            const restante = horasRestantesJanelaWpp(conversa);
            if (restante !== null) pontos += restante < 4 ? 400 : restante < 12 ? 200 : 50;
            const tags = typeof parseTags === 'function' ? parseTags(lead.tags) : [];
            if (tags.includes('Lead Forte 1')) pontos += 300;
            else if (tags.includes('Lead Forte 2')) pontos += 180;
            else if (tags.includes('Lead Forte 3')) pontos += 90;
            if (conversaNaoLidaWpp(conversa)) pontos += 60;
            return pontos;
        };
        contatosExistentes.sort((a, b) => {
            const diff = pontuar(b) - pontuar(a);
            return diff !== 0 ? diff : new Date(b.conversa.ultima_mensagem_em) - new Date(a.conversa.ultima_mensagem_em);
        });
    } else if (modoOrdenar === 'nao_lidas') {
        contatosExistentes.sort((a, b) => {
            const naoLidaA = conversaNaoLidaWpp(a.conversa) ? 1 : 0;
            const naoLidaB = conversaNaoLidaWpp(b.conversa) ? 1 : 0;
            if (naoLidaA !== naoLidaB) return naoLidaB - naoLidaA;
            return new Date(b.conversa.ultima_mensagem_em) - new Date(a.conversa.ultima_mensagem_em);
        });
    } else if (modoOrdenar === 'janela') {
        contatosExistentes.sort((a, b) => {
            const restA = horasRestantesJanelaWpp(a.conversa);
            const restB = horasRestantesJanelaWpp(b.conversa);
            // Quem não tem janela correndo (última mensagem foi nossa) vai
            // pro fim — não é urgente responder algo que já respondemos.
            if (restA === null && restB === null) return new Date(b.conversa.ultima_mensagem_em) - new Date(a.conversa.ultima_mensagem_em);
            if (restA === null) return 1;
            if (restB === null) return -1;
            return restA - restB; // menos tempo restante primeiro — mais urgente
        });
    }
    // 'recentes' — mantém a ordem já vinda da query (ultima_mensagem_em desc).

    // Fixada sempre sobe pro topo, INDEPENDENTE do modo de ordenação
    // escolhido acima (pedido do usuário, 2026-09-30: "igual no whatsapp
    // real") — `.sort()` é estável (spec ECMAScript), então essa 2ª
    // passada só reagrupa em 2 blocos (fixadas / não-fixadas) preservando
    // a ordem relativa que cada bloco já tinha do modo escolhido.
    contatosExistentes.sort((a, b) => (b.lead.wpp_fixado ? 1 : 0) - (a.lead.wpp_fixado ? 1 : 0));

    // "Iniciar nova conversa" — busca em TODA a base (respeitando o
    // filtro de filial escolhido, se houver), não só nos leads já
    // paginados pro navegador da filial atual (`leadsAtuais`) — pedido
    // implícito da unificação: dá pra começar uma conversa com QUALQUER
    // lead do sistema, de qualquer filial.
    let novosContatos = [];
    if (termo) {
        let queryNovos = window.supabaseClient
            .from('leads_inscricoes')
            .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero, filial')
            .is('lixeira_em', null)
            .ilike('pessoaNome', `%${termo}%`)
            .not('pessoaTelefoneNumero', 'is', null)
            .limit(15);
        if (wppFiltroFilial) queryNovos = queryNovos.eq('filial', wppFiltroFilial);
        const { data: candidatos } = await queryNovos;
        novosContatos = (candidatos || []).filter(l => !idsComConversa.has(String(l.pessoaIdentificador)));
    }

    let naoIdentUnicos = [];
    if (!termo) {
        const { data: naoIdentificados } = await window.supabaseClient
            .from('mensagens_whatsapp')
            .select('telefone_whatsapp, corpo_texto, criado_em')
            .is('pessoaIdentificador', null)
            // Exclui conversas da Importação em Lote sem lead vinculado
            // (nome_bruto_importado preenchido) — essas têm tela própria
            // ("Leads a Tratar" > "Conversas Importadas", js/leads-a-tratar.js);
            // aqui é só quem chegou de verdade pela API sem bater com ninguém.
            .is('nome_bruto_importado', null)
            .order('criado_em', { ascending: false })
            .limit(50);
        const vistos = new Set();
        (naoIdentificados || []).forEach(m => {
            if (!vistos.has(m.telefone_whatsapp)) { vistos.add(m.telefone_whatsapp); naoIdentUnicos.push(m); }
        });
    }

    if (contatosExistentes.length === 0 && novosContatos.length === 0 && naoIdentUnicos.length === 0) {
        lista.innerHTML = '<div style="padding:16px; font-size:12px; color:var(--text-muted);">Nenhuma conversa encontrada. Busque pelo nome de um lead pra iniciar uma nova.</div>';
        return;
    }

    let html = contatosExistentes.map(({ conversa, lead }) => htmlContatoWpp(lead, conversa, idsComSugestaoPendente.has(String(lead.pessoaIdentificador)))).join('');
    if (novosContatos.length > 0) {
        html += `<div style="padding:8px 14px; font-size:10px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Iniciar nova conversa</div>`;
        html += novosContatos.map(l => htmlContatoWpp(l, null)).join('');
    }
    if (naoIdentUnicos.length > 0) {
        html += `<div style="padding:8px 14px 2px;">
            <div style="font-size:10px; font-weight:700; color:#b45309; text-transform:uppercase;">Não identificados</div>
            <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">De QUALQUER filial (só existe 1 número de WhatsApp compartilhado hoje — não dá pra saber a escola antes de vincular)</div>
        </div>`;
        html += naoIdentUnicos.map(htmlContatoNaoIdentificadoWpp).join('');
    }
    lista.innerHTML = html;
}

function filtrarContatosWpp(valor) {
    renderizarContatosWpp(valor);
}

// "x" pra limpar a busca do WhatsApp Unificado (pedido do usuário,
// 2026-10-01) — só aparece com texto digitado.
function atualizarBotaoLimparBuscaWpp() {
    const input = document.getElementById('wppSearch');
    const btn = document.getElementById('wppSearchLimparBtn');
    if (!input || !btn) return;
    btn.style.display = input.value ? 'flex' : 'none';
}
function limparBuscaWpp() {
    const input = document.getElementById('wppSearch');
    if (!input) return;
    input.value = '';
    input.focus();
    atualizarBotaoLimparBuscaWpp();
    filtrarContatosWpp('');
}

// Bug real (2026-09-28): antes só olhava `leadsAtuais` (escopado à filial
// selecionada no topo) — abrir a conversa de um lead de OUTRA filial (a
// unificação de verdade pede isso) deixava `lead` undefined, quebrando o
// cabeçalho E a variável "filial"/"nome" dos templates (preencherValorAutomatico()
// também lê de `leadsAtuais`). Corrigido buscando do banco e MESCLANDO em
// `leadsAtuais` (mesmo padrão já usado por abrirResultadoBuscaGlobal(),
// js/app.js) quando o lead ainda não estiver carregado — depois disso,
// todo o resto do app (gaveta, templates, etc.) já enxerga esse lead
// normalmente, de qualquer filial.
async function abrirChatWpp(leadId) {
    wppContatoAtivoId = leadId;
    wppTelefoneNaoIdentAtivo = null;
    if (wppCanalNaoIdent) { window.supabaseClient.removeChannel(wppCanalNaoIdent); wppCanalNaoIdent = null; }
    marcarConversaLidaWpp(leadId);

    let lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
    if (!lead) {
        const { data, error } = await window.supabaseClient
            .from(typeof NOME_TABELA !== 'undefined' ? NOME_TABELA : 'leads_inscricoes')
            .select('*')
            .eq('pessoaIdentificador', leadId)
            .maybeSingle();
        if (!error && data) {
            leadsAtuais = [...leadsAtuais, data];
            lead = data;
        }
    }
    renderizarTagsWpp(leadId);
    carregarSugestaoIaWpp(leadId);

    if (wppCanalSugestaoIa) { window.supabaseClient.removeChannel(wppCanalSugestaoIa); wppCanalSugestaoIa = null; }
    wppCanalSugestaoIa = window.supabaseClient
        .channel(`wpp-sugestao-ia-${leadId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sugestoes_resposta_wpp', filter: `pessoaIdentificador=eq.${leadId}` }, () => {
            if (String(wppContatoAtivoId) === String(leadId)) carregarSugestaoIaWpp(leadId);
        })
        .subscribe();

    const searchEl = document.getElementById('wppSearch');
    renderizarContatosWpp(searchEl ? searchEl.value : '');

    const header = document.getElementById('wppChatHeader');
    if (header && lead) {
        // Pedido do usuário (2026-10-01): precisa ver o valor de contribuição
        // (mensalidade) da filial do lead sem sair do WhatsApp Unificado —
        // como o fluxo de trabalho aqui é por mensagem/lote (não dá pra ficar
        // abrindo a gaveta de cada lead só pra ver isso), mostra direto no
        // cabeçalho do chat + um botão pra consultar o valor de QUALQUER
        // outra filial na hora (mesmo dado de filiaisDisponiveis já
        // carregado, reaproveitado também pelas respostas rápidas
        // {valor_mensalidade}).
        const filialObjHeader = lead.filial ? ((typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).find(f => f.nome === lead.filial) || {}) : {};
        const mensalidadeTexto = filialObjHeader.valor_mensalidade != null
            ? `R$ ${Number(filialObjHeader.valor_mensalidade).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
            : 'não cadastrado';
        header.innerHTML = `
            <div style="width: 36px; height: 36px; background: #cbd5e1; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; color: white;"><i class="fa-solid fa-user"></i></div>
            <div style="flex:1;">
                <div style="font-size: 13px; font-weight: 600;">${escapeHTML(lead.pessoaNome || 'Sem nome')}</div>
                <div style="font-size: 11px; color: var(--na-green); display:flex; align-items:center; gap:4px; flex-wrap:wrap;"><i class="fa-brands fa-whatsapp"></i> ${escapeHTML(lead.pessoaTelefoneDDD || '')} ${escapeHTML(lead.pessoaTelefoneNumero || '')}${lead.filial ? ` · <i class="fa-solid fa-building"></i> ${escapeHTML(lead.filial)}` : ''}${lead.filial ? ` · <i class="fa-solid fa-sack-dollar"></i> ${mensalidadeTexto}` : ''}</div>
            </div>
            <button class="icon-btn" title="Consultar mensalidade de todas as filiais" onclick="abrirMensalidadesFiliaisWpp('${leadId}')"><i class="fa-solid fa-sack-dollar"></i></button>
            <button class="icon-btn" title="Buscar nesta conversa" onclick="chatWpp.toggleBuscaConversa()"><i class="fa-solid fa-magnifying-glass"></i></button>
            <button class="icon-btn" title="Exportar conversa (.txt) — auditoria/LGPD" onclick="exportarConversaWppTxt('${leadId}', '${escapeHTML(lead.pessoaNome || 'lead').replace(/'/g, '')}')"><i class="fa-solid fa-file-export"></i></button>
            <button class="icon-btn" title="Esse WhatsApp não é desta pessoa (telefone errado)" onclick="confirmarNumeroErradoWpp('${leadId}')"><i class="fa-solid fa-user-slash"></i></button>
            <button class="btn-toggle" style="font-size:10px;" title="Abre a ficha completa do lead (eventos, tags, resumo, lembrete, histórico, etc.)" onclick="abrirFichaCompletaDoWpp('${leadId}')"><i class="fa-solid fa-address-card"></i> Ficha completa</button>
        `;
    }

    await chatWpp.abrir(leadId);
}

// Vincula manualmente uma conversa "não identificada" (mensagem recebida
// de um número que não bateu com nenhum lead na hora do webhook) a um
// lead existente. Mesmo padrão de escrita direta do navegador já usado
// em outras partes do CRM (ex: tags) — ver policy de UPDATE em
// migracao_whatsapp.sql, que só libera linhas ainda sem pessoaIdentificador.
// Bug real relatado pelo usuário (2026-09-29): buscava só em `leadsAtuais`
// (escopado à filial selecionada no topo) — pra um duplicado CROSS-FILIAL
// (mesmo telefone em 2 filiais diferentes, o padrão real mais comum de
// "não identificado" achado nesta sessão), o lead certo podia nem estar
// carregado, e a busca dizia "nenhum lead encontrado" mesmo ele existindo.
// Agora busca direto no banco, em TODAS as filiais.
async function vincularConversaNaoIdentificada(telefoneWhatsapp) {
    const nomeBusca = prompt('Digite o nome (ou parte do nome) do lead pra vincular a esse número de WhatsApp:');
    if (!nomeBusca || !nomeBusca.trim()) return;

    const termo = nomeBusca.trim();
    const { data: candidatos, error: erroBusca } = await window.supabaseClient
        .from('leads_inscricoes')
        .select('pessoaIdentificador, pessoaNome, filial')
        .ilike('pessoaNome', `%${termo}%`)
        .is('lixeira_em', null)
        .limit(10);
    if (erroBusca) { alert('Erro ao buscar: ' + erroBusca.message); return; }
    if (!candidatos || candidatos.length === 0) { alert('Nenhum lead encontrado com esse nome.'); return; }
    if (candidatos.length > 1) {
        alert(`Encontrei ${candidatos.length} leads com esse nome — seja mais específico:\n` +
            candidatos.map(c => `${c.pessoaNome} (${c.filial || 'sem filial'})`).join('\n'));
        return;
    }

    const lead = candidatos[0];
    const { error } = await window.supabaseClient
        .from('mensagens_whatsapp')
        .update({ pessoaIdentificador: lead.pessoaIdentificador, filial: lead.filial })
        .eq('telefone_whatsapp', telefoneWhatsapp)
        .is('pessoaIdentificador', null);
    if (error) { alert('Erro ao vincular: ' + error.message); return; }

    wppTelefoneNaoIdentAtivo = null;
    if (wppCanalNaoIdent) { window.supabaseClient.removeChannel(wppCanalNaoIdent); wppCanalNaoIdent = null; }
    abrirChatWpp(lead.pessoaIdentificador);
}

// Refresca a lista de contatos a cada 1 min só pro timer de 24h
// (htmlTimerJanelaWpp()) não ficar visualmente parado — sem isso, o
// texto só atualizaria quando chegasse mensagem nova ou a pessoa trocasse
// de aba (mesmo espírito do setInterval de 3 min já usado pro SLA de
// coluna fria em js/app.js). Só roda de verdade se a aba WhatsApp
// Unificado estiver aberta na tela.
setInterval(() => {
    const tab = document.getElementById('tab-whatsapp');
    if (tab && tab.classList.contains('active')) {
        const searchEl = document.getElementById('wppSearch');
        renderizarContatosWpp(searchEl ? searchEl.value : '');
    }
}, 60 * 1000);

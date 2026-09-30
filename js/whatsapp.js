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
            { chave: null, label: 'evento/motivo (com artigo, ex: uma Palestra)' },
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
function textoComQuebrasDeLinha(texto, termoBusca) {
    let escapado = escapeHTML(texto || '');
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
    const corpoHTML = imagemUrl
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
function inserirEmojiNoInputWpp(inputEl, emoji) {
    if (!inputEl) return;
    const inicio = inputEl.selectionStart ?? inputEl.value.length;
    const fim = inputEl.selectionEnd ?? inputEl.value.length;
    inputEl.value = inputEl.value.slice(0, inicio) + emoji + inputEl.value.slice(fim);
    const novaPos = inicio + emoji.length;
    inputEl.focus();
    inputEl.setSelectionRange(novaPos, novaPos);
    if (typeof ajustarAlturaTextareaWpp === 'function') ajustarAlturaTextareaWpp(inputEl);
    fecharEmojiDigitarWpp();
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
    // Só sobre os balões já carregados (mesmo limite de 200 de
    // carregarHistoricoMensagens(), não busca no banco inteiro) — mas
    // agora igual o app real: NUNCA esconde o resto da conversa, só
    // destaca cada ocorrência (<mark>) e deixa navegar entre elas com
    // ⌃/⌄, mostrando "posição/total".
    let termoBusca = '';
    let buscaMatches = []; // mensagens (na ordem cronológica) que batem com termoBusca
    let buscaIndiceAtual = null; // índice dentro de buscaMatches — null = ainda não escolhido nesta busca
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

    function renderizarAreaInput() {
        const container = el(inputAreaId);
        if (!container) return;
        anexoPendente = null; // troca de conversa (recarregarHistorico() chama isto de novo) nunca deveria manter um anexo pendente de OUTRO lead

        if (janelaAberta(mensagens)) {
            container.innerHTML = `
                <div class="wpp-anexo-preview" style="display:none;"></div>
                <div class="chat-input-row">
                    <button type="button" class="btn-anexo-toggle" style="background: none; border: none; font-size: 18px; color: var(--text-muted); cursor: pointer;" title="Anexar foto ou documento"><i class="fa-solid fa-paperclip"></i></button>
                    <input type="file" class="wpp-anexo-input" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" hidden>
                    <button type="button" class="btn-emoji-toggle" style="background: none; border: none; font-size: 20px; color: var(--text-muted); cursor: pointer;" title="Emojis"><i class="fa-regular fa-face-smile"></i></button>
                    <textarea class="chat-input" rows="1" placeholder="Digite uma mensagem... (Ctrl+Enter pra nova linha)"></textarea>
                    <button type="button" class="btn-audio-toggle" title="Gravar áudio"><i class="fa-solid fa-microphone"></i></button>
                    <button type="button" class="btn-send"><i class="fa-solid fa-paper-plane"></i></button>
                </div>
            `;
            const input = container.querySelector('.chat-input');
            const botao = container.querySelector('.btn-send');
            const anexoBtn = container.querySelector('.btn-anexo-toggle');
            const anexoInput = container.querySelector('.wpp-anexo-input');
            const emojiBtn = container.querySelector('.btn-emoji-toggle');
            const audioBtn = container.querySelector('.btn-audio-toggle');
            const disparar = () => enviarMensagem(input);
            botao.addEventListener('click', disparar);
            // Enter sozinho envia (mesmo comportamento de sempre); Ctrl+Enter
            // (pedido do usuário, 2026-09-29) cai no padrão do <textarea> —
            // insere a quebra de linha, sem preventDefault nenhum.
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); disparar(); }
            });
            input.addEventListener('input', () => ajustarAlturaTextareaWpp(input));
            anexoBtn.addEventListener('click', () => anexoInput.click());
            anexoInput.addEventListener('change', () => {
                if (anexoInput.files[0]) selecionarAnexo(anexoInput.files[0]);
                anexoInput.value = ''; // permite escolher o MESMO arquivo de novo depois de remover
            });
            emojiBtn.addEventListener('click', () => abrirEmojiPickerDigitarWpp(emojiBtn, input));
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
            if (erroUpload) { alert('Erro ao subir o arquivo: ' + erroUpload.message); input.disabled = false; return; }

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
        renderizarAreaInput();
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

    const ids = Array.from(cardsSelecionados);
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

// Ao trocar de template: mostra o texto aprovado (fixo, só leitura) e
// monta 1 campo de texto por variável "manual" (chave: null) — essas
// valem pra TODOS os selecionados neste envio (ex: "evento/motivo" do
// template contato_aluno_ativo). Pré-preenche com o nome do evento
// escolhido, se houver — só um ponto de partida, sempre editável.
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
    camposEl.innerHTML = manuais.map(v => `
        <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">${escapeHTML(v.label)}</label>
        <input type="text" id="conviteApiManual-${v.indice}" style="width:100%; padding:8px; margin-bottom:8px; box-sizing:border-box;" value="${escapeHTML(eventoEscolhido ? eventoEscolhido.nome : '')}">
    `).join('');
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
    const ids = conviteApiModoSelecao === 'segmento'
        ? conviteApiSegmentoLeads.map(l => String(l.pessoaIdentificador))
        : Array.from(cardsSelecionados);

    // Quem já confirmou presença nesse evento não precisa ser convidado
    // de novo — só verificado quando um evento foi escolhido.
    let idsJaConfirmados = new Set();
    if (eventoId && ids.length > 0) {
        const { data: jaConfirmados } = await window.supabaseClient
            .from('evento_leads')
            .select('pessoaIdentificador')
            .eq('evento_id', eventoId)
            .eq('resposta_convite', 'confirmado')
            .in('pessoaIdentificador', ids);
        idsJaConfirmados = new Set((jaConfirmados || []).map(r => String(r.pessoaIdentificador)));
    }

    const linhas = [];
    let semTelefone = 0;
    let jaConfirmadosIgnorados = 0;

    ids.forEach(id => {
        if (idsJaConfirmados.has(String(id))) { jaConfirmadosIgnorados++; return; }
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

    document.getElementById('conviteApiEscolha').style.display = 'none';
    const previaEl = document.getElementById('conviteApiPrevia');
    previaEl.style.display = 'block';
    previaEl.innerHTML = `
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
const TAMANHO_LOTE_CONVITE_API = 5;
// Pausa entre lotes de disparo em massa (pedido do usuário, 2026-09-30:
// "o que pode melhorar" — "sem controle de throughput no disparo em
// massa além do lote de 5"). Não é uma garantia formal de taxa (a Meta
// tem seus próprios limites por número/qualidade, ver `messaging_limit`
// no WhatsApp Manager), só um respiro pra não bater dezenas de lotes de
// 5 em sequência imediata sem pausa nenhuma.
const PAUSA_ENTRE_LOTES_MS = 400;
function pausarWpp(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function confirmarEnviarConviteApiLote() {
    const { templateIndice, linhas } = conviteApiPreviaAtual;
    const tpl = TEMPLATES_WHATSAPP[templateIndice];
    if (!tpl || linhas.length === 0) return;

    if (!confirm(`Confirma o envio automático de "${tpl.label}" para ${linhas.length} lead(s) agora, via API da Meta? Essa ação não pode ser desfeita.`)) return;

    const previaEl = document.getElementById('conviteApiPrevia');
    const resultadoEl = document.getElementById('conviteApiResultado');
    previaEl.style.display = 'none';
    resultadoEl.style.display = 'block';
    resultadoEl.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Enviando...</p>';

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
        resultadoEl.innerHTML = `<p style="font-size:12px; color:var(--text-muted);">Enviando... (${resultados.length}/${linhas.length})</p>`;
        if (i + TAMANHO_LOTE_CONVITE_API < linhas.length) await pausarWpp(PAUSA_ENTRE_LOTES_MS);
    }

    const sucesso = resultados.filter(r => r.ok);
    const falha = resultados.filter(r => !r.ok);

    // Vincula evento_leads só pra quem o envio de fato saiu (nunca cria
    // um "convidado" fantasma pra quem a Meta rejeitou).
    if (conviteApiEventoAtual && sucesso.length > 0) {
        const vinculos = sucesso.map(r => ({ evento_id: conviteApiEventoAtual.id, pessoaIdentificador: r.pessoaIdentificador, origem: 'crm' }));
        await window.supabaseClient
            .from(typeof NOME_TABELA_EVENTO_LEADS !== 'undefined' ? NOME_TABELA_EVENTO_LEADS : 'evento_leads')
            .upsert(vinculos, { onConflict: 'evento_id,pessoaIdentificador', ignoreDuplicates: true });
    }

    if (typeof registrarLogAtividade === 'function' && (sucesso.length > 0 || falha.length > 0)) {
        registrarLogAtividade('convite_whatsapp_api_lote', {
            pessoaIds: sucesso.map(r => r.pessoaIdentificador),
            detalhes: { template: tpl.label, evento: conviteApiEventoAtual ? conviteApiEventoAtual.nome : null, enviados: sucesso.length, falhas: falha.length },
        });
    }

    // Pedido do usuário: mandar mensagem já tira o lead de uma coluna
    // fria — só quem ainda estava lá, nunca puxa de volta quem já avançou.
    await Promise.all(sucesso.map(r => moverParaAbordagemAposEnvio(r.pessoaIdentificador)));

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
    if (candidatos.length > 0) {
        const eventoIds = [...new Set(candidatos.map(c => c.evento.id))];
        const { data: jaConfirmados } = await window.supabaseClient
            .from('evento_leads')
            .select('"pessoaIdentificador", evento_id')
            .in('evento_id', eventoIds)
            .eq('resposta_convite', 'confirmado');
        const setConfirmados = new Set((jaConfirmados || []).map(r => `${r.evento_id}:${r.pessoaIdentificador}`));
        conviteJanelaAbertaCandidatos = candidatos.filter(c => !setConfirmados.has(`${c.evento.id}:${c.pessoaIdentificador}`));
    } else {
        conviteJanelaAbertaCandidatos = [];
    }

    renderizarPreviaConviteJanelaAberta(semEventoNaFilial, abertas.length);
}

function renderizarPreviaConviteJanelaAberta(semEventoNaFilial, totalAbertas) {
    const corpoEl = document.getElementById('conviteJanelaAbertaCorpo');
    if (!corpoEl) return;

    const avisoSemEvento = semEventoNaFilial > 0
        ? `<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-triangle-exclamation"></i> ${semEventoNaFilial} conversa(s) com janela aberta ignorada(s) — a filial deles não tem uma Abertura de Turma futura cadastrada na Agenda.</p>`
        : '';

    if (conviteJanelaAbertaCandidatos.length === 0) {
        corpoEl.innerHTML = `${avisoSemEvento}<p style="font-size:12px; color:var(--text-muted);">Nenhum candidato pra convidar agora (de ${totalAbertas} conversa(s) com janela aberta).</p><button class="btn-secondary" onclick="fecharModalConviteJanelaAberta()">Fechar</button>`;
        return;
    }

    corpoEl.innerHTML = `
        ${avisoSemEvento}
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
    if (corpoEl) corpoEl.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Enviando...</p>';

    const resultados = [];
    const TAMANHO_LOTE = 5;
    for (let i = 0; i < candidatos.length; i += TAMANHO_LOTE) {
        const lote = candidatos.slice(i, i + TAMANHO_LOTE);
        const respostas = await Promise.all(lote.map(async (c) => {
            try {
                const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
                    body: { pessoaIdentificador: c.pessoaIdentificador, tipo: 'texto', texto: c.texto, atendenteNome: (typeof obterNomeAtendente === 'function' ? obterNomeAtendente() : '') || '' },
                });
                if (error || !data || data.ok === false) return { ...c, ok: false, erro: (data && data.detalhe && data.detalhe.message) || data?.erro || error?.message || 'erro desconhecido' };
                return { ...c, ok: true };
            } catch (e) {
                return { ...c, ok: false, erro: String(e.message || e) };
            }
        }));
        resultados.push(...respostas);
        if (corpoEl) corpoEl.innerHTML = `<p style="font-size:12px; color:var(--text-muted);">Enviando... (${resultados.length}/${candidatos.length})</p>`;
        if (i + TAMANHO_LOTE < candidatos.length) await pausarWpp(PAUSA_ENTRE_LOTES_MS);
    }

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
    const preview = conversa
        ? `${conversa.ultima_direcao === 'saida' ? 'Você: ' : ''}${(conversa.ultimo_texto || '').slice(0, 40)}`
        : 'Toque para iniciar conversa';
    return `
        <div class="wpp-contact-item ${ativo} ${naoLida ? 'nao-lida' : ''}" onclick="abrirChatWpp('${id}')">
            <div class="wpp-contact-avatar"><i class="fa-solid fa-user"></i></div>
            <div class="wpp-contact-info" style="flex:1;">
                <div class="wpp-contact-name">${fixado ? '<i class="fa-solid fa-thumbtack" style="font-size:9px; color:var(--na-green-dark);" title="Fixada"></i> ' : ''}${escapeHTML(lead.pessoaNome || 'Sem nome')}${temSugestaoIa ? ' <i class="fa-solid fa-wand-magic-sparkles" style="color:#1d4ed8; font-size:10px;" title="Sugestão de resposta da IA pronta pra revisar"></i>' : ''}</div>
                <div class="wpp-contact-phone">${escapeHTML(preview)}</div>
                ${lead.filial ? `<div style="font-size:9px; color:var(--text-muted);"><i class="fa-solid fa-building"></i> ${escapeHTML(lead.filial)}</div>` : ''}
                ${htmlTimerJanelaWpp(conversa)}
            </div>
            <div class="wpp-contact-acoes">
                <button type="button" class="wpp-pin-btn ${fixado ? 'ativo' : ''}" title="${fixado ? 'Desafixar' : 'Fixar'} conversa" onclick="event.stopPropagation(); alternarFixarConversaWpp('${id}', ${fixado})"><i class="fa-solid fa-thumbtack"></i></button>
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
    `;
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
    `;
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
            .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero, filial, wpp_fixado, wpp_arquivado')
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
        header.innerHTML = `
            <div style="width: 36px; height: 36px; background: #cbd5e1; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; color: white;"><i class="fa-solid fa-user"></i></div>
            <div style="flex:1;">
                <div style="font-size: 13px; font-weight: 600;">${escapeHTML(lead.pessoaNome || 'Sem nome')}</div>
                <div style="font-size: 11px; color: var(--na-green); display:flex; align-items:center; gap:4px;"><i class="fa-brands fa-whatsapp"></i> ${escapeHTML(lead.pessoaTelefoneDDD || '')} ${escapeHTML(lead.pessoaTelefoneNumero || '')}${lead.filial ? ` · <i class="fa-solid fa-building"></i> ${escapeHTML(lead.filial)}` : ''}</div>
            </div>
            <button class="icon-btn" title="Buscar nesta conversa" onclick="chatWpp.toggleBuscaConversa()"><i class="fa-solid fa-magnifying-glass"></i></button>
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

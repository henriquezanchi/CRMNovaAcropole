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
        label: 'Contato inicial (pós-palestra)',
        corpoAprovado: 'Olá, {{1}}! Aqui quem fala é {{2}}, da Nova Acrópole. Tudo bem? Vi que você já esteve na Palestra {{3}} e gostaria de saber se ainda tem interesse em participar dos nossos próximos eventos de filosofia! Estamos abrindo uma nova turma em breve, quer saber mais detalhes de como funciona nosso curso?',
        variaveis: [
            { chave: 'nome', label: 'nome do lead' },
            { chave: 'atendente', label: 'atendente' },
            { chave: null, label: 'palestra' },
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

// Valor pré-preenchido pra uma variável de template, conforme sua chave —
// sempre EDITÁVEL depois (o SDR pode corrigir/trocar antes de enviar).
function preencherValorAutomatico(chave, leadId) {
    if (chave === 'nome') {
        const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));
        return lead ? primeiroNomeFormatado(lead.pessoaNome) : '';
    }
    if (chave === 'atendente') {
        return obterNomeAtendente() || '';
    }
    if (chave === 'filial') {
        const f = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).find(x => x.nome === filialAtual);
        if (f && f.nome_com_preposicao) return f.nome_com_preposicao;
        // Sem preposição configurada em "Gerenciar Filiais" — "de {nome}"
        // é uma aproximação razoável na maioria dos casos, mas editável.
        return filialAtual ? `de ${filialAtual}` : '';
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

function htmlMensagemWpp(m) {
    const classeDirecao = m.direcao === 'saida' ? 'msg-out' : 'msg-in';
    const classeExtra = m.wa_status === 'falhou' ? 'msg-falhou' : '';
    // Mensagem trazida de fora do CRM (js/importar-conversa-whatsapp.js,
    // enquanto a API do WhatsApp está bloqueada) — badge visível pra nunca
    // confundir com uma mensagem de verdade enviada/recebida pela API.
    const badgeImportada = m.importado_manualmente
        ? ' <i class="fa-solid fa-file-import" title="Importada de uma conversa feita fora do CRM" style="opacity:.6; font-size:10px;"></i>'
        : '';
    // Mensagem de imagem (Convite Compartilhável, ver confirmarConviteComFoto())
    // — a URL não vem de volta na resposta da Meta, foi guardada em
    // payload_bruto.imagem_url na hora do envio (ver whatsapp-send).
    const imagemUrl = m.tipo === 'imagem' ? (m.payload_bruto && m.payload_bruto.imagem_url) : null;
    const corpoHTML = imagemUrl
        ? `<img src="${escapeHTML(imagemUrl)}" alt="Imagem" style="max-width:100%; border-radius:6px; display:block; margin-bottom:${m.corpo_texto ? '4px' : '0'};">${m.corpo_texto ? escapeHTML(m.corpo_texto) : ''}`
        : escapeHTML(m.corpo_texto || '');
    // Nome do usuário logado (js/usuarios.js) que enviou esta mensagem —
    // pedido do usuário ("no whatsapp precisa aparecer o nome do usuário
    // que está logado"). Só existe em mensagens de SAÍDA a partir da
    // migração migracao_whatsapp_atendente.sql; mensagens antigas/de
    // entrada não têm.
    const atendenteHTML = (m.direcao === 'saida' && m.atendente_nome)
        ? `<div class="msg-atendente">${escapeHTML(m.atendente_nome)}</div>`
        : '';
    return `
        <div class="msg ${classeDirecao} ${classeExtra}">
            ${corpoHTML}
            ${atendenteHTML}
            <div class="msg-time">${badgeImportada}${formatarHoraWpp(m.criado_em)}${m.direcao === 'saida' ? statusIconHTML(m) : ''}</div>
        </div>
    `;
}

async function carregarHistoricoMensagens(pessoaIdentificador) {
    if (!pessoaIdentificador) return [];
    const { data, error } = await window.supabaseClient
        .from('mensagens_whatsapp')
        .select('*')
        .eq('pessoaIdentificador', pessoaIdentificador)
        .order('criado_em', { ascending: true })
        .limit(200);
    if (error) { console.error('Erro ao carregar histórico do WhatsApp:', error); return []; }
    return data || [];
}

// ==========================================================
// Controller de chat reaproveitável — instanciado uma vez pra aba
// unificada e uma vez pra gaveta lateral do lead, sem duplicar lógica.
// ==========================================================
function criarChatController({ messagesId, inputAreaId }) {
    let leadId = null;
    let mensagens = [];
    let canal = null;

    const el = (id) => document.getElementById(id);

    function renderizarMensagens() {
        const container = el(messagesId);
        if (!container) return;
        if (mensagens.length === 0) {
            container.innerHTML = '<div style="text-align:center; font-size:11px; color:#64748b; margin-top:20px;">Nenhuma mensagem ainda. Envie a primeira abaixo.</div>';
            return;
        }
        container.innerHTML = mensagens.map(htmlMensagemWpp).join('');
        container.scrollTop = container.scrollHeight;
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

            let preview = tpl.corpoAprovado || tpl.label;
            params.forEach((valor, i) => { preview = preview.split(`{{${i + 1}}}`).join(valor); });

            botao.disabled = true;
            const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
                body: { pessoaIdentificador: leadId, tipo: 'template', templateNome: tpl.nome, templateIdioma: tpl.idioma || 'pt_BR', templateParams: params, templatePreview: preview, atendenteNome: obterNomeAtendente() }
            });
            botao.disabled = false;

            if (error) { alert('Erro ao enviar modelo: ' + error.message); return; }
            if (!data.ok) {
                console.error('Erro ao enviar modelo (WhatsApp):', data.detalhe || data.erro);
                alert('Não foi possível enviar o modelo: ' + mensagemErroWpp(data));
                return;
            }
            await recarregarHistorico();
        });
    }

    function renderizarAreaInputTemplate() {
        const container = el(inputAreaId);
        if (!container) return;
        container.innerHTML = htmlSeletorTemplate();
        ligarHandlersTemplate(container);
    }

    function renderizarAreaInput() {
        const container = el(inputAreaId);
        if (!container) return;

        if (janelaAberta(mensagens)) {
            container.innerHTML = `
                <button type="button" style="background: none; border: none; font-size: 20px; color: var(--text-muted); cursor: pointer;"><i class="fa-regular fa-face-smile"></i></button>
                <input type="text" class="chat-input" placeholder="Digite uma mensagem...">
                <button type="button" class="btn-send"><i class="fa-solid fa-paper-plane"></i></button>
            `;
            const input = container.querySelector('.chat-input');
            const botao = container.querySelector('.btn-send');
            const disparar = () => enviarTexto(input);
            botao.addEventListener('click', disparar);
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') disparar(); });
        } else {
            renderizarAreaInputTemplate();
        }
    }

    async function enviarTexto(input) {
        const texto = input.value.trim();
        if (!texto || !leadId) return;
        input.value = '';
        input.disabled = true;

        const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-send', {
            body: { pessoaIdentificador: leadId, tipo: 'texto', texto, atendenteNome: obterNomeAtendente() }
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
    }

    async function recarregarHistorico() {
        if (!leadId) return;
        mensagens = await carregarHistoricoMensagens(leadId);
        renderizarMensagens();
        renderizarAreaInput();
    }

    async function abrir(pessoaIdentificador) {
        if (canal) { window.supabaseClient.removeChannel(canal); canal = null; }
        leadId = pessoaIdentificador;
        mensagens = [];

        const containerMsgs = el(messagesId);
        if (containerMsgs) containerMsgs.innerHTML = '<div style="text-align:center; font-size:11px; color:#64748b; margin-top:20px;">Carregando conversa...</div>';

        mensagens = await carregarHistoricoMensagens(leadId);
        renderizarMensagens();
        renderizarAreaInput();

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

    return { abrir, fechar, preencherTexto };
}

const chatWpp = criarChatController({ messagesId: 'wppMessages', inputAreaId: 'wppChatInputArea' });
const chatDrawer = criarChatController({ messagesId: 'drawer-messages', inputAreaId: 'drawerChatInputArea' });

// ==========================================================
// CONVITE PADRÃO PARA EVENTOS (botão na gaveta do lead)
// ==========================================================
// Vale pra QUALQUER evento cadastrado na Agenda, não só Abertura de Turma
// — a pessoa escolhe o evento num seletor, e o texto final leva o nome de
// quem está mandando, o nome da filial, o evento/data escolhidos e (se
// houver) os interesses do lead conforme as tags da família "Interesses /
// Origem". Dois textos-base conforme o lead já é aluno ativo ou não —
// ajuste livremente, são só um ponto de partida.
const CONVITE_EVENTO_NAO_ALUNO = `Olá, {nome}! Tudo bem? Aqui é {atendente}, da Nova Acrópole - {filial}. 😊 Vai rolar {evento}{quando} e eu queria muito te convidar pra vir!{interesses} Posso te passar mais detalhes?`;
const CONVITE_EVENTO_ATIVO = `Olá, {nome}! Tudo bem? Aqui é {atendente}, da Nova Acrópole - {filial}. 😊 Vai rolar {evento}{quando}, e você é muito importante nesse momento! Você pode: 1) encaminhar esse convite pra quem você acha que ia gostar de conhecer; 2) me passar o telefone de alguém que valeria a pena a gente chamar pessoalmente; ou 3) topar ser voluntário(a) no dia, ajudando a receber o pessoal. Me conta o que topa fazer? 🙏`;

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
function abrirSeletorConviteEvento() {
    if (typeof currentLeadId === 'undefined' || !currentLeadId) return;
    const select = document.getElementById('drawerConviteEventoSelect');
    const form = document.getElementById('drawerConviteEventoForm');
    if (!select || !form) return;

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

    const primeiroNome = primeiroNomeFormatado(lead.pessoaNome);
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
}

// Só preenche a caixa de texto do chat da gaveta (não envia sozinho) —
// o SDR revisa e manda, igual qualquer outra mensagem. Só funciona dentro
// da janela de 24h (preencherTexto() devolve false fora dela, já que nesse
// caso só dá pra enviar por template aprovado); nesse caso, mostra o texto
// num alert pra copiar manualmente.
function enviarConviteEvento(evento) {
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(currentLeadId));
    if (!lead) return;

    const tagsLead = (typeof parseTags === 'function' ? parseTags(lead.tags) : []).map(t => t.trim()).filter(Boolean);
    const ehAtivo = tagsLead.includes('Ativo') || tagsLead.includes('Aluno Ativo');
    const primeiroNome = primeiroNomeFormatado(lead.pessoaNome);
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

    const texto = (ehAtivo ? CONVITE_EVENTO_ATIVO : CONVITE_EVENTO_NAO_ALUNO)
        .replace('{nome}', primeiroNome)
        .replace('{atendente}', atendente || 'a equipe da Nova Acrópole')
        .replace('{filial}', filialAtual || '')
        .replace('{evento}', evento.nome)
        .replace('{quando}', quando)
        .replace('{interesses}', fraseInteresses);

    const preencheu = chatDrawer.preencherTexto(texto);
    if (!preencheu) {
        alert('Essa conversa está fora da janela de 24h, então não dá pra preencher o campo de texto livre (precisa de um template aprovado). Aqui está o texto do convite pra copiar manualmente:\n\n' + texto);
    }
}

// ==========================================================
// Aba unificada — lista de conversas
// ==========================================================
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

function htmlContatoWpp(lead, conversa) {
    const id = lead.pessoaIdentificador;
    const ativo = String(id) === String(wppContatoAtivoId) ? 'active' : '';
    const preview = conversa
        ? `${conversa.ultima_direcao === 'saida' ? 'Você: ' : ''}${(conversa.ultimo_texto || '').slice(0, 40)}`
        : 'Toque para iniciar conversa';
    return `
        <div class="wpp-contact-item ${ativo}" onclick="abrirChatWpp('${id}')">
            <div class="wpp-contact-avatar"><i class="fa-solid fa-user"></i></div>
            <div class="wpp-contact-info">
                <div class="wpp-contact-name">${escapeHTML(lead.pessoaNome || 'Sem nome')}</div>
                <div class="wpp-contact-phone">${escapeHTML(preview)}</div>
                ${lead.filial ? `<div style="font-size:9px; color:var(--text-muted);"><i class="fa-solid fa-building"></i> ${escapeHTML(lead.filial)}</div>` : ''}
            </div>
        </div>
    `;
}

function htmlContatoNaoIdentificadoWpp(m) {
    return `
        <div class="wpp-contact-item">
            <div class="wpp-contact-avatar" style="background:#f59e0b;"><i class="fa-solid fa-question"></i></div>
            <div class="wpp-contact-info" style="flex:1;">
                <div class="wpp-contact-name">${escapeHTML(m.telefone_whatsapp)}</div>
                <div class="wpp-contact-phone">${escapeHTML((m.corpo_texto || '').slice(0, 40))}</div>
            </div>
            <button class="btn-add-tag" style="flex-shrink:0;" onclick="event.stopPropagation(); vincularConversaNaoIdentificada('${m.telefone_whatsapp}')">Vincular</button>
        </div>
    `;
}

async function renderizarContatosWpp(filtro = '') {
    const lista = document.getElementById('wppContactList');
    if (!lista) return;
    iniciarEscutaGlobalWpp();

    const termo = (filtro || '').trim().toLowerCase();

    const { data: conversas } = await window.supabaseClient
        .from('vw_wpp_conversas')
        .select('*')
        .eq('filial', filialAtual)
        .order('ultima_mensagem_em', { ascending: false })
        .limit(200);
    const conversasValidas = conversas || [];
    const idsComConversa = new Set(conversasValidas.map(c => String(c.pessoaIdentificador)));

    const mapaLeads = new Map(leadsAtuais.map(l => [String(l.pessoaIdentificador), l]));
    const idsFaltando = conversasValidas.map(c => c.pessoaIdentificador).filter(id => !mapaLeads.has(String(id)));
    if (idsFaltando.length > 0) {
        const { data: extras } = await window.supabaseClient
            .from('leads_inscricoes')
            .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero, filial')
            .in('pessoaIdentificador', idsFaltando);
        (extras || []).forEach(l => mapaLeads.set(String(l.pessoaIdentificador), l));
    }

    const contatosExistentes = conversasValidas
        .map(c => ({ conversa: c, lead: mapaLeads.get(String(c.pessoaIdentificador)) }))
        .filter(c => c.lead)
        .filter(c => !termo || (c.lead.pessoaNome || '').toLowerCase().includes(termo));

    let novosContatos = [];
    if (termo) {
        novosContatos = leadsAtuais
            .filter(l => !idsComConversa.has(String(l.pessoaIdentificador)))
            .filter(l => (l.pessoaNome || '').toLowerCase().includes(termo))
            .filter(l => l.pessoaTelefoneNumero)
            .slice(0, 15);
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

    let html = contatosExistentes.map(({ conversa, lead }) => htmlContatoWpp(lead, conversa)).join('');
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

async function abrirChatWpp(leadId) {
    wppContatoAtivoId = leadId;
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(leadId));

    const searchEl = document.getElementById('wppSearch');
    renderizarContatosWpp(searchEl ? searchEl.value : '');

    const header = document.getElementById('wppChatHeader');
    if (header && lead) {
        header.innerHTML = `
            <div style="width: 36px; height: 36px; background: #cbd5e1; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; color: white;"><i class="fa-solid fa-user"></i></div>
            <div>
                <div style="font-size: 13px; font-weight: 600;">${escapeHTML(lead.pessoaNome || 'Sem nome')}</div>
                <div style="font-size: 11px; color: var(--na-green); display:flex; align-items:center; gap:4px;"><i class="fa-brands fa-whatsapp"></i> ${escapeHTML(lead.pessoaTelefoneDDD || '')} ${escapeHTML(lead.pessoaTelefoneNumero || '')}</div>
            </div>
        `;
    }

    await chatWpp.abrir(leadId);
}

// Vincula manualmente uma conversa "não identificada" (mensagem recebida
// de um número que não bateu com nenhum lead na hora do webhook) a um
// lead existente. Mesmo padrão de escrita direta do navegador já usado
// em outras partes do CRM (ex: tags) — ver policy de UPDATE em
// migracao_whatsapp.sql, que só libera linhas ainda sem pessoaIdentificador.
async function vincularConversaNaoIdentificada(telefoneWhatsapp) {
    const nomeBusca = prompt('Digite o nome (ou parte do nome) do lead pra vincular a esse número de WhatsApp:');
    if (!nomeBusca || !nomeBusca.trim()) return;

    const termo = nomeBusca.trim().toLowerCase();
    const candidatos = leadsAtuais.filter(l => (l.pessoaNome || '').toLowerCase().includes(termo));
    if (candidatos.length === 0) { alert('Nenhum lead encontrado com esse nome (entre os leads já carregados na tela).'); return; }
    if (candidatos.length > 1) { alert(`Encontrei ${candidatos.length} leads com esse nome — seja mais específico.`); return; }

    const lead = candidatos[0];
    const { error } = await window.supabaseClient
        .from('mensagens_whatsapp')
        .update({ pessoaIdentificador: lead.pessoaIdentificador, filial: lead.filial })
        .eq('telefone_whatsapp', telefoneWhatsapp)
        .is('pessoaIdentificador', null);
    if (error) { alert('Erro ao vincular: ' + error.message); return; }

    const searchEl = document.getElementById('wppSearch');
    renderizarContatosWpp(searchEl ? searchEl.value : '');
}

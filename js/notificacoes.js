// ==========================================================
// CENTRAL DE NOTIFICAÇÕES — sino no topbar, avisa sobre coisas que
// merecem atenção sem precisar ficar checando o CRM manualmente:
// Lead Forte 1 novo, evento quase lotado, lembrete de follow-up vencido/
// de hoje, e mensagem de WhatsApp recebida (mesmo se o chat daquele lead
// não estiver aberto). Tudo em memória (não persiste no banco nem entre
// sessões) — é um alerta do momento, não um histórico.
//
// Depende de funções/variáveis já definidas em app.js (leadsAtuais,
// filialAtual, parseTags(), escapeHTML(), abrirResultadoBuscaGlobal(),
// switchModule(), NOME_TABELA) e em eventos.js (eventosAtuais,
// participantesResumoPorEvento), todos carregados ANTES deste arquivo.

let notificacoesAtuais = []; // [{id, icone, titulo, mensagem, criadoEm, lida, aoClicar}]

// ==========================================
// NÚCLEO: criar/exibir notificações
// ==========================================
// "icone" é a classe COMPLETA do Font Awesome (ex: "fa-solid fa-fire",
// "fa-brands fa-whatsapp") — não só o nome, já que ícones de marca usam
// um prefixo diferente de fa-solid.
function adicionarNotificacao({ icone, titulo, mensagem, aoClicar }) {
    const notif = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        icone: icone || 'fa-solid fa-bell',
        titulo,
        mensagem,
        criadoEm: new Date(),
        lida: false,
        aoClicar: aoClicar || null,
    };
    notificacoesAtuais.unshift(notif);
    if (notificacoesAtuais.length > 30) notificacoesAtuais.length = 30; // não deixa crescer sem limite numa sessão longa
    renderizarNotificacoes();

    // Notificação nativa do navegador — funciona mesmo com a aba em
    // segundo plano (mas só se a aba continuar aberta; sem service worker,
    // não chega nada com o navegador fechado). Só dispara se a permissão
    // já foi concedida — pedir a permissão é feito em togglePainelNotificacoes().
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification(titulo, { body: mensagem, icon: 'img/logo-nova-acropole.png' }); } catch (e) { /* alguns navegadores bloqueiam sem interação recente — ignora */ }
    }
}

function renderizarNotificacoes() {
    const badge = document.getElementById('notificacoesBadge');
    const lista = document.getElementById('notificacoesLista');
    if (!badge || !lista) return;

    const naoLidas = notificacoesAtuais.filter(n => !n.lida).length;
    badge.style.display = naoLidas > 0 ? 'flex' : 'none';
    badge.innerText = naoLidas > 9 ? '9+' : String(naoLidas);

    if (notificacoesAtuais.length === 0) {
        lista.innerHTML = '<div class="notificacoes-vazio">Nenhuma notificação ainda.</div>';
        return;
    }

    lista.innerHTML = notificacoesAtuais.map(n => `
        <div class="notificacao-item ${n.lida ? '' : 'notificacao-nao-lida'}" onclick="clicarNotificacao('${n.id}')">
            <i class="${n.icone}"></i>
            <div class="notificacao-corpo">
                <div class="notificacao-titulo">${escapeHTML(n.titulo)}</div>
                <div class="notificacao-mensagem">${escapeHTML(n.mensagem)}</div>
                <div class="notificacao-hora">${n.criadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
        </div>
    `).join('');
}

function clicarNotificacao(id) {
    const n = notificacoesAtuais.find(x => String(x.id) === String(id));
    if (!n) return;
    n.lida = true;
    fecharPainelNotificacoes();
    renderizarNotificacoes();
    if (n.aoClicar) n.aoClicar();
}

function togglePainelNotificacoes() {
    const painel = document.getElementById('notificacoesPainel');
    if (!painel) return;
    const abrindo = !painel.classList.contains('open');
    painel.classList.toggle('open');

    // Pede a permissão de notificação do navegador na primeira vez que a
    // pessoa abre o painel (gesto do usuário — a maioria dos navegadores
    // bloqueia esse pedido se disparado sozinho, sem interação).
    if (abrindo && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function fecharPainelNotificacoes() {
    const painel = document.getElementById('notificacoesPainel');
    if (painel) painel.classList.remove('open');
}

function marcarTodasNotificacoesComoLidas() {
    notificacoesAtuais.forEach(n => n.lida = true);
    renderizarNotificacoes();
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.notificacoes-wrapper')) fecharPainelNotificacoes();
});

// ==========================================
// GATILHO 1: Lead Forte 1 novo
// ==========================================
// Chamada de dentro de renderizarCards() (js/app.js) — reaproveita
// leadsAtuais, sem query extra. Na 1ª vez que roda pra uma filial, só
// estabelece a base (todo mundo que já tinha a tag "Lead Forte 1") sem
// notificar — senão TODOS os Lead Forte 1 já existentes disparariam
// notificação assim que a página abre. Dali em diante, só quem aparece
// de novo (reimportação, matrícula-importer criando lead novo etc.) gera
// notificação. Limitação conhecida: um Lead Forte 1 que só é carregado
// depois via "Carregar Mais" (não estava nos primeiros 500) pode disparar
// 1 notificação "atrasada" na hora que a página buscar aquele lote — nunca
// mais que isso, e é um efeito colateral aceitável da paginação.
let leadForteBaselinePronta = false;
let leadForteJaVistos = new Set();

function resetarNotificacoesLeadForte() {
    leadForteBaselinePronta = false;
    leadForteJaVistos = new Set();
}

function verificarNotificacoesLeadForte() {
    if (typeof leadsAtuais === 'undefined' || typeof parseTags !== 'function') return;

    const atuais = new Set();
    leadsAtuais.forEach(l => {
        const tags = parseTags(l.tags).map(t => t.trim());
        if (tags.includes('Lead Forte 1')) atuais.add(String(l.pessoaIdentificador));
    });

    if (!leadForteBaselinePronta) {
        leadForteJaVistos = atuais;
        leadForteBaselinePronta = true;
        return;
    }

    atuais.forEach(id => {
        if (leadForteJaVistos.has(id)) return;
        leadForteJaVistos.add(id);
        const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === id);
        if (!lead) return;
        adicionarNotificacao({
            icone: 'fa-solid fa-fire',
            titulo: 'Novo Lead Forte 1',
            mensagem: `${lead.pessoaNome || 'Lead sem nome'} — alta propensão a matricular.`,
            aoClicar: () => { if (typeof abrirResultadoBuscaGlobal === 'function') abrirResultadoBuscaGlobal(id); },
        });
    });
}

// ==========================================
// GATILHO 2: Evento quase lotado
// ==========================================
// Chamada de dentro de renderizarListaEventos() (js/eventos.js) —
// reaproveita eventosAtuais/participantesResumoPorEvento já carregados.
let eventosQuaseLotadosNotificados = new Set();

function resetarNotificacoesEventos() {
    eventosQuaseLotadosNotificados = new Set();
}

const LIMIAR_EVENTO_QUASE_LOTADO = 0.9; // 90% da capacidade

function verificarNotificacoesEventoLotado() {
    if (typeof eventosAtuais === 'undefined' || typeof participantesResumoPorEvento === 'undefined') return;

    eventosAtuais.forEach(ev => {
        if (!ev.capacidade || ev.capacidade <= 0) return;
        const resumo = participantesResumoPorEvento.get(ev.id);
        const confirmados = resumo ? resumo.confirmados : 0;
        if (confirmados <= 0) return;
        if ((confirmados / ev.capacidade) < LIMIAR_EVENTO_QUASE_LOTADO) return;
        if (eventosQuaseLotadosNotificados.has(ev.id)) return;

        eventosQuaseLotadosNotificados.add(ev.id);
        adicionarNotificacao({
            icone: 'fa-solid fa-calendar-days',
            titulo: 'Evento quase lotado',
            mensagem: `${ev.nome}: ${confirmados}/${ev.capacidade} confirmados.`,
            aoClicar: () => { if (typeof switchModule === 'function') switchModule('tab-agenda', 'Agenda de Eventos', 'Atividades e capacidade por filial'); },
        });
    });
}

// ==========================================
// GATILHO 3: Lembretes de follow-up vencidos/de hoje
// ==========================================
// Diferente dos outros 2 (que reaproveitam dado já carregado), este faz
// uma busca própria no banco — precisa funcionar mesmo com a aba Dashboard
// fechada, então não pode depender de atualizarLembretesPendentes() (que
// só roda quando o Dashboard está visível). Poll periódico, ver o
// setInterval no fim do arquivo.
let lembretesJaNotificadosHoje = new Set(); // chave "pessoaId:data" — zera sozinho a cada reload da página

async function verificarNotificacoesLembretes() {
    if (!filialAtual || typeof window.supabaseClient === 'undefined') return;

    const hojeISO = new Date().toISOString().slice(0, 10);
    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('pessoaIdentificador, pessoaNome, lembrete_em')
        .eq('filial', filialAtual)
        .lte('lembrete_em', hojeISO)
        .order('lembrete_em', { ascending: true })
        .limit(20);

    if (error || !data) return;

    data.forEach(l => {
        const chave = `${l.pessoaIdentificador}:${l.lembrete_em}`;
        if (lembretesJaNotificadosHoje.has(chave)) return;
        lembretesJaNotificadosHoje.add(chave);

        adicionarNotificacao({
            icone: 'fa-solid fa-bell',
            titulo: 'Lembrete de follow-up',
            mensagem: `${l.pessoaNome || 'Lead'} — follow-up ${l.lembrete_em < hojeISO ? 'atrasado' : 'de hoje'}.`,
            aoClicar: () => { if (typeof abrirResultadoBuscaGlobal === 'function') abrirResultadoBuscaGlobal(l.pessoaIdentificador); },
        });
    });
}

// ==========================================
// GATILHO 4: Mensagem de WhatsApp recebida (GLOBAL de verdade — 2026-09-28)
// ==========================================
// Diferente do canal Realtime já existente em criarChatController()
// (js/whatsapp.js), que só escuta enquanto aquele chat específico está
// aberto na gaveta/aba WhatsApp — este é um canal PRÓPRIO, sempre ativo,
// independente de qual aba/lead está sendo visto.
//
// Bug real corrigido (mesma classe do "WhatsApp Unificado nunca foi de
// verdade unificado" — ver CLAUDE.md): apesar do nome "Globais", este
// canal só escutava mensagens da FILIAL ATUAL (`filter: filial=eq.${filialAtual}`)
// — uma mensagem de outra filial nunca notificava nada, mesmo com o
// WhatsApp já sendo cross-filial. Removido o filtro — agora é
// literalmente global, qualquer filial.
let canalWppNotificacoesGlobais = null;

function iniciarNotificacoesWhatsAppGlobais() {
    if (canalWppNotificacoesGlobais) {
        window.supabaseClient.removeChannel(canalWppNotificacoesGlobais);
        canalWppNotificacoesGlobais = null;
    }
    if (typeof window.supabaseClient === 'undefined') return;

    canalWppNotificacoesGlobais = window.supabaseClient
        .channel('wpp-notificacoes-global')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensagens_whatsapp' }, (payload) => {
            const msg = payload.new;
            if (msg.direcao !== 'entrada') return;

            const lead = (typeof leadsAtuais !== 'undefined')
                ? leadsAtuais.find(l => String(l.pessoaIdentificador) === String(msg.pessoaIdentificador))
                : null;
            const nome = lead ? lead.pessoaNome : (msg.telefone_whatsapp || 'contato não identificado');

            const aoClicar = () => {
                if (msg.pessoaIdentificador && typeof abrirResultadoBuscaGlobal === 'function') {
                    abrirResultadoBuscaGlobal(msg.pessoaIdentificador);
                } else if (typeof switchModule === 'function') {
                    switchModule('tab-whatsapp', 'WhatsApp Unificado', 'Caixa de entrada centralizada');
                }
            };

            adicionarNotificacao({
                icone: 'fa-brands fa-whatsapp',
                titulo: `Nova mensagem de ${nome}`,
                mensagem: (msg.corpo_texto || '').slice(0, 100),
                aoClicar,
            });

            // Pop-up visível na tela (pedido do usuário: "coloque um pop
            // up no crm sempre que recebermos uma mensagem pelo
            // whatsapp") — diferente do sino (exige abrir o painel) e da
            // notificação nativa do navegador (só aparece se a permissão
            // já foi concedida antes), este SEMPRE aparece, sem depender
            // de nada além do CRM estar com a aba aberta.
            if (typeof mostrarPopupWhatsApp === 'function') {
                mostrarPopupWhatsApp({ titulo: `Nova mensagem de ${nome}`, mensagem: msg.corpo_texto || '', aoClicar });
            }
        })
        .subscribe();
}

// ==========================================
// Pop-up de mensagem recebida — ver comentário acima. Criado
// dinamicamente (sem precisar de markup no index.html); auto-some
// depois de alguns segundos, ou ao clicar em qualquer lugar (menos no
// "x" de fechar, que só fecha sem abrir a conversa).
// ==========================================
function _containerPopupWpp() {
    let container = document.getElementById('wppPopupContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'wppPopupContainer';
        document.body.appendChild(container);
    }
    return container;
}

function mostrarPopupWhatsApp({ titulo, mensagem, aoClicar }) {
    const container = _containerPopupWpp();
    const popup = document.createElement('div');
    popup.className = 'wpp-popup-toast';
    popup.innerHTML = `
        <i class="fa-brands fa-whatsapp wpp-popup-toast-icone"></i>
        <div class="wpp-popup-toast-corpo">
            <div class="wpp-popup-toast-titulo">${escapeHTML(titulo || '')}</div>
            <div class="wpp-popup-toast-msg">${escapeHTML((mensagem || '').slice(0, 100))}</div>
        </div>
        <button type="button" class="wpp-popup-toast-fechar" title="Fechar">✕</button>
    `;
    const remover = () => { if (popup.parentNode) popup.parentNode.removeChild(popup); };
    popup.querySelector('.wpp-popup-toast-fechar').addEventListener('click', (e) => { e.stopPropagation(); remover(); });
    popup.addEventListener('click', () => { if (typeof aoClicar === 'function') aoClicar(); remover(); });
    container.appendChild(popup);
    setTimeout(remover, 8000);
}

// ==========================================
// GATILHO 5: Sincronização automática travada (Ulisses/Mercúrio)
// ==========================================
// Alimentado por status_sincronizacao_automatica (migracao_credenciais_scraper.sql),
// escrita pelo futuro job de scraping (projeto à parte, ainda não
// implementado — ver CLAUDE.md/"Login Automático"). Sem NENHUMA linha
// ainda (scraper nunca rodou), fica em silêncio — não inventa alerta de
// algo que não existe. Quando o scraper existir, qualquer tentativa que
// falhe, ou cuja última tentativa bem-sucedida esteja velha demais
// (folga de HORAS_LIMITE_SEM_SYNC sobre um job diário), dispara aviso.
const HORAS_LIMITE_SEM_SYNC = 26;

// Bug real relatado pelo usuário (2026-09-10): "sempre que atualizo a
// página, aparecem NOVAS notificações de Ulisses travado" — mesmo sem
// nenhuma tentativa nova de verdade. Causa: esse Set (chave
// "sistema:filial:executado_em") só existia em memória, então zerava a
// cada F5 — a MESMA linha de falha antiga (executado_em sem mudar) virava
// "nova" de novo em todo reload. Persistido em localStorage agora, então
// uma falha já notificada continua não-notificada depois de recarregar a
// página; só uma tentativa GENUINAMENTE nova (executado_em diferente,
// escrito pelo scraper de verdade) gera uma notificação nova.
const CHAVE_LS_SINCRONIZACOES_NOTIFICADAS = 'crm_na_sincronizacoes_notificadas';
function carregarSincronizacoesJaNotificadas() {
    try {
        const arr = JSON.parse(localStorage.getItem(CHAVE_LS_SINCRONIZACOES_NOTIFICADAS) || '[]');
        return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
}
function salvarSincronizacoesJaNotificadas(set) {
    try {
        // Cap pra nunca crescer sem limite numa base antiga com muita falha acumulada.
        localStorage.setItem(CHAVE_LS_SINCRONIZACOES_NOTIFICADAS, JSON.stringify([...set].slice(-200)));
    } catch { /* ignora */ }
}
let sincronizacoesJaNotificadas = carregarSincronizacoesJaNotificadas(); // chave "sistema:filial:executado_em"

async function verificarNotificacoesSincronizacao() {
    if (!filialAtual || typeof window.supabaseClient === 'undefined') return;

    const { data, error } = await window.supabaseClient
        .from('status_sincronizacao_automatica')
        .select('sistema, filial, sucesso, mensagem, executado_em')
        .in('filial', [filialAtual, 'GLOBAL'])
        .order('executado_em', { ascending: false })
        .limit(20);

    if (error || !data || data.length === 0) return; // scraper ainda não existe/nunca rodou — nada a alertar

    // Pega só a tentativa MAIS RECENTE de cada sistema (Ulisses da filial
    // atual, Mercúrio global) — data já vem ordenado por executado_em desc.
    const maisRecentePorSistema = new Map();
    data.forEach(row => { if (!maisRecentePorSistema.has(row.sistema)) maisRecentePorSistema.set(row.sistema, row); });

    maisRecentePorSistema.forEach((row, sistema) => {
        const chave = `${row.sistema}:${row.filial}:${row.executado_em}`;
        if (sincronizacoesJaNotificadas.has(chave)) return;

        const horasDesde = (Date.now() - new Date(row.executado_em).getTime()) / (1000 * 60 * 60);
        const travada = horasDesde > HORAS_LIMITE_SEM_SYNC;
        if (row.sucesso && !travada) return; // tudo certo, nada a avisar

        sincronizacoesJaNotificadas.add(chave);
        salvarSincronizacoesJaNotificadas(sincronizacoesJaNotificadas);
        const nomeSistema = sistema === 'ulisses' ? 'Ulisses' : 'Mercúrio';
        adicionarNotificacao({
            icone: 'fa-solid fa-triangle-exclamation',
            titulo: `Sincronização do ${nomeSistema} travada`,
            mensagem: row.sucesso
                ? `Última tentativa bem-sucedida foi há mais de ${Math.round(horasDesde)}h — confira se a automação ainda está rodando.`
                : `Última tentativa falhou: ${row.mensagem || 'sem detalhes'}.`,
            aoClicar: () => { if (typeof switchModule === 'function') switchModule('tab-importar', 'Importar Planilhas', 'Ativos, Inativos e Inscrições'); },
        });
    });
}

// ==========================================
// GATILHO 7: Janela de 24h da Meta perto de fechar (pedido do usuário,
// 2026-09-28, reunião com a Ediliene): "não podemos deixar esfriar...
// não podemos deixar de responder pra não fechar a conversa (de acordo
// com as regras do Meta API, eu posso conversar livremente se a pessoa
// tiver me mandando uma mensagem nas últimas 24h)". Avisa quando uma
// conversa ainda esperando NOSSA resposta (última mensagem foi do lead)
// está a menos de `HORAS_AVISO_JANELA_FECHANDO` de a janela fechar —
// mesmo limiar "crítico" já usado no badge visual (`htmlTimerJanelaWpp()`,
// `js/whatsapp.js`). GLOBAL (todas as filiais), mesmo espírito do
// gatilho 4 — a janela de 24h não escolhe filial. Reaproveita
// `vw_wpp_conversas` (mesma view já usada pelo WhatsApp Unificado),
// nenhuma tabela/coluna nova precisou existir só pra isso.
// ==========================================
const HORAS_AVISO_JANELA_FECHANDO = 4;
const CHAVE_LS_JANELAS_NOTIFICADAS = 'crm_na_janelas_notificadas';
function carregarJanelasJaNotificadas() {
    try {
        const arr = JSON.parse(localStorage.getItem(CHAVE_LS_JANELAS_NOTIFICADAS) || '[]');
        return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
}
function salvarJanelasJaNotificadas(set) {
    try { localStorage.setItem(CHAVE_LS_JANELAS_NOTIFICADAS, JSON.stringify([...set].slice(-200))); } catch { /* ignora */ }
}
let janelasJaNotificadas = carregarJanelasJaNotificadas(); // chave "pessoaId:ultima_mensagem_em" — persiste em localStorage (mesmo padrão do gatilho 5) pra não repetir aviso a cada F5 enquanto a mesma mensagem continua sendo a "última" da conversa.

async function verificarNotificacoesJanelaFechando() {
    if (typeof window.supabaseClient === 'undefined') return;
    const { data, error } = await window.supabaseClient
        .from('vw_wpp_conversas')
        .select('"pessoaIdentificador", ultima_mensagem_em, filial')
        .eq('ultima_direcao', 'entrada');
    if (error || !data) return;

    const agora = Date.now();
    data.forEach(conversa => {
        const horasPassadas = (agora - new Date(conversa.ultima_mensagem_em).getTime()) / 3600000;
        const restante = 24 - horasPassadas;
        if (restante <= 0 || restante > HORAS_AVISO_JANELA_FECHANDO) return; // já fechou, ou ainda tem tempo de sobra

        const chave = `${conversa.pessoaIdentificador}:${conversa.ultima_mensagem_em}`;
        if (janelasJaNotificadas.has(chave)) return;
        janelasJaNotificadas.add(chave);
        salvarJanelasJaNotificadas(janelasJaNotificadas);

        const leadConhecido = (typeof leadsAtuais !== 'undefined' ? leadsAtuais : []).find(l => String(l.pessoaIdentificador) === String(conversa.pessoaIdentificador));
        const horasArredondado = Math.max(0, Math.round(restante * 10) / 10);
        adicionarNotificacao({
            icone: 'fa-solid fa-hourglass-half',
            titulo: 'Janela de resposta fechando',
            mensagem: `${(leadConhecido && leadConhecido.pessoaNome) || 'Um lead'} (${conversa.filial || 'filial desconhecida'}) mandou mensagem há quase 24h e ainda não respondemos — restam ~${horasArredondado}h antes de precisar de um modelo aprovado pra reabrir.`,
            aoClicar: () => {
                if (typeof switchModule === 'function') switchModule('tab-whatsapp', 'WhatsApp Unificado', 'Caixa de entrada centralizada');
                if (typeof abrirChatWpp === 'function') abrirChatWpp(conversa.pessoaIdentificador);
            },
        });
    });
}

// ==========================================
// TROCA DE FILIAL — reseta os gatilhos que dependem de qual filial está
// ativa (baseline de Lead Forte, eventos já notificados, canal do WhatsApp).
// Chamada de dentro de carregarLeads() (js/app.js) sempre que resetar=true
// (troca de filial ou carga inicial — não em "Carregar Mais").
// ==========================================
function iniciarNotificacoesParaFilial() {
    resetarNotificacoesLeadForte();
    resetarNotificacoesEventos();
    iniciarNotificacoesWhatsAppGlobais();
    verificarNotificacoesLembretes();
    verificarNotificacoesSincronizacao();
}

// Poll de lembretes a cada 5 minutos — só esse gatilho precisa de
// intervalo próprio; os outros reaproveitam pontos onde a UI já
// re-renderiza (renderizarCards()/renderizarListaEventos()) ou Realtime.
setInterval(() => { if (typeof verificarNotificacoesLembretes === 'function') verificarNotificacoesLembretes(); }, 5 * 60 * 1000);
// Sincronização automática muda bem mais devagar (job diário, na melhor
// das hipóteses) — poll mais espaçado.
setInterval(() => { if (typeof verificarNotificacoesSincronizacao === 'function') verificarNotificacoesSincronizacao(); }, 30 * 60 * 1000);
// Janela de 24h fechando — poll de 10 min (mais frequente que os outros,
// já que "faltam menos de 4h" é uma janela de tempo real curta) + 1
// checagem imediata ao carregar a página (não depende de troca de
// filial, é GLOBAL — não entra em iniciarNotificacoesParaFilial()).
verificarNotificacoesJanelaFechando();
setInterval(() => { if (typeof verificarNotificacoesJanelaFechando === 'function') verificarNotificacoesJanelaFechando(); }, 10 * 60 * 1000);

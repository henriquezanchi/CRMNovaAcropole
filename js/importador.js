// ==========================================================
// IMPORTADOR DE PLANILHAS — Ativos / Inativos / Inscrições
// ==========================================================
// Este módulo lê as 3 planilhas da filial, cruza os dados por nome
// normalizado, monta o histórico de eventos de cada pessoa e classifica
// cada lead com uma tag ("Ativo" / "Inativo" / Lead Forte).
// Nada é enviado ao Supabase até o usuário revisar a prévia e clicar em
// "Confirmar e Enviar".
//
// Depende de variáveis/funções já definidas em app.js, que carrega ANTES
// deste arquivo: NOME_TABELA, filialAtual, filiaisDisponiveis,
// columnsConfig, escapeHTML(), carregarLeads().

let resultadoImportacao = null;

// IDs sintéticos para pessoas que existem em Ativos/Inativos mas nunca
// aparecem nas Inscrições (não têm pessoaIdentificador natural). Usamos
// uma faixa numérica alta e fora do intervalo observado nas Inscrições
// reais, pra nunca colidir com um pessoaIdentificador de verdade — e
// mantemos só dígitos, pra funcionar tanto se a coluna pessoaIdentificador
// for texto quanto se for numérica no Supabase.
const BASE_ID_ATIVOS_SEM_INSCRICAO = 900000000;
const BASE_ID_INATIVOS_SEM_INSCRICAO = 950000000;

// ==========================================
// UTILITÁRIOS
// ==========================================
function normalizarNomeImport(nome) {
    if (!nome) return '';
    return nome
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
}

// Classificação de tipo de evento é DIRIGIDA PELO CATÁLOGO tipos_evento —
// a MESMA lista gerenciada em "Gerenciar Tipos" na Agenda de Eventos
// (js/eventos.js). Editar nome/palavras-chave/trilha lá muda o resultado
// aqui também, sem precisar de código novo (colunas trilha/palavras_chave,
// migracao_tipos_evento_trilha.sql). Cada tipo pode ter várias palavras-
// chave (separadas por vírgula); a primeira que bater como substring
// (sem distinção de maiúsculas) no nome do evento vence, testando os
// tipos na ordem do catálogo (coluna "ordem"). Carregado 1x no início da
// importação — ver carregarCatalogoTiposEvento().
//
// Sem a migração rodada (colunas ainda não existem) ou catálogo vazio,
// cai neste classificador antigo embutido — mesmo comportamento de antes
// dessa unificação, nunca trava a importação.
const REGRAS_TIPO_EVENTO_FALLBACK = [
    { tipo: 'Curso', regex: /\bCURSO\b/i },
    { tipo: 'Workshop', regex: /\bWORKSHOP\b/i },
    { tipo: 'Oficina', regex: /\bOFICINA\b/i },
    { tipo: 'Palestra', regex: /\bPALESTRA\b/i },
    { tipo: 'Mostra / Aula Experimental', regex: /\b(MOSTRA|AULA EXPERIMENTAL)\b/i },
    { tipo: 'Clube do Livro', regex: /CLUBE DO LIVRO/i },
    { tipo: 'Filosofilme', regex: /FILOSOFILME/i },
    { tipo: 'Café Cultural', regex: /CAF[EÉ] COM/i }
];

// [{nome, regexes: [RegExp, ...]}], em ordem — só tipos com palavras-chave
// preenchidas entram aqui (um tipo sem palavra-chave nunca é atingido por
// classificação automática, só serve pra cadastro manual na Agenda).
let catalogoTiposEventoImport = [];
// nome do tipo -> trilha ("Filosófica"/"Desenvolvimento Pessoal"/"Artes"/null)
let mapaTipoTrilha = new Map();

function escaparRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function carregarCatalogoTiposEvento() {
    catalogoTiposEventoImport = [];
    mapaTipoTrilha = new Map();
    try {
        const { data, error } = await window.supabaseClient
            .from('tipos_evento')
            .select('nome, ordem, trilha, palavras_chave')
            .order('ordem', { ascending: true });
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('catálogo vazio');

        data.forEach(row => {
            if (row.trilha) mapaTipoTrilha.set(row.nome, row.trilha);
            const chaves = String(row.palavras_chave || '').split(',').map(p => p.trim()).filter(Boolean);
            if (chaves.length > 0) {
                catalogoTiposEventoImport.push({ nome: row.nome, regexes: chaves.map(p => new RegExp(escaparRegex(p), 'i')) });
            }
        });
        if (catalogoTiposEventoImport.length === 0) throw new Error('catálogo sem palavras-chave (rode migracao_tipos_evento_trilha.sql)');
    } catch (e) {
        catalogoTiposEventoImport = [];
        logImport('Catálogo de tipos de evento sem palavras-chave configuradas (rode migracao_tipos_evento_trilha.sql se ainda não rodou) — usando classificador padrão embutido, sem trilhas.', 'warn');
    }
}

function classificarTipoEvento(nomeEvento) {
    const texto = String(nomeEvento || '');
    if (catalogoTiposEventoImport.length > 0) {
        for (const tipo of catalogoTiposEventoImport) {
            if (tipo.regexes.some(re => re.test(texto))) return tipo.nome;
        }
        return 'Outro';
    }
    for (const regra of REGRAS_TIPO_EVENTO_FALLBACK) {
        if (regra.regex.test(texto)) return regra.tipo;
    }
    return 'Outro';
}

// Classifica o nível de aluno/ex-aluno a partir da coluna "Nivel" (Ativos)
// ou "Ni" (Inativos): TA (Távola/Merlin, filosofia infantil), PP (só o
// primeiro mês, aluno muito novo ou que saiu antes do 2º mês), N1 a N7
// (níveis 1 a 7 do curso regular). Heurística por palavra-chave sobre o
// texto já normalizado (maiúsculo, sem acento) — como não sabemos de
// antemão todo o vocabulário real da planilha, quem não bater com nenhuma
// regra fica sem tag de nível (não inventa um valor errado); confira a
// coluna Tags na prévia da importação antes de confirmar o envio.
// TA (Merlin/Távola, filosofia infantil), JN (Janos, adolescentes), PP (só
// o 1º mês), N1 (mantido separado — aluno ainda no nível de entrada) e
// "Membro" (N2 a N7 unificados — já é um membro estabelecido da escola,
// o nível exato de 2 a 7 não muda como o time aborda a pessoa).
function classificarNivel(nivelBruto) {
    const n = normalizarNomeImport(nivelBruto);
    if (!n) return null;
    if (/MERLIN|TAVOLA/.test(n) || n === 'TA') return 'TA';
    if (/JANOS/.test(n) || n === 'JN') return 'JN';
    if (/\bPP\b/.test(n) || /INTRODUT/.test(n)) return 'PP';
    const m = n.match(/NIVEL\s*([1-7])\b/) || n.match(/\bN\s*([1-7])\b/) || n.match(/^([1-7])\b/);
    if (m) return Number(m[1]) === 1 ? 'N1' : 'Membro';
    return null;
}

// ==========================================
// PONTUAÇÃO CONFIGURÁVEL DO "LEAD FORTE" (nível 1-3, 1 = mais propenso)
// ==========================================
// Os pesos ficam em DADOS (tabela config_pontuacao_lead_forte), não em
// código — o usuário pretende reajustá-los depois de analisar
// estatisticamente (via IA) o perfil de quem realmente virou aluno, sem
// precisar mexer aqui. Se a tabela ainda não existir (migração não
// rodada), cai num padrão embutido e a importação segue normalmente.
const CONFIG_PONTUACAO_PADRAO = {
    pontos_por_evento: 10,
    pontos_por_tipo_distinto: 5,
    pontos_evento_recente_dias: 90,
    bonus_evento_recente: 15,
    limite_nivel_1: 40,
    limite_nivel_2: 20,
    dias_gate_nivel_1: 30,
};

async function carregarConfigPontuacaoLeadForte() {
    try {
        const { data, error } = await window.supabaseClient
            .from('config_pontuacao_lead_forte')
            .select('*')
            .eq('id', 1)
            .single();
        if (error || !data) throw error || new Error('config não encontrada');
        return data;
    } catch (e) {
        logImport('Config de pontuação do Lead Forte não encontrada (rode migracao_pontuacao_lead_forte.sql se ainda não rodou) — usando valores padrão.', 'warn');
        return CONFIG_PONTUACAO_PADRAO;
    }
}

// eventos: array de {evento, data, tipo, tema?} (mesmo formato de pessoa.eventos).
// Usa parseDataBR(), definida globalmente em js/app.js (carregado antes deste arquivo).
function calcularNivelLeadForte(eventos, config) {
    if (!eventos || eventos.length === 0) return 3;

    let pontos = eventos.length * config.pontos_por_evento;

    const tiposDistintos = new Set(eventos.map(e => e.tipo).filter(Boolean));
    pontos += tiposDistintos.size * config.pontos_por_tipo_distinto;

    const datas = eventos.map(e => parseDataBR(e.data)).filter(Boolean);
    let diasDesdeUltimo = Infinity;
    if (datas.length > 0) {
        const maisRecente = new Date(Math.max(...datas.map(d => d.getTime())));
        diasDesdeUltimo = (Date.now() - maisRecente.getTime()) / (1000 * 60 * 60 * 24);
        if (diasDesdeUltimo <= config.pontos_evento_recente_dias) pontos += config.bonus_evento_recente;
    }

    // Nível 1 exige, além da pontuação, ter vindo em algum evento
    // recentemente (janela própria — dias_gate_nivel_1 — separada do
    // pontos_evento_recente_dias usado só pra bônus de pontuação acima).
    // Sem essa trava, alguém com muitos eventos só que faz tempo (sem
    // sinal de que ainda está engajado agora) ficaria marcado como "mais
    // propenso a matricular", o que não faz sentido. Cai pro nível 2
    // nesse caso, mesmo com pontuação de nível 1.
    const diasGateNivel1 = config.dias_gate_nivel_1 ?? 30;
    if (pontos >= config.limite_nivel_1 && diasDesdeUltimo <= diasGateNivel1) return 1;
    if (pontos >= config.limite_nivel_2) return 2;
    return 3;
}

// Tela "Configurar critérios de Lead Forte" — os campos ficam em
// config_pontuacao_lead_forte, não em código, exatamente pra dar pra
// reajustar os pesos depois sem depender de uma nova sessão de código.
async function abrirConfigPontuacao() {
    const config = await carregarConfigPontuacaoLeadForte();
    document.getElementById('cfgPontosPorEvento').value = config.pontos_por_evento;
    document.getElementById('cfgPontosPorTipo').value = config.pontos_por_tipo_distinto;
    document.getElementById('cfgDiasRecente').value = config.pontos_evento_recente_dias;
    document.getElementById('cfgBonusRecente').value = config.bonus_evento_recente;
    document.getElementById('cfgLimiteNivel1').value = config.limite_nivel_1;
    document.getElementById('cfgLimiteNivel2').value = config.limite_nivel_2;
    document.getElementById('cfgDiasGateNivel1').value = config.dias_gate_nivel_1 ?? 30;
    document.getElementById('modalPontuacao').classList.add('open');
    document.getElementById('overlayModalPontuacao').classList.add('active');
}
function fecharConfigPontuacao() {
    document.getElementById('modalPontuacao').classList.remove('open');
    document.getElementById('overlayModalPontuacao').classList.remove('active');
}
async function salvarConfigPontuacao() {
    const payload = {
        id: 1,
        pontos_por_evento: Number(document.getElementById('cfgPontosPorEvento').value) || 0,
        pontos_por_tipo_distinto: Number(document.getElementById('cfgPontosPorTipo').value) || 0,
        pontos_evento_recente_dias: Number(document.getElementById('cfgDiasRecente').value) || 0,
        bonus_evento_recente: Number(document.getElementById('cfgBonusRecente').value) || 0,
        limite_nivel_1: Number(document.getElementById('cfgLimiteNivel1').value) || 0,
        limite_nivel_2: Number(document.getElementById('cfgLimiteNivel2').value) || 0,
        dias_gate_nivel_1: Number(document.getElementById('cfgDiasGateNivel1').value) || 0,
        atualizado_em: new Date().toISOString(),
    };

    if (payload.limite_nivel_2 > payload.limite_nivel_1) {
        alert('O limite do nível 2 precisa ser menor ou igual ao limite do nível 1.');
        return;
    }

    const { error } = await window.supabaseClient
        .from('config_pontuacao_lead_forte')
        .upsert(payload, { onConflict: 'id' });

    if (error) { alert('Erro ao salvar critérios: ' + error.message); return; }
    alert('Critérios salvos! Valem a partir da próxima importação.');
    fecharConfigPontuacao();
}

// Telefones da planilha de Inativos vêm bagunçados: múltiplos números
// juntos separados por "/", alguns com traço, alguns sem DDD. Pegamos só
// o primeiro número informado e tentamos separar DDD + número; se não
// der pra confiar no resultado, retornamos null (fica sem telefone).
function parseTelefoneInativo(campo) {
    if (!campo) return null;
    const primeiro = String(campo).split('/').map(s => s.trim()).find(s => s !== '');
    if (!primeiro) return null;
    const digitos = primeiro.replace(/\D/g, '');
    if (digitos.length === 8 || digitos.length === 9) {
        return { ddd: '62', numero: digitos }; // assume DDD local (Goiânia) quando não vem no número
    }
    if (digitos.length === 10 || digitos.length === 11) {
        return { ddd: digitos.slice(0, 2), numero: digitos.slice(2) };
    }
    return null;
}

// ==========================================
// TAGS DE TRILHA E ESTÁGIO DA JORNADA
// ==========================================
// "Trilha" agrupa os TIPOS de evento (ver classificarTipoEvento() acima,
// dirigido pelo catálogo tipos_evento) em 3 grandes interesses —
// Filosófica / Desenvolvimento Pessoal / Artes — pra dar pra mapear a
// jornada de quem vem em atividades pagas/abertas sem nunca ter tido
// contato com filosofia ainda. mapaTipoTrilha já foi carregado junto do
// catálogo de classificação (carregarCatalogoTiposEvento(), acima).

// Tags "Trilha: X" — uma por trilha distinta já visitada pelo lead (pode
// acumular mais de uma, ex: veio numa Oficina de Artes E numa Palestra).
// Tag "Jornada: X" — só gerada pra quem NÃO é Ativo/Inativo (aluno atual
// ou ex-aluno já tem sinal de sobra nas tags de sistema; a Jornada existe
// pra priorizar quem ainda é só prospecto, ajudando a decidir quem
// nutrir pra matrícula):
//   - "Descoberta": só passou por trilhas fora da Filosófica (Artes/Dev.
//     Pessoal) — nunca teve contato direto com filosofia.
//   - "Interesse Emergente": já veio em algo da trilha Filosófica, mas o
//     Lead Forte não é 1 nem 2 (baixa frequência/diversidade/recência).
//   - "Engajado": trilha Filosófica + Lead Forte 1 ou 2 — já dá sinal
//     forte de propensão a matricular.
function calcularTagsTrilhaEJornada(eventos, tagsBase, mapaTrilha) {
    const trilhas = new Set();
    (eventos || []).forEach(e => {
        const trilha = mapaTrilha.get(e.tipo);
        if (trilha) trilhas.add(trilha);
    });
    if (trilhas.size === 0) return [];

    const tagsTrilha = Array.from(trilhas).sort().map(t => `Trilha: ${t}`);

    const jaAlunoOuExAluno = tagsBase.some(t => ['Ativo', 'Aluno Ativo', 'Inativo', 'Ex-Aluno (Inativo)'].includes(t));
    if (jaAlunoOuExAluno) return tagsTrilha;

    const tagLeadForte = tagsBase.find(t => /^Lead Forte [1-3]$/.test(t));
    const nivelLeadForte = tagLeadForte ? Number(tagLeadForte.split(' ')[2]) : null;

    const jornada = !trilhas.has('Filosófica')
        ? 'Descoberta'
        : (nivelLeadForte === 1 || nivelLeadForte === 2) ? 'Engajado' : 'Interesse Emergente';

    return [...tagsTrilha, `Jornada: ${jornada}`];
}

// ==========================================
// LOGIN AUTOMÁTICO (Ulisses/Mercúrio) — cofre de credenciais do scraper
// ==========================================
// Esta tela só GRAVA a senha (através da Edge Function
// gerenciar-credenciais, que cifra com pgcrypto — migracao_credenciais_scraper.sql)
// — nunca lê de volta, nem mesmo pra confirmar visualmente qual é. O
// scraper que efetivamente usa essas credenciais pra logar no
// Ulisses/Mercúrio e puxar os dados automaticamente é um projeto à parte
// (roda fora do Supabase — precisa de um navegador automatizado tipo
// Playwright, algo que uma Edge Function/Deno não sustenta bem; ver
// CLAUDE.md), ainda não implementado. Enquanto isso não existir, a
// importação por planilha continua sendo o caminho principal — de
// propósito, não removida.
async function abrirCredenciaisScraper() {
    await renderizarCredenciaisScraper();
    document.getElementById('modalCredenciaisScraper').classList.add('open');
    document.getElementById('overlayModalCredenciaisScraper').classList.add('active');
}
function fecharCredenciaisScraper() {
    document.getElementById('modalCredenciaisScraper').classList.remove('open');
    document.getElementById('overlayModalCredenciaisScraper').classList.remove('active');
}

async function renderizarCredenciaisScraper() {
    const container = document.getElementById('credenciaisScraperContainer');
    if (!container) return;
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando...</p>';

    const { data, error } = await window.supabaseClient.from('status_credenciais_scraper').select('*');
    const statusPorChave = new Map();
    if (!error) (data || []).forEach(row => statusPorChave.set(`${row.sistema}|${row.filial}`, row));

    const formatarStatus = (chave) => {
        const row = statusPorChave.get(chave);
        return row ? `<span style="color:#15803d;"><i class="fa-solid fa-check"></i> Configurado em ${new Date(row.atualizado_em).toLocaleString('pt-BR')}</span>` : '<span style="color:var(--text-muted);">Ainda não configurado</span>';
    };

    container.innerHTML = `
        ${error ? `<p style="font-size:12px; color:#dc2626;">Aviso: não consegui ler o status atual (${escapeHTML(error.message)}). Rode migracao_credenciais_scraper.sql se ainda não rodou — mesmo assim, dá pra tentar salvar novas senhas abaixo.</p>` : ''}
        <div class="tag-filter-grupo-titulo">CRM Publicado — senha do portão de acesso (js/acesso.js), pro scraper conseguir subir as planilhas sozinho na tela de Importar</div>
        <div class="coluna-row">
            <input type="password" id="credSenhaCrmAcesso" placeholder="Senha de acesso ao CRM" style="flex:1;">
            <button class="btn-secondary" onclick="salvarCredencialScraper('crm_acesso', null)"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
        </div>
        <p style="font-size:11px; margin:-4px 0 14px;">${formatarStatus('crm_acesso|GLOBAL')}</p>

        <div class="tag-filter-grupo-titulo">Mercúrio — autenticação prévia (pop-up cinza do navegador, única pra todo mundo, muda 1x por ano)</div>
        <div class="coluna-row">
            <input type="text" id="credUsuarioMercurioHttp" placeholder="Usuário do pop-up" style="flex:1;">
            <input type="password" id="credSenhaMercurioHttp" placeholder="Senha do pop-up" style="flex:1;">
            <button class="btn-secondary" onclick="salvarCredencialScraper('mercurio_http', null)"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
        </div>
        <p style="font-size:11px; margin:-4px 0 14px;">${formatarStatus('mercurio_http|GLOBAL')}</p>

        <div class="tag-filter-grupo-titulo">Mercúrio (Matrícula/Senha, vale pra todas as filiais)</div>
        <div class="coluna-row">
            <input type="text" id="credUsuarioMercurio" placeholder="Matrícula" style="flex:1;">
            <input type="password" id="credSenhaMercurio" placeholder="Senha do Mercúrio" style="flex:1;">
            <button class="btn-secondary" onclick="salvarCredencialScraper('mercurio', null)"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
        </div>
        <p style="font-size:11px; margin:-4px 0 14px;">${formatarStatus('mercurio|GLOBAL')}</p>

        <p style="font-size:11px; color:var(--text-muted); margin-top:8px;"><i class="fa-solid fa-circle-info"></i> O login do Ulisses é sempre manual (Cloudflare exige resolver o desafio de verificação você mesmo) — por isso não tem senha pra salvar aqui. Rode <code>npm run ulisses-local</code> na sua máquina de confiança quando precisar importar.</p>
    `;
}

// `ulisses` de propósito NÃO existe mais aqui — o login do Ulisses é
// sempre manual (Cloudflare), então guardar a senha no cofre não serve
// pra nada além de um "dica" que o scraper mostra no terminal (ver
// ulisses-local.js) — removido do CRM a pedido do usuário pra não passar
// a impressão de que existe algo automático ali.
async function salvarCredencialScraper(sistema) {
    const idsPorSistema = {
        mercurio: { usuario: 'credUsuarioMercurio', senha: 'credSenhaMercurio' },
        mercurio_http: { usuario: 'credUsuarioMercurioHttp', senha: 'credSenhaMercurioHttp' },
        crm_acesso: { usuario: null, senha: 'credSenhaCrmAcesso' }, // sem usuário — é só a senha do portão
    };
    const ids = idsPorSistema[sistema];
    const inputSenha = ids ? document.getElementById(ids.senha) : null;
    const inputUsuario = ids && ids.usuario ? document.getElementById(ids.usuario) : null;
    const senha = inputSenha ? inputSenha.value : '';
    const usuario = inputUsuario ? inputUsuario.value : '';
    if (!senha || senha.trim() === '') { alert('Digite a senha antes de salvar.'); return; }

    const { data, error } = await window.supabaseClient.functions.invoke('gerenciar-credenciais', {
        body: { sistema, filial: null, usuario: usuario || null, senha }
    });

    if (error || (data && data.ok === false)) {
        alert('Erro ao salvar: ' + ((data && data.erro) || (error && error.message) || 'erro desconhecido'));
        return;
    }
    if (inputSenha) inputSenha.value = '';
    if (inputUsuario) inputUsuario.value = '';
    alert('Senha salva com sucesso! (cifrada — o CRM não guarda nem mostra o valor em texto puro)');
    renderizarCredenciaisScraper();
}

// ==========================================
// SINCRONIZAÇÃO AUTOMÁTICA — dispara o Mercúrio sob demanda (GitHub
// Actions, Edge Function scraper-disparar) + acompanha o status
// ==========================================
// O Ulisses NUNCA aparece com botão de disparo aqui — não tem como,
// exige login manual numa máquina de confiança (Cloudflare). Só o
// Mercúrio (100% headless, já rodava sozinho todo dia) ganha um botão
// de "rodar agora", que só antecipa o mesmo job automático, sem inventar
// nada novo.
let pollSincronizacaoTimer = null;

async function abrirSincronizacaoScraper() {
    await renderizarStatusSincronizacaoScraper();
    document.getElementById('modalSincronizacaoScraper').classList.add('open');
    document.getElementById('overlayModalSincronizacaoScraper').classList.add('active');
}
function fecharSincronizacaoScraper() {
    document.getElementById('modalSincronizacaoScraper').classList.remove('open');
    document.getElementById('overlayModalSincronizacaoScraper').classList.remove('active');
    if (pollSincronizacaoTimer) { clearInterval(pollSincronizacaoTimer); pollSincronizacaoTimer = null; }
}

async function renderizarStatusSincronizacaoScraper(mensagemExtra) {
    const container = document.getElementById('sincronizacaoScraperStatus');
    if (!container) return;

    const { data, error } = await window.supabaseClient
        .from('status_sincronizacao_automatica')
        .select('*')
        .order('executado_em', { ascending: false })
        .limit(10);

    if (error) {
        container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro ao ler status: ${escapeHTML(error.message)}. Rode migracao_credenciais_scraper.sql se ainda não rodou.</p>`;
        return;
    }

    const linhas = data || [];
    const ultimoMercurio = linhas.find(l => l.sistema === 'mercurio');
    const ultimoUlisses = linhas.find(l => l.sistema === 'ulisses');

    const formatarLinha = (label, row) => {
        if (!row) return `<div class="coluna-row" style="justify-content:space-between;"><strong style="font-size:12px;">${label}</strong><span style="font-size:11px; color:var(--text-muted);">Nunca rodou ainda</span></div>`;
        const cor = row.sucesso ? '#15803d' : '#dc2626';
        const icone = row.sucesso ? 'fa-circle-check' : 'fa-circle-xmark';
        const quando = new Date(row.executado_em).toLocaleString('pt-BR');
        return `
            <div class="coluna-row" style="flex-direction:column; align-items:stretch; gap:2px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong style="font-size:12px;">${label}</strong>
                    <span style="font-size:11px; color:${cor};"><i class="fa-solid ${icone}"></i> ${quando}</span>
                </div>
                <div style="font-size:11px; color:var(--text-muted);">${escapeHTML(row.mensagem || '')}</div>
            </div>
        `;
    };

    container.innerHTML = `
        ${mensagemExtra ? `<p style="font-size:12px; color:var(--na-green-dark); margin-bottom:10px;"><i class="fa-solid fa-circle-notch fa-spin"></i> ${escapeHTML(mensagemExtra)}</p>` : ''}
        ${formatarLinha('Mercúrio (última rodada)', ultimoMercurio)}
        <div style="height:8px;"></div>
        ${formatarLinha('Ulisses (última rodada manual)', ultimoUlisses)}
    `;
}

async function dispararMercurioAgora() {
    const btn = document.getElementById('btnDispararMercurio');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Disparando...'; }

    // Guarda o timestamp do último "mercurio" ANTES de disparar, pra saber
    // reconhecer quando uma rodada NOVA (não essa que já estava aí)
    // terminar — status_sincronizacao_automatica não tem um jeito melhor
    // de "seguir" uma execução específica, então comparar timestamp é o
    // sinal mais simples e confiável disponível.
    const { data: antes } = await window.supabaseClient
        .from('status_sincronizacao_automatica')
        .select('executado_em')
        .eq('sistema', 'mercurio')
        .order('executado_em', { ascending: false })
        .limit(1)
        .maybeSingle();
    const timestampAntes = antes ? antes.executado_em : null;

    const { data, error } = await window.supabaseClient.functions.invoke('scraper-disparar', { body: {} });

    if (error || (data && data.ok === false)) {
        const motivo = (data && data.detalhe) || (error && error.message) || 'erro desconhecido';
        alert('Não consegui disparar: ' + motivo);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-play"></i> Rodar Mercúrio agora'; }
        return;
    }

    if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Rodando (leva alguns minutos)...';
    await renderizarStatusSincronizacaoScraper('Disparado! Acompanhando — isso costuma levar alguns minutos (o job passa por todas as filiais).');

    if (pollSincronizacaoTimer) clearInterval(pollSincronizacaoTimer);
    const inicioPoll = Date.now();
    const TIMEOUT_POLL_MS = 20 * 60 * 1000; // 20 min — folga generosa sobre o tempo real observado
    pollSincronizacaoTimer = setInterval(async () => {
        if (Date.now() - inicioPoll > TIMEOUT_POLL_MS) {
            clearInterval(pollSincronizacaoTimer);
            pollSincronizacaoTimer = null;
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-play"></i> Rodar Mercúrio agora'; }
            await renderizarStatusSincronizacaoScraper('Ainda não vi terminar depois de 20min — confira direto no GitHub Actions, ou só espere e reabra esta tela depois.');
            return;
        }

        const { data: depois } = await window.supabaseClient
            .from('status_sincronizacao_automatica')
            .select('executado_em')
            .eq('sistema', 'mercurio')
            .order('executado_em', { ascending: false })
            .limit(1)
            .maybeSingle();

        const terminou = depois && depois.executado_em && depois.executado_em !== timestampAntes;
        if (terminou) {
            clearInterval(pollSincronizacaoTimer);
            pollSincronizacaoTimer = null;
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-play"></i> Rodar Mercúrio agora'; }
            await renderizarStatusSincronizacaoScraper();
        }
    }, 15000);
}

// Chave de telefone pra casar registros por número em vez de nome — cobre
// os casos de erro de digitação no nome entre planilhas diferentes (a
// mesma pessoa com o nome escrito torto numa delas, mas o telefone bate).
// Normaliza removendo o 9º dígito de celular (se tiver), pra "62999998888"
// e "6299998888" caírem na mesma chave independente do formato de origem.
function normalizarTelefoneParaChave(ddd, numero) {
    const dddLimpo = String(ddd || '').replace(/\D/g, '');
    let numeroLimpo = String(numero || '').replace(/\D/g, '');
    if (!dddLimpo || !numeroLimpo) return null;
    if (numeroLimpo.length === 9 && numeroLimpo.startsWith('9')) numeroLimpo = numeroLimpo.slice(1);
    if (numeroLimpo.length !== 8) return null; // sem confiança suficiente pra usar como chave
    return dddLimpo + numeroLimpo;
}

function lerArquivoTexto(file, encoding) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo'));
        reader.readAsText(file, encoding);
    });
}

function parseCSVTexto(texto, delimitador) {
    return Papa.parse(texto, {
        header: true,
        delimiter: delimitador,
        skipEmptyLines: true,
        transformHeader: h => h.trim()
    });
}

function logImport(msg, tipo = '') {
    const logEl = document.getElementById('importLog');
    if (!logEl) return;
    logEl.style.display = 'block';
    const classe = tipo === 'ok' ? 'log-ok' : tipo === 'warn' ? 'log-warn' : tipo === 'err' ? 'log-err' : '';
    const linha = classe ? `<span class="${classe}">${escapeHTML(msg)}</span>` : escapeHTML(msg);
    logEl.innerHTML += linha + '\n';
    logEl.scrollTop = logEl.scrollHeight;
}

async function popularFilialImportacao() {
    const select = document.getElementById('importFilialSelect');
    if (!select) return;

    let lista = (typeof filiaisDisponiveis !== 'undefined' && filiaisDisponiveis.length > 0)
        ? filiaisDisponiveis
        : null;

    if (!lista) {
        // Fallback: se filiaisDisponiveis (carregada pelo app.js) ainda não estiver
        // pronta quando esta aba abre, busca direto no Supabase — assim este
        // dropdown funciona sozinho, sem depender de outra parte do código já
        // ter rodado antes.
        try {
            const { data, error } = await window.supabaseClient
                .from(NOME_TABELA_FILIAIS)
                .select('*')
                .eq('ativo', true)
                .order('ordem', { ascending: true });
            lista = (!error && data && data.length > 0) ? data : null;
        } catch (e) {
            lista = null;
        }
    }

    if (!lista || lista.length === 0) {
        lista = [{ nome: (typeof filialAtual !== 'undefined' && filialAtual) ? filialAtual : 'Goiânia - Jardim América' }];
    }

    select.innerHTML = lista.map(f => `<option value="${escapeHTML(f.nome)}">${escapeHTML(f.nome)}</option>`).join('');
    const valorPadrao = (typeof filialAtual !== 'undefined' && filialAtual) ? filialAtual : lista[0].nome;
    select.value = valorPadrao;

    if (typeof atualizarContagemExclusao === 'function') atualizarContagemExclusao();
}

function montarRegistroLead(pessoa, tags, filial, extras = {}) {
    const eventosOrdenados = [...(pessoa.eventos || [])];

    // Tags de "Cadastro" — sinalizam dados de contato faltando (só o caso
    // negativo/acionável ganha badge, ter os dois normalmente não precisa
    // de destaque visual).
    const tagsFinais = [...tags, ...calcularTagsTrilhaEJornada(eventosOrdenados, tags, mapaTipoTrilha)];
    if (!pessoa.pessoaTelefoneNumero || String(pessoa.pessoaTelefoneNumero).trim() === '') tagsFinais.push('Sem Telefone');
    if (!pessoa.pessoaEmail || String(pessoa.pessoaEmail).trim() === '') tagsFinais.push('Sem E-mail');

    return {
        pessoaIdentificador: String(pessoa.pessoaIdentificador),
        pessoaNome: pessoa.pessoaNome,
        pessoaTelefoneDDD: pessoa.pessoaTelefoneDDD || '',
        pessoaTelefoneNumero: pessoa.pessoaTelefoneNumero || '',
        pessoaEmail: pessoa.pessoaEmail || '',
        pessoaStatus: pessoa.pessoaStatus || '',
        telemarketingStatus: pessoa.telemarketingStatus || '',
        eventoNome: eventosOrdenados.map(e => e.evento).join(' | '),
        eventoData: eventosOrdenados.map(e => e.data).join(' | '),
        historico_eventos: eventosOrdenados,
        tags: JSON.stringify(tagsFinais),
        motivo_saida: extras.motivoSaida || null,
        data_saida: extras.dataSaida || null,
        filial: filial
    };
}

// ==========================================
// TEMA DE EVENTO POR IA (cache em temas_eventos, best-effort)
// ==========================================
// Nomes de evento por chamada à Edge Function classificar-temas, pra não
// estourar o prompt em bases com muitos eventos diferentes.
const LOTE_TEMAS_IA = 60;

async function classificarTemasEventos(pessoasInscricoes) {
    const nomesUnicos = new Set();
    pessoasInscricoes.forEach(pessoa => {
        pessoa.eventos.forEach(ev => { if (ev.evento) nomesUnicos.add(ev.evento); });
    });
    if (nomesUnicos.size === 0) return;

    const listaNomes = Array.from(nomesUnicos);
    const mapaTemas = new Map(); // nomeOriginal -> tema

    // 1) Busca o que já está cacheado de importações/filiais anteriores
    try {
        const normalizados = listaNomes.map(n => normalizarNomeImport(n));
        const { data: cache, error } = await window.supabaseClient
            .from('temas_eventos')
            .select('evento_nome_normalizado, tema')
            .in('evento_nome_normalizado', normalizados);
        if (error) throw error;

        const cachePorNormalizado = new Map((cache || []).map(c => [c.evento_nome_normalizado, c.tema]));
        listaNomes.forEach(nome => {
            const tema = cachePorNormalizado.get(normalizarNomeImport(nome));
            if (tema) mapaTemas.set(nome, tema);
        });
        if (mapaTemas.size > 0) logImport(`Temas de evento: ${mapaTemas.size} já em cache (reaproveitados de importações anteriores).`, 'ok');
    } catch (e) {
        logImport('Não foi possível consultar o cache de temas (tabela temas_eventos) — rode migracao_temas_eventos.sql se ainda não rodou. Seguindo sem tema.', 'warn');
        return;
    }

    // 2) Manda pra IA só os eventos que faltaram, em lotes
    const faltando = listaNomes.filter(n => !mapaTemas.has(n));
    if (faltando.length === 0) {
        aplicarTemasNosEventos(pessoasInscricoes, mapaTemas);
        return;
    }

    logImport(`Classificando ${faltando.length} evento(s) novo(s) por tema via IA...`);

    for (let i = 0; i < faltando.length; i += LOTE_TEMAS_IA) {
        const lote = faltando.slice(i, i + LOTE_TEMAS_IA);
        try {
            const { data, error } = await window.supabaseClient.functions.invoke('classificar-temas', {
                body: { eventos: lote }
            });
            if (error) throw error;
            if (!data || !data.ok) throw new Error((data && data.erro) || 'resposta inválida da função');

            Object.entries(data.mapa || {}).forEach(([nome, tema]) => {
                if (tema) mapaTemas.set(nome, tema);
            });
        } catch (e) {
            logImport(`Aviso: não foi possível classificar temas via IA (${e.message || e}). A Edge Function "classificar-temas" pode ainda não estar deployada ou sem ANTHROPIC_API_KEY configurada — a importação segue sem tema pros eventos que faltarem.`, 'warn');
            break; // não insiste nos lotes seguintes, evita repetir a mesma mensagem de erro várias vezes
        }
    }

    logImport(`Temas de evento: ${mapaTemas.size} de ${listaNomes.length} classificados no total.`, 'ok');
    aplicarTemasNosEventos(pessoasInscricoes, mapaTemas);
}

function aplicarTemasNosEventos(pessoasInscricoes, mapaTemas) {
    pessoasInscricoes.forEach(pessoa => {
        pessoa.eventos.forEach(ev => {
            const tema = mapaTemas.get(ev.evento);
            if (tema) ev.tema = tema;
        });
    });
}

// ==========================================
// PROCESSAMENTO PRINCIPAL (100% no navegador — nada é enviado ainda)
// ==========================================
async function processarPlanilhas() {
    const logEl = document.getElementById('importLog');
    if (logEl) { logEl.innerHTML = ''; logEl.style.display = 'block'; }
    const previewEl = document.getElementById('importPreview');
    if (previewEl) previewEl.style.display = 'none';
    const auditoriaEl = document.getElementById('auditoriaImportacaoContainer');
    if (auditoriaEl) auditoriaEl.style.display = 'none';
    resultadoImportacao = null;

    const fileAtivos = document.getElementById('fileAtivos').files[0];
    const fileInativos = document.getElementById('fileInativos').files[0];
    const fileInscricoes = document.getElementById('fileInscricoes').files[0];
    const filialDestino = document.getElementById('importFilialSelect').value;

    if (!fileAtivos || !fileInativos || !fileInscricoes) {
        logImport('É preciso selecionar as 3 planilhas antes de processar.', 'err');
        return;
    }
    if (!filialDestino) {
        logImport('Selecione a filial de destino.', 'err');
        return;
    }

    logImport(`Filial de destino: ${filialDestino}`);
    logImport('Lendo planilhas...');

    let textoAtivos, textoInativos, textoInscricoes;
    try {
        // Ativos e Inativos costumam ser exportados em ISO-8859-1 (Latin-1) pelo Excel;
        // as Inscrições (Ulisses) já vêm em UTF-8.
        textoAtivos = await lerArquivoTexto(fileAtivos, 'ISO-8859-1');
        textoInativos = await lerArquivoTexto(fileInativos, 'ISO-8859-1');
        textoInscricoes = await lerArquivoTexto(fileInscricoes, 'UTF-8');
    } catch (e) {
        logImport('Erro lendo os arquivos: ' + e.message, 'err');
        return;
    }

    const parsedAtivos = parseCSVTexto(textoAtivos, ';');
    const parsedInativos = parseCSVTexto(textoInativos, ';');
    const parsedInscricoes = parseCSVTexto(textoInscricoes, ',');

    logImport(`Ativos: ${parsedAtivos.data.length} linhas lidas.`, 'ok');
    logImport(`Inativos: ${parsedInativos.data.length} linhas lidas.`, 'ok');
    logImport(`Inscrições: ${parsedInscricoes.data.length} linhas lidas.`, 'ok');

    // ---- Auditoria: linhas das 3 planilhas que a importação IGNORA por
    // faltar o dado-chave (nome, ou pessoaIdentificador nas Inscrições) —
    // hoje isso acontecia em silêncio. Alimenta a seção "Auditoria da
    // Importação" na prévia (renderizarAuditoriaImportacao()), que dá pra
    // conferir e, quando fizer sentido (sobrou nome pelo menos), resgatar
    // como lead novo antes de confirmar o envio. "linha" é o número da
    // linha na planilha original (cabeçalho = linha 1), pra achar fácil.
    const auditoriaImportacao = { ativosSemNome: [], inativosSemNome: [], inscricoesSemId: [] };

    // ---- 1) Mapas de Ativos e Inativos por nome normalizado ----
    const mapaAtivos = new Map();
    parsedAtivos.data.forEach((row, i) => {
        const nome = row['Nome'];
        if (!nome) { auditoriaImportacao.ativosSemNome.push({ linha: i + 2 }); return; }
        const chave = normalizarNomeImport(nome);
        mapaAtivos.set(chave, {
            nomeOriginal: nome.trim(),
            matricula: (row['Matr'] || '').trim(),
            nivel: (row['Nivel'] || '').trim(),
            turma: (row['Turma'] || '').trim(),
            dia: (row['Dia'] || '').trim(),
            usado: false
        });
    });

    const mapaInativos = new Map();
    let telefonesInativosNaoInterpretados = 0;
    parsedInativos.data.forEach((row, i) => {
        const nome = row['Nome'];
        if (!nome) { auditoriaImportacao.inativosSemNome.push({ linha: i + 2 }); return; }
        const chave = normalizarNomeImport(nome);
        const tel = parseTelefoneInativo(row['Telefones']);
        if (row['Telefones'] && String(row['Telefones']).replace(/\//g, '').trim() !== '' && !tel) {
            telefonesInativosNaoInterpretados++;
        }
        mapaInativos.set(chave, {
            nomeOriginal: nome.trim(),
            telefoneDDD: tel ? tel.ddd : '',
            telefoneNumero: tel ? tel.numero : '',
            nivel: (row['Ni'] || '').trim(),
            dataSaida: (row['Data'] || '').trim(),
            motivo: (row['Motivo'] || '').trim(),
            usado: false
        });
    });

    // Índice por telefone dos Inativos — Ativos não tem coluna de telefone
    // na planilha, então esse fallback só é possível pra Inativos. Se dois
    // Inativos diferentes caírem na mesma chave (telefone compartilhado,
    // ex: família), fica só o último — casamento por telefone é heurística,
    // não garantia, igual o resto do importador.
    const mapaInativosPorTelefone = new Map();
    mapaInativos.forEach(info => {
        const chaveTel = normalizarTelefoneParaChave(info.telefoneDDD, info.telefoneNumero);
        if (chaveTel) mapaInativosPorTelefone.set(chaveTel, info);
    });

    logImport(`Ativos únicos: ${mapaAtivos.size} | Inativos únicos: ${mapaInativos.size}`);
    if (telefonesInativosNaoInterpretados > 0) {
        logImport(`${telefonesInativosNaoInterpretados} telefone(s) de Inativos não puderam ser interpretados com confiança — esses leads ficarão sem telefone.`, 'warn');
    }

    // Catálogo de tipos de evento (classificação por palavra-chave + trilha)
    // — precisa estar carregado ANTES de classificar qualquer evento abaixo.
    await carregarCatalogoTiposEvento();

    // ---- 2) Agrupa Inscrições por pessoa (dedup por pessoaIdentificador) ----
    const pessoasInscricoes = new Map();
    parsedInscricoes.data.forEach((row, i) => {
        const id = (row['pessoaIdentificador'] || '').trim();
        if (!id) {
            const nome = (row['pessoaNome'] || '').trim();
            auditoriaImportacao.inscricoesSemId.push({
                linha: i + 2,
                pessoaNome: nome,
                pessoaTelefoneDDD: (row['pessoaTelefoneDDD'] || '').trim(),
                pessoaTelefoneNumero: (row['pessoaTelefoneNumero'] || '').trim(),
                pessoaEmail: (row['pessoaEmail'] || '').trim(),
                eventoNome: (row['eventoNome'] || '').trim(),
                eventoData: (row['eventoData'] || '').trim(),
                resgatavel: !!nome, // sem nome não dá pra criar um lead identificável
            });
            return;
        }
        if (!pessoasInscricoes.has(id)) {
            pessoasInscricoes.set(id, {
                pessoaIdentificador: id,
                pessoaNome: (row['pessoaNome'] || '').trim(),
                pessoaTelefoneDDD: (row['pessoaTelefoneDDD'] || '').trim(),
                pessoaTelefoneNumero: (row['pessoaTelefoneNumero'] || '').trim(),
                pessoaEmail: (row['pessoaEmail'] || '').trim(),
                pessoaStatus: (row['pessoaStatus'] || '').trim(),
                telemarketingStatus: (row['telemarketingStatus'] || '').trim(),
                eventos: []
            });
        }
        const pessoa = pessoasInscricoes.get(id);
        if (!pessoa.pessoaTelefoneNumero && row['pessoaTelefoneNumero']) pessoa.pessoaTelefoneNumero = row['pessoaTelefoneNumero'].trim();
        if (!pessoa.pessoaTelefoneDDD && row['pessoaTelefoneDDD']) pessoa.pessoaTelefoneDDD = row['pessoaTelefoneDDD'].trim();
        if (!pessoa.pessoaEmail && row['pessoaEmail']) pessoa.pessoaEmail = row['pessoaEmail'].trim();

        const nomeEvento = (row['eventoNome'] || '').trim();
        const dataEvento = (row['eventoData'] || '').trim();
        if (nomeEvento) {
            pessoa.eventos.push({ evento: nomeEvento, data: dataEvento, tipo: classificarTipoEvento(nomeEvento) });
        }
    });

    logImport(`Pessoas únicas nas Inscrições (histórico já agrupado): ${pessoasInscricoes.size}`, 'ok');

    // ---- 2.1) Funde pessoas com o MESMO nome + telefone mas pessoaIdentificador
    //           diferente — acontece quando a própria planilha de Inscrições
    //           (Ulisses) tem a mesma pessoa cadastrada duas vezes com IDs
    //           diferentes. Sem isso, vira 2 leads separados no CRM com nome
    //           e telefone idênticos, cada um com só uma fatia do histórico
    //           de eventos. Só funde quando o telefone bate exatamente (nome
    //           sozinho não é confiança suficiente — pode ser coincidência).
    const pessoaCanonicaPorChave = new Map(); // "nomeNormalizado|telefoneChave" -> pessoaIdentificador
    let contDuplicadosFundidos = 0;
    Array.from(pessoasInscricoes.values()).forEach(pessoa => {
        const telChave = normalizarTelefoneParaChave(pessoa.pessoaTelefoneDDD, pessoa.pessoaTelefoneNumero);
        if (!telChave) return; // sem telefone confiável pra confirmar que é a mesma pessoa — não arrisca fundir
        const chaveFusao = normalizarNomeImport(pessoa.pessoaNome) + '|' + telChave;

        if (!pessoaCanonicaPorChave.has(chaveFusao)) {
            pessoaCanonicaPorChave.set(chaveFusao, pessoa.pessoaIdentificador);
            return;
        }

        // Já vimos essa combinação nome+telefone antes — funde no registro canônico
        const idCanonico = pessoaCanonicaPorChave.get(chaveFusao);
        const canonica = pessoasInscricoes.get(idCanonico);
        if (!canonica || canonica === pessoa) return;

        const eventosExistentes = new Set(canonica.eventos.map(e => `${e.evento}|${e.data}`));
        pessoa.eventos.forEach(ev => {
            const chaveEv = `${ev.evento}|${ev.data}`;
            if (!eventosExistentes.has(chaveEv)) {
                canonica.eventos.push(ev);
                eventosExistentes.add(chaveEv);
            }
        });
        if (!canonica.pessoaEmail && pessoa.pessoaEmail) canonica.pessoaEmail = pessoa.pessoaEmail;

        pessoasInscricoes.delete(pessoa.pessoaIdentificador);
        contDuplicadosFundidos++;
    });
    if (contDuplicadosFundidos > 0) {
        logImport(`${contDuplicadosFundidos} duplicata(s) (mesmo nome + telefone, IDs diferentes no Ulisses) foram fundidas num único lead — total agora: ${pessoasInscricoes.size}.`, 'ok');
    }

    // ---- 2.5) Classifica o TEMA de cada evento por IA (cache em temas_eventos) ----
    // Best-effort: se a Edge Function não estiver deployada/configurada
    // ainda, ou der qualquer erro, a importação segue normalmente sem tema
    // — isso nunca deve travar o restante do processo.
    await classificarTemasEventos(pessoasInscricoes);

    // ---- 3) Cruza cada pessoa das Inscrições com Ativos/Inativos ----
    const configPontuacao = await carregarConfigPontuacaoLeadForte();
    const leadsFinais = [];
    let contAlunoAtivo = 0, contExAluno = 0, contLeadForte = 0;
    const contPorNivelLeadForte = { 1: 0, 2: 0, 3: 0 };

    let contExAlunoPorTelefone = 0;
    pessoasInscricoes.forEach(pessoa => {
        const chave = normalizarNomeImport(pessoa.pessoaNome);
        const tags = [];
        let motivoSaida = null;
        let dataSaida = null;

        // Fallback por telefone: pega gente com erro de digitação no nome
        // entre as planilhas, mas cujo telefone bate — só serve pra
        // Inativos, já que a planilha de Ativos não tem coluna de telefone.
        const chaveTelPessoa = normalizarTelefoneParaChave(pessoa.pessoaTelefoneDDD, pessoa.pessoaTelefoneNumero);
        const matchInativoPorNome = mapaInativos.has(chave);
        const matchInativoPorTelefone = !matchInativoPorNome && chaveTelPessoa && mapaInativosPorTelefone.has(chaveTelPessoa);

        if (mapaAtivos.has(chave)) {
            const info = mapaAtivos.get(chave);
            info.usado = true;
            tags.push('Ativo');
            const nivelTag = classificarNivel(info.nivel);
            if (nivelTag) tags.push(nivelTag);
            contAlunoAtivo++;
        } else if (matchInativoPorNome || matchInativoPorTelefone) {
            const info = matchInativoPorNome ? mapaInativos.get(chave) : mapaInativosPorTelefone.get(chaveTelPessoa);
            info.usado = true;
            tags.push('Inativo');
            const nivelTag = classificarNivel(info.nivel);
            if (nivelTag) tags.push(nivelTag);
            motivoSaida = info.motivo || null;
            dataSaida = info.dataSaida || null;
            if (!pessoa.pessoaTelefoneNumero && info.telefoneNumero) {
                pessoa.pessoaTelefoneDDD = info.telefoneDDD;
                pessoa.pessoaTelefoneNumero = info.telefoneNumero;
            }
            if (matchInativoPorTelefone) contExAlunoPorTelefone++;
            contExAluno++;
        } else {
            const nivelLeadForte = calcularNivelLeadForte(pessoa.eventos, configPontuacao);
            tags.push('Lead Forte ' + nivelLeadForte);
            contPorNivelLeadForte[nivelLeadForte]++;
            contLeadForte++;
        }

        leadsFinais.push(montarRegistroLead(pessoa, tags, filialDestino, { motivoSaida, dataSaida }));
    });

    // ---- 4) Ativos sem correspondência nas Inscrições (sem telefone/e-mail, mesmo assim cadastrados) ----
    let contAtivosSemInscricao = 0;
    let idxAtivo = 0;
    mapaAtivos.forEach(info => {
        if (info.usado) return;
        contAtivosSemInscricao++;
        idxAtivo++;
        const tagsAtivo = ['Ativo'];
        const nivelTag = classificarNivel(info.nivel);
        if (nivelTag) tagsAtivo.push(nivelTag);
        leadsFinais.push(montarRegistroLead({
            pessoaIdentificador: BASE_ID_ATIVOS_SEM_INSCRICAO + idxAtivo,
            pessoaNome: info.nomeOriginal,
            pessoaTelefoneDDD: '', pessoaTelefoneNumero: '', pessoaEmail: '',
            pessoaStatus: '', telemarketingStatus: '', eventos: []
        }, tagsAtivo, filialDestino));
    });

    // ---- 5) Inativos sem correspondência nas Inscrições (COM telefone — viram leads de resgate) ----
    let contInativosSemInscricao = 0;
    let idxInativo = 0;
    mapaInativos.forEach(info => {
        if (info.usado) return;
        contInativosSemInscricao++;
        idxInativo++;
        const tagsInativo = ['Inativo'];
        const nivelTag = classificarNivel(info.nivel);
        if (nivelTag) tagsInativo.push(nivelTag);
        leadsFinais.push(montarRegistroLead({
            pessoaIdentificador: BASE_ID_INATIVOS_SEM_INSCRICAO + idxInativo,
            pessoaNome: info.nomeOriginal,
            pessoaTelefoneDDD: info.telefoneDDD, pessoaTelefoneNumero: info.telefoneNumero, pessoaEmail: '',
            pessoaStatus: '', telemarketingStatus: '', eventos: []
        }, tagsInativo, filialDestino, { motivoSaida: info.motivo || null, dataSaida: info.dataSaida || null }));
    });

    logImport(`Ativo: ${contAlunoAtivo} com histórico (+ ${contAtivosSemInscricao} sem histórico de evento)`, 'ok');
    logImport(`Inativo: ${contExAluno} com histórico (+ ${contInativosSemInscricao} sem histórico de evento, mas com telefone — resgate)`, 'ok');
    if (contExAlunoPorTelefone > 0) {
        logImport(`${contExAlunoPorTelefone} desses foram casados por TELEFONE, não por nome (nome provavelmente com erro de digitação numa das planilhas).`, 'ok');
    }
    logImport(`Lead Forte: ${contLeadForte} (nível 1: ${contPorNivelLeadForte[1]}, nível 2: ${contPorNivelLeadForte[2]}, nível 3: ${contPorNivelLeadForte[3]})`, 'ok');
    if (mapaTipoTrilha.size > 0) {
        const contPorJornada = { 'Descoberta': 0, 'Interesse Emergente': 0, 'Engajado': 0 };
        leadsFinais.forEach(l => {
            const m = l.tags.match(/"Jornada: ([^"]+)"/);
            if (m && contPorJornada.hasOwnProperty(m[1])) contPorJornada[m[1]]++;
        });
        logImport(`Jornada (prospectos): Descoberta ${contPorJornada['Descoberta']}, Interesse Emergente ${contPorJornada['Interesse Emergente']}, Engajado ${contPorJornada['Engajado']}`, 'ok');
    }
    logImport(`TOTAL de leads prontos: ${leadsFinais.length}`, 'ok');
    logImport('Nada foi enviado ainda. Confira a prévia abaixo.');

    resultadoImportacao = {
        filial: filialDestino,
        leads: leadsFinais,
        resumo: {
            alunoAtivo: contAlunoAtivo + contAtivosSemInscricao,
            exAluno: contExAluno + contInativosSemInscricao,
            leadForte: contLeadForte,
            total: leadsFinais.length
        },
        // Guardado pra resgatarLinhaAuditoria() poder reproduzir o mesmo
        // cruzamento do passo 3 pra uma linha isolada, sem reprocessar tudo.
        auditoria: auditoriaImportacao,
        configPontuacao,
        mapaAtivos,
        mapaInativos,
    };

    renderizarPreviaImportacao(resultadoImportacao);
    renderizarAuditoriaImportacao(resultadoImportacao);
}

// ==========================================
// AUDITORIA DA IMPORTAÇÃO (linhas ignoradas por faltar dado-chave)
// ==========================================
// IDs sintéticos pra leads resgatados pela auditoria — faixa própria,
// distinta de BASE_ID_ATIVOS_SEM_INSCRICAO/BASE_ID_INATIVOS_SEM_INSCRICAO
// (js/importador.js) e da faixa 990000000+ usada por
// js/matricula-importar.js, pra nunca colidir.
const BASE_ID_AUDITORIA_RESGATADA = 980000000;

function renderizarAuditoriaImportacao(resultado) {
    const container = document.getElementById('auditoriaImportacaoContainer');
    if (!container) return;
    const aud = resultado.auditoria;
    container.style.display = 'block';
    if (!aud) { container.innerHTML = ''; return; }

    const totalIgnoradas = aud.ativosSemNome.length + aud.inativosSemNome.length + aud.inscricoesSemId.length;

    if (totalIgnoradas === 0) {
        container.innerHTML = `
            <h3 style="font-size:16px; color:var(--na-green-dark); margin-top:26px;"><i class="fa-solid fa-magnifying-glass-chart"></i> Auditoria da Importação</h3>
            <p class="report-sub" style="color:#15803d;"><i class="fa-solid fa-circle-check"></i> Nenhuma linha das 3 planilhas foi ignorada nesta importação.</p>
        `;
        return;
    }

    const linhasInscricoes = aud.inscricoesSemId.map((l, i) => `
        <tr style="${l.resgatada ? 'opacity:.5;' : ''}">
            <td>${l.linha}</td>
            <td>${escapeHTML(l.pessoaNome || '(sem nome)')}</td>
            <td>${escapeHTML(l.pessoaTelefoneDDD)} ${escapeHTML(l.pessoaTelefoneNumero)}</td>
            <td>${escapeHTML(l.pessoaEmail)}</td>
            <td>${escapeHTML(l.eventoNome)}</td>
            <td>${l.resgatada
                ? '<span style="color:#15803d; font-size:11px;"><i class="fa-solid fa-check"></i> Resgatado</span>'
                : (l.resgatavel
                    ? `<button class="btn-secondary" style="font-size:11px; padding:4px 8px; white-space:nowrap;" onclick="resgatarLinhaAuditoria(${i})"><i class="fa-solid fa-hand-holding-heart"></i> Resgatar como lead</button>`
                    : '<span style="font-size:11px; color:var(--text-muted);">Sem nome — não recuperável</span>')}
            </td>
        </tr>
    `).join('');

    container.innerHTML = `
        <h3 style="font-size:16px; color:var(--na-green-dark); margin-top:26px;"><i class="fa-solid fa-magnifying-glass-chart"></i> Auditoria da Importação</h3>
        <p class="report-sub">Linhas das planilhas que esta importação NÃO conseguiu aproveitar por faltar um dado-chave. Nada foi enviado ao banco ainda — resgate como lead quando fizer sentido, antes de clicar em "Confirmar e Enviar".</p>
        ${aud.inscricoesSemId.length > 0 ? `
            <p style="font-size:12px; font-weight:600; margin-top:10px;">${aud.inscricoesSemId.length} linha(s) de Inscrições sem pessoaIdentificador:</p>
            <div class="import-table-wrapper">
                <table class="import-table">
                    <thead><tr><th>Linha</th><th>Nome</th><th>Telefone</th><th>E-mail</th><th>Evento</th><th></th></tr></thead>
                    <tbody>${linhasInscricoes}</tbody>
                </table>
            </div>
        ` : ''}
        ${aud.ativosSemNome.length > 0 ? `<p style="font-size:12px; color:#b45309; margin-top:10px;"><i class="fa-solid fa-triangle-exclamation"></i> ${aud.ativosSemNome.length} linha(s) de Ativos sem nome, ignoradas (linhas: ${aud.ativosSemNome.map(l => l.linha).join(', ')}) — confira na planilha original.</p>` : ''}
        ${aud.inativosSemNome.length > 0 ? `<p style="font-size:12px; color:#b45309; margin-top:10px;"><i class="fa-solid fa-triangle-exclamation"></i> ${aud.inativosSemNome.length} linha(s) de Inativos sem nome, ignoradas (linhas: ${aud.inativosSemNome.map(l => l.linha).join(', ')}) — confira na planilha original.</p>` : ''}
    `;
}

// Reproduz o mesmo cruzamento do passo 3 de processarPlanilhas() (Ativo /
// Inativo / Lead Forte) pra uma única linha órfã da auditoria, e empilha
// o lead resultante em resultadoImportacao.leads — como nada foi enviado
// ao Supabase ainda, ele já sai incluído no próximo "Confirmar e Enviar",
// sem precisar de uma chamada separada ao banco.
function resgatarLinhaAuditoria(indice) {
    if (!resultadoImportacao || !resultadoImportacao.auditoria) return;
    const linha = resultadoImportacao.auditoria.inscricoesSemId[indice];
    if (!linha || linha.resgatada || !linha.resgatavel) return;

    const { mapaAtivos, mapaInativos, configPontuacao, filial } = resultadoImportacao;
    const chave = normalizarNomeImport(linha.pessoaNome);
    const eventos = linha.eventoNome ? [{ evento: linha.eventoNome, data: linha.eventoData, tipo: classificarTipoEvento(linha.eventoNome) }] : [];
    const tags = [];
    let motivoSaida = null, dataSaida = null;

    if (mapaAtivos.has(chave) && !mapaAtivos.get(chave).usado) {
        const info = mapaAtivos.get(chave);
        info.usado = true;
        tags.push('Ativo');
        const nivelTag = classificarNivel(info.nivel);
        if (nivelTag) tags.push(nivelTag);
    } else if (mapaInativos.has(chave) && !mapaInativos.get(chave).usado) {
        const info = mapaInativos.get(chave);
        info.usado = true;
        tags.push('Inativo');
        const nivelTag = classificarNivel(info.nivel);
        if (nivelTag) tags.push(nivelTag);
        motivoSaida = info.motivo || null;
        dataSaida = info.dataSaida || null;
    } else {
        const nivel = calcularNivelLeadForte(eventos, configPontuacao);
        tags.push('Lead Forte ' + nivel);
    }

    const idSintetico = BASE_ID_AUDITORIA_RESGATADA + indice;
    const novoLead = montarRegistroLead({
        pessoaIdentificador: idSintetico,
        pessoaNome: linha.pessoaNome,
        pessoaTelefoneDDD: linha.pessoaTelefoneDDD,
        pessoaTelefoneNumero: linha.pessoaTelefoneNumero,
        pessoaEmail: linha.pessoaEmail,
        pessoaStatus: '', telemarketingStatus: '',
        eventos
    }, tags, filial, { motivoSaida, dataSaida });

    resultadoImportacao.leads.push(novoLead);
    resultadoImportacao.resumo.total++;
    if (tags.includes('Ativo')) resultadoImportacao.resumo.alunoAtivo++;
    if (tags.includes('Inativo')) resultadoImportacao.resumo.exAluno++;
    if (tags.some(t => /^Lead Forte/.test(t))) resultadoImportacao.resumo.leadForte++;

    linha.resgatada = true;
    logImport(`Linha ${linha.linha} das Inscrições resgatada como novo lead: ${linha.pessoaNome} (ID sintético ${idSintetico}).`, 'ok');

    renderizarPreviaImportacao(resultadoImportacao);
    renderizarAuditoriaImportacao(resultadoImportacao);
}

// ==========================================
// PRÉVIA (antes de qualquer envio ao banco)
// ==========================================
function renderizarPreviaImportacao(resultado) {
    const container = document.getElementById('importPreview');
    if (!container) return;
    container.style.display = 'flex';

    const amostra = resultado.leads.slice(0, 25);

    container.innerHTML = `
        <div class="import-summary-grid">
            <div class="import-summary-card"><div class="import-summary-value">${resultado.resumo.total.toLocaleString('pt-BR')}</div><div class="import-summary-label">Total de Leads</div></div>
            <div class="import-summary-card"><div class="import-summary-value">${resultado.resumo.alunoAtivo.toLocaleString('pt-BR')}</div><div class="import-summary-label">Ativo</div></div>
            <div class="import-summary-card"><div class="import-summary-value">${resultado.resumo.exAluno.toLocaleString('pt-BR')}</div><div class="import-summary-label">Inativo</div></div>
            <div class="import-summary-card"><div class="import-summary-value">${resultado.resumo.leadForte.toLocaleString('pt-BR')}</div><div class="import-summary-label">Lead Forte</div></div>
        </div>

        <div class="import-table-wrapper">
            <table class="import-table">
                <thead><tr><th>Nome</th><th>Telefone</th><th>Tags</th><th>Nº de Eventos</th></tr></thead>
                <tbody>
                    ${amostra.map(l => `
                        <tr>
                            <td>${escapeHTML(l.pessoaNome)}</td>
                            <td>${escapeHTML(l.pessoaTelefoneDDD)} ${escapeHTML(l.pessoaTelefoneNumero)}</td>
                            <td>${JSON.parse(l.tags).map(t => escapeHTML(t)).join(', ')}</td>
                            <td>${l.historico_eventos.length}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        <p style="font-size:10px; color:var(--text-muted);">Mostrando os primeiros 25 de ${resultado.resumo.total.toLocaleString('pt-BR')} leads. Nada foi enviado ainda.</p>

        <div class="import-confirm-row">
            <div class="import-progress-bar" id="importProgressBar" style="display:none;"><div class="import-progress-fill" id="importProgressFill"></div></div>
            <span id="importProgressLabel" style="font-size:11px; color:var(--text-muted);"></span>
            <button class="btn-primary" onclick="confirmarEnviarImportacao()"><i class="fa-solid fa-cloud-arrow-up"></i> Confirmar e Enviar para o Supabase</button>
        </div>
    `;
}

// ==========================================
// ENVIO AO SUPABASE (upsert em massa, preservando trabalho manual)
// ==========================================
async function confirmarEnviarImportacao() {
    if (!resultadoImportacao) return;

    const barra = document.getElementById('importProgressBar');
    const preenchimento = document.getElementById('importProgressFill');
    const label = document.getElementById('importProgressLabel');
    if (barra) barra.style.display = 'block';

    logImport('---');
    logImport('Buscando leads já existentes nesta filial (pra não sobrescrever posição no funil, resumo de IA e tags manuais)...');

    // Busca o que já existe no banco pra essa filial, paginado (1000 em 1000)
    const existentes = new Map();
    let inicio = 0;
    const passo = 1000;
    while (true) {
        const { data, error } = await window.supabaseClient
            .from(NOME_TABELA)
            .select('pessoaIdentificador, pessoaNome, tags, funil_agencia, resumo_ia')
            .eq('filial', resultadoImportacao.filial)
            .order('pessoaIdentificador', { ascending: true })
            .range(inicio, inicio + passo - 1);

        if (error) {
            logImport('Erro ao buscar leads existentes: ' + error.message, 'err');
            return;
        }
        data.forEach(l => existentes.set(String(l.pessoaIdentificador), l));
        if (data.length < passo) break;
        inicio += passo;
    }
    logImport(`${existentes.size} leads já existiam nessa filial antes desta importação.`, 'ok');

    // ---- Alerta: leads que já existiam nesta filial mas NÃO apareceram em
    //      nenhuma das 3 planilhas desta vez. Pode ser gente que trancou/saiu
    //      sem que o time tivesse percebido por aqui, ou só caiu da planilha
    //      por engano do lado de quem exportou — por isso é só INFORMATIVO,
    //      não muda tag nem coluna de ninguém sozinho.
    const idsNestaImportacao = new Set(resultadoImportacao.leads.map(l => l.pessoaIdentificador));
    const sumidos = Array.from(existentes.values()).filter(e => !idsNestaImportacao.has(String(e.pessoaIdentificador)));
    if (sumidos.length > 0) {
        logImport(`⚠ ${sumidos.length} lead(s) que já existiam nesta filial não apareceram em NENHUMA das 3 planilhas desta vez — revise antes de assumir que trancaram/saíram:`, 'warn');
        sumidos.slice(0, 30).forEach(e => logImport(`   • ${e.pessoaNome || e.pessoaIdentificador}`, 'warn'));
        if (sumidos.length > 30) logImport(`   ...e mais ${sumidos.length - 30}.`, 'warn');
    } else if (existentes.size > 0) {
        logImport('Nenhum lead sumiu das planilhas desta vez — todos os que já existiam nesta filial continuam aparecendo em pelo menos uma das 3.', 'ok');
    }

    // Tags "de sistema" (calculadas pela importação) — qualquer outra tag
    // que o time já tenha adicionado manualmente num lead existente é
    // preservada. Inclui os nomes antigos ("Aluno Ativo"/"Ex-Aluno (Inativo)")
    // além dos atuais ("Ativo"/"Inativo"), pra uma reimportação trocar o
    // nome antigo pelo novo em vez de deixar os dois acumulados. "Lead
    // Forte" cobre tanto o formato antigo (sem nível) quanto o novo ("Lead
    // Forte 1/2/3"), e o regex de nível cobre tanto o esquema antigo
    // (N1-N7 direto) quanto o atual (TA/JN/PP/N1/Membro).
    const TAGS_SISTEMA_EXATAS = ['Aluno Ativo', 'Ativo', 'Ex-Aluno (Inativo)', 'Inativo'];
    function ehTagDeSistema(tag) {
        return TAGS_SISTEMA_EXATAS.includes(tag)
            || /^Lead Forte( [1-3])?$/.test(tag)
            || /^(TA|JN|PP|N[1-7]|Membro)$/.test(tag)
            || /^Sem (Telefone|E-mail)$/.test(tag)
            || /^(Trilha|Jornada): /.test(tag);
    }
    const primeiraColuna = (typeof columnsConfig !== 'undefined' && columnsConfig.length > 0) ? columnsConfig[0].key : 'Frios';

    // "Recuperado": quem JÁ ESTAVA marcado Inativo no banco (antes desta
    // importação) e virou Ativo NESTA importação. Só dá pra detectar
    // olhando a virada acontecer — não tem histórico de tags no CRM, então
    // não dá pra achar retroativamente quem já tinha voltado antes desta
    // mudança existir. De propósito NÃO entra em ehTagDeSistema(): assim,
    // depois de aplicada uma vez, ela sobrevive reimportações futuras pelo
    // mesmo caminho de "tag customizada preservada" (na próxima
    // importação a pessoa já estará Ativa, não Inativa, então a virada não
    // seria detectada de novo — mas a tag antiga continua lá).
    const TAG_RECUPERADO = 'Recuperado';
    let contRecuperados = 0;

    // Leads NOVOS (sem registro anterior) vão todos pra primeira coluna do
    // funil, COM ou SEM telefone — quem não tem telefone não fica mais
    // segregado numa coluna "Sem Whatsapp" (decisão revertida: esses leads
    // continuam no fluxo normal de prospecção, e passam a aparecer também
    // na aba "Leads a Tratar" — ver detectarLeadsATratar() logo abaixo —
    // pra o time saber que precisam de um telefone bom antes de prosperar
    // por WhatsApp). Leads que JÁ EXISTIAM mantêm a posição atual de
    // qualquer jeito (não move ninguém que o time já triou manualmente).
    const registrosFinais = resultadoImportacao.leads.map(lead => {
        const existente = existentes.get(lead.pessoaIdentificador);
        const tagsNovas = JSON.parse(lead.tags);

        if (existente) {
            let tagsAntigas = [];
            try { tagsAntigas = JSON.parse(existente.tags || '[]'); } catch (e) { tagsAntigas = []; }
            const tagsCustomizadasMantidas = tagsAntigas.filter(t => !ehTagDeSistema(t));
            let tagsFinais = Array.from(new Set([...tagsNovas, ...tagsCustomizadasMantidas]));

            const estavaInativo = tagsAntigas.includes('Inativo') || tagsAntigas.includes('Ex-Aluno (Inativo)');
            const agoraAtivo = tagsNovas.includes('Ativo');
            if (estavaInativo && agoraAtivo && !tagsFinais.includes(TAG_RECUPERADO)) {
                tagsFinais = [...tagsFinais, TAG_RECUPERADO];
                contRecuperados++;
            }

            return {
                ...lead,
                tags: JSON.stringify(tagsFinais),
                funil_agencia: existente.funil_agencia || primeiraColuna, // preserva posição no Kanban
                resumo_ia: existente.resumo_ia || null                    // preserva resumo de IA
            };
        }

        return { ...lead, funil_agencia: primeiraColuna, resumo_ia: null };
    });

    if (contRecuperados > 0) {
        logImport(`${contRecuperados} lead(s) estavam Inativos e voltaram a ser Ativos nesta importação — marcados com a tag "Recuperado".`, 'ok');
    }

    logImport(`Enviando ${registrosFinais.length} leads ao Supabase, em lotes de 500...`);

    const TAMANHO_LOTE_ENVIO = 500;
    let enviados = 0;
    for (let i = 0; i < registrosFinais.length; i += TAMANHO_LOTE_ENVIO) {
        const lote = registrosFinais.slice(i, i + TAMANHO_LOTE_ENVIO);
        const { error } = await window.supabaseClient
            .from(NOME_TABELA)
            .upsert(lote, { onConflict: 'pessoaIdentificador' });

        if (error) {
            logImport(`Erro no lote ${i}–${i + lote.length}: ${error.message}`, 'err');
            if (label) label.innerText = 'Erro — veja o log acima.';
            logImport('Se o erro mencionar "unique or exclusion constraint", rode a migração migracao_historico_eventos.sql antes de tentar de novo.', 'warn');
            return;
        }

        enviados += lote.length;
        const pct = Math.round((enviados / registrosFinais.length) * 100);
        if (preenchimento) preenchimento.style.width = pct + '%';
        if (label) label.innerText = `${enviados} / ${registrosFinais.length} enviados (${pct}%)`;
    }

    logImport(`Importação concluída! ${enviados} leads enviados para "${resultadoImportacao.filial}".`, 'ok');
    if (label) label.innerText = 'Concluído!';

    // Varredura de "Leads a Tratar" (duplicados por telefone/nome + sem
    // telefone) — roda sempre ao final de toda importação, sobre a filial
    // inteira (não só os leads que acabaram de entrar), já que um
    // duplicado pode envolver um lead que já existia antes.
    if (typeof detectarLeadsATratar === 'function') {
        await detectarLeadsATratar(resultadoImportacao.filial, logImport);
    }

    // Se a filial importada é a que está aberta agora, recarrega o Kanban
    if (typeof filialAtual !== 'undefined' && resultadoImportacao.filial === filialAtual && typeof carregarLeads === 'function') {
        logImport('Recarregando o Kanban com os dados atualizados...');
        carregarLeads(filialAtual, true);
        if (typeof carregarLeadsATratar === 'function') carregarLeadsATratar();
    }
}

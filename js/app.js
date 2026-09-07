// ==========================================
// ESTADO GLOBAL
// ==========================================
let leadsAtuais = [];
let inicioLote = 0;
const tamanhoLote = 500;
let currentLeadId = null;
let podeCarregarMais = false;

const NOME_TABELA = 'leads_inscricoes'; // ajuste aqui se o nome da tabela no Supabase for outro
const NOME_TABELA_FILIAIS = 'filiais';
const CHAVE_STORAGE_COLUNAS = 'crm_na_colunas_config';
const CHAVE_STORAGE_COLUNAS_RECOLHIDAS = 'crm_na_colunas_recolhidas';
const CHAVE_STORAGE_FILIAL = 'crm_na_filial_atual';

// Coluna LEGADA: o importador (js/importador.js) criava ela automaticamente
// pra leads novos sem telefone — desde que a aba "Leads a Tratar" existe
// (ver js/leads-a-tratar.js), esse é o destino novo pra esses leads, e o
// importador não cria mais essa coluna. Mantida aqui só pra continuar
// tratando como "coluna fria" (não trabalhada) nos KPIs do Dashboard
// qualquer lead que já estivesse nela de antes dessa mudança.
const COLUNA_SEM_WHATSAPP = 'Sem Whatsapp';

// SLA de atendimento: horas que um lead pode ficar na PRIMEIRA coluna do
// funil (frio, ainda não abordado) antes do card ganhar borda vermelha no
// Kanban — ver renderizarCards(). Ajustável aqui direto no código (não
// pareceu justificar uma tela de configuração própria, diferente do Lead
// Forte/Trilhas, que têm reajuste mais frequente e analítico).
const SLA_HORAS_COLUNA_FRIA = 2;

// Estado da filial selecionada
let filialAtual = '';
let filiaisDisponiveis = [];

// Configuração das colunas do funil (editável pelo usuário e persistida no navegador)
let columnsConfig = carregarColunasLocal();

// Colunas "guardadas na gaveta" (escondidas do board pra reduzir poluição
// visual, sem mexer nos leads que estão nelas) — também client-side.
let colunasRecolhidas = carregarColunasRecolhidasLocal();

// Colunas com a "soneca" temporariamente revelada (ver renderizarCards()) —
// só em memória, some ao recarregar a página, de propósito: é uma espiada
// rápida em quem está com follow-up agendado pra depois, não uma
// preferência duradoura como colunasRecolhidas acima.
let colunasSonecaRevelada = new Set();
function toggleSonecaColuna(key) {
    if (colunasSonecaRevelada.has(key)) colunasSonecaRevelada.delete(key);
    else colunasSonecaRevelada.add(key);
    renderizarCards();
}
function atualizarChipSonecaColuna(key, count) {
    const chip = document.getElementById(`soneca-${key}`);
    if (!chip) return;
    if (count === 0 && !colunasSonecaRevelada.has(key)) { chip.style.display = 'none'; return; }
    chip.style.display = 'inline-flex';
    chip.innerHTML = colunasSonecaRevelada.has(key)
        ? `<i class="fa-solid fa-eye"></i> Ocultar soneca`
        : `<i class="fa-solid fa-moon"></i> ${count} em soneca`;
}

// Filtros avançados (tags/evento/data/telefone/e-mail) são por COLUNA, não
// mais um estado global único — cada coluna do Kanban tem seu próprio
// filtro independente. `filtrosColuna[key].tags` é combinatório em E: só
// mostra o lead se ele tiver TODAS as tags marcadas (não qualquer uma).
// Status/Telemarketing não fazem mais parte do filtro: Telemarketing foi
// descontinuado, e Status passou a ser exibido na gaveta do lead em vez de
// filtrado por coluna (ver abrirGaveta()).
let filtrosColuna = {}; // { chaveDaColuna: { tags, evento, dataDe, dataAte, temTelefone, temEmail } }

function filtroColunaVazio() {
    // tagsExcluidas: "filter out" — esconde o lead se ele tiver QUALQUER
    // uma dessas tags, independente do que estiver marcado em `tags`
    // (que continua sendo E — precisa ter todas).
    return { tags: [], tagsExcluidas: [], evento: '', dataDe: '', dataAte: '', temTelefone: false, temEmail: false };
}

function getFiltroColuna(key) {
    if (!filtrosColuna[key]) filtrosColuna[key] = filtroColunaVazio();
    return filtrosColuna[key];
}

function colunasPadrao() {
    return [
        { key: 'Frios', label: 'Frios', color: '#64748b' },
        { key: 'Abordagem', label: 'Em Abordagem', color: '#c5a059' },
        { key: 'RSVP', label: 'RSVP Ativo', color: '#3b82f6' },
        { key: 'Matriculados', label: 'Matriculados', color: '#005a4b' }
    ];
}

function carregarColunasLocal() {
    try {
        const salvo = localStorage.getItem(CHAVE_STORAGE_COLUNAS);
        if (salvo) {
            const parsed = JSON.parse(salvo);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch (e) { /* ignora e cai no padrão */ }
    return colunasPadrao();
}

function carregarColunasRecolhidasLocal() {
    try {
        const salvo = localStorage.getItem(CHAVE_STORAGE_COLUNAS_RECOLHIDAS);
        if (salvo) {
            const parsed = JSON.parse(salvo);
            if (Array.isArray(parsed)) return new Set(parsed);
        }
    } catch (e) { /* ignora e cai no padrão */ }
    return new Set();
}
function salvarColunasRecolhidasLocal() {
    localStorage.setItem(CHAVE_STORAGE_COLUNAS_RECOLHIDAS, JSON.stringify(Array.from(colunasRecolhidas)));
}

function salvarColunasLocal() {
    localStorage.setItem(CHAVE_STORAGE_COLUNAS, JSON.stringify(columnsConfig));
}

// ==========================================
// 0. FILIAIS (multi-unidade)
// ==========================================
async function carregarFiliais() {
    const select = document.getElementById('filialSelect');

    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA_FILIAIS)
        .select('*')
        .eq('ativo', true)
        .order('ordem', { ascending: true });

    if (error || !data || data.length === 0) {
        // Fallback: se a tabela "filiais" ainda não existir (migração não rodada),
        // o CRM continua funcionando com a filial histórica, sem quebrar.
        console.warn('Não foi possível carregar a tabela "filiais" (rode a migração SQL). Usando fallback.', error);
        filiaisDisponiveis = [{ nome: 'Goiânia - Jardim América' }];
    } else {
        filiaisDisponiveis = data;
    }

    select.innerHTML = filiaisDisponiveis.map(f =>
        `<option value="${escapeHTML(f.nome)}">${escapeHTML(f.nome)}</option>`
    ).join('');

    const salvo = localStorage.getItem(CHAVE_STORAGE_FILIAL);
    filialAtual = (salvo && filiaisDisponiveis.some(f => f.nome === salvo))
        ? salvo
        : filiaisDisponiveis[0].nome;
    select.value = filialAtual;

    renderizarColunas(); // monta o esqueleto do Kanban uma única vez
    carregarLeads(filialAtual);
}

function trocarFilial(novaFilial) {
    if (!novaFilial || novaFilial === filialAtual) return;
    filialAtual = novaFilial;
    localStorage.setItem(CHAVE_STORAGE_FILIAL, filialAtual);
    document.querySelectorAll('.column-search').forEach(input => { input.value = ''; });
    carregarLeads(filialAtual, true);
    if (typeof carregarEventos === 'function') carregarEventos();
    if (typeof carregarLeadsATratar === 'function') carregarLeadsATratar();
}

// ==========================================
// 1. CARREGAMENTO DO BANCO (Busca os dados)
// ==========================================
async function carregarLeads(filial, resetar = true) {
    filialAtual = filial;

    if (resetar) {
        inicioLote = 0;
        leadsAtuais = [];
        if (typeof iniciarNotificacoesParaFilial === 'function') iniciarNotificacoesParaFilial();
    }

    const btnAntigo = document.getElementById('btn-carregar-mais');
    if (btnAntigo) {
        btnAntigo.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Puxando...';
        btnAntigo.disabled = true;
    }

    atualizarStatsCarregando();

    const fimLote = inicioLote + tamanhoLote - 1;

    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('*')
        .eq('filial', filial)
        .order('pessoaIdentificador', { ascending: true })
        .range(inicioLote, fimLote);

    if (error) {
        console.error("Erro ao carregar dados:", error);
        alert("Erro de conexão com o Supabase. Veja o console (F12) para detalhes.");
        if (btnAntigo) btnAntigo.remove();
        return;
    }

    leadsAtuais = [...leadsAtuais, ...data];

    if (data.length === tamanhoLote) {
        podeCarregarMais = true;
        inicioLote += tamanhoLote;
    } else {
        podeCarregarMais = false;
    }

    renderizarCards();
}

// ==========================================
// 2. COLUNAS DINÂMICAS DO KANBAN
// ==========================================
function renderizarColunas() {
    const board = document.getElementById('kanbanBoard');
    board.innerHTML = '';

    // Colunas recolhidas (guardadas na gaveta) não ganham elemento no board
    // — os leads delas continuam intactos, só não aparecem em lugar nenhum
    // enquanto estiverem recolhidas. montarGavetaColunas() (chamada dentro
    // de renderizarCards()) cuida da barra superior com os chips.
    columnsConfig.filter(col => !colunasRecolhidas.has(col.key)).forEach(col => {
        const colEl = document.createElement('div');
        colEl.className = 'kanban-col';
        colEl.style.setProperty('--col-accent', col.color || '#005a4b');
        colEl.innerHTML = `
            <div class="col-header">
                <div class="col-header-top">
                    <span style="color:${col.color || 'inherit'};">${escapeHTML(col.label)}</span>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span class="col-count" id="count-${col.key}">0</span>
                        <button type="button" class="col-collapse-btn" onclick="recolherColuna('${col.key}')" title="Guardar coluna na gaveta"><i class="fa-solid fa-angles-up"></i></button>
                    </div>
                </div>
                <button type="button" class="col-soneca-chip" id="soneca-${col.key}" style="display:none;" onclick="toggleSonecaColuna('${col.key}')" title="Leads com follow-up agendado pra depois — não aparecem até o dia marcado"></button>
                <button type="button" class="col-select-all-btn" onclick="toggleSelecionarTodosColuna('${col.key}')">
                    <i class="fa-regular fa-square-check"></i> Selecionar visíveis
                </button>
                ${col.key.toLowerCase().includes('matricul') || col.label.toLowerCase().includes('matricul') ? `
                    <button type="button" class="col-import-matricula-btn" onclick="abrirImportarMatricula('${col.key}')">
                        <i class="fa-solid fa-graduation-cap"></i> Importar Matrícula
                    </button>
                ` : ''}
                <div class="col-filter-wrapper">
                    <input type="text" class="col-filter-input column-search" data-col="col-${col.key}" placeholder="Buscar em ${escapeHTML(col.label)}..." onkeyup="filtroColunaComDebounce('${col.key}')">
                    <i class="fa-solid fa-circle-notch fa-spin" id="buscaBancoIndicador-${col.key}" style="display:none; position:absolute; right:8px; top:8px; color:var(--na-green); font-size:10px;"></i>
                    <i class="fa-solid fa-filter" id="buscaBancoIcone-${col.key}"></i>
                </div>
                <div class="col-tag-filter">
                    <button type="button" class="col-tag-btn" onclick="toggleDropdownFiltroColuna('${col.key}')">
                        <span><i class="fa-solid fa-sliders"></i> Filtros</span>
                        <span style="display:flex; align-items:center; gap:4px;">
                            <span class="col-tag-badge" id="filterBadge-${col.key}" style="display:none;">0</span>
                            <i class="fa-solid fa-chevron-down" style="font-size:8px;"></i>
                        </span>
                    </button>
                    <div class="col-filter-dropdown" id="filterDropdown-${col.key}">
                        <div class="col-filter-section">
                            <div class="col-filter-section-title">Tags (precisa ter todas)</div>
                            <div class="col-filter-chip-list" id="tagsChips-${col.key}"></div>
                        </div>
                        <div class="col-filter-section">
                            <div class="col-filter-section-title">Excluir (não pode ter nenhuma destas)</div>
                            <div class="col-filter-chip-list col-filter-exclude-list" id="tagsExcluidasChips-${col.key}"></div>
                        </div>
                        <div class="col-filter-section">
                            <div class="col-filter-section-title">Evento (nome contém)</div>
                            <input type="text" id="filtroEvento-${col.key}" placeholder="Ex: Palestra, Workshop..." onkeydown="if(event.key==='Enter') aplicarFiltroColunaCampos('${col.key}')">
                        </div>
                        <div class="col-filter-section col-filter-dates">
                            <div>
                                <div class="col-filter-section-title">Data — de</div>
                                <input type="date" id="filtroDataDe-${col.key}">
                            </div>
                            <div>
                                <div class="col-filter-section-title">Data — até</div>
                                <input type="date" id="filtroDataAte-${col.key}">
                            </div>
                        </div>
                        <div class="col-filter-section col-filter-checks">
                            <label class="col-tag-option"><input type="checkbox" id="filtroTemTelefone-${col.key}"> Tem telefone</label>
                            <label class="col-tag-option"><input type="checkbox" id="filtroTemEmail-${col.key}"> Tem e-mail</label>
                        </div>
                        <div class="col-filter-actions">
                            <button type="button" class="btn-mini btn-secondary-mini" onclick="limparFiltroColuna('${col.key}')">Limpar</button>
                            <button type="button" class="btn-mini btn-primary-mini" onclick="aplicarFiltroColunaCampos('${col.key}')"><i class="fa-solid fa-check"></i> Aplicar</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-body" id="col-${col.key}" ondragover="permitirDrop(event)" ondragleave="this.classList.remove('drag-over')" ondrop="soltar(event, '${col.key}')"></div>
        `;
        board.appendChild(colEl);
    });

    montarSelectBulkAction(); // repopula o "mover para..." da barra de seleção com as colunas atuais
}

function getColumnKeys() {
    return columnsConfig.map(c => c.key);
}

// ==========================================
// GAVETA DE COLUNAS (recolher/restaurar)
// ==========================================
function recolherColuna(key) {
    const visiveisRestantes = columnsConfig.filter(c => !colunasRecolhidas.has(c.key) && c.key !== key);
    if (visiveisRestantes.length === 0) {
        alert('É preciso manter pelo menos uma coluna visível no board.');
        return;
    }
    colunasRecolhidas.add(key);
    salvarColunasRecolhidasLocal();
    renderizarColunas();
    renderizarCards();
}

function restaurarColuna(key) {
    colunasRecolhidas.delete(key);
    salvarColunasRecolhidasLocal();
    renderizarColunas();
    renderizarCards();
}

// Chamada ao final de renderizarCards(), que já sabe quantos leads caem em
// cada coluna (inclusive as recolhidas, mesmo sem elemento no DOM).
function montarGavetaColunas(contagemPorColuna) {
    const bar = document.getElementById('colunasGaveta');
    if (!bar) return;

    const chaves = columnsConfig.map(c => c.key).filter(k => colunasRecolhidas.has(k));
    if (chaves.length === 0) {
        bar.style.display = 'none';
        return;
    }

    bar.style.display = 'flex';
    bar.innerHTML = chaves.map(key => {
        const col = columnsConfig.find(c => c.key === key);
        if (!col) return '';
        const n = contagemPorColuna[key] || 0;
        return `
            <button type="button" class="coluna-recolhida-chip" style="border-left-color:${col.color || '#94a3b8'};" onclick="restaurarColuna('${key}')" title="Restaurar coluna">
                <i class="fa-solid fa-arrow-turn-down"></i> ${escapeHTML(col.label)} <span class="coluna-recolhida-count ${n > 0 ? 'tem-leads' : ''}">${n}</span>
            </button>
        `;
    }).join('');
}

// ==========================================
// 3. MOTOR DE DESENHO E ORDENAÇÃO
// ==========================================
const ORDEM_NIVEL_ALUNO = ['TA', 'JN', 'PP', 'N1', 'Membro'];

function contarTags(lead) {
    return parseTags(lead.tags).filter(t => t.trim() !== '').length;
}

// 1 = mais propenso a matricular ... 99 = não é Lead Forte (vai pro final)
function rankLeadForte(lead) {
    const tag = parseTags(lead.tags).find(t => /^Lead Forte [1-3]$/.test(t.trim()));
    return tag ? Number(tag.trim().slice(-1)) : 99;
}

// Posição na progressão TA → JN → PP → N1 → Membro; sem nível vai pro final
function rankNivelAluno(lead) {
    const tags = parseTags(lead.tags).map(t => t.trim());
    const indices = tags.map(t => ORDEM_NIVEL_ALUNO.indexOf(t)).filter(i => i >= 0);
    return indices.length > 0 ? Math.min(...indices) : 99;
}

function renderizarCards() {
    if (columnsConfig.length === 0) return;

    // 1. Sem pré-filtro global — cada coluna filtra a si mesma mais abaixo
    //    (passo 6, aplicarFiltroVisualColuna), depois que os cards já estão
    //    no DOM. "Ativo" não é mais excluído daqui: alunos ativos são
    //    uma fonte importante de indicação de novos alunos, e o time
    //    precisa conseguir contatá-los pra isso — por isso aparecem
    //    normalmente no Kanban, com um badge próprio.
    let leadsBase = leadsAtuais;

    // 2. Ordenação
    const sortEl = document.getElementById('sortSelect');
    const sortOption = sortEl ? sortEl.value : 'padrao';
    if (sortOption === 'az') {
        leadsBase = [...leadsBase].sort((a, b) => (a.pessoaNome || "").localeCompare(b.pessoaNome || ""));
    } else if (sortOption === 'za') {
        leadsBase = [...leadsBase].sort((a, b) => (b.pessoaNome || "").localeCompare(a.pessoaNome || ""));
    } else if (sortOption === 'tags_desc') {
        leadsBase = [...leadsBase].sort((a, b) => contarTags(b) - contarTags(a));
    } else if (sortOption === 'lead_forte') {
        leadsBase = [...leadsBase].sort((a, b) => rankLeadForte(a) - rankLeadForte(b));
    } else if (sortOption === 'nivel_aluno') {
        leadsBase = [...leadsBase].sort((a, b) => rankNivelAluno(a) - rankNivelAluno(b));
    } else if (sortOption === 'prioridade') {
        // Combina os critérios: Lead Forte primeiro (1 antes de 2 antes de
        // 3), empatado por quantidade de tags (mais engajado primeiro),
        // empatado por nome — pensado como "quem eu ligo primeiro hoje".
        leadsBase = [...leadsBase].sort((a, b) => {
            const diffLeadForte = rankLeadForte(a) - rankLeadForte(b);
            if (diffLeadForte !== 0) return diffLeadForte;
            const diffTags = contarTags(b) - contarTags(a);
            if (diffTags !== 0) return diffTags;
            return (a.pessoaNome || "").localeCompare(b.pessoaNome || "");
        });
    }

    // 3. Prepara as colunas (o "limpar" acontece junto da escrita, mais abaixo)
    const validKeys = getColumnKeys();

    // 4. Distribui os cards — o HTML de cada coluna é montado em memória
    //    (array de strings) e só é escrito no DOM UMA VEZ por coluna ao final.
    //    Isso é essencial em bases grandes: inserir card por card no DOM
    //    (insertAdjacentHTML repetido) é o que travava o navegador acima de
    //    alguns milhares de leads, pois cada inserção força um recálculo de
    //    layout. Uma escrita só por coluna é ordens de magnitude mais rápida.
    const primeiraColuna = validKeys[0];
    const tagsPorColuna = {};
    const htmlPorColuna = {};
    const contagemPorColuna = {}; // inclui colunas recolhidas (sem DOM), pra alimentar os chips da gaveta
    // Leads com lembrete_em NO FUTURO ficam em "soneca" — somem da coluna
    // até o dia marcado (sonecaPorColuna conta quantos, pra mostrar um chip
    // "N em soneca" no cabeçalho; colunasSonecaRevelada.has(key) mostra de
    // volta temporariamente, ver toggleSonecaColuna()). Cards com lembrete
    // vencido HOJE ou atrasado (lembreteVencido) vão pro topo da coluna
    // (array "urgente", concatenado antes do resto) com a tag "Ligar Hoje".
    const sonecaPorColuna = {};
    validKeys.forEach(key => {
        tagsPorColuna[key] = new Set();
        htmlPorColuna[key] = { urgente: [], normal: [] };
        contagemPorColuna[key] = 0;
        sonecaPorColuna[key] = 0;
    });

    leadsBase.forEach(lead => {
        let colunaAlvo = lead.funil_agencia;
        if (!validKeys.includes(colunaAlvo)) colunaAlvo = primeiraColuna;
        contagemPorColuna[colunaAlvo]++;

        const tagsArray = parseTags(lead.tags);

        let badgesHTML = '';
        // "Ativo"/"Inativo" (nomes atuais) ou "Aluno Ativo"/"Ex-Aluno (Inativo)"
        // (nomes antigos, de leads que ainda não passaram por uma
        // reimportação) — checagem por elemento exato do array, não
        // substring da string crua (essencial agora que os nomes são
        // curtos, pra não confundir com outra tag que contenha essas
        // palavras por acaso).
        const tagsLimpo = tagsArray.map(t => t.trim());
        if (tagsLimpo.includes('Ativo') || tagsLimpo.includes('Aluno Ativo')) {
            badgesHTML += `<span class="tag tag-ativo"><i class="fa-solid fa-graduation-cap"></i> Ativo</span>`;
        }
        if (tagsLimpo.includes('Inativo') || tagsLimpo.includes('Ex-Aluno (Inativo)')) {
            badgesHTML += `<span class="tag tag-exaluno">Inativo</span>`;
        }
        // "Recuperado": estava Inativo e voltou a ser Ativo (aplicada pelo
        // importador) — badge sempre visível, igual Ativo/Inativo, pra
        // destacar como uma conquista, não só mais uma tag customizada.
        if (tagsLimpo.includes('Recuperado')) {
            badgesHTML += `<span class="tag tag-recuperado"><i class="fa-solid fa-medal"></i> Recuperado</span>`;
        }
        // "Perdido": movido pra uma coluna de motivos de perda
        // (registrarMotivoPerda(), ver ehColunaPerdido()) — badge sempre
        // visível, igual Ativo/Inativo/Recuperado.
        if (tagsLimpo.includes('Perdido')) {
            badgesHTML += `<span class="tag tag-perdido"><i class="fa-solid fa-trash"></i> Perdido</span>`;
        }
        // "Lead Forte" pode vir com nível (1-3, formato novo) ou sem (dado
        // antigo, de antes dessa classificação existir) — mostra o texto
        // exato que a tag tiver.
        const tagLeadForte = tagsArray.find(t => /^Lead Forte( [1-3])?$/.test(t.trim()));
        if (tagLeadForte) {
            const textoLeadForte = tagLeadForte.trim();
            // Ícone também varia por grau, além da cor (classeVisualTag):
            // nível 1 = fogo (mais urgente), 2 = estrela cheia, 3 = estrela vazada.
            const nivelMatch = textoLeadForte.match(/([1-3])$/);
            const iconeLeadForte = !nivelMatch ? 'fa-solid fa-star'
                : nivelMatch[1] === '1' ? 'fa-solid fa-fire'
                : nivelMatch[1] === '2' ? 'fa-solid fa-star'
                : 'fa-regular fa-star';
            badgesHTML += `<span class="tag ${classeVisualTag(textoLeadForte)}"><i class="${iconeLeadForte}"></i> ${escapeHTML(textoLeadForte)}</span>`;
        }

        const MAX_TAGS_CUSTOM_NO_CARD = 3;
        let countTags = 0;
        let tagsCustomRestantes = 0;
        tagsArray.forEach(t => {
            const tagLimpa = t.trim();
            if (tagLimpa === '') return;
            if (tagsPorColuna[colunaAlvo]) tagsPorColuna[colunaAlvo].add(tagLimpa);
            const ehSistemaAtivoInativo = tagLimpa === 'Ativo' || tagLimpa === 'Aluno Ativo' || tagLimpa === 'Inativo' || tagLimpa === 'Ex-Aluno (Inativo)' || tagLimpa === 'Recuperado' || tagLimpa === 'Perdido';
            if (ehSistemaAtivoInativo || /^Lead Forte( [1-3])?$/.test(tagLimpa)) return;
            if (countTags < MAX_TAGS_CUSTOM_NO_CARD) {
                badgesHTML += `<span class="tag ${classeVisualTag(tagLimpa)}">${escapeHTML(tagLimpa)}</span>`;
                countTags++;
            } else {
                tagsCustomRestantes++;
            }
        });
        if (tagsCustomRestantes > 0) {
            badgesHTML += `<span class="tag tag-overflow" title="Mais ${tagsCustomRestantes} tag(s)">+${tagsCustomRestantes}</span>`;
        }

        const identificador = lead.pessoaIdentificador;
        const tagsAttr = escapeHTML(tagsArray.map(t => t.trim()).filter(Boolean).join('|'));
        const textoBuscaAttr = escapeHTML(
            `${lead.pessoaNome || ''} ${lead.pessoaTelefoneDDD || ''} ${lead.pessoaTelefoneNumero || ''} ${lead.pessoaEmail || ''}`.toLowerCase()
        );
        const temTelefone = lead.pessoaTelefoneNumero && String(lead.pessoaTelefoneNumero).trim() !== '';
        const temEmail = lead.pessoaEmail && String(lead.pessoaEmail).trim() !== '';
        // Lembrete de follow-up (soneca): vencido HOJE ou atrasado vira
        // prioridade máxima ("Ligar Hoje", sobe pro topo da coluna); no
        // FUTURO, o card fica em soneca (não aparece na coluna até o dia
        // marcado) — ver salvarLembreteLead().
        const hojeISO = new Date().toISOString().slice(0, 10);
        const lembreteVencido = lead.lembrete_em && String(lead.lembrete_em) <= hojeISO;
        const lembreteFuturo = lead.lembrete_em && String(lead.lembrete_em) > hojeISO;
        const lembreteIconHTML = lembreteVencido
            ? `<i class="fa-solid fa-bell lembrete-badge-icon" title="Lembrete (${escapeHTML(lead.lembrete_em)}): ${escapeHTML(lead.lembrete_nota || 'sem nota')}"></i>`
            : '';
        // Radar de Acompanhantes: sinaliza que esse lead tem gente vinculada
        // (cônjuge, amigo...) — sem contar quantas aqui (proxy, poderia
        // subestimar se os outros membros ainda não foram carregados), só
        // avisa que existe vínculo; detalhe fica na gaveta.
        const vinculoIconHTML = lead.grupo_familiar_id
            ? `<i class="fa-solid fa-link vinculo-badge-icon" title="Tem vínculo familiar — veja a ficha"></i>`
            : '';
        if (lembreteVencido) {
            badgesHTML += `<span class="tag tag-ligar-hoje"><i class="fa-solid fa-phone-volume"></i> Ligar Hoje</span>`;
        }
        if (lembreteFuturo && !colunasSonecaRevelada.has(colunaAlvo)) {
            sonecaPorColuna[colunaAlvo]++;
            return; // fica em soneca — não desenha o card nesta coluna por enquanto
        }
        // SLA visual: lead ainda na primeira coluna (frio, nunca abordado)
        // há mais de SLA_HORAS_COLUNA_FRIA horas ganha borda vermelha — o
        // tempo de resposta é o maior fator de conversão, então um lead
        // esfriando precisa ficar óbvio de bater o olho, sem precisar abrir
        // a ficha. Usa funil_agencia_atualizado_em (migracao_sla_funil.sql),
        // gravado por moverLeadsParaColuna() a cada troca de coluna — sem a
        // migração rodada (coluna null pra leads antigos), não marca nada.
        const slaVencido = colunaAlvo === primeiraColuna && lead.funil_agencia_atualizado_em &&
            (Date.now() - new Date(lead.funil_agencia_atualizado_em).getTime()) > SLA_HORAS_COLUNA_FRIA * 60 * 60 * 1000;
        const cardHTML = `
            <div class="lead-card ${slaVencido ? 'lead-card-sla-vencido' : ''}" draggable="true" id="card-${identificador}" data-tags="${tagsAttr}" data-search="${textoBuscaAttr}"
                 data-evento="${escapeHTML(String(lead.eventoNome || '').toLowerCase())}" data-eventodata="${escapeHTML(lead.eventoData || '')}"
                 data-tem-telefone="${temTelefone ? '1' : '0'}" data-tem-email="${temEmail ? '1' : '0'}"
                 ondragstart="arrastar(event, '${identificador}')"
                 ondragend="this.style.opacity='1'"
                 ${slaVencido ? `title="Sem contato há mais de ${SLA_HORAS_COLUNA_FRIA}h nesta coluna"` : ''}
                 onclick="abrirGaveta('${identificador}')">
                <label class="lead-select" onclick="event.stopPropagation()">
                    <input type="checkbox" ${cardsSelecionados.has(String(identificador)) ? 'checked' : ''} onchange="toggleSelecaoCard('${identificador}', this.checked)">
                </label>
                <div class="lead-name">${escapeHTML(lead.pessoaNome || 'Sem nome')}${lembreteIconHTML}${vinculoIconHTML}</div>
                <div class="lead-source">
                    <i class="fa-solid fa-phone"></i> ${escapeHTML(lead.pessoaTelefoneDDD || '')} ${escapeHTML(lead.pessoaTelefoneNumero || 'Sem Tlf')}
                </div>
                <div class="lead-tags">${badgesHTML}</div>
            </div>
        `;

        if (htmlPorColuna[colunaAlvo]) {
            (lembreteVencido ? htmlPorColuna[colunaAlvo].urgente : htmlPorColuna[colunaAlvo].normal).push(cardHTML);
        }
    });

    // Escreve o HTML de cada coluna de uma vez só (1 innerHTML por coluna)
    // — "Ligar Hoje" (urgente) sempre antes do resto (normal).
    validKeys.forEach(key => {
        const el = document.getElementById(`col-${key}`);
        if (el) el.innerHTML = htmlPorColuna[key].urgente.join('') + htmlPorColuna[key].normal.join('');
        atualizarChipSonecaColuna(key, sonecaPorColuna[key]);
    });

    // Popula o dropdown de filtros de cada coluna (tags)
    validKeys.forEach(key => {
        montarDropdownFiltroColuna(key, Array.from(tagsPorColuna[key]).sort());
    });

    montarGavetaColunas(contagemPorColuna);

    // 5. Botão "carregar mais" (na primeira coluna)
    if (podeCarregarMais && primeiraColuna) {
        const btnHTML = `
            <button id="btn-carregar-mais" onclick="carregarLeads('${filialAtual}', false)"
            style="width: 100%; padding: 12px; margin-top: 10px; background: #e2e8f0; border: 1px dashed #cbd5e1; border-radius: 8px; cursor: pointer; color: var(--text-dark); font-weight: 600; font-size: 12px; transition: 0.2s;">
                <i class="fa-solid fa-angles-down"></i> Carregar Mais 500 Leads
            </button>`;
        const alvo = document.getElementById(`col-${primeiraColuna}`);
        if (alvo) alvo.insertAdjacentHTML('beforeend', btnHTML);
    }

    atualizarContadores();
    atualizarStats(leadsBase.length, leadsAtuais.length);

    // 6. Reaplica busca de coluna (texto rápido) + filtro de tags por coluna
    validKeys.forEach(key => aplicarFiltroVisualColuna(key));

    // 7. Mantém a ABA ATUALMENTE VISÍVEL sincronizada com o estado dos leads.
    //    (Antes isso recalculava Dashboard + Relatórios + WhatsApp em toda
    //    interação, mesmo com as abas escondidas — trabalho desperdiçado que
    //    também pesava bastante em bases grandes. Cada aba já se atualiza
    //    sozinha quando você clica nela, via switchModule().)
    sincronizarAbaAtiva();

    if (typeof verificarNotificacoesLeadForte === 'function') verificarNotificacoesLeadForte();
}

function sincronizarAbaAtiva() {
    const abaAtiva = document.querySelector('.tab-pane.active');
    if (!abaAtiva) return;
    if (abaAtiva.id === 'tab-dashboard') atualizarDashboard();
    if (abaAtiva.id === 'tab-relatorios') atualizarRelatorios();
    // Sem fetch aqui — só re-renderiza com o que já está em eventosAtuais,
    // pra manter "Confirmados" em dia conforme leadsAtuais muda, sem bater
    // no banco a cada re-render (que acontece com muita frequência).
    if (abaAtiva.id === 'tab-agenda' && typeof renderizarListaEventos === 'function') renderizarListaEventos();
    if (abaAtiva.id === 'tab-whatsapp') {
        const wppSearchEl = document.getElementById('wppSearch');
        renderizarContatosWpp(wppSearchEl ? wppSearchEl.value : '');
    }
}

// ==========================================
// 4. FILTROS AVANÇADOS — POR COLUNA
// ==========================================
// Cada coluna tem seu próprio botão "Filtros" com um dropdown contendo
// tags (E — precisa ter todas as marcadas), status, telemarketing (OU
// dentro do próprio campo), evento, intervalo de data e telefone/e-mail.
// A casca estática do dropdown (inputs de texto/data, checkboxes, botões)
// é montada uma vez em renderizarColunas() — aqui só populamos/atualizamos
// os chips (tags/status/telemarketing), que mudam a cada renderizarCards().
let opcoesFiltroColuna = {}; // { chaveDaColuna: { tags: [], status: [], telemkt: [] } } — cache das opções disponíveis, usado ao reconstruir os chips sem esperar o próximo renderizarCards()

function toggleDropdownFiltroColuna(key) {
    const dropdown = document.getElementById(`filterDropdown-${key}`);
    if (!dropdown) return;
    const estavaAberto = dropdown.classList.contains('open');
    document.querySelectorAll('.col-filter-dropdown').forEach(d => d.classList.remove('open'));
    if (!estavaAberto) dropdown.classList.add('open');
}

// Fecha qualquer dropdown de filtro aberto ao clicar fora dele
document.addEventListener('click', (e) => {
    if (!e.target.closest('.col-tag-filter')) {
        document.querySelectorAll('.col-filter-dropdown').forEach(d => d.classList.remove('open'));
    }
});

function montarChips(containerId, valores, ativos, onClickHandlerName) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const assinatura = valores.join('|');
    if (container.dataset.assinatura === assinatura) {
        // O conjunto de valores não mudou desde a última vez — só atualiza
        // quais chips estão marcados como ativos, sem recriar o DOM inteiro.
        container.querySelectorAll('.chip').forEach(chip => {
            chip.classList.toggle('active', ativos.includes(chip.getAttribute('data-valor')));
        });
        return;
    }

    if (valores.length === 0) {
        container.innerHTML = '<span style="font-size:10px; color:var(--text-muted);">Nenhum valor disponível ainda.</span>';
        container.dataset.assinatura = assinatura;
        return;
    }
    container.innerHTML = valores.map(v => {
        const ativo = ativos.includes(v);
        return `<button type="button" class="chip ${ativo ? 'active' : ''}" data-valor="${escapeHTML(v)}">${escapeHTML(v)}</button>`;
    }).join('');

    container.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => onClickHandlerName(chip.getAttribute('data-valor')));
    });
    container.dataset.assinatura = assinatura;
}

// Mesma ideia de montarChips(), mas agrupando as tags por família
// (FAMILIAS_TAG) pra ficar mais fácil localizar no dropdown de filtro —
// "Sistema", "Nível", "Engajamento / SDR", "Objeções", "Interesses /
// Origem", "Outras". Reconstrói o grupo inteiro a cada chamada (sem o
// truque de assinatura de montarChips): a lista é pequena (algumas dezenas
// de tags), então o custo é desprezível.
function montarChipsTagsAgrupados(containerId, valores, ativos, onClickHandlerName) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (valores.length === 0) {
        container.innerHTML = '<span style="font-size:10px; color:var(--text-muted);">Nenhuma tag disponível ainda.</span>';
        return;
    }

    const grupos = new Map(); // label da família -> [tags]
    valores.forEach(v => {
        const label = identificarFamiliaTag(v).label;
        if (!grupos.has(label)) grupos.set(label, []);
        grupos.get(label).push(v);
    });

    const ordemLabels = FAMILIAS_TAG.map(f => f.label);
    const labelsOrdenados = Array.from(grupos.keys()).sort((a, b) => ordemLabels.indexOf(a) - ordemLabels.indexOf(b));

    container.innerHTML = labelsOrdenados.map(label => {
        const chipsHTML = grupos.get(label).sort().map(v => {
            const ativo = ativos.includes(v);
            return `<button type="button" class="chip ${ativo ? 'active' : ''}" data-valor="${escapeHTML(v)}">${escapeHTML(v)}</button>`;
        }).join('');
        return `
            <div class="tag-filter-grupo">
                <div class="tag-filter-grupo-titulo">${escapeHTML(label)}</div>
                <div class="col-filter-chip-list">${chipsHTML}</div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => onClickHandlerName(chip.getAttribute('data-valor')));
    });
}

// Popula os 3 grupos de chips do dropdown de uma coluna com as opções que
// realmente aparecem nela (chamado a cada renderizarCards()).
function montarDropdownFiltroColuna(key, tagsDisponiveis) {
    // Une as tags que já aparecem nesta coluna com o catálogo de tags
    // sugeridas (TAGS_SUGERIDAS) — assim o dropdown já vem "rico" com o
    // padrão de qualificação do SDR, mesmo antes de qualquer lead ter sido
    // marcado com elas.
    const tagsComSugeridas = Array.from(new Set([...tagsDisponiveis, ...TAGS_SUGERIDAS])).sort();

    opcoesFiltroColuna[key] = { tags: tagsComSugeridas };
    const filtro = getFiltroColuna(key);

    // Remove da seleção qualquer valor que não exista mais nesta coluna
    filtro.tags = filtro.tags.filter(t => tagsComSugeridas.includes(t));
    filtro.tagsExcluidas = filtro.tagsExcluidas.filter(t => tagsComSugeridas.includes(t));

    montarChipsTagsAgrupados(`tagsChips-${key}`, tagsComSugeridas, filtro.tags, (v) => toggleFiltroColunaChip(key, 'tags', v));
    // Lista de exclusão fica FLAT (sem agrupar por família) — geralmente é
    // só 1 ou 2 tags de "situação" indesejada (No-Show, Lista de Espera...),
    // não precisa da mesma organização da lista de inclusão.
    montarChips(`tagsExcluidasChips-${key}`, tagsComSugeridas, filtro.tagsExcluidas, (v) => toggleFiltroColunaChipExcluir(key, v));

    atualizarBadgeFiltroColuna(key);
}

function toggleFiltroColunaChip(key, campo, valor) {
    const filtro = getFiltroColuna(key);
    const lista = filtro[campo];
    const idx = lista.indexOf(valor);
    if (idx >= 0) {
        lista.splice(idx, 1);
    } else {
        lista.push(valor);
        registrarUsoFiltroTag(valor); // só conta ativação, não remoção (campo é sempre 'tags' agora)
    }

    const opcoes = opcoesFiltroColuna[key] || { tags: [] };
    montarChipsTagsAgrupados(`tagsChips-${key}`, opcoes.tags, filtro.tags, (v) => toggleFiltroColunaChip(key, 'tags', v));

    atualizarBadgeFiltroColuna(key);
    aplicarFiltroVisualColuna(key);
}

// "Filter out": mesma mecânica do toggle de inclusão, só que marca a tag
// pra EXCLUIR (esconder qualquer lead que tenha ela), independente do que
// estiver marcado na lista de inclusão acima.
function toggleFiltroColunaChipExcluir(key, valor) {
    const filtro = getFiltroColuna(key);
    const lista = filtro.tagsExcluidas;
    const idx = lista.indexOf(valor);
    if (idx >= 0) lista.splice(idx, 1);
    else lista.push(valor);

    const opcoes = opcoesFiltroColuna[key] || { tags: [] };
    montarChips(`tagsExcluidasChips-${key}`, opcoes.tags, filtro.tagsExcluidas, (v) => toggleFiltroColunaChipExcluir(key, v));

    atualizarBadgeFiltroColuna(key);
    aplicarFiltroVisualColuna(key);
}

// Lê os campos de texto/data/checkbox do dropdown (só aplicados ao clicar
// "Aplicar", diferente dos chips que já filtram na hora).
function aplicarFiltroColunaCampos(key) {
    const filtro = getFiltroColuna(key);
    filtro.evento = (document.getElementById(`filtroEvento-${key}`) || {}).value || '';
    filtro.dataDe = (document.getElementById(`filtroDataDe-${key}`) || {}).value || '';
    filtro.dataAte = (document.getElementById(`filtroDataAte-${key}`) || {}).value || '';
    filtro.temTelefone = (document.getElementById(`filtroTemTelefone-${key}`) || {}).checked || false;
    filtro.temEmail = (document.getElementById(`filtroTemEmail-${key}`) || {}).checked || false;
    aplicarFiltroVisualColuna(key);
    atualizarBadgeFiltroColuna(key);
}

function limparFiltroColuna(key) {
    filtrosColuna[key] = filtroColunaVazio();
    const ev = document.getElementById(`filtroEvento-${key}`); if (ev) ev.value = '';
    const dd = document.getElementById(`filtroDataDe-${key}`); if (dd) dd.value = '';
    const da = document.getElementById(`filtroDataAte-${key}`); if (da) da.value = '';
    const tt = document.getElementById(`filtroTemTelefone-${key}`); if (tt) tt.checked = false;
    const te = document.getElementById(`filtroTemEmail-${key}`); if (te) te.checked = false;

    const opcoes = opcoesFiltroColuna[key] || { tags: [] };
    montarChipsTagsAgrupados(`tagsChips-${key}`, opcoes.tags, [], (v) => toggleFiltroColunaChip(key, 'tags', v));
    montarChips(`tagsExcluidasChips-${key}`, opcoes.tags, [], (v) => toggleFiltroColunaChipExcluir(key, v));

    atualizarBadgeFiltroColuna(key);
    aplicarFiltroVisualColuna(key);
}

function atualizarBadgeFiltroColuna(key) {
    const badge = document.getElementById(`filterBadge-${key}`);
    if (!badge) return;
    const filtro = getFiltroColuna(key);
    let n = filtro.tags.length + filtro.tagsExcluidas.length;
    if (filtro.evento) n++;
    if (filtro.dataDe) n++;
    if (filtro.dataAte) n++;
    if (filtro.temTelefone) n++;
    if (filtro.temEmail) n++;

    if (n > 0) {
        badge.style.display = 'inline-flex';
        badge.innerText = n;
    } else {
        badge.style.display = 'none';
    }
}

// "Filtro Rápido: Ex-Alunos" — aplica a tag em TODAS as colunas de uma vez
function quickFilterTag(tag) {
    columnsConfig.forEach(col => {
        const filtro = getFiltroColuna(col.key);
        if (!filtro.tags.includes(tag)) filtro.tags.push(tag);
    });
    registrarUsoFiltroTag(tag);
    renderizarCards();
}

// ==========================================
// FILTRO RÁPIDO — tags mais usadas recentemente
// ==========================================
// Toda vez que uma tag é ATIVADA num filtro (por qualquer caminho —
// dropdown de coluna ou o próprio botão de filtro rápido), soma 1 pra ela
// aqui. Os botões de filtro rápido mostram sempre as mais usadas,
// persistido por navegador (não é um dado do time todo, só deste usuário).
const CHAVE_STORAGE_USO_FILTROS = 'crm_na_uso_filtros_tags';
const MAX_FILTROS_RAPIDOS = 5;
let usoFiltrosTags = carregarUsoFiltrosLocal();

function carregarUsoFiltrosLocal() {
    try {
        const salvo = localStorage.getItem(CHAVE_STORAGE_USO_FILTROS);
        if (salvo) return JSON.parse(salvo);
    } catch (e) { /* ignora e cai no padrão */ }
    return {};
}
function salvarUsoFiltrosLocal() {
    localStorage.setItem(CHAVE_STORAGE_USO_FILTROS, JSON.stringify(usoFiltrosTags));
}

function registrarUsoFiltroTag(tag) {
    usoFiltrosTags[tag] = (usoFiltrosTags[tag] || 0) + 1;
    salvarUsoFiltrosLocal();
    renderizarFiltrosRapidos();
}

// Enquanto o uso real ainda não preenche as 5 vagas, completa com esse
// ponto de partida — assim que o time realmente usar 5 tags diferentes em
// filtros, essas sugestões somem sozinhas, substituídas pelo uso de verdade.
const FILTROS_RAPIDOS_PADRAO = ['Lead Forte 1', 'Jornada: Engajado', 'Ativo', 'Inativo', 'Indicação de Aluno'];

function renderizarFiltrosRapidos() {
    const container = document.getElementById('filtrosRapidosContainer');
    if (!container) return;

    const usados = Object.entries(usoFiltrosTags)
        .sort((a, b) => b[1] - a[1])
        .map(([tag]) => tag);

    const lista = [...usados];
    FILTROS_RAPIDOS_PADRAO.forEach(tag => {
        if (lista.length < MAX_FILTROS_RAPIDOS && !lista.includes(tag)) lista.push(tag);
    });
    const topTags = lista.slice(0, MAX_FILTROS_RAPIDOS);

    if (topTags.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = topTags.map(tag => {
        const usos = usoFiltrosTags[tag];
        const titulo = usos ? `Usado ${usos}x` : 'Sugestão padrão';
        // Mesma cor do badge da tag (classeVisualTag) em vez de um chip
        // genérico — reconhece pela cor, sem precisar ler o texto toda vez.
        return `<button type="button" class="tag filtro-rapido-btn ${classeVisualTag(tag)}" data-valor="${escapeHTML(tag)}" title="${escapeHTML(titulo)}">${escapeHTML(tag)}</button>`;
    }).join('');
    container.querySelectorAll('.filtro-rapido-btn').forEach(btn => {
        btn.addEventListener('click', () => quickFilterTag(btn.getAttribute('data-valor')));
    });
}

// "Limpar Tudo" — zera o filtro de TODAS as colunas + as buscas de texto
function limparFiltros() {
    filtrosColuna = {};
    document.querySelectorAll('.column-search').forEach(input => { input.value = ''; });
    columnsConfig.forEach(col => {
        const ev = document.getElementById(`filtroEvento-${col.key}`); if (ev) ev.value = '';
        const dd = document.getElementById(`filtroDataDe-${col.key}`); if (dd) dd.value = '';
        const da = document.getElementById(`filtroDataAte-${col.key}`); if (da) da.value = '';
        const tt = document.getElementById(`filtroTemTelefone-${col.key}`); if (tt) tt.checked = false;
        const te = document.getElementById(`filtroTemEmail-${col.key}`); if (te) te.checked = false;
    });
    renderizarCards();
}

function parseDataBR(str) {
    if (!str) return null;
    const partes = str.trim().split(' ');
    const dataPartes = (partes[0] || '').split('/');
    if (dataPartes.length !== 3) return null;
    const [d, m, y] = dataPartes.map(Number);
    if (!d || !m || !y) return null;
    return new Date(y, m - 1, d);
}

// Recebe o eventoData cru (string "dd/mm/aaaa | dd/mm/aaaa | ...", vindo do
// atributo data-eventodata do card) em vez do lead inteiro — assim serve
// tanto pro filtro por coluna (que só tem acesso ao DOM) quanto a qualquer
// outro lugar que precise checar datas de evento.
function datasNoIntervalo(eventoDataStr, de, ate) {
    if (!de && !ate) return true;
    const datas = String(eventoDataStr || '').split('|').map(s => parseDataBR(s)).filter(Boolean);
    if (datas.length === 0) return false;
    const deD = de ? new Date(de + 'T00:00:00') : null;
    const ateD = ate ? new Date(ate + 'T23:59:59') : null;
    return datas.some(dt => (!deD || dt >= deD) && (!ateD || dt <= ateD));
}

// ==========================================
// 5. PESQUISA POR COLUNA (rápida, local + banco)
// ==========================================
// Espera a pessoa parar de digitar por um instante antes de buscar —
// sem isso, cada tecla digitada disparava uma varredura completa, o
// que também pesava bastante em colunas com muitos leads.
let timersFiltroColuna = {};
function filtroColunaComDebounce(key) {
    clearTimeout(timersFiltroColuna[key]);
    timersFiltroColuna[key] = setTimeout(() => processarBuscaColuna(key), 220);
}

const LIMITE_BUSCA_BANCO = 300;

// Busca no BANCO INTEIRO (não só nos leads já carregados no navegador).
// Isso é essencial em colunas com muitos milhares de leads (ex: "Frios"),
// onde só uma fração pequena costuma estar carregada localmente a
// qualquer momento.
async function processarBuscaColuna(key) {
    const inputTexto = document.querySelector(`.column-search[data-col="col-${key}"]`);
    const termo = inputTexto ? inputTexto.value.trim() : '';

    // Feedback instantâneo com o que já está carregado, enquanto a busca no banco roda
    aplicarFiltroVisualColuna(key);

    if (termo.length < 2) return; // não vale a pena consultar o banco com 1 caractere só

    const spinner = document.getElementById(`buscaBancoIndicador-${key}`);
    const iconeFiltro = document.getElementById(`buscaBancoIcone-${key}`);
    if (spinner) spinner.style.display = 'inline-flex';
    if (iconeFiltro) iconeFiltro.style.display = 'none';

    // Escapa vírgulas (separador do .or() do PostgREST) pra não quebrar a query
    const termoSeguro = termo.replace(/,/g, ' ');

    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('*')
        .eq('filial', filialAtual)
        .eq('funil_agencia', key)
        .or(`pessoaNome.ilike.%${termoSeguro}%,pessoaTelefoneNumero.ilike.%${termoSeguro}%,pessoaEmail.ilike.%${termoSeguro}%`)
        .limit(LIMITE_BUSCA_BANCO);

    if (spinner) spinner.style.display = 'none';
    if (iconeFiltro) iconeFiltro.style.display = 'inline';

    if (error) {
        console.error('Erro na busca no banco:', error);
        return;
    }

    // Se o termo já mudou enquanto a busca rodava, descarta (evita corrida entre buscas)
    const termoAtual = inputTexto ? inputTexto.value.trim() : '';
    if (termoAtual !== termo) return;

    // Mescla os resultados encontrados no banco com o que já está carregado localmente
    const idsExistentes = new Set(leadsAtuais.map(l => String(l.pessoaIdentificador)));
    const novos = data.filter(l => !idsExistentes.has(String(l.pessoaIdentificador)));
    if (novos.length > 0) {
        leadsAtuais = [...leadsAtuais, ...novos];
        renderizarCards(); // redesenha tudo, já incluindo os leads encontrados no banco
    }

    aplicarFiltroVisualColuna(key);
}

// Aplica, na coluna indicada, a busca de texto rápida E o filtro avançado
// completo (tags em E, status, telemarketing, evento, data, telefone/e-mail)
// ao mesmo tempo — tudo via show/hide no DOM, sem precisar re-renderizar
// os cards.
function aplicarFiltroVisualColuna(key) {
    const inputTexto = document.querySelector(`.column-search[data-col="col-${key}"]`);
    const termo = inputTexto ? inputTexto.value.toLowerCase() : '';
    const filtro = getFiltroColuna(key);

    const cards = document.querySelectorAll(`#${CSS.escape('col-' + key)} .lead-card`);
    cards.forEach(card => {
        // Usa o atributo data-search (montado uma vez, quando o card é criado)
        // em vez de card.innerText — .innerText obriga o navegador a recalcular
        // layout (reflow) pra cada card, a cada tecla digitada, o que travava
        // a busca em colunas com muitos milhares de leads.
        const textoBusca = card.getAttribute('data-search') || '';
        const textoOk = !termo || textoBusca.includes(termo);

        const tagsCard = (card.getAttribute('data-tags') || '').split('|').filter(Boolean);
        const tagsOk = filtro.tags.length === 0 || filtro.tags.every(t => tagsCard.includes(t));
        // "Filter out": esconde o card se ele tiver QUALQUER uma das tags
        // marcadas pra excluir, independente do que passou no filtro acima.
        const tagsExcluidasOk = filtro.tagsExcluidas.length === 0 || !filtro.tagsExcluidas.some(t => tagsCard.includes(t));

        const eventoOk = !filtro.evento || (card.getAttribute('data-evento') || '').includes(filtro.evento.toLowerCase());
        const dataOk = datasNoIntervalo(card.getAttribute('data-eventodata') || '', filtro.dataDe, filtro.dataAte);
        const telefoneOk = !filtro.temTelefone || card.getAttribute('data-tem-telefone') === '1';
        const emailOk = !filtro.temEmail || card.getAttribute('data-tem-email') === '1';

        card.style.display = (textoOk && tagsOk && tagsExcluidasOk && eventoOk && dataOk && telefoneOk && emailOk) ? 'block' : 'none';
    });
}

// ==========================================
// BUSCA GLOBAL (todas as colunas de uma vez, banco inteiro da filial atual)
// ==========================================
// Diferente de processarBuscaColuna() (por coluna), esta busca não fica
// presa a nenhuma coluna — mostra um dropdown de resultados soltos, com a
// coluna de cada um, e clicar abre a gaveta direto (carregando o lead do
// banco primeiro, se ele ainda não tiver sido paginado pro navegador).
let timerBuscaGlobal = null;
function buscaGlobalComDebounce() {
    clearTimeout(timerBuscaGlobal);
    const input = document.getElementById('globalSearchInput');
    const termo = input ? input.value.trim() : '';
    if (termo.length < 2) { fecharResultadosBuscaGlobal(); return; }
    timerBuscaGlobal = setTimeout(processarBuscaGlobal, 250);
}

async function processarBuscaGlobal() {
    const input = document.getElementById('globalSearchInput');
    const resultsEl = document.getElementById('globalSearchResults');
    if (!input || !resultsEl) return;
    const termo = input.value.trim();
    if (termo.length < 2) { fecharResultadosBuscaGlobal(); return; }

    resultsEl.innerHTML = '<div class="global-search-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Buscando...</div>';
    resultsEl.classList.add('open');

    const termoSeguro = termo.replace(/,/g, ' '); // escapa vírgula (separador do .or() do PostgREST)
    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero, pessoaEmail, funil_agencia')
        .eq('filial', filialAtual)
        .or(`pessoaNome.ilike.%${termoSeguro}%,pessoaTelefoneNumero.ilike.%${termoSeguro}%,pessoaEmail.ilike.%${termoSeguro}%`)
        .limit(30);

    if (input.value.trim() !== termo) return; // termo já mudou enquanto a busca rodava — descarta

    if (error) {
        resultsEl.innerHTML = '<div class="global-search-empty">Erro na busca — veja o console (F12).</div>';
        console.error('Erro na busca global:', error);
        return;
    }

    if (!data || data.length === 0) {
        resultsEl.innerHTML = '<div class="global-search-empty">Nenhum lead encontrado.</div>';
        return;
    }

    resultsEl.innerHTML = data.map(l => {
        const coluna = columnsConfig.find(c => c.key === l.funil_agencia);
        const nomeColuna = coluna ? coluna.label : (l.funil_agencia || '—');
        const tel = [l.pessoaTelefoneDDD, l.pessoaTelefoneNumero].filter(Boolean).join(' ') || 'Sem telefone';
        return `
            <div class="global-search-result-item" onclick="abrirResultadoBuscaGlobal('${l.pessoaIdentificador}')">
                <div class="global-search-result-name">${escapeHTML(l.pessoaNome || 'Sem nome')}</div>
                <div class="global-search-result-meta">
                    <span class="global-search-result-coluna">${escapeHTML(nomeColuna)}</span>
                    <span><i class="fa-solid fa-phone"></i> ${escapeHTML(tel)}</span>
                </div>
            </div>
        `;
    }).join('');
}

async function abrirResultadoBuscaGlobal(id) {
    fecharResultadosBuscaGlobal();
    const jaCarregado = leadsAtuais.some(l => String(l.pessoaIdentificador) === String(id));
    if (!jaCarregado) {
        const { data, error } = await window.supabaseClient
            .from(NOME_TABELA)
            .select('*')
            .eq('pessoaIdentificador', id)
            .single();
        if (error || !data) { alert('Não foi possível abrir esse lead — veja o console (F12).'); console.error(error); return; }
        leadsAtuais = [...leadsAtuais, data];
        renderizarCards();
    }
    // Garante que a aba CRM (onde o quadro vive) esteja visível antes de
    // rolar até o card — a busca pode ter vindo de outra aba (Leads a
    // Tratar, Lembretes do Dashboard).
    const abaCrm = document.getElementById('tab-crm');
    if (abaCrm && !abaCrm.classList.contains('active')) {
        switchModule('tab-crm', 'Prospecção Ativa', 'CRM Modularizado VS Code');
    }
    abrirGaveta(id);
    destacarCardNoQuadro(id);
}

// Rola o quadro até o card do lead e deixa uma borda piscando nele —
// assim, ao fechar a gaveta (ou já ali atrás, com a gaveta aberta), o
// card já está localizado e pronto pra arrastar, sem precisar catar
// visualmente em qual coluna/posição ele está.
let cardDestacadoAtual = null;
function destacarCardNoQuadro(id) {
    limparDestaqueCard();
    const card = document.getElementById(`card-${id}`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    card.classList.add('lead-card-destacado');
    cardDestacadoAtual = String(id);
}
function limparDestaqueCard() {
    if (cardDestacadoAtual == null) return;
    const card = document.getElementById(`card-${cardDestacadoAtual}`);
    if (card) card.classList.remove('lead-card-destacado');
    cardDestacadoAtual = null;
}

function fecharResultadosBuscaGlobal() {
    const resultsEl = document.getElementById('globalSearchResults');
    if (resultsEl) { resultsEl.classList.remove('open'); resultsEl.innerHTML = ''; }
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.global-search-wrapper')) fecharResultadosBuscaGlobal();
});

// ==========================================
// EXPORTAR LEADS PARA CSV
// ==========================================
// Exporta os leads já carregados no navegador (leadsAtuais) — respeita a
// mesma limitação documentada nos KPIs do Dashboard: não é uma extração
// exata do banco inteiro se ainda houver mais páginas por carregar
// ("Carregar Mais" visível na aba CRM).
function csvEscapeCampo(valor) {
    const str = String(valor ?? '');
    if (/[",\n;]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
}

function exportarLeadsCSV() {
    if (leadsAtuais.length === 0) {
        alert('Nenhum lead carregado para exportar. Abra a aba CRM e deixe os leads carregarem primeiro.');
        return;
    }

    const validKeys = getColumnKeys();
    const primeiraColuna = validKeys[0];
    const colunaDoLead = (lead) => {
        const chave = validKeys.includes(lead.funil_agencia) ? lead.funil_agencia : primeiraColuna;
        const col = columnsConfig.find(c => c.key === chave);
        return col ? col.label : chave;
    };

    const cabecalho = ['Nome', 'DDD', 'Telefone', 'E-mail', 'Coluna do Funil', 'Tags', 'Status', 'Filial'];
    const linhas = leadsAtuais.map(lead => [
        lead.pessoaNome || '',
        lead.pessoaTelefoneDDD || '',
        lead.pessoaTelefoneNumero || '',
        lead.pessoaEmail || '',
        colunaDoLead(lead),
        parseTags(lead.tags).map(t => t.trim()).filter(Boolean).join('; '),
        lead.pessoaStatus || '',
        lead.filial || ''
    ]);

    const csv = [cabecalho, ...linhas].map(linha => linha.map(csvEscapeCampo).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM pro Excel abrir acentuação certa
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads_${(filialAtual || 'filial').replace(/[^a-zA-Z0-9]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==========================================
// 6. ESTATÍSTICAS
// ==========================================
function atualizarStatsCarregando() {
    const el = document.getElementById('statsBar');
    if (el) el.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Carregando leads do Supabase...';
}

function atualizarStats(exibidos, totalCarregado) {
    const el = document.getElementById('statsBar');
    if (!el) return;
    const sufixoPaginacao = podeCarregarMais ? ' (ainda há mais no banco — use "Carregar Mais")' : '';
    el.innerHTML = `Exibindo <strong>${exibidos}</strong> de <strong>${totalCarregado}</strong> leads carregados${sufixoPaginacao}`;
}

function atualizarContadores() {
    columnsConfig.forEach(col => {
        const el = document.getElementById(`count-${col.key}`);
        if (el) el.innerText = document.querySelectorAll(`#${CSS.escape('col-' + col.key)} .lead-card`).length;
    });
}

// ==========================================
// DRAG AND DROP (ARRASTAR E SOLTAR)
// ==========================================
function arrastar(event, leadId) {
    event.dataTransfer.setData("leadId", leadId);
    event.dataTransfer.setData("cardElementId", event.target.id);
    event.target.style.opacity = "0.5";
}
function permitirDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.add('drag-over');
}

async function soltar(event, novaColuna) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');

    const leadId = event.dataTransfer.getData("leadId");
    const card = document.getElementById(event.dataTransfer.getData("cardElementId"));
    if (card) card.style.opacity = "1";
    if (!leadId) return;

    // Se o card arrastado faz parte de uma seleção com mais de 1 lead, a
    // seleção inteira vai junto — arrastar 1 card já move todos, sem
    // precisar clicar em nada. Arrastar um card que NÃO está selecionado
    // move só ele, mesmo com outros selecionados (não mexe na seleção).
    const idsParaMover = (cardsSelecionados.has(String(leadId)) && cardsSelecionados.size > 1)
        ? Array.from(cardsSelecionados)
        : [String(leadId)];

    if (idsParaMover.length > 1) limparSelecao();
    await moverLeadsParaColuna(idsParaMover, novaColuna);
}

// ==========================================
// SELEÇÃO EM MASSA E MOVIMENTAÇÃO ENTRE COLUNAS
// ==========================================
// Duas ações separadas, como pedido: primeiro seleciona os cards (um a um
// ou "Selecionar visíveis" numa coluna já filtrada — ex: filtrar por
// "WhatsApp Inválido" e selecionar todos), depois escolhe a coluna de
// destino e confirma o movimento numa barra separada. A seleção pode
// juntar cards de colunas diferentes antes de mover.
let cardsSelecionados = new Set();

function toggleSelecaoCard(id, marcado) {
    if (marcado) cardsSelecionados.add(String(id));
    else cardsSelecionados.delete(String(id));
    atualizarBarraSelecao();
}

// Alterna: se nem todos os cards VISÍVEIS da coluna (respeitando o filtro
// atual) estão selecionados, seleciona todos; se já estão todos, desmarca.
function toggleSelecionarTodosColuna(key) {
    const cards = [...document.querySelectorAll(`#${CSS.escape('col-' + key)} .lead-card`)].filter(c => c.style.display !== 'none');
    if (cards.length === 0) return;

    const idsVisiveis = cards.map(c => c.id.replace('card-', ''));
    const todosJaSelecionados = idsVisiveis.every(id => cardsSelecionados.has(id));

    idsVisiveis.forEach(id => {
        if (todosJaSelecionados) cardsSelecionados.delete(id);
        else cardsSelecionados.add(id);
    });

    cards.forEach(card => {
        const cb = card.querySelector('.lead-select input[type="checkbox"]');
        if (cb) cb.checked = !todosJaSelecionados;
    });

    atualizarBarraSelecao();
}

function limparSelecao() {
    cardsSelecionados.clear();
    document.querySelectorAll('.lead-select input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    atualizarBarraSelecao();
}

function atualizarBarraSelecao() {
    const bar = document.getElementById('bulkActionBar');
    const contador = document.getElementById('bulkActionCount');
    if (!bar || !contador) return;
    const n = cardsSelecionados.size;
    if (n === 0) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = 'flex';
    contador.innerText = `${n} lead${n > 1 ? 's' : ''} selecionado${n > 1 ? 's' : ''}`;
}

// Repopula o <select> "mover para..." com as colunas atuais — chamado por
// renderizarColunas() sempre que o Kanban é (re)montado.
function montarSelectBulkAction() {
    const select = document.getElementById('bulkActionColuna');
    if (!select) return;
    select.innerHTML = columnsConfig.map(c => `<option value="${escapeHTML(c.key)}">${escapeHTML(c.label)}</option>`).join('');
}

function moverSelecionadosParaColuna() {
    const select = document.getElementById('bulkActionColuna');
    if (!select || cardsSelecionados.size === 0) return;
    const novaColuna = select.value;
    if (!novaColuna) return;

    const ids = Array.from(cardsSelecionados);
    limparSelecao();
    moverLeadsParaColuna(ids, novaColuna);
}

// ==========================================
// EDIÇÃO DE TAGS EM MASSA
// ==========================================
// Reaproveita a mesma seleção da barra de ação em massa. Diferente de
// moverLeadsParaColuna() (mesmo payload pra todo mundo), cada lead pode já
// ter um conjunto de tags diferente — precisa calcular o array de cada um
// individualmente e mandar um update por lead (em paralelo).
async function aplicarTagEmMassa(modo) {
    const input = document.getElementById('bulkActionTagInput');
    if (!input || cardsSelecionados.size === 0) return;
    const tag = input.value.trim();
    if (!tag) { alert('Digite o nome da tag antes de aplicar.'); return; }

    const ids = Array.from(cardsSelecionados);
    const atualizacoes = [];

    ids.forEach(id => {
        const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(id));
        if (!lead) return;
        let tagsArray = parseTags(lead.tags).map(t => t.trim()).filter(Boolean);
        const jaTem = tagsArray.includes(tag);
        if (modo === 'add' && !jaTem) tagsArray = [...tagsArray, tag];
        else if (modo === 'remove' && jaTem) tagsArray = tagsArray.filter(t => t !== tag);
        else return; // nada a fazer nesse lead (add já tinha / remove não tinha)

        lead.tags = JSON.stringify(tagsArray);
        atualizacoes.push({ pessoaIdentificador: String(id), tags: lead.tags });
    });

    if (atualizacoes.length === 0) {
        alert(modo === 'add' ? 'Todos os selecionados já tinham essa tag.' : 'Nenhum dos selecionados tinha essa tag.');
        return;
    }

    input.value = '';
    renderizarCards(); // atualização otimista, igual moverLeadsParaColuna()

    const resultados = await Promise.all(atualizacoes.map(({ pessoaIdentificador, tags }) =>
        window.supabaseClient.from(NOME_TABELA).update({ tags }).eq('pessoaIdentificador', pessoaIdentificador)
    ));
    const comErro = resultados.filter(r => r.error);
    if (comErro.length > 0) {
        console.error('Erros ao aplicar tag em massa:', comErro.map(r => r.error));
        alert(`Erro ao salvar a tag em ${comErro.length} lead(s) — recarregue a página e confira. Veja o console (F12) para detalhes.`);
    } else {
        limparSelecao();
    }
}

// Função única de movimentação, usada tanto pelo botão "Mover" (seleção em
// massa) quanto pelo soltar() do arrastar-e-soltar. Atualização OTIMISTA:
// já reflete em leadsAtuais + re-renderiza antes de esperar o Supabase
// confirmar (senão o arrastar de vários cards ficaria com uma pausa
// perceptível); se o servidor falhar, reverte local e avisa. Sempre mostra
// a barra de desfazer por 5s, com o estado anterior de cada lead.
//
// Portão de "Motivos de Perda": se o destino for uma coluna "Perdido"/
// "Lixeira" (ehColunaPerdido()), a movimentação de verdade só acontece
// depois que o modal de motivo for confirmado (confirmarMotivoPerda()) —
// sem isso, "por que perdemos matrículas" ficaria impossível de responder
// depois. O card simplesmente não se move enquanto o modal não é
// respondido (sem atualização otimista até esse ponto).
async function moverLeadsParaColuna(ids, novaColuna) {
    if (!ids || ids.length === 0) return;
    if (ehColunaPerdido(novaColuna)) { abrirModalMotivoPerda(ids, novaColuna); return; }
    await executarMovimentoParaColuna(ids, novaColuna);
}

async function executarMovimentoParaColuna(ids, novaColuna) {
    const agora = new Date().toISOString();
    const anteriores = ids.map(id => {
        const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(id));
        return { id: String(id), funilAnterior: lead ? lead.funil_agencia : null, atualizadoAnterior: lead ? lead.funil_agencia_atualizado_em : null };
    });

    ids.forEach(id => {
        const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(id));
        if (lead) { lead.funil_agencia = novaColuna; lead.funil_agencia_atualizado_em = agora; }
    });
    renderizarCards();
    mostrarUndoMovimento(anteriores, novaColuna);

    // funil_agencia_atualizado_em alimenta o SLA visual (renderizarCards())
    // — marca "desde quando" o lead está nesta coluna, pra saber se esfriou.
    const { error } = await window.supabaseClient
        .from(NOME_TABELA)
        .update({ funil_agencia: novaColuna, funil_agencia_atualizado_em: agora })
        .in('pessoaIdentificador', ids);

    if (error) {
        console.error('Erro ao mover leads:', error);
        alert('Erro ao salvar no servidor — desfazendo a movimentação local.');
        anteriores.forEach(({ id, funilAnterior, atualizadoAnterior }) => {
            const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(id));
            if (lead) { lead.funil_agencia = funilAnterior; lead.funil_agencia_atualizado_em = atualizadoAnterior; }
        });
        esconderUndoMovimento();
        renderizarCards();
    }
}

// ==========================================
// MOTIVOS DE PERDA (Loss Reasons)
// ==========================================
// Qualquer coluna com "perdid" ou "lixeira" no nome/chave — mesma
// heurística por substring já usada pra achar Matriculados/Ativos/
// Recontato (js/eventos.js, js/matricula-importar.js), nunca cria a
// coluna sozinho. Mover um lead pra lá SEMPRE passa pelo modal de motivo
// primeiro (ver moverLeadsParaColuna() acima) — sem isso, o relatório de
// "por que perdemos matrículas" (aba Relatórios) ficaria impossível de
// montar depois.
const MOTIVOS_PERDA = ['Preço', 'Horário', 'Distância', 'Sem Retorno', 'Não se Interessou Mais', 'Já Matriculado em Outro Lugar', 'Outro'];
let idsPendentesPerda = [];
let colunaPendentePerda = null;

function ehColunaPerdido(chaveColuna) {
    const col = columnsConfig.find(c => c.key === chaveColuna);
    const texto = `${col ? col.label : ''} ${chaveColuna}`.toLowerCase();
    return /perdid|lixeira/.test(texto);
}

function abrirModalMotivoPerda(ids, novaColuna) {
    idsPendentesPerda = ids;
    colunaPendentePerda = novaColuna;
    const select = document.getElementById('motivoPerdaSelect');
    if (select) select.innerHTML = MOTIVOS_PERDA.map(m => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`).join('');
    const nota = document.getElementById('motivoPerdaNota');
    if (nota) nota.value = '';
    document.getElementById('modalMotivoPerda').classList.add('open');
    document.getElementById('overlayModalMotivoPerda').classList.add('active');
}
function fecharModalMotivoPerda() {
    document.getElementById('modalMotivoPerda').classList.remove('open');
    document.getElementById('overlayModalMotivoPerda').classList.remove('active');
    // Nada foi movido — o card simplesmente fica onde já estava.
    idsPendentesPerda = [];
    colunaPendentePerda = null;
}
async function confirmarMotivoPerda() {
    const select = document.getElementById('motivoPerdaSelect');
    const nota = document.getElementById('motivoPerdaNota');
    const motivo = select ? select.value : 'Outro';
    const notaTexto = nota ? nota.value.trim() : '';
    const motivoFinal = notaTexto ? `${motivo} — ${notaTexto}` : motivo;

    const ids = idsPendentesPerda;
    const novaColuna = colunaPendentePerda;
    fecharModalMotivoPerda();

    await executarMovimentoParaColuna(ids, novaColuna);
    await registrarMotivoPerda(ids, motivoFinal);
}

// Grava motivo_perda/data_perda + tag "Perdido" em cada lead — 1 update
// por lead (Promise.all), já que `tags` difere de lead pra lead (mesmo
// padrão de aplicarTagEmMassa() acima).
async function registrarMotivoPerda(ids, motivo) {
    const hojeISO = new Date().toISOString().slice(0, 10);
    const atualizacoes = ids.map(id => {
        const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(id));
        if (!lead) return null;
        let tagsArray = parseTags(lead.tags).map(t => t.trim()).filter(Boolean);
        if (!tagsArray.includes('Perdido')) tagsArray = [...tagsArray, 'Perdido'];
        lead.tags = JSON.stringify(tagsArray);
        lead.motivo_perda = motivo;
        lead.data_perda = hojeISO;
        return { pessoaIdentificador: String(id), tags: lead.tags };
    }).filter(Boolean);

    renderizarCards();

    const resultados = await Promise.all(atualizacoes.map(a =>
        window.supabaseClient.from(NOME_TABELA)
            .update({ tags: a.tags, motivo_perda: motivo, data_perda: hojeISO })
            .eq('pessoaIdentificador', a.pessoaIdentificador)
    ));
    const erro = resultados.find(r => r.error);
    if (erro) {
        console.error('Erro ao salvar motivo de perda:', erro.error);
        alert('O lead foi movido, mas houve um erro ao salvar o motivo — confira manualmente na ficha. Veja o console (F12) para detalhes.');
    }
}

// ==========================================
// DESFAZER MOVIMENTAÇÃO (barra por 5s)
// ==========================================
let ultimoMovimento = null; // { anteriores: [{id, funilAnterior}], timeoutId }

function nomeColunaPorChave(key) {
    const col = columnsConfig.find(c => c.key === key);
    return col ? col.label : key;
}

function mostrarUndoMovimento(anteriores, novaColuna) {
    if (ultimoMovimento && ultimoMovimento.timeoutId) clearTimeout(ultimoMovimento.timeoutId);
    ultimoMovimento = { anteriores };

    const bar = document.getElementById('undoBar');
    const texto = document.getElementById('undoTexto');
    if (!bar || !texto) return;

    const n = anteriores.length;
    texto.innerText = `${n} lead${n > 1 ? 's' : ''} movido${n > 1 ? 's' : ''} para "${nomeColunaPorChave(novaColuna)}".`;
    bar.style.display = 'flex';
    ultimoMovimento.timeoutId = setTimeout(esconderUndoMovimento, 5000);
}

function esconderUndoMovimento() {
    const bar = document.getElementById('undoBar');
    if (bar) bar.style.display = 'none';
    ultimoMovimento = null;
}

async function desfazerUltimoMovimento() {
    if (!ultimoMovimento) return;
    const { anteriores } = ultimoMovimento;
    if (ultimoMovimento.timeoutId) clearTimeout(ultimoMovimento.timeoutId);
    esconderUndoMovimento();

    // Agrupa por coluna de origem (cada lead pode ter vindo de uma coluna
    // diferente) pra fazer poucos updates em vez de 1 por lead. Não
    // restaura o funil_agencia_atualizado_em exato de antes do movimento
    // (não vale a complexidade pra uma janela de desfazer de 5s) — grava
    // "agora" de novo, mesmo espírito de "acabou de entrar" na coluna.
    const agora = new Date().toISOString();
    const porColunaOrigem = new Map();
    anteriores.forEach(({ id, funilAnterior }) => {
        if (!porColunaOrigem.has(funilAnterior)) porColunaOrigem.set(funilAnterior, []);
        porColunaOrigem.get(funilAnterior).push(id);
    });

    for (const [coluna, ids] of porColunaOrigem) {
        ids.forEach(id => {
            const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(id));
            if (lead) { lead.funil_agencia = coluna; lead.funil_agencia_atualizado_em = agora; }
        });
        await window.supabaseClient.from(NOME_TABELA).update({ funil_agencia: coluna, funil_agencia_atualizado_em: agora }).in('pessoaIdentificador', ids);
    }

    renderizarCards();
}

// ==========================================
// DRAG-AND-DROP GENÉRICO PRA LISTAS REORDENÁVEIS
// ==========================================
// Reordenar QUALQUER lista de "Gerenciar X" (Colunas, Filiais, Tipos de
// Evento, Tags) arrastando a linha inteira — pedido do usuário: toda
// movimentação de item no CRM deve ser por arrastar-e-soltar, mesmo padrão
// já usado nos cards do Kanban acima (dataTransfer, sem addEventListener).
// Cada tela registra sua própria função de persistência/render em
// REORDENADORES_LISTA[contexto] — quem chama soltarNaLista() não sabe (nem
// precisa saber) se aquela lista é localStorage (colunas) ou uma tabela no
// Supabase (filiais/tipos_evento/tags_sugeridas).
const REORDENADORES_LISTA = {};
function iniciarArrastoLista(event, id) {
    event.dataTransfer.setData('itemListaId', String(id));
    event.target.style.opacity = '0.5';
}
function soltarNaLista(event, contexto, idDestino) {
    event.preventDefault();
    const idOrigem = event.dataTransfer.getData('itemListaId');
    if (!idOrigem || String(idOrigem) === String(idDestino)) return;
    const fn = REORDENADORES_LISTA[contexto];
    if (fn) fn(idOrigem, idDestino);
}

// Reordena um array de itens de uma tabela do Supabase (cada um com
// {id, ordem}) depois de um drag-and-drop: tira o item de origem, insere
// na posição do destino, e regrava `ordem` sequencial (0..N) pra TODOS os
// itens de uma vez (1 update por item, em paralelo) — mais robusto que só
// trocar 2 valores adjacentes (jeito antigo dos botões de mover), já que
// arrastar pode soltar bem longe da posição original. Usado por Filiais,
// Tipos de Evento (js/eventos.js) e Tags.
async function reordenarESalvarOrdem(tabela, cache, idOrigem, idDestino, aoTerminar) {
    const iOrigem = cache.findIndex(item => String(item.id) === String(idOrigem));
    const iDestino = cache.findIndex(item => String(item.id) === String(idDestino));
    if (iOrigem === -1 || iDestino === -1) return;

    const [movido] = cache.splice(iOrigem, 1);
    cache.splice(iDestino, 0, movido);

    const resultados = await Promise.all(
        cache.map((item, i) => window.supabaseClient.from(tabela).update({ ordem: i }).eq('id', item.id))
    );
    const erro = resultados.find(r => r.error);
    if (erro) { alert('Erro ao reordenar: ' + erro.error.message); return; }
    if (aoTerminar) aoTerminar();
}

// ==========================================
// GERENCIAR COLUNAS DO FUNIL
// ==========================================
function abrirGerenciarColunas() {
    renderizarListaColunasModal();
    document.getElementById('modalColunas').classList.add('open');
    document.getElementById('overlayModal').classList.add('active');
}
function fecharGerenciarColunas() {
    document.getElementById('modalColunas').classList.remove('open');
    document.getElementById('overlayModal').classList.remove('active');
    // Garante que tudo que foi editado esteja refletido no quadro
    salvarColunasLocal();
    renderizarColunas();
    renderizarCards();
}

function renderizarListaColunasModal() {
    const container = document.getElementById('colunasList');
    container.innerHTML = columnsConfig.map((col, i) => `
        <div class="coluna-row" draggable="true" ondragstart="iniciarArrastoLista(event, '${col.key}')" ondragend="this.style.opacity='1'" ondragover="event.preventDefault()" ondrop="soltarNaLista(event, 'colunas', '${col.key}')">
            <i class="fa-solid fa-grip-vertical" style="color:var(--text-muted); cursor:grab;" title="Arraste pra reordenar"></i>
            <input type="color" value="${col.color}" onchange="atualizarCorColuna(${i}, this.value)">
            <input type="text" value="${escapeHTML(col.label)}" onchange="atualizarLabelColuna(${i}, this.value)">
            <button class="icon-btn danger" title="Remover coluna" onclick="removerColuna('${col.key}')"><i class="fa-solid fa-trash"></i></button>
        </div>
    `).join('');
}

function atualizarLabelColuna(i, novoLabel) {
    if (!columnsConfig[i]) return;
    columnsConfig[i].label = novoLabel.trim() || columnsConfig[i].label;
    salvarColunasLocal();
}
function atualizarCorColuna(i, novaCor) {
    if (!columnsConfig[i]) return;
    columnsConfig[i].color = novaCor;
    salvarColunasLocal();
}
REORDENADORES_LISTA['colunas'] = function reordenarColunasDrag(chaveOrigem, chaveDestino) {
    const iOrigem = columnsConfig.findIndex(c => c.key === chaveOrigem);
    const iDestino = columnsConfig.findIndex(c => c.key === chaveDestino);
    if (iOrigem === -1 || iDestino === -1) return;
    const [movido] = columnsConfig.splice(iOrigem, 1);
    columnsConfig.splice(iDestino, 0, movido);
    salvarColunasLocal();
    renderizarListaColunasModal();
};

function gerarChaveColuna(label) {
    let base = (label || 'COL').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base) base = 'COL';
    let chave = base;
    let i = 1;
    const existentes = getColumnKeys();
    while (existentes.includes(chave)) { chave = `${base}_${i++}`; }
    return chave;
}

function adicionarColuna() {
    const label = prompt('Nome da nova coluna (etapa do funil):');
    if (!label || label.trim() === '') return;
    const key = gerarChaveColuna(label);
    columnsConfig.push({ key, label: label.trim(), color: '#0ea5e9' });
    salvarColunasLocal();
    renderizarListaColunasModal();
}

async function removerColuna(key) {
    if (columnsConfig.length <= 1) {
        alert('É preciso manter pelo menos uma coluna no funil.');
        return;
    }
    const colunaAlvo = columnsConfig.find(c => c.key === key);
    const nomeColuna = colunaAlvo ? colunaAlvo.label : key;
    const fallback = columnsConfig.find(c => c.key !== key);
    if (!confirm(`Remover a coluna "${nomeColuna}"? Os leads nela serão movidos para "${fallback.label}".`)) return;

    columnsConfig = columnsConfig.filter(c => c.key !== key);
    salvarColunasLocal();
    renderizarListaColunasModal();

    const afetados = leadsAtuais.filter(l => l.funil_agencia === key);
    afetados.forEach(l => { l.funil_agencia = fallback.key; });

    renderizarColunas();
    renderizarCards();

    // Atualiza no Supabase em segundo plano (não trava a interface)
    for (const lead of afetados) {
        await window.supabaseClient
            .from(NOME_TABELA)
            .update({ funil_agencia: fallback.key })
            .eq('pessoaIdentificador', lead.pessoaIdentificador);
    }
}

// ==========================================
// GERENCIAR FILIAIS
// ==========================================
// Diferente de "Gerenciar Colunas" (só localStorage), filiais são uma
// tabela compartilhada no Supabase — cada edição já grava direto no banco,
// não só localmente. "Remover" = desativar (ativo=false): tira a filial do
// seletor principal sem apagar nenhum lead dela, mesmo padrão de retenção
// que "Ativo" já usa no Kanban.
let filiaisModalCache = []; // todas (ativas + inativas), carregadas ao abrir o modal

async function abrirGerenciarFiliais() {
    await renderizarListaFiliaisModal();
    document.getElementById('modalFiliais').classList.add('open');
    document.getElementById('overlayModalFiliais').classList.add('active');
}
function fecharGerenciarFiliais() {
    document.getElementById('modalFiliais').classList.remove('open');
    document.getElementById('overlayModalFiliais').classList.remove('active');
    // Repopula os seletores que dependem da lista de filiais
    carregarFiliais();
    if (typeof popularFilialImportacao === 'function') popularFilialImportacao();
}

async function renderizarListaFiliaisModal() {
    const container = document.getElementById('filiaisList');
    if (!container) return;
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Carregando...</p>';

    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA_FILIAIS)
        .select('*')
        .order('ordem', { ascending: true });

    if (error) {
        container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro ao carregar filiais: ${escapeHTML(error.message)}</p>`;
        return;
    }

    filiaisModalCache = data || [];
    container.innerHTML = filiaisModalCache.map((f, i) => `
        <div class="coluna-row" data-idx="${i}" draggable="true" ondragstart="iniciarArrastoLista(event, '${f.id}')" ondragend="this.style.opacity='1'" ondragover="event.preventDefault()" ondrop="soltarNaLista(event, 'filiais', '${f.id}')" style="flex-direction:column; align-items:stretch; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
                <i class="fa-solid fa-grip-vertical" style="color:var(--text-muted); cursor:grab;" title="Arraste pra reordenar"></i>
                <input type="text" value="${escapeHTML(f.nome)}" onchange="atualizarNomeFilial(${f.id}, this.value)" style="flex:1;">
                <label class="col-tag-option" style="white-space:nowrap;">
                    <input type="checkbox" ${f.ativo ? 'checked' : ''} onchange="atualizarAtivoFilial(${f.id}, this.checked)"> Ativa
                </label>
            </div>
            <input type="text" value="${escapeHTML(f.nome_com_preposicao || '')}" placeholder="Como falar dela naturalmente (ex: do Jardim América, de Barra do Garças)" onchange="atualizarPreposicaoFilial(${f.id}, this.value)">
            <input type="text" value="${escapeHTML(f.whatsapp_chefe_numero || '')}" placeholder="WhatsApp do chefe de filial (E.164, ex: 5562991234567) — aviso de aniversário e resumo de lead" onchange="atualizarWhatsappChefeFilial(${f.id}, this.value)">
        </div>
    `).join('');
}
REORDENADORES_LISTA['filiais'] = (idOrigem, idDestino) =>
    reordenarESalvarOrdem(NOME_TABELA_FILIAIS, filiaisModalCache, idOrigem, idDestino, renderizarListaFiliaisModal);

async function atualizarNomeFilial(id, novoNome) {
    novoNome = novoNome.trim();
    if (!novoNome) return;
    const { error } = await window.supabaseClient.from(NOME_TABELA_FILIAIS).update({ nome: novoNome }).eq('id', id);
    if (error) alert('Erro ao salvar nome: ' + error.message);
}

async function atualizarAtivoFilial(id, ativo) {
    const { error } = await window.supabaseClient.from(NOME_TABELA_FILIAIS).update({ ativo }).eq('id', id);
    if (error) alert('Erro ao salvar: ' + error.message);
}

// "do Jardim América" / "de Barra do Garças" — usado pra pré-preencher a
// variável "filial" nos modelos de WhatsApp (js/whatsapp.js), sem
// precisar digitar toda vez. Propriedade da FILIAL (igual pra qualquer
// atendente), não uma preferência pessoal — por isso fica aqui, não em
// localStorage.
async function atualizarPreposicaoFilial(id, novoValor) {
    novoValor = novoValor.trim();
    const { error } = await window.supabaseClient.from(NOME_TABELA_FILIAIS).update({ nome_com_preposicao: novoValor || null }).eq('id', id);
    if (error) alert('Erro ao salvar: ' + error.message);
}

// Número de WhatsApp do chefe de filial/professor responsável — só
// dígitos (E.164 sem "+"), destinatário do aviso de aniversário de aluno
// Ativo (job diário do Mercúrio) e do resumo de lead sob demanda (gaveta
// do lead). Ver migracao_filial_whatsapp_chefe.sql.
async function atualizarWhatsappChefeFilial(id, novoValor) {
    novoValor = novoValor.replace(/\D/g, '');
    const { error } = await window.supabaseClient.from(NOME_TABELA_FILIAIS).update({ whatsapp_chefe_numero: novoValor || null }).eq('id', id);
    if (error) alert('Erro ao salvar: ' + error.message);
}


async function adicionarFilial() {
    const nome = prompt('Nome da nova filial:');
    if (!nome || !nome.trim()) return;

    const proximaOrdem = filiaisModalCache.length > 0
        ? Math.max(...filiaisModalCache.map(f => f.ordem || 0)) + 1
        : 0;

    const { error } = await window.supabaseClient
        .from(NOME_TABELA_FILIAIS)
        .insert({ nome: nome.trim(), ativo: true, ordem: proximaOrdem });

    if (error) { alert('Erro ao criar filial: ' + error.message); return; }
    renderizarListaFiliaisModal();
}

// ==========================================
// NAVEGAÇÃO MULTI-ABAS (SIDEBAR)
// ==========================================
const ICONES_MODULO = {
    'tab-dashboard': 'fa-solid fa-chart-line',
    'tab-crm': 'fa-solid fa-users-viewfinder',
    'tab-agenda': 'fa-solid fa-calendar-days',
    'tab-whatsapp': 'fa-brands fa-whatsapp',
    'tab-relatorios': 'fa-solid fa-chart-simple',
    'tab-leads-tratar': 'fa-solid fa-clone',
    'tab-importar': 'fa-solid fa-file-import'
};

function switchModule(tabId, title, subtitle) {
    // Alterna qual .tab-pane está visível
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    const paneAlvo = document.getElementById(tabId);
    if (paneAlvo) paneAlvo.classList.add('active');

    // Alterna qual ícone da sidebar fica "aceso"
    document.querySelectorAll('.sidebar-icon').forEach(icon => icon.classList.remove('active'));
    const iconeAlvo = document.querySelector(`.sidebar-icon[data-tab="${tabId}"]`);
    if (iconeAlvo) iconeAlvo.classList.add('active');

    // Atualiza título/subtítulo/ícone da topbar
    const topbarIcon = document.getElementById('topbar-icon');
    if (topbarIcon) topbarIcon.className = ICONES_MODULO[tabId] || 'fa-solid fa-circle';
    const topbarTitle = document.getElementById('topbar-title-text');
    if (topbarTitle) topbarTitle.innerText = title;
    const topbarSubtitle = document.getElementById('topbar-subtitle');
    if (topbarSubtitle) topbarSubtitle.innerText = subtitle;

    // Atualiza o conteúdo da aba que acabou de ficar visível
    if (tabId === 'tab-dashboard') atualizarDashboard();
    if (tabId === 'tab-relatorios') atualizarRelatorios();
    if (tabId === 'tab-agenda' && typeof carregarEventos === 'function') carregarEventos();
    if (tabId === 'tab-leads-tratar' && typeof carregarLeadsATratar === 'function') carregarLeadsATratar();
    if (tabId === 'tab-whatsapp') {
        const wppSearchEl = document.getElementById('wppSearch');
        renderizarContatosWpp(wppSearchEl ? wppSearchEl.value : '');
    }
    if (tabId === 'tab-importar' && typeof popularFilialImportacao === 'function') {
        popularFilialImportacao();
    }
}

// ==========================================
// ZONA DE PERIGO — apagar todos os leads de uma filial
// ==========================================
// Usado antes de reimportar do zero (ex: quando os dados atuais vieram de
// um processo externo, fora do importador do próprio CRM). Confirmação =
// digitar o nome exato da filial, mais um confirm() nativo como rede de
// segurança extra — não tem senha nem login no app.
async function atualizarContagemExclusao() {
    const select = document.getElementById('importFilialSelect');
    const container = document.getElementById('importDangerContagem');
    if (!select || !container) return;

    const filial = select.value;
    if (!filial) {
        container.innerText = 'Selecione uma filial para ver quantos leads seriam apagados.';
        return;
    }

    container.innerText = 'Contando leads...';
    const { count, error } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('*', { count: 'exact', head: true })
        .eq('filial', filial);

    if (error) {
        container.innerText = 'Erro ao contar leads: ' + error.message;
        return;
    }

    container.innerHTML = `Isso vai apagar <strong>${(count || 0).toLocaleString('pt-BR')}</strong> lead(s) da filial <strong>${escapeHTML(filial)}</strong>. Essa ação não pode ser desfeita.`;
    verificarTextoConfirmacaoExclusao();
}

function verificarTextoConfirmacaoExclusao() {
    const select = document.getElementById('importFilialSelect');
    const input = document.getElementById('importDangerConfirmInput');
    const botao = document.getElementById('btnExcluirLeadsFilial');
    if (!select || !input || !botao) return;
    botao.disabled = !select.value || input.value.trim() !== select.value.trim();
}

async function excluirLeadsDaFilial() {
    const select = document.getElementById('importFilialSelect');
    const input = document.getElementById('importDangerConfirmInput');
    if (!select || !input) return;

    const filial = select.value;
    if (!filial || input.value.trim() !== filial.trim()) return;

    if (!confirm(`Tem certeza? Isso vai apagar PERMANENTEMENTE todos os leads da filial "${filial}". Essa ação não pode ser desfeita.`)) return;

    const botao = document.getElementById('btnExcluirLeadsFilial');
    if (botao) {
        botao.disabled = true;
        botao.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Apagando...';
    }

    const { error } = await window.supabaseClient
        .from(NOME_TABELA)
        .delete()
        .eq('filial', filial);

    if (botao) botao.innerHTML = '<i class="fa-solid fa-trash-can"></i> Apagar todos os leads desta filial';

    if (error) {
        alert('Erro ao apagar leads: ' + error.message);
        verificarTextoConfirmacaoExclusao();
        return;
    }

    input.value = '';
    if (botao) botao.disabled = true;
    await atualizarContagemExclusao();

    if (filial === filialAtual) {
        carregarLeads(filialAtual, true);
    }
    alert(`Leads da filial "${filial}" apagados com sucesso.`);
}

// ==========================================
// ABA: VISÃO GERAL (DASHBOARD)
// ==========================================
// Observação: os KPIs abaixo são calculados em cima dos leads já
// carregados no navegador (respeitando a paginação de 500 em 500).
// Não são uma contagem exata de todo o histórico no banco — servem
// como leitura rápida do que está em tela agora.
function atualizarDashboard() {
    const kpiEl = document.getElementById('kpiLeadsMinerados');
    if (!kpiEl) return; // aba ainda não está no DOM (não deveria acontecer, mas por segurança)

    const validKeys = getColumnKeys();
    if (validKeys.length === 0) return;
    const primeiraColuna = validKeys[0];

    const colunaDoLead = (lead) => validKeys.includes(lead.funil_agencia) ? lead.funil_agencia : primeiraColuna;

    // "Frio" = ainda não foi trabalhado. A primeira coluna do funil conta,
    // e "Sem Whatsapp" também — coluna LEGADA (o importador não cria mais
    // essa coluna pra leads sem telefone, ver COLUNA_SEM_WHATSAPP; hoje
    // esses leads vão pra aba "Leads a Tratar"), mantida aqui só pra quem
    // já tinha leads presos lá de antes dessa mudança não inflar "Taxa de
    // Resposta"/"Resgates" como se tivessem sido trabalhados.
    const colunasFrias = new Set([primeiraColuna, COLUNA_SEM_WHATSAPP].filter(k => validKeys.includes(k)));
    const ehColunaFria = (lead) => colunasFrias.has(colunaDoLead(lead));

    const total = leadsAtuais.length;
    const emColunaFria = leadsAtuais.filter(ehColunaFria).length;
    const foraDeColunasFrias = total - emColunaFria;
    const taxaResposta = total > 0 ? Math.round((foraDeColunasFrias / total) * 1000) / 10 : 0;

    const matriculadosKey = validKeys.find(k => k.toLowerCase().includes('matricul')) || validKeys[validKeys.length - 1];
    const novasMatriculas = leadsAtuais.filter(l => colunaDoLead(l) === matriculadosKey).length;

    // "Resgate": prioriza a tag "Recuperado" (confirmado pela importação:
    // estava Inativo numa planilha anterior e voltou como Ativo — rematrícula
    // de verdade, não só "saiu da coluna fria"). Leads que nunca passaram por
    // essa reimportação (ou cuja tag ainda não foi gerada) caem no critério
    // antigo como fallback: Inativo que já saiu de uma coluna fria — mais
    // fraco (só indica "foi trabalhado", não confirma rematrícula), mas evita
    // zerar o KPI pra quem importou antes dessa tag existir.
    const resgates = leadsAtuais.filter(l => {
        const tags = parseTags(l.tags).map(t => t.trim());
        if (tags.includes('Recuperado')) return true;
        const ehInativo = tags.includes('Inativo') || tags.includes('Ex-Aluno (Inativo)');
        return ehInativo && !ehColunaFria(l);
    }).length;

    setTextoElemento('kpiLeadsMinerados', total.toLocaleString('pt-BR'));
    setTextoElemento('kpiTaxaResposta', `${taxaResposta}%`);
    setTextoElemento('kpiNovasMatriculas', novasMatriculas.toLocaleString('pt-BR'));
    setTextoElemento('kpiResgates', resgates.toLocaleString('pt-BR'));

    renderizarResumoLeadForte();
    renderizarResumoJornada();
    renderizarFeedAtividades();
    atualizarLembretesPendentes();
    atualizarAniversariantes();
    atualizarFollowupEventos();
}

// Mesma lógica de rankLeadForte()/renderizarCards() pra reconhecer a tag
// (com ou sem nível — formato antigo não entra na contagem, já que não dá
// pra saber o nível dele). Proxy igual os outros KPIs (leadsAtuais).
function renderizarResumoLeadForte() {
    const container = document.getElementById('leadForteResumo');
    if (!container) return;

    const contagem = { 1: 0, 2: 0, 3: 0 };
    leadsAtuais.forEach(l => {
        const tag = parseTags(l.tags).map(t => t.trim()).find(t => /^Lead Forte [1-3]$/.test(t));
        if (tag) contagem[tag.slice(-1)]++;
    });

    const NIVEIS = [
        { n: 1, classe: 'tag-strong-1', icone: 'fa-solid fa-fire' },
        { n: 2, classe: 'tag-strong-2', icone: 'fa-solid fa-star' },
        { n: 3, classe: 'tag-strong-3', icone: 'fa-regular fa-star' },
    ];
    container.innerHTML = NIVEIS.map(({ n, classe, icone }) => `
        <div class="lead-forte-resumo-item ${classe}" onclick="filtrarPorLeadForte(${n})" title="Ver esses leads no CRM">
            <div class="lead-forte-resumo-valor">${contagem[n].toLocaleString('pt-BR')}</div>
            <div class="lead-forte-resumo-label"><i class="${icone}"></i> Nível ${n}</div>
        </div>
    `).join('');
}

// Clicar num card de "Lead Forte por Nível" no Dashboard leva direto pro
// CRM já filtrado por aquele nível — reaproveita quickFilterTag() (o mesmo
// mecanismo do Filtro Rápido), que aplica a tag em TODAS as colunas de
// uma vez e conta como uso pra fins de aparecer nos filtros rápidos depois.
function filtrarPorLeadForte(nivel) {
    switchModule('tab-crm', 'Prospecção Ativa', 'CRM Modularizado VS Code');
    quickFilterTag(`Lead Forte ${nivel}`);
}

// "Verdadeiros" Leads Fortes: quem já frequentou a trilha Filosófica é um
// sinal mais específico de propensão a matricular do que o Lead Forte
// puro (que conta qualquer evento, inclusive só Artes/Dev. Pessoal) —
// "Engajado" (trilha Filosófica + Lead Forte 1 ou 2) é a lista pra
// começar os contatos por ela. Mesma lógica de contagem de
// renderizarRelatorioJornadaBase(), só que sem Matriculado/Em Recuperação
// (não são alvo de prospecção) e com os cards clicáveis, igual ao resumo
// de Lead Forte acima.
function renderizarResumoJornada() {
    const container = document.getElementById('jornadaResumo');
    if (!container) return;

    const contagem = { 'Descoberta': 0, 'Interesse Emergente': 0, 'Engajado': 0 };
    leadsAtuais.forEach(l => {
        const tags = parseTags(l.tags).map(t => t.trim());
        const tagJornada = tags.find(t => /^Jornada: /.test(t));
        if (!tagJornada) return;
        const estagio = tagJornada.replace(/^Jornada: /, '');
        if (contagem.hasOwnProperty(estagio)) contagem[estagio]++;
    });

    const ESTAGIOS = [
        { estagio: 'Descoberta', classe: 'tag-strong-3', icone: 'fa-solid fa-seedling' },
        { estagio: 'Interesse Emergente', classe: 'tag-strong-2', icone: 'fa-solid fa-magnifying-glass' },
        { estagio: 'Engajado', classe: 'tag-strong-1', icone: 'fa-solid fa-fire' },
    ];
    container.innerHTML = ESTAGIOS.map(({ estagio, classe, icone }) => `
        <div class="lead-forte-resumo-item ${classe}" onclick="filtrarPorJornada('${estagio}')" title="Ver esses leads no CRM">
            <div class="lead-forte-resumo-valor">${contagem[estagio].toLocaleString('pt-BR')}</div>
            <div class="lead-forte-resumo-label"><i class="${icone}"></i> ${escapeHTML(estagio)}</div>
        </div>
    `).join('');
}

function filtrarPorJornada(estagio) {
    switchModule('tab-crm', 'Prospecção Ativa', 'CRM Modularizado VS Code');
    quickFilterTag(`Jornada: ${estagio}`);
}

// Diferente dos KPIs acima (proxy, calculados só em cima do que já está no
// navegador), lembretes vão direto no banco — um follow-up atrasado
// precisa aparecer mesmo que o lead não esteja entre os já carregados.
async function atualizarLembretesPendentes() {
    const feed = document.getElementById('lembretesFeed');
    if (!feed || !filialAtual) return;

    const hojeISO = new Date().toISOString().slice(0, 10);
    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('pessoaIdentificador, pessoaNome, lembrete_em, lembrete_nota')
        .eq('filial', filialAtual)
        .lte('lembrete_em', hojeISO)
        .order('lembrete_em', { ascending: true })
        .limit(20);

    if (error) {
        feed.innerHTML = '<div style="font-size:11px; color:var(--text-muted);">Lembretes indisponíveis (rode migracao_lembrete_lead.sql).</div>';
        return;
    }

    if (!data || data.length === 0) {
        feed.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhum lembrete pendente hoje.</div>';
        return;
    }

    feed.innerHTML = data.map(l => {
        const atrasado = l.lembrete_em < hojeISO;
        return `
            <div class="activity-item" style="cursor:pointer;" onclick="abrirResultadoBuscaGlobal('${l.pessoaIdentificador}')">
                <div class="activity-dot" style="background:${atrasado ? '#dc2626' : '#f59e0b'};"></div>
                <div>
                    <div><strong>${escapeHTML(l.pessoaNome || 'Lead sem nome')}</strong>${l.lembrete_nota ? ' — ' + escapeHTML(l.lembrete_nota) : ''}</div>
                    <div class="activity-time">${atrasado ? 'Atrasado desde' : 'Hoje'}: ${escapeHTML(l.lembrete_em)}</div>
                </div>
            </div>`;
    }).join('');
}

// Aniversariantes do Mês — busca direta no banco (não é proxy sobre
// leadsAtuais, já que aniversário importa pra filial inteira, não só o
// que já foi paginado). data_nascimento é preenchida manualmente na
// gaveta (bloco "Contato") — nenhuma das 3 planilhas traz esse dado hoje.
// Aniversariante de HOJE ganha o mesmo destaque festivo do feed de
// atividades (Matriculado/Recuperado — ver renderizarFeedAtividades()).
async function atualizarAniversariantes() {
    const container = document.getElementById('aniversariantesFeed');
    if (!container || !filialAtual) return;

    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('pessoaIdentificador, pessoaNome, data_nascimento')
        .eq('filial', filialAtual)
        .not('data_nascimento', 'is', null);

    if (error) {
        container.innerHTML = '<div style="font-size:11px; color:var(--text-muted);">Aniversariantes indisponíveis (rode migracao_data_nascimento.sql).</div>';
        return;
    }

    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const diaAtual = hoje.getDate();

    const doMes = (data || [])
        .map(l => {
            const [, mes, dia] = l.data_nascimento.split('-').map(Number);
            return { ...l, mes, dia };
        })
        .filter(l => l.mes === mesAtual)
        .sort((a, b) => a.dia - b.dia);

    if (doMes.length === 0) {
        container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhum aniversariante com data cadastrada este mês.</div>';
        return;
    }

    container.innerHTML = doMes.map(l => {
        const ehHoje = l.dia === diaAtual;
        return `
            <div class="activity-item ${ehHoje ? 'activity-item-festiva' : ''}" style="cursor:pointer;" onclick="abrirResultadoBuscaGlobal('${l.pessoaIdentificador}')">
                <div class="activity-dot ${ehHoje ? 'activity-dot-festiva' : ''}"></div>
                <div>
                    <div><strong>${escapeHTML(l.pessoaNome || 'Lead sem nome')}</strong>${ehHoje ? ' 🎂 <strong>hoje!</strong>' : ''}</div>
                    <div class="activity-time">${String(l.dia).padStart(2, '0')}/${String(l.mes).padStart(2, '0')}</div>
                </div>
            </div>`;
    }).join('');
}

// Follow-up de Eventos: quem está vinculado (evento_leads — "se inscreveu",
// ou o time confirmou por WhatsApp/telefone e marcou no modal de
// Participantes) a um evento AINDA NÃO PASSADO da filial atual. Direto no
// banco (não proxy sobre leadsAtuais), mesmo motivo de
// atualizarLembretesPendentes()/atualizarAniversariantes() — um evento
// chegando precisa aparecer mesmo que o lead ainda não tenha sido paginado
// pro navegador. "Recusado" fica de fora (não precisa de follow-up);
// "Confirmado" aparece antes de "Pendente" (é quem mais precisa de um
// lembrete de presença perto da data). Mesma noção de "evento ainda vale"
// de dataEfetivaLimite() (js/eventos.js) — data OU data_limite_inscricao
// (o que for mais tarde) ainda não passou.
async function atualizarFollowupEventos() {
    const container = document.getElementById('followupEventosFeed');
    if (!container || !filialAtual) return;

    const hojeISO = new Date().toISOString().slice(0, 10);

    const { data: eventosFuturos, error: erroEventos } = await window.supabaseClient
        .from('eventos')
        .select('id, nome, data, data_limite_inscricao')
        .eq('filial', filialAtual)
        .eq('ativo', true)
        .or(`data.gte.${hojeISO},data_limite_inscricao.gte.${hojeISO}`);

    if (erroEventos) {
        container.innerHTML = '<div style="font-size:11px; color:var(--text-muted);">Follow-up de eventos indisponível (rode migracao_evento_leads.sql).</div>';
        return;
    }
    if (!eventosFuturos || eventosFuturos.length === 0) {
        container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhum evento futuro cadastrado.</div>';
        return;
    }

    const mapaEventos = new Map(eventosFuturos.map(e => [e.id, e]));

    const { data: inscritos, error: erroInscritos } = await window.supabaseClient
        .from('evento_leads')
        .select('evento_id, pessoaIdentificador, resposta_convite')
        .in('evento_id', eventosFuturos.map(e => e.id))
        .neq('resposta_convite', 'recusado');

    if (erroInscritos || !inscritos || inscritos.length === 0) {
        container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Ninguém inscrito nos próximos eventos ainda.</div>';
        return;
    }

    const idsPessoas = [...new Set(inscritos.map(i => i.pessoaIdentificador))];
    const { data: leadsInfo } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('pessoaIdentificador, pessoaNome')
        .in('pessoaIdentificador', idsPessoas);
    const mapaNomes = new Map((leadsInfo || []).map(l => [l.pessoaIdentificador, l.pessoaNome]));

    const linhas = inscritos
        .map(i => ({ ...i, evento: mapaEventos.get(i.evento_id), nome: mapaNomes.get(i.pessoaIdentificador) }))
        .filter(l => l.evento)
        .sort((a, b) => {
            if (a.resposta_convite !== b.resposta_convite) return a.resposta_convite === 'confirmado' ? -1 : 1;
            return (a.evento.data || '').localeCompare(b.evento.data || '');
        })
        .slice(0, 20);

    if (linhas.length === 0) {
        container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Ninguém inscrito nos próximos eventos ainda.</div>';
        return;
    }

    container.innerHTML = linhas.map(l => {
        const classeResposta = (typeof CLASSES_RESPOSTA_CONVITE !== 'undefined' && CLASSES_RESPOSTA_CONVITE[l.resposta_convite]) || '';
        const rotuloResposta = (typeof ROTULOS_RESPOSTA_CONVITE !== 'undefined' && ROTULOS_RESPOSTA_CONVITE[l.resposta_convite]) || l.resposta_convite;
        const dataFmt = (typeof formatarDataEvento === 'function') ? formatarDataEvento(l.evento.data) : l.evento.data;
        return `
            <div class="activity-item" style="cursor:pointer;" onclick="abrirResultadoBuscaGlobal('${l.pessoaIdentificador}')">
                <div class="activity-dot" style="background:${l.resposta_convite === 'confirmado' ? '#16a34a' : '#f59e0b'};"></div>
                <div>
                    <div><strong>${escapeHTML(l.nome || 'Lead sem nome')}</strong> <span class="tag ${classeResposta}" style="font-size:10px;">${escapeHTML(rotuloResposta)}</span></div>
                    <div class="activity-time">${escapeHTML(l.evento.nome)} — ${escapeHTML(dataFmt)}</div>
                </div>
            </div>`;
    }).join('');
}

function setTextoElemento(id, texto) {
    const el = document.getElementById(id);
    if (el) el.innerText = texto;
}

// Observação: ainda não existe uma tabela de log de atividades no
// Supabase, então este feed é montado a partir do estado atual dos
// leads mais recentes carregados — não é um histórico persistido.
// Se no futuro vocês criarem uma tabela "atividades", é só trocar
// esta função para consultá-la diretamente.
function renderizarFeedAtividades() {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;

    const validKeys = getColumnKeys();
    const primeiraColuna = validKeys[0];
    const amostra = [...leadsAtuais].slice(-8).reverse();

    if (amostra.length === 0) {
        feed.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhuma atividade para exibir ainda.</div>';
        return;
    }

    feed.innerHTML = amostra.map(lead => {
        const chaveColuna = validKeys.includes(lead.funil_agencia) ? lead.funil_agencia : primeiraColuna;
        const coluna = columnsConfig.find(c => c.key === chaveColuna);

        // Destaque festivo pra dois marcos que merecem comemorar: virou
        // Matriculado (coluna) ou ganhou a tag "Recuperado" (rematrícula
        // confirmada — ver ehTagDeSistema()/importador.js).
        const ehMatriculado = chaveColuna.toLowerCase().includes('matricul');
        const ehRecuperado = parseTags(lead.tags).map(t => t.trim()).includes('Recuperado');
        const festiva = ehMatriculado || ehRecuperado;
        const iconeFestivo = ehMatriculado ? 'fa-graduation-cap' : 'fa-medal';

        const textoAtividade = ehMatriculado
            ? `está <strong>Matriculado(a)!</strong>`
            : ehRecuperado
                ? `foi <strong>Recuperado(a)!</strong>`
                : `está em <strong>${escapeHTML(coluna ? coluna.label : '—')}</strong>`;

        return `
            <div class="activity-item ${festiva ? 'activity-item-festiva' : ''}">
                <div class="activity-dot ${festiva ? 'activity-dot-festiva' : ''}" ${festiva ? '' : `style="background:${coluna ? coluna.color : '#94a3b8'};"`}>${festiva ? `<i class="fa-solid ${iconeFestivo}"></i>` : ''}</div>
                <div>
                    <div><strong>${escapeHTML(lead.pessoaNome || 'Lead sem nome')}</strong> ${textoAtividade}${festiva ? ' <span class="activity-festiva-emoji">🎉</span>' : ''}</div>
                    <div class="activity-time">Matrícula/ID ${escapeHTML(String(lead.pessoaIdentificador))}</div>
                </div>
            </div>`;
    }).join('');
}

// ==========================================
// ABA: WHATSAPP UNIFICADO
// ==========================================
// A lógica real da aba WhatsApp (lista de contatos, chat, envio/recebimento
// via Meta Cloud API) mora em js/whatsapp.js — ver renderizarContatosWpp,
// filtrarContatosWpp e abrirChatWpp lá, que substituem as funções mockadas
// que existiam aqui antes.
// ==========================================

// ==========================================
// ABA: RELATÓRIOS (FUNIL DE CONVERSÃO)
// ==========================================
// Calcula a largura (%) de cada etapa de um funil visual — SEMPRE
// decrescente (nunca duas etapas seguidas com a mesma largura), mesmo
// quando os valores reais são iguais ou zero. Sem isso, etapas vazias
// batiam todas no mesmo piso mínimo e ficavam com a MESMA largura —
// visualmente parecia uma pilha de retângulos iguais ("simétrico"), não
// um funil afunilando de verdade. `quedaMinima` garante um degrau visual
// sempre, mesmo sem diferença real nos dados; quando a queda real é maior
// que isso, o valor real prevalece (funil não fica "mais gordo" do que a
// proporção verdadeira).
function calcularLargurasFunil(valores, { minimo = 26, quedaMinima = 14 } = {}) {
    const maior = Math.max(1, ...valores);
    let tetoAnterior = 100;
    return valores.map((v, i) => {
        const pctDado = Math.round((v / maior) * 100);
        const teto = i === 0 ? 100 : Math.max(minimo, tetoAnterior - quedaMinima);
        const largura = i === 0 ? 100 : Math.min(Math.max(pctDado, minimo), teto);
        tetoAnterior = largura;
        return largura;
    });
}

function atualizarRelatorios() {
    const container = document.getElementById('funnelChart');
    if (!container) return;

    const validKeys = getColumnKeys();
    if (validKeys.length === 0) return;
    const primeiraColuna = validKeys[0];
    const colunaDoLead = (lead) => validKeys.includes(lead.funil_agencia) ? lead.funil_agencia : primeiraColuna;
    const contarColuna = (key) => leadsAtuais.filter(l => colunaDoLead(l) === key).length;

    const matriculadosKey = validKeys.find(k => k.toLowerCase().includes('matricul')) || validKeys[validKeys.length - 1];
    const rsvpKey = validKeys.find(k => k.toLowerCase().includes('rsvp'));

    // "Sem Whatsapp" também conta como frio (mesmo critério do Dashboard,
    // ver atualizarDashboard()) — senão quem só está lá por falta de
    // telefone aparecia como "engajamento" sem ninguém ter feito nada.
    const colunasFrias = new Set([primeiraColuna, COLUNA_SEM_WHATSAPP].filter(k => validKeys.includes(k)));
    const emColunaFria = (lead) => colunasFrias.has(colunaDoLead(lead));

    const total = leadsAtuais.length;
    const baseCarregada = total;
    const engajamento = total - leadsAtuais.filter(emColunaFria).length;
    const rsvpConfirmado = rsvpKey ? (contarColuna(rsvpKey) + contarColuna(matriculadosKey)) : contarColuna(matriculadosKey);
    const showUpMatricula = contarColuna(matriculadosKey);

    const etapas = [
        { label: 'Base Carregada', desc: 'Todos os leads da filial atual', valor: baseCarregada },
        { label: 'Engajamento', desc: 'Já saíram da coluna fria do funil', valor: engajamento },
        { label: 'RSVP Confirmado', desc: 'Confirmaram presença ou já matricularam', valor: rsvpConfirmado },
        { label: 'Show-up e Matrícula', desc: 'Efetivamente matricularam', valor: showUpMatricula }
    ];

    // Visual em cards empilhados (largura proporcional ao valor real de
    // cada etapa, cor por posição — cinza/dourado/azul/verde, igual o
    // protótipo aprovado) em vez da barra fina antiga. Só esta função usa
    // essas classes (funil-etapa-*) — os outros funis do app (Motivos de
    // Perda, Jornada da Base) continuam com .funnel-bar-wrapper/.funnel-bar,
    // sem qualquer mudança.
    const PALETA_ETAPAS = [
        { borda: '#cbd5e1', fundo: '#f1f5f9', cor: 'var(--text-dark)' },
        { borda: 'var(--na-gold)', fundo: '#fdfaf5', cor: 'var(--text-dark)' },
        { borda: '#3b82f6', fundo: '#eff6ff', cor: 'var(--text-dark)' },
        { borda: 'var(--na-green)', fundo: '#f0fdf4', cor: 'var(--na-green-dark)' },
    ];
    const larguras = calcularLargurasFunil(etapas.map(e => e.valor));

    container.innerHTML = `<div class="funil-visual">` + etapas.map((e, i) => {
        const pct = larguras[i];
        const paleta = PALETA_ETAPAS[i % PALETA_ETAPAS.length];
        const ehUltima = i === etapas.length - 1;
        const anterior = i > 0 ? etapas[i - 1].valor : null;
        const taxaConversao = ehUltima && anterior ? Math.round((e.valor / anterior) * 100) : null;

        const seta = i > 0 ? `<div class="funil-etapa-seta"><i class="fa-solid fa-arrow-down"></i></div>` : '';
        return `
            ${seta}
            <div class="funil-etapa-card" style="width:${pct}%; border-left-color:${paleta.borda}; background:${paleta.fundo};">
                <div>
                    <div class="funil-etapa-titulo" style="color:${paleta.cor};">${i + 1}. ${escapeHTML(e.label)}</div>
                    <div class="funil-etapa-desc">${escapeHTML(e.desc)}</div>
                </div>
                <div class="funil-etapa-valor-bloco">
                    <div class="funil-etapa-valor" style="color:${paleta.cor};">${e.valor.toLocaleString('pt-BR')}</div>
                    ${taxaConversao !== null ? `<div class="funil-etapa-badge">${taxaConversao}% de Show-up</div>` : ''}
                </div>
            </div>
        `;
    }).join('') + `</div>`;

    renderizarRelatorioTemasEvento();
    renderizarRelatorioMatriculasPorMes();
    renderizarRelatorioComparacaoFiliais();
    renderizarRelatorioJornadaBase();
    renderizarRelatorioMotivosPerda();
}

// Proxy sobre leadsAtuais, mesmo espírito dos outros relatórios acima —
// conta quantos leads foram perdidos por motivo (registrarMotivoPerda(),
// js/app.js), agrupando pelo motivo-base (ignora a observação livre depois
// do " — ", pra não fragmentar o agrupamento). Alimenta a decisão de onde
// investir (ex: muita perda por "Horário" -> abrir turma em outro horário).
function renderizarRelatorioMotivosPerda() {
    const container = document.getElementById('relatorioMotivosPerda');
    if (!container) return;

    const porMotivo = new Map();
    leadsAtuais.forEach(lead => {
        if (!lead.motivo_perda) return;
        const motivoBase = String(lead.motivo_perda).split(' — ')[0].trim();
        porMotivo.set(motivoBase, (porMotivo.get(motivoBase) || 0) + 1);
    });

    if (porMotivo.size === 0) {
        container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhum lead marcado como perdido ainda nesta filial.</p>';
        return;
    }

    const linhas = Array.from(porMotivo.entries()).sort((a, b) => b[1] - a[1]);
    const total = linhas.reduce((soma, [, v]) => soma + v, 0);
    const maiorValor = Math.max(1, ...linhas.map(([, v]) => v));

    container.innerHTML = `
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">${total.toLocaleString('pt-BR')} lead(s) perdido(s) ao todo (dos já carregados nesta filial).</p>
        ${linhas.map(([motivo, valor]) => {
            const pct = Math.max(4, Math.round((valor / maiorValor) * 100));
            return `
                <div class="funnel-stage">
                    <div class="funnel-label">${escapeHTML(motivo)}</div>
                    <div class="funnel-bar-wrapper">
                        <div class="funnel-bar" style="width:${pct}%; background: linear-gradient(90deg, #dc2626, #f87171);">${pct}%</div>
                    </div>
                    <div class="funnel-count">${valor.toLocaleString('pt-BR')}</div>
                </div>
            `;
        }).join('')}
    `;
}

// Proxy sobre leadsAtuais (mesma limitação dos outros KPIs/relatórios do
// dashboard). Distribui a base em estágios do sistema de follow-up
// (Trilhas de Interesse + Jornada, ver migracao_trilhas_tipo_evento.sql):
// prospectos passam por Descoberta -> Interesse Emergente -> Engajado
// antes de Matricular; quem já é Ativo conta como "Matriculado" e quem é
// Inativo como "Em Recuperação", independente de ter tag de Jornada (essa
// só é gerada pelo importador pra quem ainda é só prospecto). Quem nunca
// apareceu em nenhum evento classificado numa trilha fica fora do funil
// (não força um estágio sem sinal nenhum).
function renderizarRelatorioJornadaBase() {
    const container = document.getElementById('relatorioJornadaBase');
    if (!container) return;

    const contagem = { 'Descoberta': 0, 'Interesse Emergente': 0, 'Engajado': 0, 'Matriculado': 0, 'Em Recuperação': 0 };
    leadsAtuais.forEach(lead => {
        const tags = parseTags(lead.tags).map(t => t.trim());
        if (tags.includes('Ativo') || tags.includes('Aluno Ativo')) { contagem['Matriculado']++; return; }
        if (tags.includes('Inativo') || tags.includes('Ex-Aluno (Inativo)')) { contagem['Em Recuperação']++; return; }
        const tagJornada = tags.find(t => /^Jornada: /.test(t));
        if (tagJornada) {
            const estagio = tagJornada.replace(/^Jornada: /, '');
            if (contagem.hasOwnProperty(estagio)) contagem[estagio]++;
        }
    });

    const totalNoFunil = Object.values(contagem).reduce((a, b) => a + b, 0);
    if (totalNoFunil === 0) {
        container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhum lead classificado em trilha/jornada ainda — configure "Trilhas de Interesse" na aba Importar e reimporte as planilhas.</p>';
        return;
    }

    // Descoberta → Interesse Emergente → Engajado é uma progressão real
    // (cada estágio pressupõe mais engajamento que o anterior), mas
    // Matriculado/Em Recuperação NÃO são "o próximo passo depois de
    // Engajado" — são 2 DESTINOS diferentes (virou aluno, ou já foi aluno
    // e precisa ser resgatado), por isso ficam lado a lado formando a
    // base do funil, em vez de mais uma etapa única embaixo (pedido
    // explícito do usuário).
    const ETAPAS_SEQUENCIA = ['Descoberta', 'Interesse Emergente', 'Engajado'];
    const PALETA_JORNADA = [
        { borda: '#cbd5e1', fundo: '#f1f5f9', cor: 'var(--text-dark)' },
        { borda: 'var(--na-gold)', fundo: '#fdfaf5', cor: 'var(--text-dark)' },
        { borda: '#3b82f6', fundo: '#eff6ff', cor: 'var(--text-dark)' },
    ];
    // % de cada estágio sobre os "leads ÚTEIS" — quem ainda NÃO é
    // Matriculado (Descoberta + Interesse Emergente + Engajado + Em
    // Recuperação). **Bug real corrigido**: a versão anterior calculava
    // a largura de cada barra como % do MAIOR valor entre os 5 grupos
    // (ex: Interesse Emergente com 124 pessoas virava "100%" só por ser
    // o maior, não por representar 100% de coisa nenhuma) — sem
    // denominador que fizesse sentido, o número não dizia nada real.
    // Agora os 4 valores do funil de prospecção sempre somam 100% entre
    // si; Matriculado fica de fora do denominador de propósito (é a
    // META, não faz sentido competir por fatia do funil que já converteu).
    const totalUteis = contagem['Descoberta'] + contagem['Interesse Emergente'] + contagem['Engajado'] + contagem['Em Recuperação'];
    const pctDe = (valor) => totalUteis > 0 ? Math.round((valor / totalUteis) * 100) : 0;
    const larguraDe = (valor) => Math.max(15, pctDe(valor));

    const htmlSequencia = ETAPAS_SEQUENCIA.map((label, i) => {
        const paleta = PALETA_JORNADA[i];
        const seta = i > 0 ? `<div class="funil-etapa-seta"><i class="fa-solid fa-arrow-down"></i></div>` : '';
        return `
            ${seta}
            <div class="funil-etapa-card" style="width:${larguraDe(contagem[label])}%; border-left-color:${paleta.borda}; background:${paleta.fundo};">
                <div class="funil-etapa-titulo" style="color:${paleta.cor};">${escapeHTML(label)}</div>
                <div class="funil-etapa-valor-bloco">
                    <div class="funil-etapa-valor" style="color:${paleta.cor};">${contagem[label].toLocaleString('pt-BR')}</div>
                    <div class="funil-etapa-pct">${pctDe(contagem[label])}% dos leads úteis</div>
                </div>
            </div>
        `;
    }).join('');

    // Base dupla: largura total do par = largura da etapa "Engajado"
    // (última sequencial), dividida entre os 2 destinos proporcional ao
    // valor de cada um — visualmente "o funil se bifurca" na saída.
    const valorMatriculado = contagem['Matriculado'];
    const valorRecuperacao = contagem['Em Recuperação'];
    const somaBase = Math.max(1, valorMatriculado + valorRecuperacao);
    const larguraDisponivel = larguraDe(contagem['Engajado']);
    const wMatriculado = Math.max(20, Math.round(larguraDisponivel * (valorMatriculado / somaBase)));
    const wRecuperacao = Math.max(20, Math.round(larguraDisponivel * (valorRecuperacao / somaBase)));

    const htmlBase = `
        <div class="funil-etapa-seta"><i class="fa-solid fa-arrow-down"></i></div>
        <div class="funil-base-dupla">
            <div class="funil-etapa-card funil-base-item" style="width:${wMatriculado}%; border-left-color:var(--na-green); background:#f0fdf4;">
                <div class="funil-etapa-titulo" style="color:var(--na-green-dark);">Matriculado</div>
                <div class="funil-etapa-valor" style="color:var(--na-green-dark);">${valorMatriculado.toLocaleString('pt-BR')}</div>
            </div>
            <div class="funil-etapa-card funil-base-item" style="width:${wRecuperacao}%; border-left-color:#b45309; background:#fffbeb;">
                <div class="funil-etapa-titulo" style="color:#b45309;">Em Recuperação</div>
                <div class="funil-etapa-valor" style="color:#b45309;">${valorRecuperacao.toLocaleString('pt-BR')}</div>
                <div class="funil-etapa-pct">${pctDe(valorRecuperacao)}% dos leads úteis</div>
            </div>
        </div>
    `;

    container.innerHTML = `<div class="funil-visual">${htmlSequencia}${htmlBase}</div>`;
}

// Proxy sobre leadsAtuais (mesma limitação dos outros KPIs do Dashboard —
// não é o banco inteiro se ainda houver "Carregar Mais" pendente). Pra
// cada tema que aparece em QUALQUER evento do histórico do lead, conta 1
// "participação" e verifica se esse lead já tem data_matricula preenchida
// (sinal de matrícula confirmada, independente de qual coluna do Kanban
// ele está — funil_agencia é só configuração local de cada navegador).
function renderizarRelatorioTemasEvento() {
    const container = document.getElementById('relatorioTemasEvento');
    if (!container) return;

    const porTema = new Map(); // tema -> {total, matriculados}
    leadsAtuais.forEach(lead => {
        const hist = Array.isArray(lead.historico_eventos) ? lead.historico_eventos : [];
        const temas = new Set(hist.map(h => h.tema).filter(Boolean));
        if (temas.size === 0) return;
        const matriculado = !!lead.data_matricula;
        temas.forEach(tema => {
            if (!porTema.has(tema)) porTema.set(tema, { total: 0, matriculados: 0 });
            const r = porTema.get(tema);
            r.total++;
            if (matriculado) r.matriculados++;
        });
    });

    if (porTema.size === 0) {
        container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhum tema de evento classificado ainda nos leads carregados (a classificação por IA roda na importação de planilhas — ver seção "Classificação de temas de evento por IA" no CLAUDE.md).</p>';
        return;
    }

    const linhas = Array.from(porTema.entries())
        .map(([tema, r]) => ({ tema, ...r, taxa: r.total > 0 ? Math.round((r.matriculados / r.total) * 100) : 0 }))
        .sort((a, b) => b.total - a.total);

    container.innerHTML = `
        <table class="tabela-relatorio">
            <thead><tr><th>Tema</th><th>Leads</th><th>Matriculados</th><th>Taxa</th></tr></thead>
            <tbody>${linhas.map(l => `
                <tr>
                    <td>${escapeHTML(l.tema)}</td>
                    <td>${l.total.toLocaleString('pt-BR')}</td>
                    <td>${l.matriculados.toLocaleString('pt-BR')}</td>
                    <td><strong>${l.taxa}%</strong></td>
                </tr>
            `).join('')}</tbody>
        </table>
    `;
}

// Diferente do relatório acima, este busca direto no banco (paginado,
// com ORDER BY estável) — a exatidão importa mais que a velocidade aqui,
// já que é uma métrica de negócio (não um KPI-proxy do dia a dia).
async function renderizarRelatorioMatriculasPorMes() {
    const container = document.getElementById('relatorioMatriculasPorMes');
    if (!container || !filialAtual) return;
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando...</p>';

    let todos = [];
    let pagina = 0;
    while (true) {
        const { data, error } = await window.supabaseClient
            .from(NOME_TABELA)
            .select('data_matricula')
            .eq('filial', filialAtual)
            .not('data_matricula', 'is', null)
            .order('data_matricula', { ascending: true })
            .range(pagina * 1000, pagina * 1000 + 999);
        if (error) { container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro: ${escapeHTML(error.message)}</p>`; return; }
        todos = todos.concat(data || []);
        if (!data || data.length < 1000) break;
        pagina++;
    }

    if (todos.length === 0) {
        container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhuma matrícula registrada ainda (data_matricula vazio pra todos os leads desta filial — ver migracao_data_matricula.sql).</p>';
        return;
    }

    const porMes = new Map();
    todos.forEach(l => {
        const mes = String(l.data_matricula).slice(0, 7); // "AAAA-MM"
        porMes.set(mes, (porMes.get(mes) || 0) + 1);
    });

    const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const mesesOrdenados = Array.from(porMes.keys()).sort();
    const maiorValor = Math.max(1, ...porMes.values());

    container.innerHTML = `
        <div class="funnel">
            ${mesesOrdenados.map(mes => {
                const [ano, mesNum] = mes.split('-');
                const valor = porMes.get(mes);
                const pct = Math.max(4, Math.round((valor / maiorValor) * 100));
                return `
                    <div class="funnel-stage">
                        <div class="funnel-label">${NOMES_MES[Number(mesNum) - 1]}/${ano.slice(2)}</div>
                        <div class="funnel-bar-wrapper"><div class="funnel-bar" style="width:${pct}%;">${pct}%</div></div>
                        <div class="funnel-count">${valor}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// Único relatório que olha pra TODAS as filiais de uma vez (os outros são
// escopados à filial atual, como o resto do app) — usa count exato do
// PostgREST (head:true não baixa nenhuma linha, só o total) em vez de
// buscar tudo pra contar no navegador.
async function renderizarRelatorioComparacaoFiliais() {
    const container = document.getElementById('relatorioComparacaoFiliais');
    if (!container) return;

    const filiais = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).map(f => f.nome);
    if (filiais.length === 0) { container.innerHTML = ''; return; }

    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando...</p>';

    const resultados = await Promise.all(filiais.map(async nome => {
        const [totalResp, matriculadosResp] = await Promise.all([
            window.supabaseClient.from(NOME_TABELA).select('*', { count: 'exact', head: true }).eq('filial', nome),
            window.supabaseClient.from(NOME_TABELA).select('*', { count: 'exact', head: true }).eq('filial', nome).not('data_matricula', 'is', null),
        ]);
        const total = totalResp.count || 0;
        const matriculados = matriculadosResp.count || 0;
        return { nome, total, matriculados, taxa: total > 0 ? Math.round((matriculados / total) * 100) : 0 };
    }));

    container.innerHTML = `
        <table class="tabela-relatorio">
            <thead><tr><th>Filial</th><th>Total de Leads</th><th>Matriculados</th><th>Taxa</th></tr></thead>
            <tbody>${resultados.map(r => `
                <tr class="${r.nome === filialAtual ? 'linha-filial-atual' : ''}">
                    <td>${escapeHTML(r.nome)}</td>
                    <td>${r.total.toLocaleString('pt-BR')}</td>
                    <td>${r.matriculados.toLocaleString('pt-BR')}</td>
                    <td><strong>${r.taxa}%</strong></td>
                </tr>
            `).join('')}</tbody>
        </table>
    `;
}

// ==========================================
// GAVETA LATERAL E EDIÇÃO DE DADOS
// ==========================================
function parseTags(tagsData) {
    if (!tagsData) return [];
    if (Array.isArray(tagsData)) return tagsData;
    try {
        const parsed = JSON.parse(tagsData);
        return Array.isArray(parsed) ? parsed : [tagsData];
    } catch (e) { return [String(tagsData).replace(/[\[\]"]/g, '')]; }
}

// Catálogo de tags sugeridas pro time de SDR — um padrão de qualificação
// pra não depender de cada atendente inventar seu próprio texto. Aparecem
// como sugestão (datalist) no formulário de nova tag e também "enriquecem"
// o dropdown de filtro de cada coluna do Kanban desde o primeiro uso, mesmo
// antes de qualquer lead ter sido marcado com elas. Vive na tabela
// tags_sugeridas (compartilhada entre navegadores/time — ver "Gerenciar
// Tags"), não mais fixo no código; carregado uma vez no início.
let TAGS_SUGERIDAS = [];

async function carregarTagsSugeridas() {
    const { data, error } = await window.supabaseClient
        .from('tags_sugeridas')
        .select('tag, familia')
        .order('ordem', { ascending: true });

    if (error) {
        console.warn('Não foi possível carregar tags_sugeridas (rode migracao_tags_sugeridas.sql e migracao_tags_familia.sql se ainda não rodou).', error);
        return;
    }
    TAGS_SUGERIDAS = (data || []).map(row => row.tag);
    mapaFamiliaManual = new Map((data || []).filter(row => row.familia).map(row => [row.tag, row.familia]));
    montarDatalistTagsSugeridas();
}

// "Ativo"/"Inativo" são tags de SISTEMA (geradas pelo importador ao
// cruzar as planilhas) — de propósito NÃO vivem na tabela tags_sugeridas
// (não fazem sentido no catálogo editável em "Gerenciar Tags", nem devem
// poder ser renomeadas por lá, já que o resto do código compara pelo
// texto exato). Mesmo assim, aparecem aqui como sugestão na hora de
// adicionar uma tag manualmente: a importação casa por nome/telefone
// normalizado, então às vezes deixa passar batido alguém que É Ativo ou
// Inativo de verdade — isso dá um jeito rápido de corrigir na mão.
const TAGS_SISTEMA_SUGERIDAS_MANUALMENTE = ['Ativo', 'Inativo'];

function montarDatalistTagsSugeridas() {
    const datalist = document.getElementById('tagsSugeridasList');
    if (!datalist) return;
    const todas = [...TAGS_SISTEMA_SUGERIDAS_MANUALMENTE, ...TAGS_SUGERIDAS];
    datalist.innerHTML = todas.map(t => `<option value="${escapeHTML(t)}"></option>`).join('');
}

// ==========================================
// GERENCIAR TAGS (catálogo compartilhado)
// ==========================================
let tagsSugeridasModalCache = []; // [{id, tag}], carregado ao abrir o modal

async function abrirGerenciarTags() {
    await renderizarListaTagsModal();
    document.getElementById('modalTags').classList.add('open');
    document.getElementById('overlayModalTags').classList.add('active');
}
function fecharGerenciarTags() {
    document.getElementById('modalTags').classList.remove('open');
    document.getElementById('overlayModalTags').classList.remove('active');
    carregarTagsSugeridas(); // repopula o datalist + o array usado nos filtros
}

async function renderizarListaTagsModal() {
    const container = document.getElementById('tagsGerenciarList');
    if (!container) return;
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Carregando...</p>';

    const { data, error } = await window.supabaseClient
        .from('tags_sugeridas')
        .select('id, tag, familia')
        .order('ordem', { ascending: true });

    if (error) {
        container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro ao carregar tags: ${escapeHTML(error.message)}. Rode migracao_tags_sugeridas.sql e migracao_tags_familia.sql se ainda não rodou.</p>`;
        return;
    }

    tagsSugeridasModalCache = data || [];

    // Agrupa pelo que estiver em "familia" (escolhido manualmente); sem
    // familia definida, cai no padrão automático por texto, só pra exibir
    // organizado — assim que a pessoa mexer no <select> da linha, a tag
    // ganha uma família explícita de verdade.
    const grupos = new Map();
    tagsSugeridasModalCache.forEach(row => {
        const label = row.familia || identificarFamiliaTag(row.tag).label;
        if (!grupos.has(label)) grupos.set(label, []);
        grupos.get(label).push(row);
    });
    const ordemLabels = FAMILIAS_TAG.map(f => f.label);
    const labelsOrdenados = Array.from(grupos.keys()).sort((a, b) => ordemLabels.indexOf(a) - ordemLabels.indexOf(b));

    if (tagsSugeridasModalCache.length === 0) {
        container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhuma tag sugerida ainda.</p>';
        return;
    }

    const opcoesFamilia = (selecionada) => FAMILIAS_TAG_CATALOGO.map(f =>
        `<option value="${escapeHTML(f)}" ${f === selecionada ? 'selected' : ''}>${escapeHTML(f)}</option>`
    ).join('');

    container.innerHTML = labelsOrdenados.map(label => `
        <div class="tag-filter-grupo-titulo" style="margin-top:10px;">${escapeHTML(label)}</div>
        ${grupos.get(label).map(row => `
            <div class="coluna-row" draggable="true" ondragstart="iniciarArrastoLista(event, '${row.id}')" ondragend="this.style.opacity='1'" ondragover="event.preventDefault()" ondrop="soltarNaLista(event, 'tags', '${row.id}')">
                <i class="fa-solid fa-grip-vertical" style="color:var(--text-muted); cursor:grab;" title="Arraste pra reordenar"></i>
                <input type="text" value="${escapeHTML(row.tag)}" style="flex:1;" onchange="atualizarNomeTagSugerida(${row.id}, this.value)">
                <select onchange="atualizarFamiliaTagSugerida(${row.id}, this.value)">
                    ${opcoesFamilia(row.familia || identificarFamiliaTag(row.tag).label)}
                </select>
                <button class="icon-btn danger" title="Remover" onclick="removerTagSugerida(${row.id})"><i class="fa-solid fa-trash"></i></button>
            </div>
        `).join('')}
    `).join('');
}
REORDENADORES_LISTA['tags'] = (idOrigem, idDestino) =>
    reordenarESalvarOrdem('tags_sugeridas', tagsSugeridasModalCache, idOrigem, idDestino, renderizarListaTagsModal);

async function atualizarNomeTagSugerida(id, novoNome) {
    novoNome = novoNome.trim();
    if (!novoNome) return;
    const { error } = await window.supabaseClient.from('tags_sugeridas').update({ tag: novoNome }).eq('id', id);
    if (error) { alert('Erro ao renomear tag: ' + error.message); return; }
    renderizarListaTagsModal();
}

async function atualizarFamiliaTagSugerida(id, novaFamilia) {
    const { error } = await window.supabaseClient.from('tags_sugeridas').update({ familia: novaFamilia }).eq('id', id);
    if (error) { alert('Erro ao mover tag: ' + error.message); return; }
    renderizarListaTagsModal();
}

async function adicionarTagSugerida() {
    const inputTexto = document.getElementById('novaTagSugeridaTexto');
    const selectFamilia = document.getElementById('novaTagSugeridaFamilia');
    if (!inputTexto) return;
    const tag = inputTexto.value.trim();
    if (!tag) return;

    const proximaOrdem = tagsSugeridasModalCache.length; // ordem simples, só pra manter uma ordem estável
    const { error } = await window.supabaseClient
        .from('tags_sugeridas')
        .insert({ tag, familia: selectFamilia ? selectFamilia.value : null, ordem: proximaOrdem });

    if (error) { alert('Erro ao adicionar tag: ' + error.message); return; }
    inputTexto.value = '';
    renderizarListaTagsModal();
}

async function removerTagSugerida(id) {
    const { error } = await window.supabaseClient.from('tags_sugeridas').delete().eq('id', id);
    if (error) { alert('Erro ao remover tag: ' + error.message); return; }
    renderizarListaTagsModal();
}

// Fonte única de classificação de tags em família — usada tanto pra
// escolher a cor do badge (classeVisualTag) quanto pra agrupar as tags no
// dropdown de filtro de cada coluna (montarChipsTagsAgrupados), pra não ter
// duas listas de regex que podem ficar dessincronizadas. Reconhece por
// PADRÃO de texto, não só as tags exatas do catálogo (TAGS_SUGERIDAS) —
// então uma tag customizada parecida (ex: "Objeção: Saúde") já cai na
// família certa.
const FAMILIAS_TAG = [
    {
        label: 'Sistema',
        // "Ativo"/"Inativo" são os nomes atuais; "Aluno Ativo"/"Ex-Aluno
        // (Inativo)" são os nomes antigos, ainda presentes em leads que não
        // passaram por uma reimportação desde a troca. "Recuperado" é
        // aplicada pelo importador quando detecta a virada Inativo→Ativo
        // (ver confirmarEnviarImportacao(), js/importador.js) — cor própria
        // pra destacar como uma conquista, não só "está ativo".
        testar: t => t === 'Ativo' || t === 'Aluno Ativo' || t === 'Inativo' || t === 'Ex-Aluno (Inativo)' || t === 'Recuperado' || t === 'Perdido' || /^Lead Forte( [1-3])?$/.test(t),
        classe: t => {
            if (t === 'Ativo' || t === 'Aluno Ativo') return 'tag-ativo';
            if (t === 'Inativo' || t === 'Ex-Aluno (Inativo)') return 'tag-exaluno';
            if (t === 'Recuperado') return 'tag-recuperado';
            if (t === 'Perdido') return 'tag-perdido';
            // Cada grau de Lead Forte tem uma cor/intensidade própria
            // (tag-strong-1 = mais quente/saturado, tag-strong-3 = mais
            // apagado) — .tag-strong sozinha é só o fallback pro formato
            // antigo sem nível.
            const nivel = t.match(/^Lead Forte ([1-3])$/);
            return nivel ? `tag-strong tag-strong-${nivel[1]}` : 'tag-strong';
        },
    },
    // TA (Merlin/Távola, infantil), JN (Janos, adolescentes), PP (1º mês),
    // N1 (nível de entrada, mantido separado) e "Membro" (N2-N7 unificados).
    // N[2-7] direto no regex é só pra CLASSIFICAR tags antigas (de antes do
    // esquema TA/JN/PP/N1/Membro) corretamente até a próxima reimportação —
    // o importador nunca mais GERA esse formato, só N1/Membro.
    { label: 'Nível', testar: t => /^(TA|JN|PP|N[1-7]|Membro)$/i.test(t), classe: () => 'tag-nivel' },
    // "Trilha: X" / "Jornada: X" — geradas pelo importador a partir do
    // histórico de eventos + config de trilhas_tipo_evento (sistema de
    // follow-up). Cor própria pra distinguir de tag customizada comum.
    { label: 'Jornada', testar: t => /^(Trilha|Jornada): /i.test(t), classe: () => 'tag-jornada' },
    { label: 'Cadastro', testar: t => /^Sem (Telefone|E-mail)$/i.test(t), classe: () => 'tag-warning' },
    { label: 'Engajamento / SDR', testar: t => /(n[ãa]o atende|caixa postal|n[ãa]o responde|inv[áa]lido|no-?show)/i.test(t), classe: () => 'tag-error' },
    { label: 'Objeções', testar: t => /^objeç[ãa]o/i.test(t), classe: () => 'tag-warning' },
    { label: 'Interesses / Origem', testar: t => /^(interesse|busca autoconhecimento|s[áa]bado filos[óo]fico|filosofilme|voluntariado|indicaç[ãa]o de aluno)/i.test(t), classe: () => 'tag-success' },
    { label: 'Outras', testar: () => true, classe: () => 'tag-info' }, // sempre por último — pega qualquer coisa que não bateu acima
];

// Grupos que dá pra escolher manualmente pra uma tag do catálogo
// (Sistema/Nível/Cadastro são só automáticas, geradas pelo importador —
// não faz sentido "mover" a tag Ativo pra Objeções, por exemplo).
const FAMILIAS_TAG_CATALOGO = ['Engajamento / SDR', 'Objeções', 'Interesses / Origem', 'Outras'];

// tag (texto exato) -> família escolhida manualmente em "Gerenciar Tags",
// carregado de tags_sugeridas.familia por carregarTagsSugeridas(). Tag sem
// entrada aqui cai no padrão automático por texto (FAMILIAS_TAG).
let mapaFamiliaManual = new Map();

function identificarFamiliaTag(tag) {
    const t = (tag || '').trim();
    const familiaManual = mapaFamiliaManual.get(t);
    if (familiaManual) {
        const encontrada = FAMILIAS_TAG.find(f => f.label === familiaManual);
        if (encontrada) return encontrada;
    }
    return FAMILIAS_TAG.find(f => f.testar(t)) || FAMILIAS_TAG[FAMILIAS_TAG.length - 1];
}

// Classifica a tag pra escolher a cor do badge.
function classeVisualTag(tag) {
    return identificarFamiliaTag(tag).classe((tag || '').trim());
}

function escapeHTML(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Normaliza texto que vem cru da planilha (tudo maiúsculo, tudo minúsculo,
// mistura, às vezes com "_" no lugar de espaço — ex: "Pode_me_contactar")
// pro mesmo padrão de escrita das tags do sistema: Title Case, preposições
// comuns em minúsculo (menos na primeira palavra). Usado no Status da
// gaveta — puramente de exibição, não muda o valor guardado.
const PALAVRAS_MINUSCULAS_TITULO = ['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'a', 'o', 'com', 'pra', 'para'];
function formatarTextoPadrao(texto) {
    const t = String(texto || '').trim();
    if (!t) return '';
    return t.toLowerCase().replace(/_/g, ' ').split(/\s+/).map((palavra, i) => {
        if (i > 0 && PALAVRAS_MINUSCULAS_TITULO.includes(palavra)) return palavra;
        return palavra.charAt(0).toUpperCase() + palavra.slice(1);
    }).join(' ');
}

// Só o primeiro nome, formatado (nem tudo maiúsculo, nem tudo minúsculo)
// — o nome do lead às vezes chega em CAIXA ALTA das planilhas (Ativos/
// Inativos/Ulisses/Mercúrio). Usado em convites de WhatsApp e no
// preenchimento automático de templates — é só exibição, nunca muda o
// valor guardado no banco.
function primeiroNomeFormatado(nomeCompleto) {
    const primeiro = String(nomeCompleto || '').trim().split(/\s+/)[0] || '';
    if (!primeiro) return '';
    return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

// Gavetas colapsáveis da ficha do lead (Eventos/Como Abordar/Resumo/
// Lembrete/Tags/Contato/Histórico). Estado É por abertura de gaveta, não
// persiste entre leads — cada abrirGaveta() recalcula os padrões do zero:
// tudo fechado, exceto Contato, que abre sozinho quando falta telefone ou
// e-mail (pra chamar atenção pra um cadastro incompleto sem precisar clicar).
const SECOES_GAVETA_LEAD = ['eventos', 'abordagem', 'resumo', 'lembrete', 'tags', 'contato', 'vinculo', 'historico'];
let gavetaLeadAberta = {};

function aplicarEstadoGavetasLead() {
    SECOES_GAVETA_LEAD.forEach(secao => {
        const body = document.getElementById(`drawer-gaveta-body-${secao}`);
        const seta = document.getElementById(`drawer-gaveta-seta-${secao}`);
        if (!body) return;
        const aberta = !!gavetaLeadAberta[secao];
        body.style.display = aberta ? 'block' : 'none';
        if (seta) {
            seta.classList.toggle('fa-chevron-down', aberta);
            seta.classList.toggle('fa-chevron-right', !aberta);
        }
    });
}

function toggleGavetaLead(secao) {
    gavetaLeadAberta[secao] = !gavetaLeadAberta[secao];
    aplicarEstadoGavetasLead();
}

function abrirGaveta(id) {
    currentLeadId = id;
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(id));
    if (!lead) return;

    const temTelefone = !!(lead.pessoaTelefoneDDD && String(lead.pessoaTelefoneDDD).trim()) && !!(lead.pessoaTelefoneNumero && String(lead.pessoaTelefoneNumero).trim());
    const temEmail = !!(lead.pessoaEmail && String(lead.pessoaEmail).trim());
    gavetaLeadAberta = {
        eventos: false,
        abordagem: false,
        resumo: false,
        lembrete: false,
        tags: false,
        contato: !temTelefone || !temEmail,
        vinculo: false,
        historico: false,
    };

    document.getElementById('drawer-name').innerText = lead.pessoaNome;
    document.getElementById('drawer-subtitle').innerText = `Matrícula/ID: ${lead.pessoaIdentificador} | ${lead.pessoaEmail || 'Sem e-mail'}`;
    document.getElementById('drawer-chat-header').innerText = `${lead.pessoaNome} (${lead.pessoaTelefoneDDD || ''} ${lead.pessoaTelefoneNumero || ''})`;

    document.getElementById('drawer-tel-ddd').value = lead.pessoaTelefoneDDD || '';
    document.getElementById('drawer-tel-numero').value = lead.pessoaTelefoneNumero || '';
    document.getElementById('drawer-email').value = lead.pessoaEmail || '';
    document.getElementById('drawer-data-nascimento').value = lead.data_nascimento || '';

    document.getElementById('drawer-lembrete-data').value = lead.lembrete_em || '';
    document.getElementById('drawer-lembrete-nota').value = lead.lembrete_nota || '';
    document.getElementById('drawer-lembrete-limpar').style.display = lead.lembrete_em ? 'inline-flex' : 'none';

    const eventos = (lead.eventoNome || "Sem registro").split(' | ');
    const datas = (lead.eventoData || "").split(' | ');
    let historyHTML = '';
    for (let i = 0; i < eventos.length; i++) {
        if (eventos[i].trim() !== "") historyHTML += `<li><strong>${escapeHTML(eventos[i])}</strong> <br><span style="color:#94a3b8">${escapeHTML(datas[i] || '')}</span></li>`;
    }
    document.getElementById('drawer-history').innerHTML = historyHTML;

    const blocoStatus = document.getElementById('drawer-status-bloco');
    if (blocoStatus) {
        const temStatus = lead.pessoaStatus && String(lead.pessoaStatus).trim() !== '';
        if (temStatus) {
            document.getElementById('drawer-status').innerText = formatarTextoPadrao(lead.pessoaStatus);
            blocoStatus.style.display = 'block';
        } else {
            blocoStatus.style.display = 'none';
        }
    }

    const blocoMotivo = document.getElementById('drawer-motivo-bloco');
    if (blocoMotivo) {
        // Mostra o bloco pra qualquer Inativo, mesmo sem motivo/data
        // registrados na planilha — nesse caso mostra "Não informado" em
        // vez de esconder o bloco inteiro (diferente de "sem dado" silencioso).
        const tagsLead = parseTags(lead.tags).map(t => t.trim());
        const ehInativo = tagsLead.includes('Inativo') || tagsLead.includes('Ex-Aluno (Inativo)');
        if (ehInativo) {
            const temMotivo = lead.motivo_saida && String(lead.motivo_saida).trim() !== '';
            const temDataSaida = lead.data_saida && String(lead.data_saida).trim() !== '';
            document.getElementById('drawer-motivo-saida').innerText = temMotivo ? lead.motivo_saida : 'Não informado';
            document.getElementById('drawer-data-saida').innerText = temDataSaida ? lead.data_saida : 'Não informada';
            blocoMotivo.style.display = 'block';
        } else {
            blocoMotivo.style.display = 'none';
        }
    }

    // Motivo da Perda: só pra quem foi movido pra uma coluna "Perdido"/
    // "Lixeira" (registrarMotivoPerda() acima) — mesmo padrão de exibição
    // do bloco "Saída (Inativo)" logo acima.
    const blocoPerda = document.getElementById('drawer-perda-bloco');
    if (blocoPerda) {
        const ehPerdido = parseTags(lead.tags).map(t => t.trim()).includes('Perdido');
        if (ehPerdido) {
            const temMotivoPerda = lead.motivo_perda && String(lead.motivo_perda).trim() !== '';
            const temDataPerda = lead.data_perda && String(lead.data_perda).trim() !== '';
            document.getElementById('drawer-motivo-perda').innerText = temMotivoPerda ? lead.motivo_perda : 'Não informado';
            document.getElementById('drawer-data-perda').innerText = temDataPerda ? lead.data_perda : 'Não informada';
            blocoPerda.style.display = 'block';
        } else {
            blocoPerda.style.display = 'none';
        }
    }

    renderAISummary();
    renderAbordagemSugerida();
    renderDrawerTags();
    aplicarEstadoGavetasLead();
    carregarVinculoFamiliar(id);
    if (typeof carregarEventosDoLead === 'function') carregarEventosDoLead(id);
    if (typeof chatDrawer !== 'undefined') chatDrawer.abrir(id);
    document.getElementById('leadDrawer').classList.add('open');
    document.getElementById('overlay').classList.add('active');
}
function fecharGaveta() {
    currentLeadId = null;
    limparDestaqueCard();
    if (typeof fecharFormConvidarEventoNaGaveta === 'function') fecharFormConvidarEventoNaGaveta();
    if (typeof chatDrawer !== 'undefined') chatDrawer.fechar();
    document.getElementById('leadDrawer').classList.remove('open');
    document.getElementById('overlay').classList.remove('active');
}

// ==========================================
// RADAR DE ACOMPANHANTES (vínculo familiar)
// ==========================================
// Grupo de N pessoas (cônjuge, amigos, quem veio junto) — implementado com
// UMA coluna em leads_inscricoes (grupo_familiar_id, uuid,
// migracao_vinculo_familiar.sql) em vez de tabela própria: todo lead com o
// MESMO valor faz parte do mesmo grupo, mesmo padrão já usado por
// eventos.grupo_evento_id (eventos multi-filial). Um lead pertence a NO
// MÁXIMO 1 grupo por vez. Objetivo: quando o SDR percebe que dois leads se
// conhecem, vincula os dois — a partir daí, abrir a ficha de qualquer um
// mostra os outros do grupo, pra abordagem e retenção em conjunto
// (conversão e permanência aumentam quando as pessoas estudam
// acompanhadas).
async function carregarVinculoFamiliar(id) {
    const container = document.getElementById('drawer-vinculo-lista');
    if (!container) return;
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(id));
    if (!lead || !lead.grupo_familiar_id) {
        container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhum vínculo ainda.</p>';
        return;
    }

    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando...</p>';
    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero')
        .eq('grupo_familiar_id', lead.grupo_familiar_id)
        .neq('pessoaIdentificador', id);

    if (error) { container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro ao carregar vínculo: ${escapeHTML(error.message)}</p>`; return; }

    if (!data || data.length === 0) {
        container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhum vínculo ainda.</p>';
        return;
    }

    container.innerHTML = data.map(m => `
        <div class="info-box" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="cursor:pointer;" onclick="abrirResultadoBuscaGlobal('${m.pessoaIdentificador}')"><i class="fa-solid fa-user"></i> ${escapeHTML(m.pessoaNome)} <span style="color:var(--text-muted); font-size:11px;">(${escapeHTML(m.pessoaTelefoneDDD || '')} ${escapeHTML(m.pessoaTelefoneNumero || 'sem tel.')})</span></span>
            <button class="icon-btn danger" title="Remover do vínculo" onclick="removerDoGrupoFamiliar('${m.pessoaIdentificador}')"><i class="fa-solid fa-link-slash"></i></button>
        </div>
    `).join('');
}

function abrirBuscaVinculoFamiliar() {
    gavetaLeadAberta.vinculo = true;
    aplicarEstadoGavetasLead();
    const form = document.getElementById('drawer-vinculo-busca-form');
    const input = document.getElementById('drawer-vinculo-busca-input');
    const resultados = document.getElementById('drawer-vinculo-busca-resultados');
    if (form) form.style.display = 'flex';
    if (input) { input.value = ''; input.focus(); }
    if (resultados) resultados.innerHTML = '';
}
function fecharBuscaVinculoFamiliar() {
    const form = document.getElementById('drawer-vinculo-busca-form');
    if (form) form.style.display = 'none';
}

let debounceVinculoFamiliar = null;
function buscarLeadParaVinculoFamiliar() {
    clearTimeout(debounceVinculoFamiliar);
    debounceVinculoFamiliar = setTimeout(async () => {
        const input = document.getElementById('drawer-vinculo-busca-input');
        const resultados = document.getElementById('drawer-vinculo-busca-resultados');
        if (!input || !resultados) return;
        const termo = input.value.trim();
        if (termo.length < 2) { resultados.innerHTML = ''; return; }

        const termoSeguro = termo.replace(/,/g, ' '); // escapa vírgula (separador do .or() do PostgREST)
        const { data, error } = await window.supabaseClient
            .from(NOME_TABELA)
            .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero')
            .eq('filial', filialAtual)
            .neq('pessoaIdentificador', currentLeadId)
            .or(`pessoaNome.ilike.%${termoSeguro}%,pessoaTelefoneNumero.ilike.%${termoSeguro}%`)
            .limit(10);

        if (error) { resultados.innerHTML = `<p style="font-size:11px; color:#dc2626;">Erro: ${escapeHTML(error.message)}</p>`; return; }
        if (!data || data.length === 0) { resultados.innerHTML = '<p style="font-size:11px; color:var(--text-muted);">Nenhum lead encontrado.</p>'; return; }

        resultados.innerHTML = data.map(r => `
            <div class="info-box" style="cursor:pointer; margin-bottom:4px;" onclick="vincularLeadFamiliar('${r.pessoaIdentificador}')">
                <i class="fa-solid fa-user-plus"></i> ${escapeHTML(r.pessoaNome)} <span style="color:var(--text-muted); font-size:11px;">(${escapeHTML(r.pessoaTelefoneDDD || '')} ${escapeHTML(r.pessoaTelefoneNumero || 'sem tel.')})</span>
            </div>
        `).join('');
    }, 300);
}

async function vincularLeadFamiliar(idAlvo) {
    const leadAtual = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(currentLeadId));
    if (!leadAtual) return;

    const { data: alvo, error: erroAlvo } = await window.supabaseClient
        .from(NOME_TABELA).select('grupo_familiar_id, pessoaNome').eq('pessoaIdentificador', idAlvo).single();
    if (erroAlvo) { alert('Erro ao buscar lead: ' + erroAlvo.message); return; }

    let grupoId = leadAtual.grupo_familiar_id;
    if (alvo.grupo_familiar_id && alvo.grupo_familiar_id !== leadAtual.grupo_familiar_id) {
        if (leadAtual.grupo_familiar_id) {
            // os dois já têm grupos DIFERENTES — fundir os dois grupos inteiros
            // não é trivial (pode ter várias pessoas de cada lado); o grupo do
            // lead que está com a ficha aberta "vence", e só essa pessoa entra.
            if (!confirm(`"${alvo.pessoaNome}" já faz parte de outro vínculo familiar. Mover essa pessoa para o vínculo deste lead?`)) return;
        } else {
            grupoId = alvo.grupo_familiar_id; // o lead atual entra no grupo já existente do alvo
        }
    }
    if (!grupoId) grupoId = crypto.randomUUID(); // nenhum dos dois tinha grupo ainda

    const { error } = await window.supabaseClient
        .from(NOME_TABELA).update({ grupo_familiar_id: grupoId }).in('pessoaIdentificador', [String(currentLeadId), String(idAlvo)]);
    if (error) { alert('Erro ao vincular: ' + error.message); return; }

    leadAtual.grupo_familiar_id = grupoId;
    fecharBuscaVinculoFamiliar();
    carregarVinculoFamiliar(currentLeadId);
}

async function removerDoGrupoFamiliar(idMembro) {
    if (!confirm('Remover essa pessoa do vínculo familiar?')) return;
    const { error } = await window.supabaseClient
        .from(NOME_TABELA).update({ grupo_familiar_id: null }).eq('pessoaIdentificador', idMembro);
    if (error) { alert('Erro ao remover: ' + error.message); return; }

    const membro = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(idMembro));
    if (membro) membro.grupo_familiar_id = null;
    carregarVinculoFamiliar(currentLeadId);
}

function renderAISummary() {
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(currentLeadId));
    document.getElementById('drawer-ai-summary').innerHTML = lead.resumo_ia || "Nenhum resumo adicionado.";
}
function editarResumoIA() {
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(currentLeadId));
    document.getElementById('drawer-ai-summary').innerHTML = `
        <textarea id="ai-summary-input" style="width: 100%; height: 80px; padding: 8px; border: 1px solid #8b5cf6; border-radius: 6px; font-size: 11px; outline: none; font-family: inherit;">${lead.resumo_ia || ""}</textarea>
        <div style="text-align: right; margin-top: 8px;">
            <button style="background: #8b5cf6; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 10px; cursor: pointer; font-weight: 600;" onclick="salvarResumoIA()">
                <i class="fa-solid fa-floppy-disk"></i> Salvar no Banco
            </button>
        </div>
    `;
    gavetaLeadAberta.resumo = true;
    aplicarEstadoGavetasLead();
}
async function salvarResumoIA() {
    const newText = document.getElementById('ai-summary-input').value;
    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(currentLeadId));
    leadsAtuais[leadIndex].resumo_ia = newText;
    renderAISummary();

    await window.supabaseClient
        .from(NOME_TABELA)
        .update({ resumo_ia: newText })
        .eq('pessoaIdentificador', currentLeadId);
}

// "Enviar pro Chefe" — pedido explícito do time de SDR: avisar o
// chefe de filial/professor responsável sobre um lead específico que
// merece mais atenção, mandando o Resumo da Conversa (IA) já escrito
// (de propósito NÃO gera nada novo por IA aqui — "de forma simples",
// só reaproveita o texto que já existe no campo). Passa pela mesma
// Edge Function usada pelo aviso de aniversário (whatsapp-notificar-
// chefe-filial) — o número do chefe nunca é exposto ao navegador, só
// resolvido no servidor a partir da filial.
async function enviarResumoParaChefeFilial() {
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(currentLeadId));
    if (!lead) return;
    const resumo = (lead.resumo_ia || '').trim();
    if (!resumo) { alert('Este lead ainda não tem um Resumo da Conversa (IA) preenchido — escreva algo em "Editar" antes de enviar.'); return; }
    if (!confirm(`Enviar o resumo de "${lead.pessoaNome}" pro WhatsApp do chefe da filial "${lead.filial}"?`)) return;

    const nomeAtendente = typeof obterNomeAtendente === 'function' ? obterNomeAtendente() : '';
    const texto = `📋 *Resumo de acompanhamento* — ${lead.pessoaNome}\n${nomeAtendente ? `Enviado por: ${nomeAtendente}\n` : ''}\n${resumo}`;

    const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-notificar-chefe-filial', {
        body: { filial: lead.filial, texto }
    });

    if (error || (data && data.ok === false)) {
        const motivo = (data && data.erro === 'chefe_sem_numero')
            ? 'Essa filial ainda não tem o WhatsApp do chefe cadastrado (botão de engrenagem > Gerenciar Filiais).'
            : ((data && data.detalhe && data.detalhe.message) || (error && error.message) || 'erro desconhecido');
        alert('Não consegui enviar: ' + motivo);
        return;
    }
    alert('Resumo enviado pro chefe da filial!');
}

// "Como Abordar" — mesmo padrão de edição do Resumo da Conversa (IA) acima,
// mas guardado num campo próprio (abordagem_sugerida), já que são sugestões
// de natureza diferente (uma é orientação de abordagem, a outra é resumo do
// que já foi conversado). Antes era um texto fixo no HTML, sem persistir
// no banco — agora é editável por lead, igual o Resumo.
function renderAbordagemSugerida() {
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(currentLeadId));
    const box = document.getElementById('drawer-approach');
    if (!lead || !box) return;
    box.innerHTML = lead.abordagem_sugerida
        ? escapeHTML(lead.abordagem_sugerida).replace(/\n/g, '<br>')
        : '<span style="color:var(--text-muted);">Nenhuma sugestão registrada ainda — clique em "Editar" pra adicionar.</span>';
}
function editarAbordagemSugerida() {
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(currentLeadId));
    document.getElementById('drawer-approach').innerHTML = `
        <textarea id="abordagem-input" style="width: 100%; height: 70px; padding: 8px; border: 1px solid var(--na-gold); border-radius: 6px; font-size: 11px; outline: none; font-family: inherit;">${lead.abordagem_sugerida || ""}</textarea>
        <div style="text-align: right; margin-top: 8px;">
            <button style="background: var(--na-gold); color: #78350f; border: none; padding: 6px 12px; border-radius: 4px; font-size: 10px; cursor: pointer; font-weight: 600;" onclick="salvarAbordagemSugerida()">
                <i class="fa-solid fa-floppy-disk"></i> Salvar no Banco
            </button>
        </div>
    `;
    gavetaLeadAberta.abordagem = true;
    aplicarEstadoGavetasLead();
}
async function salvarAbordagemSugerida() {
    const newText = document.getElementById('abordagem-input').value;
    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(currentLeadId));
    leadsAtuais[leadIndex].abordagem_sugerida = newText;
    renderAbordagemSugerida();

    await window.supabaseClient
        .from(NOME_TABELA)
        .update({ abordagem_sugerida: newText })
        .eq('pessoaIdentificador', currentLeadId);
}

// Telefone e e-mail editáveis direto na gaveta — salva a cada onchange
// (sai do campo ou aperta Enter), sem precisar de um botão "Editar"
// separado. Mantém as tags "Sem Telefone"/"Sem E-mail" (geradas na
// importação) sincronizadas com a realidade na hora, sem esperar a
// próxima importação.
async function salvarTelefoneLead() {
    const ddd = document.getElementById('drawer-tel-ddd').value.trim();
    const numero = document.getElementById('drawer-tel-numero').value.trim();

    // Validação de formato — só quando o campo tem algo preenchido; campo
    // vazio continua válido (é o estado normal de "sem telefone").
    if (ddd && !/^\d{2}$/.test(ddd)) {
        alert('DDD parece inválido — precisa ter exatamente 2 dígitos numéricos.');
        return;
    }
    if (numero && !/^\d{8,9}$/.test(numero.replace(/\D/g, ''))) {
        alert('Telefone parece inválido — precisa ter 8 ou 9 dígitos numéricos.');
        return;
    }

    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(currentLeadId));
    if (leadIndex === -1) return;

    leadsAtuais[leadIndex].pessoaTelefoneDDD = ddd;
    leadsAtuais[leadIndex].pessoaTelefoneNumero = numero;

    let tagsArray = parseTags(leadsAtuais[leadIndex].tags);
    const temTagSemTelefone = tagsArray.some(t => t.trim() === 'Sem Telefone');
    if (numero && temTagSemTelefone) tagsArray = tagsArray.filter(t => t.trim() !== 'Sem Telefone');
    else if (!numero && !temTagSemTelefone) tagsArray = [...tagsArray, 'Sem Telefone'];
    leadsAtuais[leadIndex].tags = JSON.stringify(tagsArray);
    renderDrawerTags();

    document.getElementById('drawer-chat-header').innerText = `${leadsAtuais[leadIndex].pessoaNome} (${ddd} ${numero})`;
    renderizarCards();

    const { error } = await window.supabaseClient
        .from(NOME_TABELA)
        .update({ pessoaTelefoneDDD: ddd, pessoaTelefoneNumero: numero, tags: leadsAtuais[leadIndex].tags })
        .eq('pessoaIdentificador', currentLeadId);

    if (error) alert('Erro ao salvar telefone: ' + error.message);
}

// Descoberto numa conversa (ex: WhatsApp devolveu erro, número não existe
// mais) — diferente de simplesmente apagar o campo, marca a tag "Telefone
// Inválido" pra ficar registrado O PORQUÊ do campo estar vazio (não é só
// "nunca tivemos esse dado"). Reaproveita salvarTelefoneLead() pra não
// duplicar a lógica de sincronizar a tag "Sem Telefone" e persistir.
async function marcarTelefoneInvalido() {
    const numeroAtual = document.getElementById('drawer-tel-numero').value.trim();
    if (!numeroAtual) { alert('Não há telefone cadastrado pra marcar como inválido.'); return; }
    if (!confirm('Marcar telefone como inválido? O número atual será removido do cadastro (fica registrada a tag "Telefone Inválido" pra explicar por quê).')) return;

    document.getElementById('drawer-tel-ddd').value = '';
    document.getElementById('drawer-tel-numero').value = '';

    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(currentLeadId));
    if (leadIndex === -1) return;
    let tagsArray = parseTags(leadsAtuais[leadIndex].tags).map(t => t.trim()).filter(Boolean);
    if (!tagsArray.includes('Telefone Inválido')) tagsArray.push('Telefone Inválido');
    leadsAtuais[leadIndex].tags = JSON.stringify(tagsArray);

    await salvarTelefoneLead();
}

// Provedores de e-mail comuns (bem prováveis de estarem certos) — usados
// como referência pra detectar erro de digitação no domínio, tipo
// "gmial.com" em vez de "gmail.com". Não é uma lista de provedores
// "permitidos" (qualquer domínio passa), é só o dicionário de comparação.
const DOMINIOS_EMAIL_COMUNS = [
    'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.br',
    'icloud.com', 'live.com', 'bol.com.br', 'uol.com.br', 'terra.com.br',
    'globo.com', 'globomail.com', 'ig.com.br', 'msn.com', 'r7.com'
];

function distanciaLevenshtein(a, b) {
    const linhas = a.length + 1, colunas = b.length + 1;
    const d = Array.from({ length: linhas }, () => new Array(colunas).fill(0));
    for (let i = 0; i < linhas; i++) d[i][0] = i;
    for (let j = 0; j < colunas; j++) d[0][j] = j;
    for (let i = 1; i < linhas; i++) {
        for (let j = 1; j < colunas; j++) {
            const custo = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + custo);
        }
    }
    return d[a.length][b.length];
}

// Compara o domínio do e-mail com a lista de provedores comuns — se estiver
// a 1-2 caracteres de distância de um deles (mas não idêntico), é bem
// provável que seja erro de digitação ("gmial.com", "hotmial.com" etc.),
// então sugere a correção. Domínio curto demais (<5 caracteres) não entra
// nessa checagem, pra não arriscar "corrigir" um domínio corporativo
// pequeno de verdade que só coincide de estar perto de um provedor comum.
function sugerirCorrecaoEmail(email) {
    const em = String(email || '').trim();
    const arroba = em.lastIndexOf('@');
    if (arroba === -1) return null;
    const dominio = em.slice(arroba + 1).toLowerCase();
    if (!dominio || dominio.length < 5 || DOMINIOS_EMAIL_COMUNS.includes(dominio)) return null;

    let maisProximo = null;
    let menorDistancia = Infinity;
    DOMINIOS_EMAIL_COMUNS.forEach(candidato => {
        const dist = distanciaLevenshtein(dominio, candidato);
        if (dist < menorDistancia) { menorDistancia = dist; maisProximo = candidato; }
    });

    if (maisProximo && menorDistancia > 0 && menorDistancia <= 2) {
        return em.slice(0, arroba + 1) + maisProximo;
    }
    return null;
}

async function salvarEmailLead() {
    const inputEmail = document.getElementById('drawer-email');
    let email = inputEmail.value.trim();
    if (email && !email.includes('@')) {
        alert('E-mail parece inválido — confira antes de salvar.');
        return;
    }

    // Provedor com erro de digitação (ex: "gmial.com") — avisa e já corrige
    // antes de salvar, em vez de deixar o dado errado ir pro banco.
    const correcao = email ? sugerirCorrecaoEmail(email) : null;
    if (correcao) {
        alert(`O provedor de e-mail parece estar digitado errado ("${email}") — vou corrigir automaticamente para "${correcao}".`);
        email = correcao;
        inputEmail.value = correcao;
    }

    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(currentLeadId));
    if (leadIndex === -1) return;

    leadsAtuais[leadIndex].pessoaEmail = email;

    let tagsArray = parseTags(leadsAtuais[leadIndex].tags);
    const temTagSemEmail = tagsArray.some(t => t.trim() === 'Sem E-mail');
    if (email && temTagSemEmail) tagsArray = tagsArray.filter(t => t.trim() !== 'Sem E-mail');
    else if (!email && !temTagSemEmail) tagsArray = [...tagsArray, 'Sem E-mail'];
    leadsAtuais[leadIndex].tags = JSON.stringify(tagsArray);
    renderDrawerTags();

    document.getElementById('drawer-subtitle').innerText = `Matrícula/ID: ${currentLeadId} | ${email || 'Sem e-mail'}`;
    renderizarCards();

    const { error } = await window.supabaseClient
        .from(NOME_TABELA)
        .update({ pessoaEmail: email, tags: leadsAtuais[leadIndex].tags })
        .eq('pessoaIdentificador', currentLeadId);

    if (error) alert('Erro ao salvar e-mail: ' + error.message);
}

// Data de Nascimento — nenhuma das 3 planilhas traz esse dado hoje, então
// é preenchida manualmente aqui; alimenta o card "Aniversariantes do Mês"
// no Dashboard (migracao_data_nascimento.sql).
async function salvarDataNascimentoLead() {
    const input = document.getElementById('drawer-data-nascimento');
    const dataNascimento = input.value || null;

    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(currentLeadId));
    if (leadIndex !== -1) leadsAtuais[leadIndex].data_nascimento = dataNascimento;

    const { error } = await window.supabaseClient
        .from(NOME_TABELA)
        .update({ data_nascimento: dataNascimento })
        .eq('pessoaIdentificador', currentLeadId);

    if (error) alert('Erro ao salvar data de nascimento: ' + error.message);
}

// Mesma ideia de marcarTelefoneInvalido() acima, pro e-mail.
async function marcarEmailInvalido() {
    const emailAtual = document.getElementById('drawer-email').value.trim();
    if (!emailAtual) { alert('Não há e-mail cadastrado pra marcar como inválido.'); return; }
    if (!confirm('Marcar e-mail como inválido? O e-mail atual será removido do cadastro (fica registrada a tag "E-mail Inválido" pra explicar por quê).')) return;

    document.getElementById('drawer-email').value = '';

    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(currentLeadId));
    if (leadIndex === -1) return;
    let tagsArray = parseTags(leadsAtuais[leadIndex].tags).map(t => t.trim()).filter(Boolean);
    if (!tagsArray.includes('E-mail Inválido')) tagsArray.push('E-mail Inválido');
    leadsAtuais[leadIndex].tags = JSON.stringify(tagsArray);

    await salvarEmailLead();
}

// ==========================================
// LEMBRETE DE FOLLOW-UP (snooze) — 1 lembrete ativo por lead
// ==========================================
// Sem tabela separada de propósito: é um único lembrete por lead, não um
// histórico. Se no futuro for preciso guardar vários lembretes por lead,
// aí sim vale migrar pra uma tabela própria (ver migracao_lembrete_lead.sql).
async function salvarLembreteLead() {
    const dataInput = document.getElementById('drawer-lembrete-data');
    const notaInput = document.getElementById('drawer-lembrete-nota');
    const data = dataInput.value || null;
    const nota = notaInput.value.trim() || null;

    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(currentLeadId));
    if (leadIndex === -1) return;

    leadsAtuais[leadIndex].lembrete_em = data;
    leadsAtuais[leadIndex].lembrete_nota = nota;
    document.getElementById('drawer-lembrete-limpar').style.display = data ? 'inline-flex' : 'none';
    renderizarCards();

    const { error } = await window.supabaseClient
        .from(NOME_TABELA)
        .update({ lembrete_em: data, lembrete_nota: nota })
        .eq('pessoaIdentificador', currentLeadId);

    if (error) {
        console.warn('Não foi possível salvar o lembrete — rode migracao_lembrete_lead.sql se ainda não rodou.', error);
        alert('Erro ao salvar lembrete: ' + error.message);
    }
}

function limparLembreteLead() {
    document.getElementById('drawer-lembrete-data').value = '';
    document.getElementById('drawer-lembrete-nota').value = '';
    salvarLembreteLead();
}

function renderDrawerTags() {
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(currentLeadId));
    const tags = parseTags(lead.tags);
    const container = document.getElementById('drawer-tags');
    container.innerHTML = "";
    tags.forEach((t, index) => {
        const tagLimpa = t.trim();
        if (tagLimpa !== "") {
            container.innerHTML += `<span class="tag ${classeVisualTag(tagLimpa)}" style="font-size: 11px; padding: 6px 10px;">${escapeHTML(tagLimpa)} <i class="fa-solid fa-xmark tag-remove" onclick="removerTag(${index})" title="Remover Tag"></i></span>`;
        }
    });
}
// Em vez de um prompt() cego, mostra um mini-formulário com autocomplete
// (datalist) alimentado por TAGS_SUGERIDAS — o time digita livre ou escolhe
// uma das sugestões, sem perder a padronização.
function abrirFormNovaTag() {
    const form = document.getElementById('drawer-tag-form');
    const input = document.getElementById('drawer-tag-input');
    if (!form || !input) return;
    gavetaLeadAberta.tags = true;
    aplicarEstadoGavetasLead();
    form.style.display = 'block';
    input.value = '';
    input.focus();
}
function fecharFormNovaTag() {
    const form = document.getElementById('drawer-tag-form');
    if (form) form.style.display = 'none';
}
async function confirmarNovaTag() {
    const input = document.getElementById('drawer-tag-input');
    if (!input) return;
    const novaTagText = input.value.trim();
    if (!novaTagText) return;

    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(currentLeadId));
    let tagsArray = parseTags(leadsAtuais[leadIndex].tags).map(t => t.trim()).filter(Boolean);

    if (tagsArray.includes(novaTagText)) {
        alert('Esse lead já tem essa tag.');
        fecharFormNovaTag();
        return;
    }

    // "Ativo" e "Inativo" são mutuamente exclusivos — um lead não pode ser
    // aluno ativo e ex-aluno ao mesmo tempo. Adicionar um manualmente
    // (corrigindo um caso que a importação não pegou) remove o outro,
    // inclusive os nomes antigos ("Aluno Ativo"/"Ex-Aluno (Inativo)").
    if (novaTagText === 'Ativo') {
        tagsArray = tagsArray.filter(t => t !== 'Inativo' && t !== 'Ex-Aluno (Inativo)');
    } else if (novaTagText === 'Inativo') {
        tagsArray = tagsArray.filter(t => t !== 'Ativo' && t !== 'Aluno Ativo');
    }

    tagsArray.push(novaTagText);
    leadsAtuais[leadIndex].tags = JSON.stringify(tagsArray);
    fecharFormNovaTag();
    renderDrawerTags();
    renderizarCards(); // atualiza badge do card + opções de filtro na hora

    await window.supabaseClient
        .from(NOME_TABELA)
        .update({ tags: JSON.stringify(tagsArray) })
        .eq('pessoaIdentificador', currentLeadId);
}

// Refresca o Kanban de tempos em tempos só pra atualizar a borda de SLA
// vencido (SLA_HORAS_COLUNA_FRIA) mesmo com o quadro parado, sem precisar
// de nenhuma interação (mover lead, trocar de aba...) que já disparasse
// renderizarCards() de qualquer jeito.
setInterval(() => {
    if (typeof leadsAtuais !== 'undefined' && leadsAtuais.length > 0) renderizarCards();
}, 3 * 60 * 1000);

async function removerTag(index) {
    const leadIndex = leadsAtuais.findIndex(l => String(l.pessoaIdentificador) === String(currentLeadId));
    let tagsArray = parseTags(leadsAtuais[leadIndex].tags);

    tagsArray.splice(index, 1);
    leadsAtuais[leadIndex].tags = JSON.stringify(tagsArray);
    renderDrawerTags();
    renderizarCards(); // atualiza badge do card + opções de filtro na hora

    await window.supabaseClient
        .from(NOME_TABELA)
        .update({ tags: JSON.stringify(tagsArray) })
        .eq('pessoaIdentificador', currentLeadId);
}

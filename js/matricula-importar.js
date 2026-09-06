// ==========================================================
// IMPORTAR MATRÍCULA (TEXTO COLADO) — botão "Importar Matrícula" na coluna
// de Matriculados do Kanban. Fluxo: cola o texto copiado (Ctrl+C) — tanto
// da tela "Aluno => Matricular" quanto da tela de Turma completa (desde
// "ALTERAR INFORMAÇÕES DE TURMAS", que também traz Turma/Dia/Horário) —
// parseTextoMatricula() lê as linhas de aluno (Matr., Nome, Fone, Ingresso)
// por regex, sem IA, sem custo nenhum. O frontend casa cada linha com um
// lead já existente na filial (telefone > nome > manual) e, ao confirmar,
// atualiza telefone, tags de turma/dia (se veio de uma tela de Turma),
// grava data_matricula, e move o lead pra Matriculados OU Ativos (ver
// ehMatriculaRecente() abaixo).
//
// Depende de funções já carregadas antes deste arquivo: NOME_TABELA,
// filialAtual, leadsAtuais, escapeHTML(), parseDataBR(), formatarTextoPadrao(),
// getColumnKeys() (app.js), normalizarTelefoneParaChave(), normalizarNomeImport()
// (importador.js).
//
// Duplicidade entre textos colados de dias diferentes é resolvida por
// matricula_mercurio (coluna "Matr." do Mercúrio, gravada em
// leads_inscricoes — migracao_matricula_mercurio.sql): se um lead na
// filial já tem esse número, a linha é ignorada automaticamente.

let linhasRevisaoMatricula = []; // linhas lidas do texto + resultado do casamento
let leadsMatriculaCache = []; // todos os leads da filial, carregados 1x por importação
let matriculadosKeyMatricula = null; // chave da coluna de destino (a que tinha o botão)
let metadadosTurmaAtual = null; // {turma, dia, horario} — só existe se o texto colado veio da tela de Turma

// ==========================================
// ABRIR / FECHAR
// ==========================================
function abrirImportarMatricula(colKey) {
    matriculadosKeyMatricula = colKey;
    linhasRevisaoMatricula = [];
    leadsMatriculaCache = [];
    metadadosTurmaAtual = null;

    document.getElementById('matriculaImportarEtapaTexto').style.display = 'block';
    document.getElementById('matriculaImportarEtapaRevisao').style.display = 'none';
    document.getElementById('matriculaImportarStatus').innerHTML = '';
    document.getElementById('matriculaImportarBtnProcessar').style.display = 'inline-flex';
    document.getElementById('matriculaImportarBtnProcessar').disabled = true;
    document.getElementById('matriculaImportarBtnConfirmar').style.display = 'none';
    document.getElementById('matriculaImportarTexto').value = '';

    document.getElementById('modalImportarMatricula').classList.add('open');
    document.getElementById('overlayModalImportarMatricula').classList.add('active');
}

function fecharImportarMatricula() {
    document.getElementById('modalImportarMatricula').classList.remove('open');
    document.getElementById('overlayModalImportarMatricula').classList.remove('active');
}

function atualizarBotaoProcessarMatricula() {
    const btn = document.getElementById('matriculaImportarBtnProcessar');
    if (!btn) return;
    btn.disabled = document.getElementById('matriculaImportarTexto').value.trim() === '';
}

// ==========================================
// ETAPA 1: LER O TEXTO COLADO (regex, sem IA)
// ==========================================
function dataBRParaISO(str) {
    if (!str) return null;
    const partes = String(str).trim().split('/');
    if (partes.length !== 3) return null;
    const [d, m, y] = partes.map(Number);
    if (!d || !m || !y) return null;
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// O texto copiado (Ctrl+C) da tabela HTML do Mercúrio sai bem estruturado
// — 1 linha por aluno, células separadas por tabulação — então dá pra ler
// direto com regex, sem IA nenhuma. Testado contra um export real da tela
// "Aluno => Matricular": cabeçalho ("Matr.	Nome	Origem...") é descartado
// sozinho porque a 1ª coluna não é um número; os 3 links da coluna
// "Funções" (Transferir/Promover/Dar Baixa) viram campos extras no fim da
// linha, mas são ignorados (só usamos os índices 0/1/3/5).
function parseTextoMatricula(texto) {
    const linhas = String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const resultado = [];

    for (const linha of linhas) {
        let campos = linha.split('\t');
        // Fallback pra quando o "colar" não preserva tabulação de verdade
        // (alguns navegadores/fontes colam com múltiplos espaços no lugar).
        if (campos.length < 6) campos = linha.split(/\s{2,}/);
        if (campos.length < 6) continue;

        const matricula = parseInt(campos[0].trim(), 10);
        if (!Number.isFinite(matricula)) continue; // descarta o cabeçalho ("Matr.") e qualquer linha sem número

        const nome = (campos[1] || '').trim();
        if (!nome) continue;

        const ingressoTexto = (campos[3] || '').trim();
        const ingresso = /^\d{2}\/\d{2}\/\d{4}$/.test(ingressoTexto) ? ingressoTexto : null;

        const foneTexto = (campos[5] || '').trim();
        const foneMatch = foneTexto.match(/\((\d{2})\)\s*(\d{8,9})/);

        resultado.push({
            matricula,
            nome,
            fone_ddd: foneMatch ? foneMatch[1] : null,
            fone_numero: foneMatch ? foneMatch[2] : null,
            ingresso,
        });
    }

    return resultado;
}

// Só existe quando o texto colado veio da tela de Turma (não da lista
// avulsa "Aluno => Matricular"): procura a linha com "Turma:" — cada
// célula dessa linha já vem no formato "Rótulo: Valor" (ex: "Turma:
// XESOSTRIS", "Dia: TERÇA"), então separa por tabulação e depois por ":"
// dentro de cada célula. Retorna null se não achar (texto colado é só a
// lista de alunos, sem cabeçalho de turma — comportamento de antes).
function parseMetadadosTurma(texto) {
    const linhas = String(texto || '').split(/\r?\n/);
    for (const linha of linhas) {
        if (!linha.includes('Turma:')) continue;
        const mapa = {};
        linha.split('\t').forEach(campo => {
            const idx = campo.indexOf(':');
            if (idx === -1) return;
            const label = campo.slice(0, idx).trim();
            const valor = campo.slice(idx + 1).trim();
            if (label) mapa[label] = valor;
        });
        if (mapa['Turma']) {
            return {
                turma: mapa['Turma'] || null,
                dia: mapa['Dia'] || null,
                horario: mapa['Horário'] || mapa['Horario'] || null,
            };
        }
    }
    return null;
}

// Substitui (não duplica) as tags "Turma: X"/"Dia: X"/"Horário: X" —
// importante pra quando o mesmo lead aparece num texto colado de uma
// turma diferente depois (trocou de turma/horário), a tag antiga não pode
// ficar grudada junto com a nova.
function mesclarTagsComTurma(tagsJSON, metadados) {
    let tagsArray = [];
    try { tagsArray = JSON.parse(tagsJSON || '[]'); } catch (e) { tagsArray = []; }
    tagsArray = tagsArray.map(t => String(t).trim()).filter(Boolean)
        .filter(t => !/^Turma: /.test(t) && !/^Dia: /.test(t) && !/^Horário: /.test(t));

    if (metadados.turma) tagsArray.push(`Turma: ${metadados.turma}`);
    if (metadados.dia) tagsArray.push(`Dia: ${formatarTextoPadrao(metadados.dia)}`);
    if (metadados.horario) tagsArray.push(`Horário: ${metadados.horario}`);
    return tagsArray;
}

// "Matrícula nova" (vai pra Matriculados) vs "já é aluno ativo há tempos"
// (vai pra uma coluna "Ativos" — ver encontrarColunaAtivosMatricula()):
// a tela de Turma lista TODOS os alunos atuais da turma, não só quem
// entrou agora, então o "Ingresso" pode ser de anos atrás. Sem essa
// distinção, colar uma turma inteira jogaria veteranos dentro de
// "Matriculados" como se fossem conversão nova — o que infla a métrica e
// confunde o funil. 90 dias é uma janela generosa pra cobrir atraso entre
// a matrícula de verdade e a hora de colar a lista no CRM.
const DIAS_MATRICULA_RECENTE = 90;
function ehMatriculaRecente(ingressoISO) {
    if (!ingressoISO) return true; // sem data legível, assume novo (comportamento de antes)
    const hoje = new Date();
    const dataIngresso = new Date(ingressoISO + 'T00:00:00');
    const diffDias = (hoje - dataIngresso) / (1000 * 60 * 60 * 24);
    return diffDias <= DIAS_MATRICULA_RECENTE;
}

// Mesma heurística por substring já usada pra "Matriculados"/"Recontato"
// (js/app.js/js/eventos.js) — nunca cria a coluna sozinha, só procura uma
// já existente com "ativo" no nome/chave. Exclui "inativo" explicitamente
// (senão uma coluna chamada "Inativo" bateria também, já que contém "ativo").
function encontrarColunaAtivosMatricula() {
    if (typeof columnsConfig === 'undefined') return null;
    const bateAtivo = s => { const t = String(s || '').toLowerCase(); return t.includes('ativo') && !t.includes('inativo'); };
    const col = columnsConfig.find(c => bateAtivo(c.key) || bateAtivo(c.label));
    return col ? col.key : null;
}

// ==========================================
// ETAPA 2: PROCESSAR (parse local + casamento com leads da filial)
// ==========================================
async function processarTextoMatricula() {
    const texto = document.getElementById('matriculaImportarTexto').value.trim();
    if (!texto) return;

    const btn = document.getElementById('matriculaImportarBtnProcessar');
    const status = document.getElementById('matriculaImportarStatus');
    if (btn) btn.disabled = true;

    try {
        const linhasExtraidas = parseTextoMatricula(texto);
        if (linhasExtraidas.length === 0) {
            if (status) status.innerHTML = '<span style="color:#dc2626;">Não consegui reconhecer nenhuma linha nesse texto — confirme que colou a tabela inteira (com o cabeçalho "Matr. Nome Origem...") e que veio com as colunas separadas.</span>';
            if (btn) btn.disabled = false;
            return;
        }

        metadadosTurmaAtual = parseMetadadosTurma(texto);

        if (status) status.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Cruzando com os leads da filial...';
        leadsMatriculaCache = await carregarLeadsParaMatchMatricula();

        linhasRevisaoMatricula = linhasExtraidas
            .filter(l => l && l.matricula != null && String(l.nome || '').trim() !== '')
            .map(l => resolverLinhaMatricula(l, leadsMatriculaCache));

        if (status) status.innerHTML = '';
        document.getElementById('matriculaImportarEtapaTexto').style.display = 'none';
        document.getElementById('matriculaImportarEtapaRevisao').style.display = 'block';
        document.getElementById('matriculaImportarBtnProcessar').style.display = 'none';
        document.getElementById('matriculaImportarBtnConfirmar').style.display = 'inline-flex';
        renderizarRevisaoMatricula();
    } catch (e) {
        if (status) status.innerHTML = `<span style="color:#dc2626;">Erro inesperado: ${escapeHTML(e.message)}</span>`;
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Busca TODOS os leads da filial (paginado 1000 em 1000, mesmo limite do
// PostgREST já documentado em detectarLeadsATratar()) — aqui a exatidão do
// casamento importa mais que a velocidade, e os dados (telefone, matrícula
// já processada) precisam estar completos, não só o que já foi paginado
// no Kanban.
async function carregarLeadsParaMatchMatricula() {
    let pagina = 0;
    let todos = [];
    while (true) {
        const { data, error } = await window.supabaseClient
            .from(NOME_TABELA)
            .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero, funil_agencia, matricula_mercurio, data_matricula, tags')
            .eq('filial', filialAtual)
            .order('pessoaIdentificador', { ascending: true })
            .range(pagina * 1000, pagina * 1000 + 999);
        if (error) throw error;
        todos = todos.concat(data || []);
        if (!data || data.length < 1000) break;
        pagina++;
    }
    return todos;
}

// Ordem de confiança: (1) já processado antes (mesmo Matr.) — encerra sem
// mexer em nada; (2) telefone idêntico; (3) nome normalizado idêntico E
// único (homônimos caem em "sem_match" pra revisão manual, não arrisca
// escolher errado sozinho).
function resolverLinhaMatricula(linhaLida, leads) {
    const matricula = Number(linhaLida.matricula);
    const nome = String(linhaLida.nome || '').trim();
    const chaveTelefone = (linhaLida.fone_ddd && linhaLida.fone_numero)
        ? normalizarTelefoneParaChave(linhaLida.fone_ddd, linhaLida.fone_numero)
        : null;

    const ingressoISO = dataBRParaISO(linhaLida.ingresso);
    const linha = {
        matricula,
        nome,
        ingressoTexto: linhaLida.ingresso || null,
        ingressoISO,
        recente: ehMatriculaRecente(ingressoISO),
        foneDDD: linhaLida.fone_ddd ? String(linhaLida.fone_ddd).replace(/\D/g, '') : '',
        foneNumero: linhaLida.fone_numero ? String(linhaLida.fone_numero).replace(/\D/g, '') : '',
        leadExistente: null,
        status: 'sem_match',
        incluir: false,
    };

    const jaImportado = leads.find(l => Number(l.matricula_mercurio) === matricula);
    if (jaImportado) {
        linha.status = 'duplicado';
        linha.leadExistente = jaImportado;
        return linha;
    }

    if (chaveTelefone) {
        const porTelefone = leads.find(l => normalizarTelefoneParaChave(l.pessoaTelefoneDDD, l.pessoaTelefoneNumero) === chaveTelefone);
        if (porTelefone) {
            linha.status = 'match_telefone';
            linha.leadExistente = porTelefone;
            linha.incluir = true;
            return linha;
        }
    }

    const nomeNorm = normalizarNomeImport(nome);
    const porNome = leads.filter(l => normalizarNomeImport(l.pessoaNome) === nomeNorm);
    if (porNome.length === 1) {
        linha.status = 'match_nome';
        linha.leadExistente = porNome[0];
        linha.incluir = true;
    }
    return linha;
}

// ==========================================
// ETAPA 3: REVISÃO (confirmar/ajustar cada linha antes de aplicar)
// ==========================================
const ROTULOS_STATUS_MATRICULA = {
    duplicado: { texto: 'Já importado antes', classe: 'tag-nivel' },
    match_telefone: { texto: 'Encontrado por telefone', classe: 'tag-ativo' },
    match_nome: { texto: 'Encontrado por nome', classe: 'tag-ativo' },
    match_manual: { texto: 'Vinculado manualmente', classe: 'tag-ativo' },
    sem_match: { texto: 'Não encontrado — resolva abaixo', classe: 'tag-warning' },
    novo_lead: { texto: 'Será cadastrado como novo lead', classe: 'tag-success' },
};

function renderizarRevisaoMatricula() {
    const container = document.getElementById('matriculaImportarRevisaoLista');
    if (!container) return;

    let avisoTurma = '';
    if (metadadosTurmaAtual) {
        const partes = [];
        if (metadadosTurmaAtual.turma) partes.push(`Turma: ${escapeHTML(metadadosTurmaAtual.turma)}`);
        if (metadadosTurmaAtual.dia) partes.push(`Dia: ${escapeHTML(formatarTextoPadrao(metadadosTurmaAtual.dia))}`);
        if (metadadosTurmaAtual.horario) partes.push(`Horário: ${escapeHTML(metadadosTurmaAtual.horario)}`);
        avisoTurma = `<div class="matricula-importar-aviso-turma">
            <i class="fa-solid fa-chalkboard-user"></i> Texto de turma reconhecido (${partes.join(' · ')}) — essas tags serão gravadas em cada lead vinculado.
        </div>`;
    }

    // Independente de ter vindo de uma tela de Turma ou da lista avulsa —
    // qualquer linha com Ingresso antigo é tratada como "já ativo" (ver
    // ehMatriculaRecente()), então esse aviso precisa aparecer sempre que
    // isso afetar pelo menos 1 linha, não só quando há cabeçalho de turma.
    const temLinhaAntiga = linhasRevisaoMatricula.some(l => l.status !== 'duplicado' && !l.recente);
    if (temLinhaAntiga) {
        const colunaAtivos = encontrarColunaAtivosMatricula();
        avisoTurma += `<div class="matricula-importar-aviso-turma">
            <i class="fa-solid fa-clock-rotate-left"></i> Linha(s) com Ingresso de mais de ${DIAS_MATRICULA_RECENTE} dias atrás são tratadas como "já ativo", não matrícula nova${colunaAtivos ? ` — vão pra coluna "${escapeHTML(nomeColunaPorChave(colunaAtivos))}"` : ' — mas nenhuma coluna com "ativo" no nome foi encontrada no seu Kanban, então essas ficam na coluna onde já estavam (não avançam sozinhas pra Matriculados). Crie uma coluna "Ativos" antes de confirmar se quiser que elas sejam movidas'}.
        </div>`;
    }

    if (linhasRevisaoMatricula.length === 0) {
        container.innerHTML = avisoTurma + '<p style="font-size:12px; color:var(--text-muted);">Nenhuma linha de matrícula foi reconhecida no texto colado.</p>';
    } else {
        container.innerHTML = avisoTurma + linhasRevisaoMatricula.map((l, i) => {
            const info = ROTULOS_STATUS_MATRICULA[l.status];
            const lead = l.leadExistente;
            const temFoneLido = !!(l.foneDDD && l.foneNumero);
            const telefoneLido = temFoneLido ? `(${l.foneDDD}) ${l.foneNumero}` : null;
            const chaveLida = temFoneLido ? normalizarTelefoneParaChave(l.foneDDD, l.foneNumero) : null;
            const chaveCRM = lead ? normalizarTelefoneParaChave(lead.pessoaTelefoneDDD, lead.pessoaTelefoneNumero) : null;
            const telefoneCRM = lead && lead.pessoaTelefoneNumero ? `(${lead.pessoaTelefoneDDD || ''}) ${lead.pessoaTelefoneNumero}` : null;
            const telefoneDiverge = lead && chaveLida && chaveCRM && chaveLida !== chaveCRM;
            const telefoneFaltando = lead && chaveLida && !chaveCRM;
            const podeIncluir = l.status !== 'duplicado' && (l.leadExistente || l.status === 'novo_lead');

            return `
                <div class="matricula-importar-row ${l.status === 'duplicado' ? 'matricula-importar-row-duplicado' : ''}">
                    <div class="matricula-importar-row-check">
                        ${l.status === 'duplicado'
                            ? '<i class="fa-solid fa-check" style="color:#94a3b8;"></i>'
                            : `<input type="checkbox" ${l.incluir ? 'checked' : ''} ${podeIncluir ? '' : 'disabled'} onchange="toggleIncluirLinhaMatricula(${i}, this.checked)">`}
                    </div>
                    <div class="matricula-importar-row-info">
                        <div><strong>${escapeHTML(l.nome)}</strong> <span style="color:var(--text-muted); font-size:10px;">Matr. ${l.matricula}${l.ingressoTexto ? ' · Ingresso ' + escapeHTML(l.ingressoTexto) : ''}</span></div>
                        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                            <span class="tag ${info.classe}">${info.texto}</span>
                            ${!l.recente && l.status !== 'duplicado' ? ' <span class="tag tag-nivel">Já ativo (não é matrícula nova)</span>' : ''}
                            ${lead ? ` vinculado a <strong>${escapeHTML(lead.pessoaNome)}</strong>` : ''}
                            ${telefoneDiverge ? ` <span style="color:#b45309;">· Telefone no CRM (${escapeHTML(telefoneCRM)}) será atualizado pra ${escapeHTML(telefoneLido)}</span>` : ''}
                            ${telefoneFaltando ? ` <span style="color:#b45309;">· Telefone ${escapeHTML(telefoneLido)} será adicionado</span>` : ''}
                        </div>
                        ${l.status === 'sem_match' ? `
                            <div class="matricula-importar-row-acoes">
                                <div class="global-search-wrapper" style="width:280px;">
                                    <input type="text" class="global-search-input" placeholder="Buscar lead pra vincular..." oninput="buscarLeadParaMatricula(${i}, this.value)">
                                    <i class="fa-solid fa-magnifying-glass"></i>
                                    <div class="global-search-results" id="matriculaBusca-${i}"></div>
                                </div>
                                <button class="btn-mini btn-secondary-mini" onclick="marcarComoNovoLeadMatricula(${i})"><i class="fa-solid fa-user-plus"></i> Cadastrar como novo lead</button>
                            </div>
                        ` : ''}
                    </div>
                    ${l.status !== 'duplicado' ? `<button class="icon-btn danger" title="Ignorar esta linha" onclick="ignorarLinhaMatricula(${i})"><i class="fa-solid fa-ban"></i></button>` : ''}
                </div>
            `;
        }).join('');
    }

    const totalIncluidos = linhasRevisaoMatricula.filter(l => l.incluir).length;
    const btnConfirmar = document.getElementById('matriculaImportarBtnConfirmar');
    if (btnConfirmar) {
        btnConfirmar.disabled = totalIncluidos === 0;
        btnConfirmar.innerHTML = `<i class="fa-solid fa-check"></i> Confirmar ${totalIncluidos} Matrícula${totalIncluidos === 1 ? '' : 's'}`;
    }
}

function toggleIncluirLinhaMatricula(i, checked) {
    if (linhasRevisaoMatricula[i]) linhasRevisaoMatricula[i].incluir = checked;
    renderizarRevisaoMatricula();
}

function ignorarLinhaMatricula(i) {
    linhasRevisaoMatricula.splice(i, 1);
    renderizarRevisaoMatricula();
}

function marcarComoNovoLeadMatricula(i) {
    const l = linhasRevisaoMatricula[i];
    if (!l) return;
    l.status = 'novo_lead';
    l.leadExistente = null;
    l.incluir = true;
    renderizarRevisaoMatricula();
}

// Busca local (sem nova query — leadsMatriculaCache já tem a filial
// inteira) pra vincular manualmente um "sem_match", mesmo espírito visual
// da busca global (js/app.js), só que escopada à revisão desta linha.
let debounceBuscaMatricula = null;
function buscarLeadParaMatricula(i, termo) {
    clearTimeout(debounceBuscaMatricula);
    debounceBuscaMatricula = setTimeout(() => executarBuscaLeadMatricula(i, termo), 250);
}

function executarBuscaLeadMatricula(i, termo) {
    const resultsEl = document.getElementById(`matriculaBusca-${i}`);
    if (!resultsEl) return;
    termo = (termo || '').trim();
    if (termo.length < 2) { resultsEl.classList.remove('open'); resultsEl.innerHTML = ''; return; }

    const termoNorm = normalizarNomeImport(termo);
    const termoDigitos = termo.replace(/\D/g, '');
    const candidatos = leadsMatriculaCache.filter(l =>
        normalizarNomeImport(l.pessoaNome).includes(termoNorm) ||
        (termoDigitos.length >= 4 && (l.pessoaTelefoneNumero || '').includes(termoDigitos))
    ).slice(0, 15);

    if (candidatos.length === 0) {
        resultsEl.innerHTML = '<div class="global-search-empty">Nenhum lead encontrado.</div>';
        resultsEl.classList.add('open');
        return;
    }

    resultsEl.innerHTML = candidatos.map(l => {
        const tel = [l.pessoaTelefoneDDD, l.pessoaTelefoneNumero].filter(Boolean).join(' ') || 'Sem telefone';
        return `
            <div class="global-search-result-item" onclick="selecionarLeadManualMatricula(${i}, '${l.pessoaIdentificador}')">
                <div class="global-search-result-name">${escapeHTML(l.pessoaNome || 'Sem nome')}</div>
                <div class="global-search-result-meta"><span><i class="fa-solid fa-phone"></i> ${escapeHTML(tel)}</span></div>
            </div>
        `;
    }).join('');
    resultsEl.classList.add('open');
}

function selecionarLeadManualMatricula(i, pessoaId) {
    const lead = leadsMatriculaCache.find(l => String(l.pessoaIdentificador) === String(pessoaId));
    const l = linhasRevisaoMatricula[i];
    if (!lead || !l) return;
    l.leadExistente = lead;
    l.status = 'match_manual';
    l.incluir = true;
    renderizarRevisaoMatricula();
}

// ==========================================
// ETAPA 4: CONFIRMAR (aplica em lote)
// ==========================================
// Aplica UMA linha (update se já tem lead vinculado, insert se é "novo
// lead") — reaproveitada tanto pelo lote de confirmarImportacaoMatricula()
// quanto pela ação "Vincular e Matricular" de uma sugestão no relatório
// final (aceitarSugestaoRelatorioMatricula()).
async function aplicarLinhaMatricula(l) {
    const hojeISO = new Date().toISOString().slice(0, 10);

    if (l.leadExistente) {
        const payload = {
            matricula_mercurio: l.matricula,
            data_matricula: l.ingressoISO || l.leadExistente.data_matricula || hojeISO,
        };
        if (l.foneDDD && l.foneNumero) {
            payload.pessoaTelefoneDDD = l.foneDDD;
            payload.pessoaTelefoneNumero = l.foneNumero;
        }
        if (metadadosTurmaAtual) {
            payload.tags = JSON.stringify(mesclarTagsComTurma(l.leadExistente.tags, metadadosTurmaAtual));
        }
        // Matrícula recente = vira "Matriculados", como sempre. Ingresso
        // antigo (típico de colar a lista inteira de uma turma, não só os
        // novatos) = já é aluno ativo — só move pra "Ativos" se essa coluna
        // existir; se não existir, não mexe no funil_agencia atual, pra
        // não empurrar um veterano pra Matriculados por engano.
        if (l.recente) {
            payload.funil_agencia = matriculadosKeyMatricula;
        } else {
            const colunaAtivos = encontrarColunaAtivosMatricula();
            if (colunaAtivos) payload.funil_agencia = colunaAtivos;
        }
        const { error } = await window.supabaseClient.from(NOME_TABELA).update(payload).eq('pessoaIdentificador', l.leadExistente.pessoaIdentificador);
        return { error };
    }

    // Novo lead (raro — alguém que nunca foi lead antes): ID sintético
    // numa faixa (990000000+) separada da usada pelo importador de
    // planilhas (900000000+/950000000+, js/importador.js), pra nunca colidir.
    // Aqui SEMPRE precisa de uma coluna (não tem "onde já estava" pra manter),
    // então cai pra Matriculados se for recente ou se não achar "Ativos".
    const colunaAtivosNovo = !l.recente ? encontrarColunaAtivosMatricula() : null;
    const idsUsados = new Set(leadsMatriculaCache.map(x => String(x.pessoaIdentificador)));
    let novoId;
    do { novoId = String(990000000 + Math.floor(Math.random() * 9000000)); } while (idsUsados.has(novoId));
    const { error } = await window.supabaseClient.from(NOME_TABELA).insert({
        pessoaIdentificador: novoId,
        pessoaNome: l.nome,
        pessoaTelefoneDDD: l.foneDDD || null,
        pessoaTelefoneNumero: l.foneNumero || null,
        filial: filialAtual,
        funil_agencia: colunaAtivosNovo || matriculadosKeyMatricula,
        tags: metadadosTurmaAtual ? JSON.stringify(mesclarTagsComTurma('[]', metadadosTurmaAtual)) : '[]',
        matricula_mercurio: l.matricula,
        data_matricula: l.ingressoISO || hojeISO,
    });
    return { error };
}

async function confirmarImportacaoMatricula() {
    const linhasParaAplicar = linhasRevisaoMatricula.filter(l => l.incluir && l.status !== 'duplicado');
    if (linhasParaAplicar.length === 0) return;

    const nomeColuna = (typeof nomeColunaPorChave === 'function') ? nomeColunaPorChave(matriculadosKeyMatricula) : matriculadosKeyMatricula;
    const temAntigos = linhasParaAplicar.some(l => !l.recente);
    const complementoAntigos = temAntigos ? ' Quem já é aluno ativo há mais tempo (Ingresso antigo) vai pra coluna de Ativos em vez de Matriculados, quando ela existir.' : '';
    if (!confirm(`Confirmar ${linhasParaAplicar.length} matrícula(s)? Isso move os leads pra "${nomeColuna}", grava a data de matrícula e atualiza o telefone quando necessário.${complementoAntigos}`)) return;

    const btn = document.getElementById('matriculaImportarBtnConfirmar');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Aplicando...'; }

    const resultados = await Promise.all(linhasParaAplicar.map(async l => ({ linha: l, ...(await aplicarLinhaMatricula(l)) })));
    const sucesso = resultados.filter(r => !r.error).map(r => r.linha);
    const comErro = resultados.filter(r => r.error);
    if (comErro.length > 0) console.error('Erros na importação de matrícula:', comErro);

    // "Não localizados" pro relatório final: linhas que ficaram de fora do
    // lote aplicado (sem_match nunca resolvido, ou explicitamente
    // ignoradas) — não inclui "duplicado" (esses já eram conhecidos, não
    // é "não encontrado").
    const naoLocalizadas = linhasRevisaoMatricula.filter(l => !l.incluir && l.status !== 'duplicado');

    fecharImportarMatricula();
    carregarLeads(filialAtual, true);
    mostrarRelatorioMatricula(sucesso, naoLocalizadas, comErro.length);
}

// ==========================================
// RELATÓRIO FINAL — quem foi matriculado, quem do texto colado não foi
// localizado entre os leads (com sugestão por semelhança de nome, quando
// houver um candidato razoável)
// ==========================================
let relatorioSucessoMatricula = [];
let relatorioNaoLocalizadas = []; // [{linha, sugestao: {lead, score} | null}]
let relatorioErrosMatricula = 0;

// Sugestão simples por cobertura de tokens do nome (mesmo espírito do
// critério "nome" de Leads a Tratar, js/leads-a-tratar.js, só que bem mais
// simples — aqui é só uma sugestão pra revisão humana, não um matching
// automático que decide sozinho).
function sugerirLeadParecido(nome, leads) {
    const tokensAlvo = normalizarNomeImport(nome).split(' ').filter(Boolean);
    if (tokensAlvo.length === 0) return null;

    let melhorLead = null, melhorScore = 0;
    leads.forEach(l => {
        const tokensLead = normalizarNomeImport(l.pessoaNome || '').split(' ').filter(Boolean);
        if (tokensLead.length === 0) return;
        const menor = Math.min(tokensAlvo.length, tokensLead.length);
        const acertos = tokensAlvo.filter(t => tokensLead.includes(t)).length;
        const score = Math.round((acertos / menor) * 100);
        if (score > melhorScore) { melhorScore = score; melhorLead = l; }
    });

    return (melhorLead && melhorScore >= 60) ? { lead: melhorLead, score: melhorScore } : null;
}

function mostrarRelatorioMatricula(sucesso, naoLocalizadas, countErros) {
    relatorioSucessoMatricula = sucesso.slice();
    relatorioNaoLocalizadas = naoLocalizadas.map(l => ({ linha: l, sugestao: sugerirLeadParecido(l.nome, leadsMatriculaCache) }));
    relatorioErrosMatricula = countErros;

    renderizarRelatorioMatricula();
    document.getElementById('modalRelatorioMatricula').classList.add('open');
    document.getElementById('overlayModalRelatorioMatricula').classList.add('active');
}

function renderizarRelatorioMatricula() {
    const container = document.getElementById('matriculaRelatorioConteudo');
    if (!container) return;

    const jaAtivos = relatorioSucessoMatricula.filter(l => l.recente === false);
    const colunaAtivos = encontrarColunaAtivosMatricula();

    let html = `<div class="matricula-relatorio-secao">
        <h4><i class="fa-solid fa-circle-check" style="color:#047857;"></i> ${relatorioSucessoMatricula.length} lead(s) processado(s) com sucesso</h4>
        ${relatorioSucessoMatricula.length > 0
            ? `<ul>${relatorioSucessoMatricula.map(l => `<li>${escapeHTML(l.nome)} <span style="color:var(--text-muted);">(Matr. ${l.matricula}${l.recente === false ? ' · já ativo' : ''})</span></li>`).join('')}</ul>`
            : '<p style="font-size:12px; color:var(--text-muted);">Nenhum.</p>'}
        ${jaAtivos.length > 0 ? `
            <p style="font-size:11px; color:#b45309; background:#fffbeb; border:1px solid #fde68a; padding:8px 10px; border-radius:6px; margin-top:8px;">
                <i class="fa-solid fa-circle-info"></i> ${jaAtivos.length} desses são "já ativo" (Ingresso de mais de ${DIAS_MATRICULA_RECENTE} dias atrás) — telefone, tags de turma e matrícula/data foram atualizados normalmente, mas
                ${colunaAtivos ? ` a coluna do Kanban foi trocada pra "${escapeHTML(nomeColunaPorChave(colunaAtivos))}", não Matriculados.` : ` a coluna do Kanban NÃO foi alterada (continuam onde já estavam) — nenhuma coluna com "ativo" no nome foi encontrada no seu Kanban. Como o Matr. desses leads já ficou gravado, colar essa mesma lista de novo não vai mais surtir efeito (a linha passa a ser tratada como "já importada" e é ignorada) — se quiser movê-los, crie uma coluna "Ativos" e arraste os cards manualmente pra lá desta vez.`}
            </p>
        ` : ''}
    </div>`;

    if (relatorioErrosMatricula > 0) {
        html += `<div class="matricula-relatorio-secao"><p style="font-size:12px; color:#dc2626;"><i class="fa-solid fa-triangle-exclamation"></i> ${relatorioErrosMatricula} linha(s) falharam ao salvar — veja o console (F12).</p></div>`;
    }

    html += `<div class="matricula-relatorio-secao">
        <h4><i class="fa-solid fa-circle-question" style="color:#b45309;"></i> ${relatorioNaoLocalizadas.length} aluno(s) do texto não incluído(s)</h4>
        ${relatorioNaoLocalizadas.length === 0 ? '<p style="font-size:12px; color:var(--text-muted);">Nenhum — todo mundo do texto colado foi processado.</p>' : relatorioNaoLocalizadas.map((item, i) => {
            const l = item.linha;
            const sug = item.sugestao;
            return `
                <div class="matricula-relatorio-item">
                    <div><strong>${escapeHTML(l.nome)}</strong> <span style="color:var(--text-muted); font-size:10px;">Matr. ${l.matricula}</span></div>
                    ${sug ? `
                        <div style="font-size:12px; margin-top:4px;">
                            "${escapeHTML(l.nome)}" é o lead <strong>${escapeHTML(sug.lead.pessoaNome)}</strong>? <span style="color:var(--text-muted);">(${sug.score}% parecido)</span>
                            <div style="display:flex; gap:6px; margin-top:6px;">
                                <button class="btn-mini btn-primary-mini" onclick="aceitarSugestaoRelatorioMatricula(${i})"><i class="fa-solid fa-check"></i> Sim, vincular e matricular</button>
                                <button class="btn-mini btn-secondary-mini" onclick="rejeitarSugestaoRelatorioMatricula(${i})">Não é</button>
                            </div>
                        </div>
                    ` : '<div style="font-size:11px; color:var(--text-muted); margin-top:4px;">Nenhum lead parecido encontrado — verifique manualmente.</div>'}
                </div>
            `;
        }).join('')}
    </div>`;

    container.innerHTML = html;
}

async function aceitarSugestaoRelatorioMatricula(i) {
    const item = relatorioNaoLocalizadas[i];
    if (!item || !item.sugestao) return;

    item.linha.leadExistente = item.sugestao.lead;
    const { error } = await aplicarLinhaMatricula(item.linha);
    if (error) { alert('Erro ao vincular: ' + error.message); return; }

    relatorioSucessoMatricula.push(item.linha);
    relatorioNaoLocalizadas.splice(i, 1);
    renderizarRelatorioMatricula();
    carregarLeads(filialAtual, true);
}

function rejeitarSugestaoRelatorioMatricula(i) {
    if (relatorioNaoLocalizadas[i]) relatorioNaoLocalizadas[i].sugestao = null;
    renderizarRelatorioMatricula();
}

function fecharRelatorioMatricula() {
    document.getElementById('modalRelatorioMatricula').classList.remove('open');
    document.getElementById('overlayModalRelatorioMatricula').classList.remove('active');
}

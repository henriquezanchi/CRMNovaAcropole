// =========================================================
// Banco de consulta do Mercúrio (oinabview) — telas do CRM
// =========================================================
// Os dados vêm de mercurio_alunos/mercurio_turmas, preenchidos todo dia pela
// Edge Function `mercurio-db-sincronizar`. A competência de cobrança de cada
// aluno já chega CALCULADA de lá (regra: programa branco conta no mês de
// abertura da turma, aceitando matrícula até 30 dias antes; mais que isso =
// investigar; complementar conta pela data individual). Aqui é só leitura,
// mais o campo "informado pela escola", que é manual.

const NOMES_MES_CONC = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const rotuloMesConc = (m) => { const [a, mm] = String(m).split('-'); return `${NOMES_MES_CONC[Number(mm) - 1]}/${a}`; };
const dataBRConc = (iso) => { if (!iso) return '—'; const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const formatarRealConc = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let mesSelecionadoConciliacao = null;
let ultimaConciliacaoCarregada = null; // { mes, porFilial: Map }

function filialTemMercurioDb(nomeFilial) {
    const f = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).find(x => x.nome === nomeFilial);
    return !!(f && f.mercurio_unidade);
}

// Meses em que existe alguma competência ou caso a investigar.
async function listarMesesConciliacaoMercurio() {
    const meses = new Set();
    for (const coluna of ['competencia', 'investigar_competencia']) {
        let de = 0;
        for (;;) {
            const { data, error } = await window.supabaseClient
                .from('mercurio_alunos').select(coluna).not(coluna, 'is', null)
                .order(coluna, { ascending: true }).range(de, de + 999);
            if (error || !data) break;
            data.forEach(l => meses.add(l[coluna]));
            if (data.length < 1000) break;
            de += 1000;
        }
    }
    return [...meses].sort();
}

// Map filial -> { contam: [...], investigar: [...], informado: {quantidade, observacao} | null, turmasAbertas: [...] }
async function carregarConciliacaoMes(mes) {
    const campos = 'matricula, unidade, filial, nome, nivel, turma, turma_competencia, data_efetiva, ingresso, reingresso, recuperado, programa, conta_remuneracao, motivo_investigar, pessoa_identificador, ativo, contribuicao';
    const [rContam, rInvestigar, rInformado, rTurmas] = await Promise.all([
        window.supabaseClient.from('mercurio_alunos').select(campos).eq('competencia', mes).eq('conta_remuneracao', true).order('data_efetiva').limit(5000),
        window.supabaseClient.from('mercurio_alunos').select(campos).eq('investigar_competencia', mes).order('data_efetiva').limit(5000),
        window.supabaseClient.from('conciliacao_matriculas_informado').select('filial, quantidade, observacao, atualizado_por, atualizado_em').eq('mes', mes),
        window.supabaseClient.from('mercurio_turmas').select('filial, turma, tipo, nivel, dia, horario, inicio').gte('inicio', `${mes}-01`).lte('inicio', `${mes}-31`).order('inicio'),
    ]);
    const erro = rContam.error || rInvestigar.error || rInformado.error || rTurmas.error;
    if (erro) throw new Error(erro.message);

    const porFilial = new Map();
    const garantir = (f) => { if (!porFilial.has(f)) porFilial.set(f, { contam: [], investigar: [], informado: null, turmasAbertas: [] }); return porFilial.get(f); };
    (rContam.data || []).forEach(a => garantir(a.filial).contam.push(a));
    (rInvestigar.data || []).forEach(a => garantir(a.filial).investigar.push(a));
    (rInformado.data || []).forEach(i => { garantir(i.filial).informado = i; });
    (rTurmas.data || []).forEach(t => garantir(t.filial).turmasAbertas.push(t));
    ultimaConciliacaoCarregada = { mes, porFilial };
    return porFilial;
}

async function salvarInformadoConciliacao(filial, mes, valor) {
    const texto = String(valor ?? '').trim();
    if (texto === '') {
        const { error } = await window.supabaseClient.from('conciliacao_matriculas_informado').delete().eq('filial', filial).eq('mes', mes);
        if (error) { alert('Erro ao limpar: ' + error.message); return; }
    } else {
        const quantidade = parseInt(texto, 10);
        if (isNaN(quantidade) || quantidade < 0) { alert('Informe um número inteiro.'); return; }
        const autor = (typeof usuarioLogado === 'function' && usuarioLogado()?.nome) || localStorage.getItem('crm_na_nome_atendente') || null;
        const { error } = await window.supabaseClient.from('conciliacao_matriculas_informado')
            .upsert({ filial, mes, quantidade, atualizado_por: autor, atualizado_em: new Date().toISOString() }, { onConflict: 'filial,mes' });
        if (error) { alert('Erro ao salvar: ' + error.message); return; }
    }
    if (typeof registrarLogAtividade === 'function') registrarLogAtividade('conciliacao_informado', { filial, detalhes: { mes, quantidade: texto } });
    renderizarConciliacaoMercurio();
    if (typeof renderizarComissaoSdrTodasFiliais === 'function') renderizarComissaoSdrTodasFiliais();
}

function htmlDiferencaConciliacao(noMercurio, informado) {
    if (informado == null) return '<span style="color:var(--text-muted);">—</span>';
    const dif = noMercurio - informado;
    if (dif === 0) return '<span class="tag tag-ativo" style="font-size:10px;">Bate</span>';
    if (dif < 0) return `<span class="tag tag-error" style="font-size:10px;" title="O Mercúrio tem menos matrículas que o informado pela escola">Devolver ${Math.abs(dif)}</span>`;
    return `<span class="tag tag-success" style="font-size:10px;" title="O Mercúrio tem mais matrículas que o informado pela escola">Cobrar +${dif}</span>`;
}

function htmlAlunoConciliacao(a, comMotivo) {
    const clicavel = a.pessoa_identificador ? `onclick="abrirResultadoBuscaGlobal('${escapeHTML(a.pessoa_identificador)}')" style="cursor:pointer;"` : 'title="Ainda sem lead vinculado no CRM"';
    const reingresso = a.recuperado && a.reingresso ? ` <span class="tag tag-recuperado" style="font-size:9px;">Reingresso ${dataBRConc(a.reingresso)}</span>` : '';
    const saiu = a.ativo === false ? ' <span class="tag tag-exaluno" style="font-size:9px;" title="Não aparece mais como ativo no Mercúrio">Saiu</span>' : '';
    return `
        <div class="conc-aluno" ${clicavel}>
            <div><strong>${escapeHTML(a.nome || '(sem nome)')}</strong> <span class="conc-aluno-meta">matr. ${a.matricula} · ${escapeHTML(a.nivel || '?')} · ${escapeHTML(a.turma || 'sem turma')}</span>${reingresso}${saiu}</div>
            <div class="conc-aluno-meta">Data considerada: ${dataBRConc(a.data_efetiva)}${a.programa === 'complementar' ? ' · complementar (conta pela data individual)' : (a.turma_competencia ? ` · conta pela abertura da turma ${escapeHTML(a.turma_competencia)}` : '')}</div>
            ${comMotivo && a.motivo_investigar ? `<div class="conc-aluno-motivo"><i class="fa-solid fa-magnifying-glass"></i> ${escapeHTML(a.motivo_investigar)}</div>` : ''}
        </div>`;
}

async function renderizarConciliacaoMercurio() {
    const container = document.getElementById('relatorioConciliacaoMercurio');
    if (!container) return;
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando...</p>';

    let meses;
    try { meses = await listarMesesConciliacaoMercurio(); } catch (e) { meses = []; }
    if (meses.length === 0) {
        container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Ainda não há dados do banco do Mercúrio. A sincronização roda todo dia às 06:30.</p>';
        return;
    }
    const mesAtual = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
    if (!mesSelecionadoConciliacao || !meses.includes(mesSelecionadoConciliacao)) {
        mesSelecionadoConciliacao = meses.includes(mesAtual) ? mesAtual : meses[meses.length - 1];
    }

    let porFilial;
    try { porFilial = await carregarConciliacaoMes(mesSelecionadoConciliacao); }
    catch (e) { container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro: ${escapeHTML(e.message)}</p>`; return; }

    const filiais = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).filter(f => f.mercurio_unidade);
    const { data: ultimaSync } = await window.supabaseClient.from('status_sincronizacao_automatica')
        .select('executado_em, sucesso, mensagem').eq('sistema', 'mercurio_db').order('executado_em', { ascending: false }).limit(1);
    const sync = ultimaSync && ultimaSync[0];
    const baseEm = sync && sync.mensagem ? (sync.mensagem.match(/Base do Mercúrio de ([0-9-]+ [0-9:]+)/) || [])[1] : null;

    const linhasResumo = filiais.map(f => {
        const c = porFilial.get(f.nome) || { contam: [], investigar: [], informado: null, turmasAbertas: [] };
        const informado = c.informado ? c.informado.quantidade : null;
        return { f, c, informado };
    });

    container.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px; flex-wrap:wrap;">
            <label style="font-size:12px; font-weight:600; color:var(--text-dark);">Mês:</label>
            <select onchange="mesSelecionadoConciliacao = this.value; renderizarConciliacaoMercurio();" style="padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; outline:none;">
                ${meses.slice().reverse().map(m => `<option value="${m}" ${m === mesSelecionadoConciliacao ? 'selected' : ''}>${rotuloMesConc(m)}</option>`).join('')}
            </select>
            <button class="btn-secondary" style="font-size:11px; padding:6px 10px;" onclick="sincronizarMercurioDbAgora(this)"><i class="fa-solid fa-rotate"></i> Sincronizar agora</button>
            <span style="font-size:11px; color:${sync && !sync.sucesso ? '#dc2626' : 'var(--text-muted)'};">
                ${sync ? `Última sincronização: ${new Date(sync.executado_em).toLocaleString('pt-BR')}${baseEm ? ` · base do Mercúrio de ${dataBRConc(baseEm.slice(0, 10))} ${baseEm.slice(11, 16)}` : ''}${sync.sucesso ? '' : ' · <strong>falhou</strong>'}` : 'Nunca sincronizado'}
            </span>
        </div>
        <table class="tabela-relatorio">
            <thead><tr><th>Filial</th><th>Turmas abertas no mês</th><th>No Mercúrio</th><th>Investigar</th><th>Informado pela escola</th><th>Diferença</th></tr></thead>
            <tbody>
                ${linhasResumo.map(({ f, c, informado }) => `
                    <tr>
                        <td>${escapeHTML(f.nome)}</td>
                        <td>${c.turmasAbertas.length ? c.turmasAbertas.map(t => `${escapeHTML(t.turma)} <span class="conc-aluno-meta">(${escapeHTML(t.nivel || '')}, ${dataBRConc(t.inicio)})</span>`).join('<br>') : '<span style="color:var(--text-muted);">nenhuma</span>'}</td>
                        <td><strong>${c.contam.length}</strong></td>
                        <td>${c.investigar.length ? `<span class="tag tag-warning" style="font-size:10px;">${c.investigar.length}</span>` : '0'}</td>
                        <td><input type="number" min="0" step="1" value="${informado != null ? informado : ''}" placeholder="—" style="width:70px; padding:4px 6px; border:1px solid #cbd5e1; border-radius:4px;" onchange="salvarInformadoConciliacao('${escapeHTML(f.nome)}', '${mesSelecionadoConciliacao}', this.value)"></td>
                        <td>${htmlDiferencaConciliacao(c.contam.length, informado)}</td>
                    </tr>`).join('')}
            </tbody>
        </table>
        <div class="conc-detalhes">
            ${linhasResumo.filter(({ c }) => c.contam.length || c.investigar.length).map(({ f, c }) => `
                <details class="conc-filial">
                    <summary>${escapeHTML(f.nome)} — ${c.contam.length} conta(m)${c.investigar.length ? `, ${c.investigar.length} pra investigar` : ''}</summary>
                    ${c.investigar.length ? `<div class="conc-bloco-titulo conc-bloco-investigar">Investigar antes de fechar</div>${c.investigar.map(a => htmlAlunoConciliacao(a, true)).join('')}` : ''}
                    ${c.contam.length ? `<div class="conc-bloco-titulo">Contam pra cobrança</div>${c.contam.map(a => htmlAlunoConciliacao(a, false)).join('')}` : ''}
                </details>`).join('')}
        </div>
        <p class="report-sub" style="margin-top:10px;">Regra: no programa branco a matrícula conta no mês em que a turma abriu, mesmo que tenha sido feita até 30 dias antes; feita mais cedo que isso, entra em "Investigar" (pode ser reingresso não registrado) e não conta até ser resolvida no Mercúrio. Complementar conta pela data de ingresso. Para recuperados vale a data de reingresso. Só contam PP, N1, CA e Membro reingressado.</p>
    `;
}

async function sincronizarMercurioDbAgora(botao) {
    const original = botao ? botao.innerHTML : '';
    if (botao) { botao.disabled = true; botao.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Sincronizando...'; }
    try {
        const { data, error } = await window.supabaseClient.functions.invoke('mercurio-db-sincronizar', { body: {} });
        if (error) throw error;
        if (!data || !data.ok) {
            const falhas = (data && data.resultados || []).filter(r => r.erro).map(r => `${r.filial}: ${r.erro}`).join('\n');
            alert('A sincronização terminou com problema:\n' + (data && data.erro ? data.erro : falhas));
        }
    } catch (e) {
        alert('Erro ao sincronizar: ' + (e.message || e));
    } finally {
        if (botao) { botao.disabled = false; botao.innerHTML = original; }
        renderizarConciliacaoMercurio();
        if (typeof renderizarComissaoSdrTodasFiliais === 'function') renderizarComissaoSdrTodasFiliais();
        if (typeof renderizarCanalOrigemMercurio === 'function') renderizarCanalOrigemMercurio();
    }
}

// ---------------------------------------------------------
// Contribuição em atraso — lista de retenção (Agenda do Dia)
// ---------------------------------------------------------
async function carregarAgendaGeralAtrasoContribuicao() {
    const el = document.getElementById('agendaGeralAtraso');
    if (!el) return;
    const { data, error } = await window.supabaseClient.from('mercurio_alunos')
        .select('nome, filial, nivel, meses_em_atraso, ultimo_pagamento, pessoa_identificador')
        .eq('ativo', true).gt('meses_em_atraso', 0)
        .order('meses_em_atraso', { ascending: false }).order('ultimo_pagamento', { ascending: true, nullsFirst: true }).limit(500);
    if (error) { el.innerHTML = `<div style="font-size:12px; color:#dc2626;">Erro: ${escapeHTML(error.message)}</div>`; return; }
    if (!data || data.length === 0) { el.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:4px;">Nenhum aluno com contribuição em atraso nos últimos 6 meses.</div>'; return; }
    const porFilial = {};
    data.forEach(a => { porFilial[a.filial] = (porFilial[a.filial] || 0) + 1; });
    el.innerHTML = `
        <div class="conc-aluno-meta" style="padding:4px 4px 8px;">${Object.entries(porFilial).map(([f, n]) => `${escapeHTML(f)}: <strong>${n}</strong>`).join(' · ')}</div>
        ${data.map(a => `
            <div class="activity-item" ${a.pessoa_identificador ? `onclick="abrirResultadoBuscaGlobal('${escapeHTML(a.pessoa_identificador)}')" style="cursor:pointer;"` : 'title="Ainda sem lead vinculado no CRM"'}>
                <div class="activity-content">
                    <div class="activity-text"><strong>${escapeHTML(a.nome || '')}</strong> <span class="tag ${a.meses_em_atraso >= 3 ? 'tag-error' : 'tag-warning'}" style="font-size:10px;">${a.meses_em_atraso} ${a.meses_em_atraso === 1 ? 'mês' : 'meses'} em atraso</span></div>
                    <div class="activity-time">${escapeHTML(a.filial || '')} · ${escapeHTML(a.nivel || '')} · último pagamento: ${dataBRConc(a.ultimo_pagamento)}</div>
                </div>
            </div>`).join('')}`;
}

// ---------------------------------------------------------
// Matrículas por canal de origem ("como conheceu a escola")
// ---------------------------------------------------------
async function renderizarCanalOrigemMercurio() {
    const container = document.getElementById('relatorioCanalOrigemMercurio');
    if (!container) return;
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando...</p>';

    const hoje = new Date();
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1);
    const mesInicio = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}`;
    const [{ data: alunos, error }, { data: canais }] = await Promise.all([
        window.supabaseClient.from('mercurio_alunos').select('midia_ingresso, filial, competencia')
            .eq('conta_remuneracao', true).gte('competencia', mesInicio).limit(5000),
        window.supabaseClient.from('mercurio_midia_ingresso').select('codigo, descricao').order('codigo'),
    ]);
    if (error) { container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro: ${escapeHTML(error.message)}</p>`; return; }
    if (!alunos || alunos.length === 0) { container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Ainda não há matrículas nos últimos 6 meses no banco do Mercúrio.</p>'; return; }

    const descricao = new Map((canais || []).map(c => [Number(c.codigo), c.descricao]));
    const filiais = [...new Set(alunos.map(a => a.filial))].sort();
    const porCodigo = new Map();
    alunos.forEach(a => {
        const cod = a.midia_ingresso == null ? -1 : Number(a.midia_ingresso);
        if (!porCodigo.has(cod)) porCodigo.set(cod, { total: 0, porFilial: {} });
        const g = porCodigo.get(cod);
        g.total++;
        g.porFilial[a.filial] = (g.porFilial[a.filial] || 0) + 1;
    });
    const linhas = [...porCodigo.entries()].sort((a, b) => b[1].total - a[1].total);
    const total = alunos.length;

    container.innerHTML = `
        <table class="tabela-relatorio">
            <thead><tr><th>Código</th><th>Canal (preencha o significado)</th><th>Matrículas</th><th>%</th>${filiais.map(f => `<th>${escapeHTML(f.replace('Goiânia - ', ''))}</th>`).join('')}</tr></thead>
            <tbody>
                ${linhas.map(([cod, g]) => `
                    <tr>
                        <td>${cod < 0 ? '—' : cod}</td>
                        <td>${cod < 0 ? '<span style="color:var(--text-muted);">não informado</span>' : `<input type="text" value="${escapeHTML(descricao.get(cod) || '')}" placeholder="${cod === 0 ? 'provavelmente “não informado”' : 'ex: Instagram, indicação...'}" style="width:100%; min-width:160px; padding:4px 6px; border:1px solid #cbd5e1; border-radius:4px;" onchange="salvarDescricaoCanalMercurio(${cod}, this.value)">`}</td>
                        <td><strong>${g.total}</strong></td>
                        <td>${Math.round(g.total / total * 100)}%</td>
                        ${filiais.map(f => `<td>${g.porFilial[f] || ''}</td>`).join('')}
                    </tr>`).join('')}
            </tbody>
        </table>
        <p class="report-sub" style="margin-top:8px;">Matrículas que contam pra cobrança nos últimos 6 meses, pelo campo "como conheceu a escola" do Mercúrio. O banco guarda só o número do canal — o significado de cada código é preenchido aqui e vale pra todo o time.</p>
    `;
}

async function salvarDescricaoCanalMercurio(codigo, valor) {
    const { error } = await window.supabaseClient.from('mercurio_midia_ingresso')
        .upsert({ codigo, descricao: String(valor || '').trim() || null, ordem: codigo }, { onConflict: 'codigo' });
    if (error) alert('Erro ao salvar: ' + error.message);
}

// =========================================================
// Ciclos de Abertura de Turma + Cobrança Mensal (Módulo 2)
// =========================================================
// O cálculo vive só na Edge Function `cobranca-mensal` (dia 10 ou próximo dia
// útil, rascunho + aviso no WhatsApp do admin). Aqui: cadastro dos ciclos por
// filial, revisão do rascunho (tirar/devolver aluno), fechamento e Excel.

const NOMES_MES_COB = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const rotuloMesCob = (m) => { const [a, mm] = String(m).split('-'); return `${NOMES_MES_COB[Number(mm) - 1]}/${a}`; };
const dataBRCob = (iso) => { if (!iso) return '—'; const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const realCob = (v) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hojeCob = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function numeroValidoCobranca(valor) {
    if (valor == null || (typeof valor === 'string' && valor.trim() === '')) return null;
    const numero = Number(valor);
    return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

function motivoPendenciaCobranca(c) {
    const filiais = typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : [];
    const filial = filiais.find(f => f.nome === c.filial);
    if (filial?.filial_cobranca_id != null) {
        const grupo = filiais.find(f => String(f.id) === String(filial.filial_cobranca_id));
        return `Esta filial está incluída na cobrança de ${grupo?.nome || 'outra filial'}; não feche uma cobrança própria.`;
    }
    if (c.modulo2_contratado === false) return null;
    if (c.matriculas == null) return 'A quantidade de matrículas não foi consultada; configure o vínculo com o Mercúrio antes de cobrar.';
    if (numeroValidoCobranca(c.valor_fixo) == null) {
        if (c.fixo_manual) return 'O ajuste manual do Fixo está ausente ou inválido.';
        const membros = c.membros_congelados;
        if (membros == null || (typeof membros === 'string' && membros.trim() === '')) {
            return 'A contagem de membros não foi congelada. Informe a quantidade ou sincronize o Mercúrio e gere uma nova prévia.';
        }
        return 'A contagem de membros congelada é inválida. Corrija-a e gere uma nova prévia.';
    }
    if (Number(c.matriculas || 0) > 0 && numeroValidoCobranca(c.valor_mensalidade) == null) {
        return 'Falta o valor da mensalidade para calcular a comissão de 30%.';
    }
    if (numeroValidoCobranca(c.total) == null) return 'O total da cobrança não foi calculado.';
    return null;
}

let mesSelecionadoCobranca = null;

function filiaisComMercurio() {
    return (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).filter(f => f.mercurio_unidade);
}
function autorCob() {
    return (typeof usuarioLogado === 'function' && usuarioLogado()?.nome) || localStorage.getItem('crm_na_nome_atendente') || null;
}

// Mesma regra da Edge Function: dia 10, ou o próximo dia útil (sem fim de
// semana e feriado nacional). Só pra mostrar na tela.
function somarDiasCob(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function pascoaCob(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
function diaDeCobrancaCob(ano, mes) {
    const p = pascoaCob(ano);
    const feriados = new Set([...['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map(x => `${ano}-${x}`),
        ...[-48, -47, -2, 60].map(n => somarDiasCob(p, n))]);
    let d = `${ano}-${String(mes).padStart(2, '0')}-10`;
    for (;;) { const s = new Date(d + 'T12:00:00Z').getUTCDay(); if (s !== 0 && s !== 6 && !feriados.has(d)) return d; d = somarDiasCob(d, 1); }
}
function proximaDataCobranca() {
    const hoje = hojeCob(); const [a, m] = hoje.split('-').map(Number);
    const deste = diaDeCobrancaCob(a, m);
    if (deste >= hoje) return deste;
    return m === 12 ? diaDeCobrancaCob(a + 1, 1) : diaDeCobrancaCob(a, m + 1);
}

// ---------------------------------------------------------
// Ciclos de abertura de turma (por filial)
// ---------------------------------------------------------
async function renderizarCiclosTurma() {
    const container = document.getElementById('relatorioCiclosTurma');
    if (!container) return;
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando...</p>';
    const filiais = filiaisComMercurio();
    const seisMeses = somarDiasCob(hojeCob(), -183);
    const [{ data: ciclos, error }, { data: turmas }] = await Promise.all([
        window.supabaseClient.from('ciclos_turma').select('*').order('inicio', { ascending: false }),
        window.supabaseClient.from('mercurio_turmas').select('filial, turma, nivel, inicio')
            .eq('tipo', 'P').in('nivel', ['PP', 'N1']).not('inicio', 'is', null).order('inicio'),
    ]);
    if (error) { container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro: ${escapeHTML(error.message)}</p>`; return; }

    container.innerHTML = filiais.map(f => {
        const meus = (ciclos || []).filter(c => c.filial === f.nome);
        const minhasTurmas = (turmas || []).filter(t => t.filial === f.nome);
        const dentro = (c) => minhasTurmas.filter(t => t.inicio >= c.inicio && t.inicio <= c.fim);
        const soltas = minhasTurmas.filter(t => t.inicio >= seisMeses && !meus.some(c => t.inicio >= c.inicio && t.inicio <= c.fim));
        const nomeSeguro = escapeHTML(f.nome);
        return `
            <details class="conc-filial" style="margin-bottom:8px;" ${soltas.length ? 'open' : ''}>
                <summary>${nomeSeguro} — ${meus.length} ciclo(s)${soltas.length ? ` · <span class="tag tag-warning" style="font-size:10px;">${soltas.length} turma(s) recente(s) fora de ciclo</span>` : ''}</summary>
                ${meus.map(c => `
                    <div class="conc-aluno" style="cursor:default;">
                        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                            <input type="text" value="${escapeHTML(c.nome)}" onchange="salvarCampoCiclo(${c.id}, 'nome', this.value)" style="width:170px; padding:4px 6px; border:1px solid #cbd5e1; border-radius:4px;">
                            <input type="date" value="${c.inicio}" onchange="salvarCampoCiclo(${c.id}, 'inicio', this.value)" style="padding:3px 6px; border:1px solid #cbd5e1; border-radius:4px;">
                            <span class="conc-aluno-meta">até</span>
                            <input type="date" value="${c.fim}" onchange="salvarCampoCiclo(${c.id}, 'fim', this.value)" style="padding:3px 6px; border:1px solid #cbd5e1; border-radius:4px;">
                            <button class="icon-btn danger" title="Remover ciclo" onclick="removerCiclo(${c.id}, '${escapeHTML(c.nome).replace(/'/g, "\\'")}')"><i class="fa-solid fa-trash"></i></button>
                        </div>
                        <div class="conc-aluno-meta">${dentro(c).length ? dentro(c).map(t => `${escapeHTML(t.turma)} (${escapeHTML(t.nivel)}, abriu ${dataBRCob(t.inicio)})`).join(' · ') : 'nenhuma turma do programa branco abriu neste período'}</div>
                    </div>`).join('')}
                ${soltas.length ? `<div class="conc-bloco-titulo conc-bloco-investigar">Abriram nos últimos 6 meses e não estão em nenhum ciclo (não entram na cobrança)</div>
                    <div class="conc-aluno-meta" style="padding:4px 0 8px;">${soltas.map(t => `${escapeHTML(t.turma)} (${escapeHTML(t.nivel)}, ${dataBRCob(t.inicio)})`).join(' · ')}</div>` : ''}
                <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; padding:8px 0 12px;">
                    <input type="text" id="cicloNovoNome-${f.id}" placeholder="ex: Ciclo Out/2026" style="width:170px; padding:4px 6px; border:1px solid #cbd5e1; border-radius:4px;">
                    <input type="date" id="cicloNovoInicio-${f.id}" style="padding:3px 6px; border:1px solid #cbd5e1; border-radius:4px;">
                    <span class="conc-aluno-meta">até</span>
                    <input type="date" id="cicloNovoFim-${f.id}" style="padding:3px 6px; border:1px solid #cbd5e1; border-radius:4px;">
                    <button class="btn-secondary" style="font-size:11px; padding:5px 10px;" onclick="adicionarCiclo(${f.id})"><i class="fa-solid fa-plus"></i> Adicionar ciclo</button>
                </div>
            </details>`;
    }).join('') + `<p class="report-sub" style="margin-top:6px;">Toda turma do programa branco (PP/N1) que abrir dentro do período pertence ao ciclo. A cobrança do dia 10 inclui os ciclos que já terminaram; quem entrar numa turma depois que a cobrança dela saiu vai pra cobrança seguinte.</p>`;
}

async function adicionarCiclo(filialId) {
    const f = filiaisComMercurio().find(x => x.id === filialId);
    const nome = document.getElementById(`cicloNovoNome-${filialId}`).value.trim();
    const inicio = document.getElementById(`cicloNovoInicio-${filialId}`).value;
    const fim = document.getElementById(`cicloNovoFim-${filialId}`).value;
    if (!f || !nome || !inicio || !fim) { alert('Preencha nome, início e fim do ciclo.'); return; }
    if (fim < inicio) { alert('O fim do ciclo não pode ser antes do início.'); return; }
    const { error } = await window.supabaseClient.from('ciclos_turma').insert({ filial: f.nome, nome, inicio, fim, criado_por: autorCob() });
    if (error) { alert('Erro ao salvar o ciclo: ' + error.message); return; }
    if (typeof registrarLogAtividade === 'function') registrarLogAtividade('ciclo_turma_criado', { filial: f.nome, detalhes: { nome, inicio, fim } });
    renderizarCiclosTurma();
}

async function salvarCampoCiclo(id, campo, valor) {
    if (!valor) { alert('O campo não pode ficar vazio.'); renderizarCiclosTurma(); return; }
    const { error } = await window.supabaseClient.from('ciclos_turma').update({ [campo]: valor }).eq('id', id);
    if (error) alert('Erro ao salvar: ' + error.message);
    renderizarCiclosTurma();
}

async function removerCiclo(id, nome) {
    if (!confirm(`Remover o ciclo "${nome}"? Cobranças já fechadas não mudam.`)) return;
    const { error } = await window.supabaseClient.from('ciclos_turma').delete().eq('id', id);
    if (error) { alert('Erro ao remover: ' + error.message); return; }
    renderizarCiclosTurma();
}

// ---------------------------------------------------------
// Cobrança mensal — revisão, fechamento e Excel
// ---------------------------------------------------------
async function carregarCobrancasMes(mes) {
    const { data: cobrancas, error } = await window.supabaseClient.from('cobrancas_mensais').select('*').eq('mes', mes).order('filial');
    if (error) throw new Error(error.message);
    const ids = (cobrancas || []).map(c => c.id);
    const itens = ids.length ? await (async () => {
        const todos = [];
        for (let de = 0; ; de += 1000) {
            const { data, error: e } = await window.supabaseClient.from('cobranca_itens').select('*').in('cobranca_id', ids)
                .order('data_referencia').order('id').range(de, de + 999);
            if (e) throw new Error(e.message);
            todos.push(...(data || []));
            if (!data || data.length < 1000) return todos;
        }
    })() : [];
    return (cobrancas || []).map(c => ({ ...c, itens: itens.filter(i => i.cobranca_id === c.id) }));
}

function htmlItemCobranca(i, fechada) {
    const clicavel = i.pessoa_identificador ? `<a href="#" onclick="event.preventDefault(); abrirResultadoBuscaGlobal('${escapeHTML(i.pessoa_identificador)}')"><strong>${escapeHTML(i.nome || '(sem nome)')}</strong></a>` : `<strong>${escapeHTML(i.nome || '(sem nome)')}</strong>`;
    const selos = [
        i.recuperado ? '<span class="tag tag-recuperado" style="font-size:9px;">Reingresso</span>' : '',
        i.ativo === false ? '<span class="tag tag-exaluno" style="font-size:9px;" title="Já não aparece como ativo no Mercúrio">Saiu</span>' : '',
        !i.incluido ? `<span class="tag tag-error" style="font-size:9px;">Fora da cobrança${i.motivo_exclusao ? `: ${escapeHTML(i.motivo_exclusao)}` : ''}</span>` : '',
    ].join(' ');
    return `
        <div class="conc-aluno" style="cursor:default; ${i.incluido ? '' : 'opacity:.55;'}">
            <div style="display:flex; gap:8px; align-items:flex-start;">
                <input type="checkbox" ${i.incluido ? 'checked' : ''} ${fechada ? 'disabled' : ''} title="Desmarque pra tirar da cobrança" onchange="alternarItemCobranca(${i.id}, ${i.cobranca_id}, this.checked)">
                <div>
                    <div>${clicavel} <span class="conc-aluno-meta">matr. ${i.matricula} · ${escapeHTML(i.nivel || '?')} · ${escapeHTML(i.turma || 'sem turma')}</span> ${selos}</div>
                    <div class="conc-aluno-meta">${i.programa === 'branco' ? `Turma abriu em ${dataBRCob(i.data_referencia)}` : 'Conta pela data individual'} · matrícula ${dataBRCob(i.data_efetiva)}${i.ciclo_nome ? ` · ${escapeHTML(i.ciclo_nome)}` : ''}</div>
                </div>
            </div>
        </div>`;
}

async function renderizarCobrancaMensal() {
    const container = document.getElementById('relatorioCobrancaMensal');
    if (!container) return;
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando...</p>';

    const { data: mesesBrutos } = await window.supabaseClient.from('cobrancas_mensais').select('mes').order('mes', { ascending: false }).limit(500);
    const meses = [...new Set((mesesBrutos || []).map(m => m.mes))];
    if (!mesSelecionadoCobranca || !meses.includes(mesSelecionadoCobranca)) mesSelecionadoCobranca = meses[0] || null;
    const proxima = proximaDataCobranca();

    const cabecalho = `
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px; flex-wrap:wrap;">
            <span style="font-size:12px;">Próxima cobrança automática: <strong>${dataBRCob(proxima)}</strong> (o rascunho chega no seu WhatsApp pra revisar)</span>
            ${meses.length ? `<label style="font-size:12px; font-weight:600;">Mês:</label>
                <select onchange="mesSelecionadoCobranca = this.value; renderizarCobrancaMensal();" style="padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;">
                    ${meses.map(m => `<option value="${m}" ${m === mesSelecionadoCobranca ? 'selected' : ''}>${rotuloMesCob(m)}</option>`).join('')}
                </select>` : ''}
            <button class="btn-secondary" style="font-size:11px; padding:6px 10px;" onclick="gerarPreviaCobranca(this)" title="Calcula agora, com corte em hoje, sem mandar WhatsApp"><i class="fa-solid fa-calculator"></i> Gerar prévia agora</button>
        </div>`;
    if (!mesSelecionadoCobranca) {
        container.innerHTML = cabecalho + '<p style="font-size:12px; color:var(--text-muted);">Nenhuma cobrança gerada ainda. Cadastre os ciclos de abertura de turma abaixo; no dia da cobrança o rascunho é montado sozinho.</p>';
        return;
    }

    let cobrancas;
    try { cobrancas = await carregarCobrancasMes(mesSelecionadoCobranca); }
    catch (e) { container.innerHTML = cabecalho + `<p style="font-size:12px; color:#dc2626;">Erro: ${escapeHTML(e.message)}</p>`; return; }

    const fechada = cobrancas.length && cobrancas.every(c => c.status === 'fechada');
    const temTotalPendente = cobrancas.some(c => c.status === 'rascunho' && (motivoPendenciaCobranca(c) || (c.modulo2_contratado !== false && numeroValidoCobranca(c.total) == null)));
    const totalGeral = temTotalPendente ? null : cobrancas.reduce((s, c) => s + Number(c.total || 0), 0);
    const totalMatriculas = cobrancas.some(c => c.status === 'rascunho' && c.matriculas == null)
        ? null
        : cobrancas.reduce((s, c) => s + (c.matriculas || 0), 0);
    const alertasPendencia = cobrancas.filter(c => c.status === 'rascunho').map(c => ({ filial: c.filial, motivo: motivoPendenciaCobranca(c) })).filter(c => c.motivo);
    container.innerHTML = cabecalho + `
        <div style="font-size:12px; margin-bottom:8px;">
            ${fechada
                ? `<span class="tag tag-ativo">Fechada</span> em ${new Date(cobrancas[0].fechado_em).toLocaleString('pt-BR')}${cobrancas[0].fechado_por ? ` por ${escapeHTML(cobrancas[0].fechado_por)}` : ''}`
                : `<span class="tag tag-warning">Rascunho</span> corte em ${dataBRCob(cobrancas[0]?.data_cobranca)} · gerado em ${cobrancas[0] ? new Date(cobrancas[0].gerado_em).toLocaleString('pt-BR') : '—'}`}
        </div>
        ${alertasPendencia.length ? `<p style="font-size:12px; color:#b91c1c; margin:0 0 8px;"><i class="fa-solid fa-triangle-exclamation"></i> Fechamento bloqueado: ${alertasPendencia.map(p => `<strong>${escapeHTML(p.filial)}:</strong> ${escapeHTML(p.motivo)}`).join(' · ')}</p>` : ''}
        <table class="tabela-relatorio">
            <thead><tr><th>Filial</th><th>Ciclos cobertos</th><th>Membros (congelado)</th><th>Fixo</th><th>Matrículas</th><th>Investigar</th><th>Comissão (30%)</th><th>Total a cobrar</th></tr></thead>
            <tbody>
                ${cobrancas.map(c => {
                    const pendencia = c.status === 'rascunho' ? motivoPendenciaCobranca(c) : null;
                    const filiais = typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : [];
                    const filialAtual = filiais.find(f => f.nome === c.filial);
                    const grupo = filialAtual?.filial_cobranca_id != null ? filiais.find(f => String(f.id) === String(filialAtual.filial_cobranca_id)) : null;
                    return `
                    <tr style="${c.modulo2_contratado ? '' : 'opacity:.6;'}">
                        <td>${escapeHTML(c.filial)}${grupo ? ` <span class="tag tag-warning" style="font-size:9px;">Incluída em ${escapeHTML(grupo.nome)}</span>` : (c.modulo2_contratado ? '' : ' <span class="tag tag-exaluno" style="font-size:9px;">Não cobrada</span>')}</td>
                        <td>${(c.ciclos || []).length ? c.ciclos.map(x => escapeHTML(x.nome)).join('<br>') : '<span class="tag tag-warning" style="font-size:10px;">nenhum ciclo</span>'}</td>
                        <td>${c.membros_congelados ?? '—'}</td>
                        <td>${realCob(c.valor_fixo)}${c.fixo_manual ? ' <span class="conc-aluno-meta">(manual)</span>' : ''}</td>
                        <td><strong>${c.matriculas ?? '—'}</strong>${c.matriculas != null && c.itens.length > c.matriculas ? ` <span class="conc-aluno-meta">(${c.itens.length - c.matriculas} fora)</span>` : ''}</td>
                        <td>${(c.investigar || []).length ? `<span class="tag tag-warning" style="font-size:10px;">${c.investigar.length}</span>` : '0'}</td>
                        <td>${realCob(c.comissao)}</td>
                        <td><strong>${realCob(c.total)}${pendencia ? ` <span class="tag tag-error" title="${escapeHTML(pendencia)}" style="font-size:9px;">Pendente</span>` : ''}</strong></td>
                    </tr>`;
                }).join('')}
                ${(typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).filter(f => f.filial_cobranca_id != null && !cobrancas.some(c => c.filial === f.nome)).map(f => {
                    const grupo = filiaisDisponiveis.find(x => String(x.id) === String(f.filial_cobranca_id));
                    return `<tr><td>${escapeHTML(f.nome)} <span class="tag tag-warning" style="font-size:9px;">Incluída em ${escapeHTML(grupo?.nome || 'outra filial')}</span></td><td>—</td><td>—</td><td>R$0,00</td><td>—</td><td>—</td><td>R$0,00</td><td>Consolidada em ${escapeHTML(grupo?.nome || 'outra filial')}</td></tr>`;
                }).join('')}
                <tr style="font-weight:700; background:#f8fafc;"><td>TOTAL</td><td></td><td></td><td></td><td>${totalMatriculas ?? '—'}</td><td></td><td></td><td>${realCob(totalGeral)}</td></tr>
            </tbody>
        </table>
        <div style="display:flex; gap:8px; margin:10px 0; flex-wrap:wrap;">
            <button class="btn-secondary" style="font-size:11px; padding:6px 10px;" onclick="exportarCobrancaMensalExcel()"><i class="fa-solid fa-file-excel"></i> Gerar Excel</button>
            ${fechada ? '' : `<button class="btn-primary" style="font-size:11px; padding:6px 12px;" onclick="fecharCobrancaMes()" ${temTotalPendente ? 'disabled title="Há filial com cálculo pendente; corrija os dados antes de fechar."' : ''}><i class="fa-solid fa-lock"></i> Fechar cobrança de ${rotuloMesCob(mesSelecionadoCobranca)}</button>`}
        </div>
        <div class="conc-detalhes">
            ${cobrancas.filter(c => c.itens.length || (c.investigar || []).length).map(c => `
                <details class="conc-filial">
                    <summary>${escapeHTML(c.filial)} — ${c.matriculas == null ? 'matrículas não consultadas' : `${c.matriculas} na cobrança`}${(c.investigar || []).length ? `, ${c.investigar.length} pra investigar` : ''}</summary>
                    ${(c.investigar || []).length ? `<div class="conc-bloco-titulo conc-bloco-investigar">Investigar (não entram até serem corrigidos no Mercúrio)</div>
                        ${c.investigar.map(a => `<div class="conc-aluno" style="cursor:default;"><div><strong>${escapeHTML(a.nome || '')}</strong> <span class="conc-aluno-meta">matr. ${a.matricula} · ${escapeHTML(a.nivel || '')} · ${escapeHTML(a.turma || '')} · ${escapeHTML(a.ciclo_nome || '')}</span></div><div class="conc-aluno-motivo"><i class="fa-solid fa-magnifying-glass"></i> ${escapeHTML(a.motivo || '')}</div></div>`).join('')}` : ''}
                    ${c.itens.length ? `<div class="conc-bloco-titulo">Alunos da cobrança</div>${c.itens.map(i => htmlItemCobranca(i, c.status === 'fechada')).join('')}` : ''}
                </details>`).join('')}
        </div>
        <p class="report-sub" style="margin-top:10px;">Programa branco conta pela turma de abertura, quando o ciclo dela já terminou; complementar conta pela data individual. Desmarcar um aluno tira ele desta cobrança e de todas as seguintes. O Fixo é R$4,96 por membro por mês, sem mínimo nem teto; a quantidade manual da filial vence, e em branco usa o Mercúrio. A quantidade é congelada no rascunho. Rascunho com cálculo pendente não pode ser fechado.</p>`;
}

async function gerarPreviaCobranca(botao) {
    if (!confirm('Gerar a prévia agora, com corte em hoje? Um rascunho já aberto é recalculado (os alunos que você tirou continuam fora). Nada é enviado.')) return;
    const original = botao.innerHTML;
    botao.disabled = true; botao.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Calculando...';
    try {
        const { data, error } = await window.supabaseClient.functions.invoke('cobranca-mensal', { body: { forcar: true, semAviso: true } });
        if (error) throw error;
        const problemas = (data?.resultados || []).filter(r => r.erro || r.pulada || r.erroCalculo).map(r => `${r.filial}: ${r.erro || r.pulada || r.erroCalculo}`);
        if (problemas.length) alert(problemas.join('\n'));
        mesSelecionadoCobranca = data?.mes || mesSelecionadoCobranca;
    } catch (e) {
        alert('Erro ao gerar a prévia: ' + (e.message || e));
    } finally {
        botao.disabled = false; botao.innerHTML = original;
        renderizarCobrancaMensal();
    }
}

async function recalcularTotaisCobranca(cobrancaId) {
    const [{ data: c }, { count }] = await Promise.all([
        window.supabaseClient.from('cobrancas_mensais').select('valor_fixo, valor_mensalidade, matriculas, modulo2_contratado, status').eq('id', cobrancaId).single(),
        window.supabaseClient.from('cobranca_itens').select('id', { count: 'exact', head: true }).eq('cobranca_id', cobrancaId).eq('incluido', true),
    ]);
    if (!c || c.status !== 'rascunho' || count == null) return; // nunca altera cobrança fechada nem presume 0 em falha de contagem
    const matriculas = count;
    const mensalidade = numeroValidoCobranca(c.valor_mensalidade);
    const comissao = matriculas === 0 ? 0 : mensalidade == null ? null : Math.round(matriculas * mensalidade * 0.3 * 100) / 100;
    const fixo = numeroValidoCobranca(c.valor_fixo);
    const total = c.modulo2_contratado === false ? 0 : (fixo == null || comissao == null ? null : fixo + comissao);
    await window.supabaseClient.from('cobrancas_mensais').update({ matriculas, comissao, total }).eq('id', cobrancaId).eq('status', 'rascunho');
}

async function alternarItemCobranca(itemId, cobrancaId, incluir) {
    let motivo = null;
    if (!incluir) {
        motivo = prompt('Por que este aluno sai da cobrança? (fica registrado)');
        if (motivo === null) { renderizarCobrancaMensal(); return; }
    }
    const { error } = await window.supabaseClient.from('cobranca_itens')
        .update({ incluido: incluir, motivo_exclusao: incluir ? null : (motivo.trim() || null) }).eq('id', itemId);
    if (error) { alert('Erro: ' + error.message); return; }
    await recalcularTotaisCobranca(cobrancaId);
    if (typeof registrarLogAtividade === 'function') registrarLogAtividade('cobranca_item_alterado', { detalhes: { itemId, cobrancaId, incluir, motivo } });
    renderizarCobrancaMensal();
}

async function fecharCobrancaMes() {
    const mes = mesSelecionadoCobranca;
    if (!mes) return;
    let cobrancas;
    try { cobrancas = await carregarCobrancasMes(mes); }
    catch (e) { alert('Não foi possível conferir a cobrança antes do fechamento: ' + e.message); return; }
    const pendentes = cobrancas.filter(c => c.status === 'rascunho').map(c => ({ filial: c.filial, motivo: motivoPendenciaCobranca(c) })).filter(c => c.motivo);
    if (pendentes.length) {
        alert(`Não é possível fechar a cobrança enquanto houver cálculo pendente:\n${pendentes.map(c => `• ${c.filial}: ${c.motivo}`).join('\n')}`);
        renderizarCobrancaMensal();
        return;
    }
    if (!mes || !confirm(`Fechar a cobrança de ${rotuloMesCob(mes)}? Depois de fechada ela não muda mais, e os alunos dela nunca mais entram em outra cobrança.`)) return;
    const { error } = await window.supabaseClient.from('cobrancas_mensais')
        .update({ status: 'fechada', fechado_em: new Date().toISOString(), fechado_por: autorCob() })
        .eq('mes', mes).eq('status', 'rascunho');
    if (error) { alert('Erro ao fechar: ' + error.message); return; }
    if (typeof registrarLogAtividade === 'function') registrarLogAtividade('cobranca_fechada', { filial: 'GLOBAL', detalhes: { mes } });
    renderizarCobrancaMensal();
}

async function exportarCobrancaMensalExcel() {
    if (typeof XLSX === 'undefined') { alert('A biblioteca de Excel ainda não carregou. Tente de novo em alguns segundos.'); return; }
    const mes = mesSelecionadoCobranca;
    let cobrancas;
    try { cobrancas = await carregarCobrancasMes(mes); } catch (e) { alert('Erro: ' + e.message); return; }
    const MOEDA = '"R$" #,##0.00';
    const wb = XLSX.utils.book_new();
    const resumo = [['Filial', 'Ciclos', 'Membros', 'Fixo (R$4,96 por membro/mês)', 'Matrículas', 'Mensalidade', 'Comissão (30%)', 'Total a cobrar', 'Status']];
    cobrancas.forEach(c => {
        const filiais = typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : [];
        const filial = filiais.find(f => f.nome === c.filial);
        const grupo = filial?.filial_cobranca_id != null ? filiais.find(f => String(f.id) === String(filial.filial_cobranca_id)) : null;
        resumo.push([c.filial, grupo ? `Cobrança consolidada em ${grupo.nome}` : (c.ciclos || []).map(x => x.nome).join(', '), c.membros_congelados ?? '',
            c.valor_fixo != null ? Number(c.valor_fixo) : '', c.matriculas ?? '', c.valor_mensalidade != null ? Number(c.valor_mensalidade) : '',
            c.comissao != null ? Number(c.comissao) : '', c.total != null ? Number(c.total) : '', c.modulo2_contratado ? (motivoPendenciaCobranca(c) ? `${c.status} — cálculo pendente` : c.status) : 'não cobrada']);
    });
    (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).filter(f => f.filial_cobranca_id != null && !cobrancas.some(c => c.filial === f.nome)).forEach(f => {
        const grupo = filiaisDisponiveis.find(x => String(x.id) === String(f.filial_cobranca_id));
        resumo.push([f.nome, `Cobrança consolidada em ${grupo?.nome || 'outra filial'}`, '', 0, '', '', 0, '', `incluída em ${grupo?.nome || 'outra filial'}`]);
    });
    const totalExportavel = cobrancas.some(c => (c.status === 'rascunho' && motivoPendenciaCobranca(c)) || (c.modulo2_contratado !== false && numeroValidoCobranca(c.total) == null))
        ? '' : cobrancas.reduce((s, c) => s + Number(c.total || 0), 0);
    const totalMatriculasExport = cobrancas.some(c => c.status === 'rascunho' && c.matriculas == null)
        ? '' : cobrancas.reduce((s, c) => s + (c.matriculas || 0), 0);
    resumo.push(['TOTAL', '', '', '', totalMatriculasExport, '', '', totalExportavel, '']);
    const wsR = XLSX.utils.aoa_to_sheet(resumo);
    wsR['!cols'] = [{ wch: 28 }, { wch: 26 }, { wch: 9 }, { wch: 12 }, { wch: 11 }, { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 12 }];
    aplicarFormatoMoedaColunasExcel(wsR, [4, 6, 7, 8], resumo.length, MOEDA);
    XLSX.utils.book_append_sheet(wb, wsR, 'Resumo');

    cobrancas.forEach(c => {
        const valor = numeroValidoCobranca(c.valor_mensalidade);
        const linhas = [['Nome', 'Matrícula', 'Nível', 'Turma', 'Abertura da turma / data', 'Matrícula em', 'Ciclo', 'Contribuição', 'Comissão (30%)']];
        c.itens.filter(i => i.incluido).forEach(i => linhas.push([i.nome || '', i.matricula, i.nivel || '', i.turma || '',
            dataBRCob(i.data_referencia), dataBRCob(i.data_efetiva), i.ciclo_nome || '', valor ?? '', valor != null ? valor * 0.3 : '']));
        const n = linhas.length;
        const fora = c.itens.filter(i => !i.incluido);
        if (fora.length) { linhas.push([]); linhas.push(['FORA DA COBRANÇA', 'Matrícula', 'Motivo']); fora.forEach(i => linhas.push([i.nome || '', i.matricula, i.motivo_exclusao || ''])); }
        if ((c.investigar || []).length) { linhas.push([]); linhas.push(['INVESTIGAR', 'Matrícula', 'Motivo']); c.investigar.forEach(a => linhas.push([a.nome || '', a.matricula, a.motivo || ''])); }
        const ws = XLSX.utils.aoa_to_sheet(linhas);
        ws['!cols'] = [{ wch: 34 }, { wch: 11 }, { wch: 7 }, { wch: 18 }, { wch: 18 }, { wch: 13 }, { wch: 22 }, { wch: 13 }, { wch: 15 }];
        aplicarFormatoMoedaColunasExcel(ws, [8, 9], n, MOEDA);
        XLSX.utils.book_append_sheet(wb, ws, sanitizarNomeAbaExcel(c.filial));
    });
    XLSX.writeFile(wb, `Cobranca_${rotuloMesCob(mes).replace('/', '_')}.xlsx`);
}

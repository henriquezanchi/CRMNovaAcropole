// Saldo de comissões por filial. Centavos inteiros; recebido em branco é
// desconhecido, nunca um pagamento zero presumido. Não altera faturas.
let filialAcertoSelecionada = null;
let linhasAcertoComissao = [];
let versaoRenderAcertos = 0;

function centavosAcerto(valor) {
    if (valor == null || String(valor).trim() === '') return null;
    const texto = String(valor).trim().replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(texto)) throw new Error('Informe um valor positivo com até duas casas decimais, ou zero.');
    const [inteiro, decimal = ''] = texto.split('.');
    const total = Number(inteiro) * 100 + Number(decimal.padEnd(2, '0'));
    if (!Number.isSafeInteger(total) || total > 999999999999) throw new Error('Valor fora do limite.');
    return total;
}
function proximoMesAcerto(mes) {
    const [ano, numero] = mes.split('-').map(Number);
    return numero === 12 ? `${ano + 1}-01` : `${ano}-${String(numero + 1).padStart(2, '0')}`;
}
function calcularAcertosComissao(linhas) {
    let saldo = 0, anterior = null;
    return linhas.slice().sort((a, b) => a.mes.localeCompare(b.mes)).map(linha => {
        if (anterior && proximoMesAcerto(anterior) !== linha.mes) saldo = null;
        const devido = centavosAcerto(linha.comissao_devida);
        const recebido = centavosAcerto(linha.valor_recebido);
        const saldoAnterior = saldo;
        const ajustado = saldoAnterior == null || devido == null ? null : saldoAnterior + devido;
        const diferencaMes = devido == null || recebido == null ? null : devido - recebido;
        saldo = ajustado == null || recebido == null ? null : ajustado - recebido;
        anterior = linha.mes;
        return { ...linha, saldoAnterior, ajustado, diferencaMes, saldoSeguinte: saldo,
            aReceber: ajustado == null ? null : Math.max(0, ajustado),
            creditoDaEscola: ajustado == null ? null : Math.max(0, -ajustado) };
    });
}
function moedaAcerto(centavos) {
    return centavos == null ? 'Pendente' : (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function autorAcerto() {
    return (typeof usuarioLogado === 'function' && usuarioLogado()?.nome) || localStorage.getItem('crm_na_nome_atendente') || null;
}
async function renderizarAcertosComissao() {
    const container = document.getElementById('relatorioAcertosComissao');
    if (!container) return;
    const rodada = ++versaoRenderAcertos;
    const filiais = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).filter(f => !f.filial_cobranca_id && f.modulo2_contratado !== false);
    if (!filiais.length) { container.innerHTML = '<p>Nenhuma filial com cobrança própria ativa.</p>'; return; }
    if (!filiais.some(f => String(f.id) === String(filialAcertoSelecionada))) filialAcertoSelecionada = filiais[0].id;
    container.innerHTML = '<p>Carregando acertos...</p>';
    try {
        const linhas = [];
        for (let de = 0; ; de += 1000) {
            const { data, error } = await window.supabaseClient.from('comissao_acertos').select('*')
                .eq('filial_id', filialAcertoSelecionada).order('mes').range(de, de + 999);
            if (error) throw error;
            linhas.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
        if (rodada !== versaoRenderAcertos) return;
        const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
        const mesRelatorio = typeof mesSelecionadoComissaoSdr !== 'undefined' ? mesSelecionadoComissaoSdr : null;
        const ultimo = [hoje, mesRelatorio, ...linhas.map(l => l.mes)].filter(Boolean).sort().at(-1);
        const primeiro = [mesRelatorio, ...linhas.map(l => l.mes), hoje].filter(Boolean).sort()[0];
        const porMes = new Map(linhas.map(l => [l.mes, l]));
        const meses = [];
        for (let mes = primeiro; mes <= proximoMesAcerto(ultimo); mes = proximoMesAcerto(mes)) {
            meses.push(porMes.get(mes) || { mes, comissao_devida: null, valor_recebido: null, versao: 0, observacao: '', origem: 'manual' });
        }
        linhasAcertoComissao = calcularAcertosComissao(meses);
        const filial = filiais.find(f => String(f.id) === String(filialAcertoSelecionada));
        const grupo = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).filter(f => String(f.filial_cobranca_id) === String(filial.id));
        container.innerHTML = `
            <label>Filial <select onchange="filialAcertoSelecionada=this.value; renderizarAcertosComissao()">${filiais.map(f => `<option value="${f.id}" ${String(f.id) === String(filial.id) ? 'selected' : ''}>${escapeHTML(f.nome)}</option>`).join('')}</select></label>
            <button class="btn-secondary" onclick="exportarAcertosComissao()">Exportar acertos CSV</button>
            ${grupo.length ? `<p class="report-sub">Inclui a base acadêmica de ${escapeHTML(grupo.map(f => f.nome).join(', '))}.</p>` : ''}
            <p class="report-sub">Somente comissões, sem o fixo de R$ 4,96 por membro. Positivo: falta receber. Negativo: crédito da escola para descontar depois. Informe zero quando não recebeu nada; em branco, o saldo seguinte fica pendente. Os valores devidos dos meses anteriores podem ser corrigidos quando o Mercúrio for atualizado.</p>
            <div style="overflow-x:auto"><table class="tabela-relatorio"><thead><tr><th>Mês</th><th>Comissão devida (R$)</th><th>Recebido (R$)</th><th>Diferença do mês</th><th>Saldo anterior</th><th>Comissão ajustada</th><th>Saldo para o mês seguinte</th><th>Observação</th><th></th></tr></thead><tbody>
            ${linhasAcertoComissao.map(l => `<tr>
                <td>${l.mes}</td>
                <td><input aria-label="Comissão devida em ${l.mes}" id="acerto-devido-${l.mes}" type="number" min="0" step="0.01" value="${l.comissao_devida ?? ''}" style="width:110px">${mesRelatorio === l.mes ? `<button class="btn-secondary" onclick="usarApuracaoAcerto('${l.mes}')" title="Preencher com a comissão da prévia acima">Usar prévia</button>` : ''}</td>
                <td><input aria-label="Comissão recebida em ${l.mes}" id="acerto-recebido-${l.mes}" type="number" min="0" step="0.01" value="${l.valor_recebido ?? ''}" placeholder="Não informado" style="width:110px"></td>
                <td>${moedaAcerto(l.diferencaMes)}</td><td>${moedaAcerto(l.saldoAnterior)}</td>
                <td>${moedaAcerto(l.ajustado)}</td><td><strong>${moedaAcerto(l.saldoSeguinte)}</strong></td>
                <td><input aria-label="Observação em ${l.mes}" id="acerto-obs-${l.mes}" maxlength="2000" value="${escapeHTML(l.observacao || '')}" style="width:180px"><small style="display:block">${escapeHTML(l.origem || 'manual')}</small></td>
                <td><button id="acerto-salvar-${l.mes}" class="btn-secondary" onclick="salvarAcertoComissao('${l.mes}')">Salvar</button></td>
            </tr>`).join('')}</tbody></table></div>
            <p class="report-sub">A comissão ajustada pode ficar negativa: esse crédito permanece para os meses seguintes até ser compensado. Campos salvos têm histórico de alterações. Esta simulação não modifica cobranças fechadas nem emite pagamentos.</p>`;
    } catch (e) {
        if (rodada === versaoRenderAcertos) container.innerHTML = `<p style="color:#b91c1c">Não foi possível carregar os acertos: ${escapeHTML(e.message || String(e))}</p>`;
    }
}
function usarApuracaoAcerto(mes) {
    const relatorio = typeof ultimoResultadoComissaoSdr !== 'undefined' ? ultimoResultadoComissaoSdr : null;
    const filial = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).find(f => String(f.id) === String(filialAcertoSelecionada));
    const linha = relatorio?.mes === mes ? relatorio.resultados.find(r => r.nome === filial?.nome) : null;
    if (!linha || linha.comissao == null || linha.erroCalculo || linha.investigar > 0) {
        alert('A prévia está pendente ou tem matrículas para investigar. Confira os dados antes de usá-la.'); return;
    }
    document.getElementById(`acerto-devido-${mes}`).value = (Math.round(linha.comissao * 100) / 100).toFixed(2);
    document.getElementById(`acerto-devido-${mes}`).dataset.origem = 'previa_mercurio';
}
async function salvarAcertoComissao(mes) {
    const linha = linhasAcertoComissao.find(l => l.mes === mes);
    if (!linha) return;
    const btn = document.getElementById(`acerto-salvar-${mes}`);
    btn.disabled = true;
    try {
        const inputDevido = document.getElementById(`acerto-devido-${mes}`);
        const devido = centavosAcerto(inputDevido.value);
        const recebido = centavosAcerto(document.getElementById(`acerto-recebido-${mes}`).value);
        const mudouDevido = devido !== centavosAcerto(linha.comissao_devida);
        const { error } = await window.supabaseClient.rpc('salvar_acerto_comissao', {
            p_filial_id: Number(filialAcertoSelecionada), p_mes: mes,
            p_devida: devido == null ? null : devido / 100, p_recebido: recebido == null ? null : recebido / 100,
            p_versao: linha.versao, p_origem: inputDevido.dataset.origem || (mudouDevido ? 'manual' : linha.origem),
            p_observacao: document.getElementById(`acerto-obs-${mes}`).value.trim() || null, p_autor: autorAcerto(),
        });
        if (error) throw error;
        await renderizarAcertosComissao();
    } catch (e) { alert(e.message || String(e)); } finally { btn.disabled = false; }
}
function exportarAcertosComissao() {
    const filial = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).find(f => String(f.id) === String(filialAcertoSelecionada));
    const linhas = [['Filial','Mês','Comissão devida','Recebido','Diferença do mês','Saldo anterior','Comissão ajustada','Saldo seguinte','Observação'],
        ...linhasAcertoComissao.map(l => [filial?.nome || '', l.mes, l.comissao_devida, l.valor_recebido,
            ...[l.diferencaMes,l.saldoAnterior,l.ajustado,l.saldoSeguinte].map(v => v == null ? '' : (v / 100).toFixed(2)), l.observacao || ''])];
    const campo = v => {
        let texto = String(v ?? '');
        if (/^\s*[=+@-]/.test(texto) && !/^-?\d+(?:\.\d+)?$/.test(texto)) texto = "'" + texto;
        return '"' + texto.replace(/"/g, '""') + '"';
    };
    const csv = '\ufeff' + linhas.map(l => l.map(campo).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href=url; a.download=`acertos_comissao_${filialAcertoSelecionada}.csv`; a.click(); URL.revokeObjectURL(url);
}

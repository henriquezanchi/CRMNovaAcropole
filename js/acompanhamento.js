// Complementa o Kanban existente; não envia mensagens nem muda cobranças.
let acompanhamentoFila = [];
let acompanhamentoConsulta = 0;
let acompanhamentoSalvando = false;

function acompanhamentoOpcoes(chave, selecionado) {
    return Object.entries(AcompanhamentoModelo.campos[chave]).map(([valor, rotulo]) => `<option value="${valor}" ${valor === selecionado ? 'selected' : ''}>${escapeHTML(rotulo)}</option>`).join('');
}
function acompanhamentoDataLocal(iso) {
    if (!iso || !Number.isFinite(Date.parse(iso))) return '';
    const data = new Date(iso);
    return new Date(data.getTime() - data.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function renderizarAcompanhamento(lead) {
    const el = document.getElementById('acompanhamentoLead');
    if (!el) return;
    const dado = AcompanhamentoModelo.normalizar(lead.acompanhamento);
    const schemaPronto = Object.hasOwn(lead, 'acompanhamento');
    el.innerHTML = `<details open><summary><strong>Acolhimento e próximo passo</strong></summary>
        <p>Registre o que a pessoa declarou. Silêncio não é recusa; simpatia não é confirmação.</p>
        ${!schemaPronto ? '<p role="status">Atualização do banco pendente. Os registros antigos continuam disponíveis.</p>' : ''}
        <form id="acompanhamentoForm"><fieldset ${!schemaPronto ? 'disabled' : ''}>
        <div class="acompanhamento-grade">${['relacao', 'origem', 'entrada', 'intencao', 'contato', 'experiencia', 'inscricao', 'fonte_registro', 'apoio_escola', 'proximo'].map(chave => `<label>${escapeHTML(({ relacao: 'Relação atual com a escola', origem: 'Canal de origem', entrada: 'Forma de entrada', intencao: 'Intenção declarada', contato: 'Preferência de contato', experiencia: 'Experiência relatada', inscricao: 'Andamento da inscrição', fonte_registro: 'Onde o cadastro foi conferido', apoio_escola: 'O que precisa de atenção da escola', proximo: 'Próximo passo' })[chave])}<select name="${chave}">${acompanhamentoOpcoes(chave, dado[chave])}</select></label>`).join('')}
        <label>Referência da conferência<input name="referencia_registro" maxlength="160" value="${escapeHTML(dado.referencia_registro)}" placeholder="Identificação do registro ou responsável — sem documentos pessoais"></label>
        <label>Quando foi conferido<input name="conferido_em" type="datetime-local" value="${acompanhamentoDataLocal(dado.conferido_em)}"></label>
        <label>Responsável<input name="responsavel" maxlength="120" value="${escapeHTML(dado.responsavel)}" autocomplete="off"></label>
        <label>Quando retornar<input name="proxima_em" type="datetime-local" value="${acompanhamentoDataLocal(dado.proxima_em)}"></label>
        <label>Pausa até (opcional)<input name="pausa_ate" type="datetime-local" value="${acompanhamentoDataLocal(dado.pausa_ate)}"></label></div>
        <p>Cadastro conferido não comprova primeira contribuição recebida. Esta ficha organiza o acompanhamento; não faz lançamentos no Mercúrio ou Mercury.</p>
        <label>Pedido visível no painel da escola<textarea name="pedido_escola" maxlength="300" placeholder="Somente o necessário para o responsável local ajudar">${escapeHTML(dado.pedido_escola)}</textarea></label>
        <label>Contexto interno breve — sem informações íntimas<textarea name="nota" maxlength="600">${escapeHTML(dado.nota)}</textarea></label>
        <button type="submit" class="btn-mini btn-primary-mini">Salvar acompanhamento</button>
        <span id="acompanhamentoResultado" role="status" aria-live="polite"></span></fieldset></form>
        <small>${dado.atualizado_em ? 'Último registro: ' + escapeHTML(new Date(dado.atualizado_em).toLocaleString('pt-BR')) + ' · ' + escapeHTML(dado.atualizado_por) : 'Sem acompanhamento registrado.'}</small>
        <aside id="acompanhamentoSugestao" class="acompanhamento-sugestao"></aside></details>`;
    renderizarSugestaoConversa(dado);
    document.getElementById('acompanhamentoForm').addEventListener('submit', evento => { evento.preventDefault(); salvarAcompanhamento(lead); });
}
function renderizarSugestaoConversa(dado) {
    const el = document.getElementById('acompanhamentoSugestao');
    if (!el) return;
    const sugestao = AcompanhamentoModelo.sugerirConversa(dado);
    el.innerHTML = '<h4>Apoio para o próximo contato</h4><small>Baseado no último acompanhamento salvo. Revise antes de usar; nada é enviado automaticamente.</small>';
    const orientacao = document.createElement('p'); orientacao.textContent = sugestao.orientacao; el.append(orientacao);
    if (!sugestao.texto) return;
    const texto = document.createElement('textarea'); texto.readOnly = true; texto.value = sugestao.texto; texto.setAttribute('aria-label', 'Sugestão para revisar antes de enviar'); el.append(texto);
    const botao = document.createElement('button'); botao.type = 'button'; botao.className = 'btn-mini btn-secondary-mini'; botao.textContent = 'Copiar para revisar';
    const retorno = document.createElement('span'); retorno.setAttribute('role', 'status');
    botao.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(texto.value); retorno.textContent = 'Texto copiado. Personalize com seu nome e a escola antes de usar.'; }
        catch { texto.focus(); texto.select(); retorno.textContent = 'Selecione e copie o texto. Revise antes de enviar.'; }
    });
    el.append(botao, retorno);
}
async function salvarAcompanhamento(lead) {
    if (acompanhamentoSalvando) return;
    const formulario = document.getElementById('acompanhamentoForm');
    const retorno = document.getElementById('acompanhamentoResultado');
    const usuario = typeof usuarioLogado === 'function' ? usuarioLogado() : null;
    if (!usuario) { retorno.textContent = 'Entre novamente para registrar o atendimento.'; return; }
    try {
        acompanhamentoSalvando = true;
        const valores = Object.fromEntries(new FormData(formulario));
        ['proxima_em', 'pausa_ate', 'conferido_em'].forEach(chave => { valores[chave] = valores[chave] ? new Date(valores[chave]).toISOString() : ''; });
        const dado = AcompanhamentoModelo.validar(valores);
        const anterior = lead.acompanhamento || {};
        if (anterior.origem && anterior.origem !== 'desconhecida' && dado.origem !== anterior.origem && !confirm('Corrigir a origem já registrada? Isso não deve reclassificar um contato antigo como novo.')) return;
        dado.revisao = AcompanhamentoModelo.normalizar(anterior).revisao + 1;
        dado.atualizado_em = new Date().toISOString();
        dado.atualizado_por = usuario.nome;
        formulario.querySelector('fieldset').disabled = true;
        const { data, error } = await window.supabaseClient.from(NOME_TABELA)
            .update({ acompanhamento: dado }).eq('pessoaIdentificador', lead.pessoaIdentificador).eq('filial', lead.filial)
            .eq('acompanhamento', JSON.stringify(anterior)).select('pessoaIdentificador, acompanhamento');
        if (error) throw new Error('Não foi possível salvar. Confira a atualização do banco e tente novamente.');
        if (!data || data.length !== 1) throw new Error('Este contato mudou em outra sessão. Atualize a lista antes de editar.');
        lead.acompanhamento = data[0].acompanhamento;
        const cache = leadsAtuais.find(item => String(item.pessoaIdentificador) === String(lead.pessoaIdentificador));
        if (cache) cache.acompanhamento = lead.acompanhamento;
        acompanhamentoFila = acompanhamentoFila.map(item => String(item.pessoaIdentificador) === String(lead.pessoaIdentificador) ? { ...item, acompanhamento: lead.acompanhamento } : item);
        if (typeof registrarLogAtividade === 'function') registrarLogAtividade('acompanhamento_atualizado', { pessoaIds: [lead.pessoaIdentificador], detalhes: { revisao: dado.revisao } });
        retorno.textContent = 'Acompanhamento salvo.';
        if (formulario.isConnected) renderizarSugestaoConversa(dado);
        if (document.getElementById('acompanhamentoLista')) renderizarFilaAcompanhamento();
    } catch (erro) { retorno.textContent = erro.message; }
    finally { acompanhamentoSalvando = false; if (formulario.isConnected) formulario.querySelector('fieldset').disabled = false; }
}
async function carregarFilaAcompanhamento() {
    const el = document.getElementById('acompanhamentoLista');
    if (!el) return;
    const consulta = ++acompanhamentoConsulta;
    const filial = filialAtual;
    acompanhamentoFila = [];
    if (!filial) { el.textContent = 'Selecione uma escola.'; return; }
    el.textContent = 'Conferindo próximos passos…';
    ['acompanhamentoResumo', 'acompanhamentoContagem'].forEach(id => { const elemento = document.getElementById(id); if (elemento) elemento.textContent = ''; });
    try {
        const linhas = [];
        for (let inicio = 0; ; inicio += 1000) {
            const { data, error } = await window.supabaseClient.from(NOME_TABELA)
                .select('pessoaIdentificador,pessoaNome,filial,acompanhamento').eq('filial', filial).is('lixeira_em', null)
                .order('pessoaIdentificador').range(inicio, inicio + 999);
            if (consulta !== acompanhamentoConsulta || filial !== filialAtual) return;
            if (error) throw new Error('Acompanhamento indisponível. Verifique a atualização do banco. Nenhuma lista parcial será apresentada.');
            linhas.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
        acompanhamentoFila = linhas;
        renderizarFilaAcompanhamento();
    } catch (erro) { if (consulta === acompanhamentoConsulta) el.textContent = erro.message; }
}
function renderizarFilaAcompanhamento() {
    const el = document.getElementById('acompanhamentoLista');
    const filtro = document.getElementById('acompanhamentoFiltro').value;
    const usuario = typeof usuarioLogado === 'function' ? usuarioLogado() : null;
    const linhas = AcompanhamentoModelo.selecionarFila(acompanhamentoFila, {
        filtro, busca: document.getElementById('acompanhamentoBusca')?.value || '',
        somenteMeus: !!document.getElementById('acompanhamentoMeus')?.checked, responsavel: usuario?.nome || '',
    });
    const resumo = AcompanhamentoModelo.resumir(acompanhamentoFila);
    const indicador = document.getElementById('acompanhamentoResumo');
    if (indicador) indicador.textContent = `${resumo.atencao} retorno(s)/pedido(s) de atenção · ${resumo.inscricoes} inscrição(ões) em acompanhamento · ${resumo.semResponsavel} sem responsável · ${resumo.preferenciaPendente} preferências a conferir. Categorias podem se sobrepor.`;
    const contagem = document.getElementById('acompanhamentoContagem');
    contagem.textContent = `${linhas.length} contato(s). Exibidos até 100; refine pela busca, origem ou responsável. Não há envio automático.`;
    el.innerHTML = linhas.slice(0, 100).map(({ lead, prioridade }) => {
        const dado = AcompanhamentoModelo.normalizar(lead.acompanhamento);
        return `<article><strong>${escapeHTML(lead.pessoaNome || 'Sem nome')}</strong><span>${escapeHTML(prioridade.motivo)}</span><small>${escapeHTML(AcompanhamentoModelo.campos.origem[dado.origem])} · ${escapeHTML(dado.responsavel || 'Sem responsável')} · ${dado.proxima_em ? escapeHTML(new Date(dado.proxima_em).toLocaleString('pt-BR')) : 'Sem data'}</small><button type="button" class="btn-mini btn-secondary-mini" data-acompanhamento-id="${escapeHTML(String(lead.pessoaIdentificador))}">Abrir atendimento</button></article>`;
    }).join('') || '<p>Nenhum contato neste filtro.</p>';
    el.querySelectorAll('[data-acompanhamento-id]').forEach(botao => botao.addEventListener('click', () => abrirAcompanhamentoDaFila(botao.dataset.acompanhamentoId)));
}
async function abrirAcompanhamentoDaFila(id) {
    const filial = filialAtual;
    const { data, error } = await window.supabaseClient.from(NOME_TABELA).select('*').eq('pessoaIdentificador', id).eq('filial', filial).maybeSingle();
    if (filial !== filialAtual) return;
    if (error || !data) { alert('Não foi possível abrir esse atendimento. Atualize a lista.'); return; }
    const indice = leadsAtuais.findIndex(lead => String(lead.pessoaIdentificador) === String(id));
    if (indice < 0) leadsAtuais.push(data); else leadsAtuais[indice] = data;
    abrirGaveta(id);
}

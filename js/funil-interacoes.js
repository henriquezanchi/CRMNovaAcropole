// Medição por fatos: toda a base é agregada no servidor, sem depender dos cards carregados.
let funilInteracoesVersao = 0;
let funilRevisaoAntes = null;
function percentualFunil(valor, base) {
    return base ? `${(100 * Number(valor) / Number(base)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—';
}
function parametrosFunil() {
    const inicio = document.getElementById('funilInicio').value;
    const fim = document.getElementById('funilFim').value;
    if (!inicio || !fim || inicio > fim) throw new Error('Confira o início e o fim do período.');
    // Dia civil brasileiro; não depende do fuso configurado no computador do atendente.
    const exclusivo = new Date(`${fim}T00:00:00-03:00`);
    exclusivo.setUTCDate(exclusivo.getUTCDate() + 1);
    return { p_inicio: `${inicio}T00:00:00-03:00`, p_fim: exclusivo.toISOString(), p_filial: document.getElementById('funilEscopo').value === 'todas' ? null : filialAtual };
}
function iniciarFunilInteracoes() {
    const box = document.getElementById('funilInteracoes');
    if (!box) return;
    if (!document.getElementById('funilInicio')) {
        const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        const inicio = new Date(`${hoje}T12:00:00Z`); inicio.setUTCDate(inicio.getUTCDate() - 29);
        box.innerHTML = `<h3>Do contato à matrícula</h3>
        <p class="report-sub">Resultados comprovados das pessoas contatadas no período. Consulta toda a base, mesmo com poucos cards carregados.</p>
        <div class="funil-controles"><label>Primeiro dia<input id="funilInicio" type="date" value="${inicio.toISOString().slice(0, 10)}"></label><label>Último dia<input id="funilFim" type="date" value="${hoje}"></label>
        <label>Visão<select id="funilEscopo"><option value="todas">Total e todas as filiais</option><option value="atual">Filial selecionada no CRM</option></select></label>
        <button class="btn-primary" onclick="carregarFunilInteracoes()">Atualizar resultados</button></div>
        <div id="funilInteracoesDados" aria-live="polite"></div>
        <details class="funil-metodo"><summary>Como interpretar os números</summary>
        <p>Envios são mensagens aceitas pelo WhatsApp oficial: enviadas, entregues ou lidas. Falhas, reenvios substituídos, conversas importadas e cliques em links não contam. Uma pessoa pode receber várias mensagens; cada pessoa conta uma vez por etapa.</p>
        <p>As porcentagens das etapas usam as pessoas contatadas como base. A porcentagem de envios mostra a participação da filial nos envios exibidos. No total, pessoas atendidas por mais de uma filial contam uma vez.</p>
        <p>Resposta válida é humana e compreensível, inclusive uma recusa. Continuidade exige aceitação clara de conversa ou informações. Intenção de inscrição exige declaração explícita e evento identificado. Essas três etapas dependem de revisão humana da mensagem; sugestões de IA e tags não são comprovação.</p>
        <p>Inscrição exige registro do Ulisses em evento ligado a um convite comprovado ou à intenção revisada. Presença exige confirmação no evento. Matrícula exige número e data conferidos no Mercúrio, na mesma filial, a partir do contato. Aceitar um convite não comprova inscrição, presença nem matrícula.</p>
        <p>Os resultados são observados até agora e podem crescer depois do período de envios. A inscrição pode ter ocorrido antes do convite: o Ulisses não informa aqui sua data original. O relatório mostra associação, sem atribuir automaticamente o resultado à mensagem. Etapas sem revisão ou vínculo podem ficar abaixo das etapas seguintes.</p></details>
        <details id="funilRevisao"><summary>Conferir respostas e melhorar a medição</summary>
        <p class="report-sub">Revise a mensagem no contexto, sem enviar nada ao contato. Só registre aceitação ou intenção quando estiverem claras.</p>
        <label><input type="checkbox" id="funilRevisadas"> Rever classificações já salvas</label>
        <button class="btn-secondary" onclick="carregarRevisaoFunil(true)">Carregar respostas</button><div id="funilRevisaoLista"></div>
        <button id="funilRevisaoMais" class="btn-secondary" hidden onclick="carregarRevisaoFunil(false)">Próximas respostas</button></details>`;
    }
    carregarFunilInteracoes();
}
async function carregarFunilInteracoes() {
    const box = document.getElementById('funilInteracoesDados');
    if (!box) return;
    const versao = ++funilInteracoesVersao;
    box.textContent = 'Conferindo os registros…';
    try {
        const { data, error } = await window.supabaseClient.rpc('relatorio_funil_interacoes', parametrosFunil());
        if (versao !== funilInteracoesVersao) return;
        if (error) throw error;
        const linhas = data || [];
        const total = linhas.find(l => l.total) || {};
        const etapas = [['contatados', 'Pessoas contatadas'], ['responderam', 'Responderam (qualquer resposta)'], ['validas', 'Respostas válidas'], ['aceitaram', 'Aceitaram continuar / receber informações'], ['intencoes', 'Disseram que vão se inscrever'], ['inscritos', 'Inscritos no evento'], ['presentes', 'Compareceram'], ['matriculados', 'Matrículas conferidas']];
        const numero = valor => Number(valor || 0).toLocaleString('pt-BR');
        box.innerHTML = `<p><strong>${numero(total.mensagens)} mensagens enviadas</strong> para <strong>${numero(total.contatados)} pessoas identificadas</strong>. ${numero(total.pendentes)} pessoas com respostas ainda por revisar.</p>
        <p class="report-sub">Deslize a tabela para ver todas as etapas.</p><div class="funil-tabela"><table class="tabela-simples"><thead><tr><th>Filial</th><th>Mensagens enviadas</th>${etapas.map(e => `<th>${e[1]}</th>`).join('')}<th>Respostas por revisar (pessoas)</th></tr></thead>
        <tbody>${linhas.map(l => `<tr><th scope="row">${escapeHTML(l.filial || 'Sem filial')}</th><td>${numero(l.mensagens)}<small>${percentualFunil(l.mensagens, total.mensagens)} dos envios</small></td>${etapas.map(e => `<td>${numero(l[e[0]])}<small>${percentualFunil(l[e[0]], l.contatados)} dos contatados</small></td>`).join('')}<td>${numero(l.pendentes)}</td></tr>`).join('')}</tbody></table></div>
        ${Number(total.sem_identificacao) ? `<p>${numero(total.sem_identificacao)} envios ainda sem pessoa vinculada: entram no volume de mensagens, mas não nas etapas de pessoas.</p>` : ''}
        <p class="report-sub">Para ajustar a abordagem, confira quantos respondem, quantos autorizam continuar e onde o avanço diminui. Pendências de revisão não significam falta de interesse. Convites antigos sem vínculo comprovado com o evento não entram na medição de inscrição e presença.</p>`;
    } catch (e) { if (versao === funilInteracoesVersao) box.textContent = `Não foi possível consultar o funil: ${e.message}`; }
}
async function carregarRevisaoFunil(reiniciar) {
    const box = document.getElementById('funilRevisaoLista');
    if (reiniciar) funilRevisaoAntes = null;
    box.textContent = 'Carregando respostas…';
    try {
        const parametros = { ...parametrosFunil(), p_antes: funilRevisaoAntes, p_revisadas: document.getElementById('funilRevisadas').checked };
        const { data, error } = await window.supabaseClient.rpc('fila_revisao_funil', parametros);
        if (error) throw error;
        const linhas = data || [];
        funilRevisaoAntes = linhas.length ? linhas[linhas.length - 1].id : null;
        document.getElementById('funilRevisaoMais').hidden = linhas.length < 20;
        const classes = [['valida', 'Resposta humana válida (sem aceitação clara)'], ['aceitou', 'Aceitou continuar / receber informações'], ['inscricao', 'Disse claramente que vai se inscrever'], ['recusa', 'Recusou / não tem interesse'], ['automatica', 'Resposta automática'], ['inconclusiva', 'Não é possível concluir']];
        box.innerHTML = linhas.length ? linhas.map(l => `<article class="funil-resposta" id="funilResposta${Number(l.id)}"><strong>${escapeHTML(l.nome || l.pessoa || 'Contato')} · ${escapeHTML(l.filial || '')}</strong><small>${escapeHTML(new Date(l.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</small>
        <p>Último envio: ${escapeHTML(l.contexto || '(sem texto disponível)')}</p><blockquote>${escapeHTML(l.corpo_texto || `Mensagem de ${l.tipo || 'mídia'}: confira na conversa antes de classificar.`)}</blockquote>
        <label>O que a resposta comprova?<select id="funilClasse${Number(l.id)}"><option value="">Selecione com base na conversa</option>${classes.map(c => `<option value="${c[0]}" ${l.classificacao === c[0] ? 'selected' : ''}>${c[1]}</option>`).join('')}</select></label>
        <label>Evento (obrigatório para intenção de inscrição)<select id="funilEvento${Number(l.id)}"><option value="">Sem evento identificado</option>${(l.eventos || []).map(e => `<option value="${Number(e.id)}" ${String(l.evento_id) === String(e.id) ? 'selected' : ''}>${escapeHTML(e.nome)} · ${escapeHTML(e.data)}</option>`).join('')}</select></label>
        <button class="btn-secondary" data-pessoa="${escapeHTML(l.pessoa || '')}" onclick="abrirConversaNoWppUnificado(this.dataset.pessoa)">Abrir conversa completa</button>
        <button class="btn-primary" onclick="salvarRevisaoFunil(${Number(l.id)},this)">Salvar conferência</button><span role="status"></span></article>`).join('') : '<p>Nenhuma resposta nesta seleção.</p>';
    } catch (e) { box.textContent = `Não foi possível carregar: ${e.message}`; }
}
async function salvarRevisaoFunil(id, botao) {
    const status = botao.nextElementSibling;
    const classificacao = document.getElementById(`funilClasse${id}`).value;
    const evento = document.getElementById(`funilEvento${id}`).value;
    if (!classificacao || (classificacao === 'inscricao' && !evento)) { status.textContent = 'Selecione a classificação e, para inscrição, o evento.'; return; }
    const usuario = typeof usuarioLogado === 'function' ? usuarioLogado() : null;
    if (!usuario?.nome) { status.textContent = 'Entre com seu usuário para registrar a revisão.'; return; }
    botao.disabled = true;
    try {
        const { error } = await window.supabaseClient.rpc('registrar_resposta_funil', { p_mensagem: id, p_classificacao: classificacao, p_evento: evento ? Number(evento) : null, p_revisor: usuario.nome });
        if (error) throw error;
        status.textContent = 'Conferência salva com histórico.';
        carregarFunilInteracoes();
    } catch (e) { status.textContent = `Não foi possível salvar: ${e.message}`; }
    finally { botao.disabled = false; }
}
// Falha de medição nunca transforma envio bem-sucedido em falha ou provoca reenvio.
async function registrarConviteFunil(waId, eventoId) {
    if (!waId || !eventoId) return;
    try {
        const { error } = await window.supabaseClient.rpc('registrar_convite_funil', { p_wa_id: waId, p_evento: eventoId });
        if (error) console.warn('Convite enviado; vínculo de medição pendente.', error.message);
    } catch (e) { console.warn('Convite enviado; vínculo de medição pendente.', e.message); }
}

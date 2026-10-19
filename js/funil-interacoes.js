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
        <p>Resposta válida é humana e compreensível, inclusive uma recusa. Continuidade exige aceitação clara de conversa ou informações. Intenção de inscrição exige declaração explícita e evento identificado. Essas três etapas são classificadas automaticamente pela análise de toda a conversa, com citações verificáveis. Tags e sugestões de resposta não são comprovação. A aceitação e a intenção refletem a decisão explícita mais recente.</p>
        <p>Inscrição exige registro ou histórico importado do Ulisses, com evento e data correspondentes, ligado a um convite comprovado ou à intenção identificada na conversa. Presença exige confirmação no evento. Matrícula exige número e data conferidos no Mercúrio, na mesma filial, a partir do contato. Aceitar um convite não comprova inscrição, presença nem matrícula.</p>
        <p>Os resultados são observados até agora e podem crescer depois do período de envios. A inscrição pode ter ocorrido antes do convite: o Ulisses não informa aqui sua data original. O relatório mostra associação, sem atribuir automaticamente o resultado à mensagem. Cada nova interação provoca uma reanálise. Conteúdo inconclusivo não é convertido em interesse. Inscrições e presença continuam dependendo de vínculo comprovável com o evento.</p></details>
        <details id="funilRevisao"><summary>Ver evidências da análise automática</summary>
        <p class="report-sub">O sistema lê o histórico inteiro e reclassifica a conversa a cada nova interação. Não é necessário validar. Aqui você pode consultar o trecho e o motivo de cada classificação.</p>
        <button class="btn-secondary" onclick="carregarRevisaoFunil(true)">Consultar evidências</button><div id="funilRevisaoLista"></div>
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
        const parametros = parametrosFunil();
        const [{ data, error }, cobertura] = await Promise.all([
            window.supabaseClient.rpc('relatorio_funil_interacoes', parametros),
            window.supabaseClient.rpc('situacao_funil_automatico', { p_filial: parametros.p_filial }),
        ]);
        if (versao !== funilInteracoesVersao) return;
        if (error) throw error;
        if (cobertura.error) throw cobertura.error;
        const linhas = data || [];
        const total = linhas.find(l => l.total) || {};
        const situacao = cobertura.data || {};
        const etapas = [['contatados', 'Pessoas contatadas'], ['responderam', 'Responderam (qualquer resposta)'], ['validas', 'Respostas válidas'], ['aceitaram', 'Aceitaram continuar / receber informações'], ['intencoes', 'Disseram que vão se inscrever'], ['inscritos', 'Inscritos no evento'], ['presentes', 'Compareceram'], ['matriculados', 'Matrículas conferidas']];
        const numero = valor => Number(valor || 0).toLocaleString('pt-BR');
        box.innerHTML = `<p><strong>${numero(total.mensagens)} mensagens enviadas</strong> para <strong>${numero(total.contatados)} pessoas identificadas</strong>. ${numero(total.pendentes)} pessoas com atualização da análise em andamento.</p>
        <p class="report-sub">Histórico completo: ${numero(situacao.mensagens_analisadas)} de ${numero(situacao.total_mensagens)} mensagens analisadas em ${numero(situacao.concluidas)} de ${numero(situacao.conversas)} conversas. ${numero(situacao.pendentes)} aguardam processamento; ${numero(situacao.erros)} tiveram falha e serão tentadas novamente. ${numero(situacao.midias_inconclusivas)} respostas em mídia sem evidência textual suficiente. Atualização automática em rodadas de aproximadamente um minuto; durante o processamento, o último resultado permanece visível.</p>
        <p class="report-sub">Deslize a tabela para ver todas as etapas.</p><div class="funil-tabela"><table class="tabela-simples"><thead><tr><th>Filial</th><th>Mensagens enviadas</th>${etapas.map(e => `<th>${e[1]}</th>`).join('')}<th>Atualização pendente (pessoas)</th></tr></thead>
        <tbody>${linhas.map(l => `<tr><th scope="row">${escapeHTML(l.filial || 'Sem filial')}</th><td>${numero(l.mensagens)}<small>${percentualFunil(l.mensagens, total.mensagens)} dos envios</small></td>${etapas.map(e => `<td>${numero(l[e[0]])}<small>${percentualFunil(l[e[0]], l.contatados)} dos contatados</small></td>`).join('')}<td>${numero(l.pendentes)}</td></tr>`).join('')}</tbody></table></div>
        ${Number(total.sem_identificacao) ? `<p>${numero(total.sem_identificacao)} envios ainda sem pessoa vinculada: entram no volume de mensagens, mas não nas etapas de pessoas.</p>` : ''}
        <p class="report-sub">Para ajustar a abordagem, confira quantos respondem, quantos autorizam continuar e onde o avanço diminui. Análise pendente ou inconclusiva não significa falta de interesse. Convites antigos sem vínculo comprovado com o evento não entram na medição de inscrição e presença.</p>`;
    } catch (e) { if (versao === funilInteracoesVersao) box.textContent = `Não foi possível consultar o funil: ${e.message}`; }
}
async function carregarRevisaoFunil(reiniciar) {
    const box = document.getElementById('funilRevisaoLista');
    if (reiniciar) funilRevisaoAntes = null;
    box.textContent = 'Consultando evidências…';
    try {
        const { data, error } = await window.supabaseClient.rpc('evidencias_funil_automatico', { ...parametrosFunil(), p_antes: funilRevisaoAntes });
        if (error) throw error;
        const linhas = data || [];
        funilRevisaoAntes = linhas.length ? linhas[linhas.length - 1].id : null;
        document.getElementById('funilRevisaoMais').hidden = linhas.length < 20;
        const rotulos = { valida: 'Resposta humana válida', aceitou: 'Aceitou continuar / receber informações', inscricao: 'Declarou intenção de inscrição', recusa: 'Recusou / não tem interesse', automatica: 'Resposta automática', inconclusiva: 'Conteúdo inconclusivo' };
        box.innerHTML = linhas.length ? linhas.map(l => `<article class="funil-resposta"><strong>${escapeHTML(rotulos[l.classificacao] || 'Ainda não classificada')} · ${escapeHTML(l.filial || '')}</strong><small>${escapeHTML(new Date(l.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</small>
        <p>Último envio: ${escapeHTML(l.contexto || '(sem texto disponível)')}</p><blockquote>${escapeHTML(l.corpo_texto || `Mensagem de ${l.tipo || 'mídia'} sem texto disponível.`)}</blockquote>
        <p>${escapeHTML(l.justificativa || 'Sem evidência textual suficiente.')}</p>
        <button class="btn-secondary" data-pessoa="${escapeHTML(l.pessoa || '')}" onclick="abrirConversaNoWppUnificado(this.dataset.pessoa)">Abrir conversa completa</button></article>`).join('') : '<p>Nenhuma evidência nesta seleção.</p>';
    } catch (e) { box.textContent = `Não foi possível consultar: ${e.message}`; }
}
// Atualiza somente a tela aberta. O processamento ocorre no servidor, mesmo com CRM fechado.
setInterval(() => {
    if (document.getElementById('tab-relatorios')?.classList.contains('active') && document.getElementById('funilInicio')) carregarFunilInteracoes();
}, 60000);
// Falha de medição nunca transforma envio bem-sucedido em falha ou provoca reenvio.
async function registrarConviteFunil(waId, eventoId) {
    if (!waId || !eventoId) return;
    try {
        const { error } = await window.supabaseClient.rpc('registrar_convite_funil', { p_wa_id: waId, p_evento: eventoId });
        if (error) console.warn('Convite enviado; vínculo de medição pendente.', error.message);
    } catch (e) { console.warn('Convite enviado; vínculo de medição pendente.', e.message); }
}

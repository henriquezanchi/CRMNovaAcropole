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
    const sinal = AcompanhamentoModelo.proximidade(lead);
    const trabalho = AcompanhamentoModelo.trabalhoEspecializado(lead);
    el.innerHTML = `<details open><summary><strong>Acolhimento e próximo passo</strong></summary>
        <section id="memoriaConversaIA" class="memoria-ia" hidden></section>
        <p><strong>Frente: ${escapeHTML(trabalho.frente)}</strong> · ${escapeHTML(trabalho.objetivo)}</p><p>Próximo passo sugerido: ${escapeHTML(trabalho.proximo)}</p>
        <p id="acompanhamentoSinalAtual"><strong>${escapeHTML(sinal.rotulo)}</strong> · ${escapeHTML(sinal.motivo)}</p><p>Registre o que a pessoa declarou. Silêncio não é recusa; simpatia não é confirmação. Conte no contexto breve qual fala sustenta a intenção, sem copiar dados íntimos.</p>
        ${!schemaPronto ? '<p role="status">Atualização do banco pendente. Os registros antigos continuam disponíveis.</p>' : ''}
        <form id="acompanhamentoForm"><fieldset ${!schemaPronto ? 'disabled' : ''}>
        <div class="acompanhamento-grade">${['intencao', 'contato', 'proximo', 'inscricao', 'relacao', 'experiencia', 'origem', 'entrada', 'fonte_registro', 'apoio_escola'].map(chave => `<label>${escapeHTML(({ relacao: 'Relação atual com a escola', origem: 'Canal de origem', entrada: 'Forma de entrada', intencao: 'Intenção declarada', contato: 'Preferência de contato', experiencia: 'Experiência relatada', inscricao: 'Andamento da inscrição', fonte_registro: 'Onde o cadastro foi conferido', apoio_escola: 'O que precisa de atenção da escola', proximo: 'Próximo passo' })[chave])}<select name="${chave}">${acompanhamentoOpcoes(chave, dado[chave])}</select></label>`).join('')}
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
    carregarMemoriaConversaIA(lead);
    const form = document.getElementById('acompanhamentoForm');
    const essenciais = ['intencao', 'contato', 'proximo', 'responsavel', 'proxima_em'];
    const grade = form.querySelector('.acompanhamento-grade');
    const detalhes = document.createElement('details'); detalhes.className = 'qualificacao-detalhes';
    const titulo = document.createElement('summary'); titulo.textContent = 'Visita, origem, cadastro e apoio à escola'; detalhes.append(titulo);
    const complemento = document.createElement('div'); complemento.className = 'acompanhamento-grade'; detalhes.append(complemento);
    [...grade.children].forEach(label => { if (!essenciais.includes(label.querySelector('[name]')?.name)) complemento.append(label); });
    grade.after(detalhes);
    document.getElementById('acompanhamentoForm').addEventListener('submit', evento => { evento.preventDefault(); salvarAcompanhamento(lead); });
}
// Memória escrita pela IA de qualificação: resumo datado + perfil, cada item com a fala que o comprova.
const ROTULOS_ETAPA_IA = { qualificacao: 'A qualificar', informacoes: 'Informações iniciais', eventos: 'Eventos e inscrições', pos_evento: 'Pós-evento', matricula: 'Matrícula', antigos_alunos: 'Antigo aluno', acolhimento: 'Aluno atual' };
const ROTULOS_PERFIL_IA = { interesses: 'Interesses', disponibilidade: 'Disponibilidade', objecoes: 'Objeções', contexto: 'Contexto' };
async function carregarMemoriaConversaIA(lead) {
    const el = document.getElementById('memoriaConversaIA');
    if (!el || !lead?.pessoaIdentificador || !lead.filial || !window.supabaseClient) return;
    const pessoa = String(lead.pessoaIdentificador);
    el.dataset.pessoa = pessoa;
    const { data, error } = await window.supabaseClient.from('crm_memoria_conversa')
        .select('resumo,perfil,proximo_passo,qualificacao,gerado_em').eq('filial', lead.filial).eq('pessoa', pessoa).maybeSingle();
    if (!el.isConnected || el.dataset.pessoa !== pessoa) return;
    if (error || !data?.resumo) { el.hidden = true; return; }
    el.replaceChildren();
    const titulo = document.createElement('h4'); titulo.textContent = 'O que a conversa já mostrou'; el.append(titulo);
    const q = data.qualificacao || {};
    const confirmada = q.etapa && q.etapa !== 'qualificacao';
    const etapa = confirmada ? q.etapa : (q.etapa_provavel || 'qualificacao');
    const linhaEtapa = document.createElement('p'); linhaEtapa.className = 'memoria-ia-etapa';
    const rotulo = document.createElement('strong'); rotulo.textContent = 'Etapa: ';
    linhaEtapa.append(rotulo, ROTULOS_ETAPA_IA[etapa] || etapa);
    if (!confirmada && q.etapa_provavel) { const selo = document.createElement('span'); selo.className = 'memoria-ia-selo'; selo.textContent = 'provável'; linhaEtapa.append(' ', selo); }
    el.append(linhaEtapa);
    const prova = confirmada ? q.evidencia : q.indicio;
    if (prova?.trecho) { const citacao = document.createElement('blockquote'); citacao.textContent = prova.trecho; el.append(citacao); }
    const resumo = document.createElement('p'); resumo.className = 'memoria-ia-resumo'; resumo.textContent = data.resumo; el.append(resumo);
    const perfil = data.perfil || {};
    const campos = Object.keys(ROTULOS_PERFIL_IA).filter(campo => Array.isArray(perfil[campo]) && perfil[campo].length);
    if (campos.length) {
        const lista = document.createElement('dl'); lista.className = 'memoria-ia-perfil';
        for (const campo of campos) {
            const dt = document.createElement('dt'); dt.textContent = ROTULOS_PERFIL_IA[campo];
            const dd = document.createElement('dd');
            for (const item of perfil[campo]) {
                const chip = document.createElement('span'); chip.className = 'memoria-ia-chip';
                chip.textContent = item.valor; chip.title = 'Disse: “' + item.trecho + '”';
                dd.append(chip);
            }
            lista.append(dt, dd);
        }
        el.append(lista);
    }
    if (data.proximo_passo) {
        const passo = document.createElement('p'); const rotuloPasso = document.createElement('strong');
        rotuloPasso.textContent = 'Próximo passo sugerido: '; passo.append(rotuloPasso, data.proximo_passo); el.append(passo);
    }
    const rodape = document.createElement('small');
    const quando = data.gerado_em ? new Date(data.gerado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    rodape.textContent = `Leitura da IA${quando ? ' em ' + quando : ''}. Passe o mouse num item do perfil para ver a frase da pessoa. Confira antes de usar.`;
    el.append(rodape);
    el.hidden = false;
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
        if (dado.intencao !== anterior.intencao) {
            dado.intencao_atualizado_em = dado.atualizado_em;
            dado.intencao_atualizado_por = dado.atualizado_por;
        } else {
            dado.intencao_atualizado_em = anterior.intencao_atualizado_em || anterior.atualizado_em || '';
            dado.intencao_atualizado_por = anterior.intencao_atualizado_por || anterior.atualizado_por || '';
        }
        if (dado.contato !== anterior.contato) {
            dado.preferencia_contato_em = dado.atualizado_em;
            dado.preferencia_contato_por = dado.atualizado_por;
        } else {
            dado.preferencia_contato_em = anterior.preferencia_contato_em || '';
            dado.preferencia_contato_por = anterior.preferencia_contato_por || '';
        }
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
        if (formulario.isConnected) {
            const sinal = AcompanhamentoModelo.proximidade(lead);
            document.getElementById('acompanhamentoSinalAtual').innerHTML = `<strong>${escapeHTML(sinal.rotulo)}</strong> · ${escapeHTML(sinal.motivo)}`;
        }
        if (typeof renderizarCards === 'function') renderizarCards();
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
    ['acompanhamentoResumo', 'acompanhamentoContagem', 'sinaisMatricula', 'acompanhamentoDia'].forEach(id => { const elemento = document.getElementById(id); if (elemento) elemento.textContent = ''; });
    try {
        const linhas = [];
        for (let inicio = 0; ; inicio += 1000) {
            const { data, error } = await window.supabaseClient.from(NOME_TABELA)
                .select('pessoaIdentificador,pessoaNome,filial,acompanhamento,tags,funil_agencia').eq('filial', filial).is('lixeira_em', null)
                .order('pessoaIdentificador').range(inicio, inicio + 999);
            if (consulta !== acompanhamentoConsulta || filial !== filialAtual) return;
            if (error) throw new Error('Acompanhamento indisponível. Verifique a atualização do banco. Nenhuma lista parcial será apresentada.');
            linhas.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
        const analises = new Map();
        for (let inicio = 0; ; inicio += 1000) {
            const { data, error } = await window.supabaseClient.from('funil_analises_conversa')
                .select('pessoa,resultado,analisado_em,estado').eq('filial', filial).order('pessoa').range(inicio, inicio + 999);
            if (consulta !== acompanhamentoConsulta || filial !== filialAtual) return;
            if (error) throw new Error('Não foi possível consultar a análise das conversas. Atualize para tentar novamente.');
            (data || []).forEach(analise => analises.set(String(analise.pessoa), analise));
            if (!data || data.length < 1000) break;
        }
        linhas.forEach(lead => { lead.analise_funil = analises.get(String(lead.pessoaIdentificador)) || null; });
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
    if (indicador) indicador.textContent = `Datas e responsáveis são combinados pela equipe; a análise automática não inventa agendamentos. ${resumo.atencao} retorno(s)/pedido(s) de atenção · ${resumo.inscricoes} inscrição(ões) em acompanhamento · ${resumo.semResponsavel} sem responsável · ${resumo.preferenciaPendente} preferências a conferir. Categorias podem se sobrepor.`;
    renderizarSinaisMatricula();
    renderizarResumoDoDia();
    const contagem = document.getElementById('acompanhamentoContagem');
    contagem.textContent = `${linhas.length} contato(s). Exibidos até 100; refine pela busca, origem ou responsável. Não há envio automático.`;
    el.innerHTML = linhas.slice(0, 100).map(({ lead, prioridade }) => {
        const dado = AcompanhamentoModelo.normalizar(lead.acompanhamento);
        const sinal = AcompanhamentoModelo.proximidade(lead);
        const preferencia = AcompanhamentoModelo.impedimento(dado);
        const evidencia = lead.analise_funil?.resultado;
        const trecho = sinal.grupo === 'evento' ? evidencia?.intencao?.trecho : sinal.grupo === 'conversa' ? evidencia?.continuidade?.trecho : '';
        const dia = AcompanhamentoModelo.atendimentoDiario(lead);
        const trabalho = AcompanhamentoModelo.trabalhoEspecializado(lead);
        return `<article><strong>${escapeHTML(lead.pessoaNome || 'Sem nome')}</strong><span class="sinal-matricula sinal-${sinal.grupo}">${escapeHTML(sinal.rotulo)}</span><span>${escapeHTML(sinal.motivo)}</span><small>Próximo cuidado: ${escapeHTML(sinal.acao)}</small>${trecho ? `<blockquote class="acompanhamento-evidencia">${escapeHTML(trecho)}</blockquote><small>Identificado automaticamente na conversa${lead.analise_funil.estado !== 'concluido' ? ' · reanálise em andamento' : ''}. Não altera a autorização de envio.</small>` : ''}<small><strong>Frente: ${escapeHTML(trabalho.frente)}</strong></small><small>${escapeHTML(trabalho.objetivo)}</small><small>Próximo passo sugerido: ${escapeHTML(trabalho.proximo)}</small><small>Fila diária: ${escapeHTML(dia.rotulo)}</small><small>Atendimento: ${escapeHTML(prioridade.motivo)}${preferencia ? ' · ' + escapeHTML(preferencia) : ''}</small><small>${dado.atualizado_em ? 'Registro de ' + escapeHTML(new Date(dado.atualizado_em).toLocaleDateString('pt-BR')) : 'Sem data de atualização da intenção'}</small><small>${escapeHTML(AcompanhamentoModelo.campos.origem[dado.origem])} · ${escapeHTML(dado.responsavel || 'Sem responsável')} · ${dado.proxima_em ? escapeHTML(new Date(dado.proxima_em).toLocaleString('pt-BR')) : 'Sem data'}</small><button type="button" class="btn-mini btn-secondary-mini" data-acompanhamento-id="${escapeHTML(String(lead.pessoaIdentificador))}">Abrir atendimento</button></article>`;
    }).join('') || (filtro === 'proximos' ? '<p>Ainda não há pedido de matrícula, cadastro em andamento ou visita com relato positivo registrado nesta escola. Consulte também as intenções de inscrição em evento e as conversas aceitas nos indicadores acima.</p>' : '<p>Nenhum contato neste filtro.</p>');
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

function mostrarProximosDaMatricula(filtro = 'proximos') {
    document.getElementById('acompanhamentoFiltro').value = filtro;
    document.getElementById('painelInteresseMatricula').open = true;
    carregarFilaAcompanhamento();
}
function renderizarSinaisMatricula() {
    const el = document.getElementById('sinaisMatricula');
    if (!el) return;
    const grupos = [['proximos', 'Mais próximos da matrícula'], ['sinal:evento', 'Intenção de inscrição em evento'], ['sinal:conversa', 'Aceitaram conversar'], ['sinal:participar', 'Querem participar'], ['sinal:conhecer', 'Querem conhecer'], ['sinal:qualificar', 'Interesse a confirmar'], ['sinal:momento', 'Pausa / não contatar'], ['sinal:conferidos', 'Cadastros conferidos']];
    const contagens = {};
    acompanhamentoFila.forEach(lead => { const grupo = AcompanhamentoModelo.proximidade(lead).grupo; contagens[grupo] = (contagens[grupo] || 0) + 1; });
    el.innerHTML = grupos.map(([filtro, titulo]) => {
        const total = filtro === 'proximos' ? ['inscricao','decididos','visita'].reduce((soma, grupo) => soma + (contagens[grupo] || 0), 0) : contagens[filtro.slice(6)] || 0;
        return `<button type="button" class="sinal-resumo" data-sinal-filtro="${filtro}" aria-pressed="${document.getElementById('acompanhamentoFiltro').value === filtro}"><strong>${total}</strong><span>${titulo}</span></button>`;
    }).join('');
    el.querySelectorAll('[data-sinal-filtro]').forEach(botao => botao.addEventListener('click', () => { document.getElementById('acompanhamentoFiltro').value = botao.dataset.sinalFiltro; renderizarFilaAcompanhamento(); }));
}

function renderizarResumoDoDia() {
    const el = document.getElementById('acompanhamentoDia');
    if (!el) return;
    const grupos = [['pendentes', 'Atendimentos do dia'], ['atrasados', 'Retornos atrasados'], ['hoje', 'Combinados para hoje'], ['pedidos', 'Pedidos sem data'], ['interno', 'Conferir internamente']];
    const contagens = {};
    acompanhamentoFila.forEach(lead => { const grupo = AcompanhamentoModelo.atendimentoDiario(lead).grupo; contagens[grupo] = (contagens[grupo] || 0) + 1; });
    el.innerHTML = grupos.map(([grupo, titulo]) => {
        const total = grupo === 'pendentes' ? ['atrasados','hoje','pedidos','interno'].reduce((soma, chave) => soma + (contagens[chave] || 0), 0) : contagens[grupo] || 0;
        return `<button type="button" class="btn-toggle" data-dia="${grupo}" aria-pressed="${document.getElementById('acompanhamentoFiltro').value === 'dia:' + grupo}">${escapeHTML(titulo)} · ${total}</button>`;
    }).join('');
    el.querySelectorAll('[data-dia]').forEach(botao => botao.addEventListener('click', () => { document.getElementById('acompanhamentoFiltro').value = 'dia:' + botao.dataset.dia; renderizarFilaAcompanhamento(); }));
}

// A análise é processada no servidor; mantém o painel aberto atualizado sem mudar o filtro.
setInterval(() => {
    if (!acompanhamentoSalvando && document.getElementById('tab-crm')?.classList.contains('active') && document.getElementById('painelInteresseMatricula')?.open) carregarFilaAcompanhamento();
}, 60000);

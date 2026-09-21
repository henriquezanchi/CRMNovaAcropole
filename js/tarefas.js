// ==========================================================
// TAREFAS (js/tarefas.js) — pedido do usuário (2026-09-21): visão de
// tarefas com responsável (usuário OU equipe), prazo, e status que muda
// AUTOMATICAMENTE ao mover o lead de coluna, e VICE-VERSA (concluir a
// tarefa move o lead de coluna). Ver migracao_equipes.sql +
// migracao_tarefas.sql e a seção própria no CLAUDE.md.
//
// Decisão confirmada com o usuário: uma tarefa pode ter VÁRIOS leads
// (`tarefa_leads`, N:N) — o status de conclusão é POR LEAD dentro da
// tarefa, não 1 status pra tarefa inteira (calculado na hora, "3/5
// concluídos", nunca guardado separado — evita os dois ficarem
// dessincronizados).
// ==========================================================

// ---------------------------------------------------------
// Equipes (migracao_equipes.sql) — Agência/Voluntários por padrão,
// editável em "Gerenciar Equipes" (botão dentro de "Gerenciar
// Usuários"). Reaproveitado tanto pelo responsável de uma Tarefa quanto
// pelo <select> de equipe de cada usuário (js/usuarios.js).
// ---------------------------------------------------------
let equipesTarefasCache = [];

async function carregarEquipesTarefas() {
    const { data, error } = await window.supabaseClient.from('equipes').select('*').order('ordem', { ascending: true });
    if (error) { console.error('Erro ao carregar equipes:', error.message); return; }
    equipesTarefasCache = data || [];
}

function abrirGerenciarEquipes() {
    document.getElementById('modalGerenciarEquipes').classList.add('open');
    renderizarListaEquipesModal();
}
function fecharGerenciarEquipes() {
    document.getElementById('modalGerenciarEquipes').classList.remove('open');
    // Reflete nome/ordem novos na tela de Usuários, se estiver aberta por baixo.
    if (typeof renderizarListaUsuariosCrm === 'function') renderizarListaUsuariosCrm();
}

function renderizarListaEquipesModal() {
    const container = document.getElementById('listaEquipesModal');
    if (!container) return;
    if (equipesTarefasCache.length === 0) {
        container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhuma equipe cadastrada.</p>';
        return;
    }
    container.innerHTML = equipesTarefasCache.map(eq => `
        <div class="coluna-row" draggable="true" ondragstart="iniciarArrastoLista(event, '${eq.id}')" ondragend="this.style.opacity='1'" ondragover="event.preventDefault()" ondrop="soltarNaLista(event, 'equipes', '${eq.id}')">
            <i class="fa-solid fa-grip-vertical" style="color:var(--text-muted); cursor:grab;" title="Arraste pra reordenar"></i>
            <input type="text" value="${escapeHTML(eq.nome)}" onchange="atualizarNomeEquipe(${eq.id}, this.value)" style="flex:1;">
            <button class="icon-btn danger" onclick="removerEquipe(${eq.id})" title="Remover"><i class="fa-solid fa-trash"></i></button>
        </div>
    `).join('');
}
// REORDENADORES_LISTA já existe (declarado em js/app.js, carregado
// antes) — só adiciona a entrada 'equipes', mesmo padrão de
// filiais/tags/tipos de evento.
REORDENADORES_LISTA['equipes'] = (idOrigem, idDestino) =>
    reordenarESalvarOrdem('equipes', equipesTarefasCache, idOrigem, idDestino, renderizarListaEquipesModal);

async function atualizarNomeEquipe(id, novoNome) {
    novoNome = novoNome.trim();
    if (!novoNome) return;
    const { error } = await window.supabaseClient.from('equipes').update({ nome: novoNome }).eq('id', id);
    if (error) { alert('Erro ao renomear equipe: ' + error.message); return; }
    const eq = equipesTarefasCache.find(e => e.id === id);
    if (eq) eq.nome = novoNome;
}

async function adicionarEquipe() {
    const input = document.getElementById('novaEquipeNome');
    const nome = input.value.trim();
    if (!nome) return;
    const { error } = await window.supabaseClient.from('equipes').insert({ nome, ordem: equipesTarefasCache.length });
    if (error) { alert('Erro ao criar equipe: ' + error.message); return; }
    input.value = '';
    await carregarEquipesTarefas();
    renderizarListaEquipesModal();
}

async function removerEquipe(id) {
    const eq = equipesTarefasCache.find(e => e.id === id);
    if (!eq) return;
    if (!confirm(`Remover a equipe "${eq.nome}"? Usuários e tarefas atribuídos a ela ficam sem equipe (nada é apagado).`)) return;
    const { error } = await window.supabaseClient.from('equipes').delete().eq('id', id);
    if (error) { alert('Erro ao remover equipe: ' + error.message); return; }
    await carregarEquipesTarefas();
    renderizarListaEquipesModal();
}

// ---------------------------------------------------------
// Tarefas — lista principal
// ---------------------------------------------------------
let tarefasCache = [];
// tarefaId -> [{id, tarefa_id, pessoaIdentificador, pessoaNome, concluida, concluida_em, concluida_via}]
let tarefaLeadsPorTarefa = {};
let tarefaEditandoId = null;
let tarefaLeadsSelecionados = [];
let debounceBuscaLeadTarefa = null;

async function carregarTarefas() {
    const container = document.getElementById('listaTarefas');
    if (!container) return;
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando...</p>';

    if (equipesTarefasCache.length === 0) await carregarEquipesTarefas();
    if ((typeof usuariosCrmCache === 'undefined' || usuariosCrmCache.length === 0) && typeof carregarUsuariosCrm === 'function') {
        await carregarUsuariosCrm();
    }

    const verTodas = document.getElementById('tarefasVerTodasFiliais');
    let query = window.supabaseClient.from('tarefas').select('*').eq('cancelada', false)
        .order('prazo', { ascending: true, nullsFirst: false }).order('criado_em', { ascending: false });
    // Sem "ver de todas as filiais": mostra as desta filial + as
    // cross-filial (filial=null, ex: tarefa da Agência que vale pra
    // qualquer unidade) — mesmo padrão de bulletin "Agenda do Dia".
    if (!(verTodas && verTodas.checked)) {
        query = query.or(`filial.eq.${filialAtual},filial.is.null`);
    }
    const { data: tarefas, error } = await query;
    if (error) { container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro ao carregar tarefas: ${escapeHTML(error.message)}</p>`; return; }
    tarefasCache = tarefas || [];

    // 1 query só pra TODOS os vínculos das tarefas carregadas (não 1 por
    // tarefa) — mesmo espírito de carregarResumoParticipantes() (js/eventos.js).
    tarefaLeadsPorTarefa = {};
    const idsTarefas = tarefasCache.map(t => t.id);
    if (idsTarefas.length > 0) {
        const { data: vinculos, error: erroVinculos } = await window.supabaseClient
            .from('tarefa_leads')
            .select('id, tarefa_id, pessoaIdentificador, concluida, concluida_em, concluida_via')
            .in('tarefa_id', idsTarefas);
        if (erroVinculos) console.error('Erro ao carregar leads das tarefas:', erroVinculos.message);
        (vinculos || []).forEach(v => {
            if (!tarefaLeadsPorTarefa[v.tarefa_id]) tarefaLeadsPorTarefa[v.tarefa_id] = [];
            tarefaLeadsPorTarefa[v.tarefa_id].push(v);
        });

        // Resolve nome de cada lead em 1 query em lote (mesmo padrão de
        // resolverNomesLeadsLog(), js/log-atividade.js).
        const idsLeads = [...new Set((vinculos || []).map(v => v.pessoaIdentificador))];
        if (idsLeads.length > 0) {
            const { data: leadsInfo } = await window.supabaseClient
                .from(NOME_TABELA).select('pessoaIdentificador, pessoaNome').in('pessoaIdentificador', idsLeads);
            const nomePorId = new Map((leadsInfo || []).map(l => [String(l.pessoaIdentificador), l.pessoaNome]));
            Object.values(tarefaLeadsPorTarefa).forEach(lista => lista.forEach(v => {
                v.pessoaNome = nomePorId.get(String(v.pessoaIdentificador)) || `lead #${v.pessoaIdentificador} (não encontrado)`;
            }));
        }
    }

    renderizarListaTarefas();
}

function renderizarListaTarefas() {
    const container = document.getElementById('listaTarefas');
    if (!container) return;
    if (tarefasCache.length === 0) {
        container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhuma tarefa por aqui ainda — clique em "Nova Tarefa" pra criar a primeira.</p>';
        return;
    }
    const hojeISO = new Date().toISOString().slice(0, 10);
    container.innerHTML = tarefasCache.map(t => {
        const leads = tarefaLeadsPorTarefa[t.id] || [];
        const total = leads.length;
        const concluidos = leads.filter(l => l.concluida).length;
        const concluidaTotalmente = total > 0 && concluidos === total;
        const atrasada = !concluidaTotalmente && t.prazo && t.prazo < hojeISO;

        let responsavelTexto = 'Sem responsável';
        if (t.responsavel_equipe_id) {
            const eq = equipesTarefasCache.find(e => e.id === t.responsavel_equipe_id);
            responsavelTexto = `Equipe ${eq ? eq.nome : '?'}`;
        } else if (t.responsavel_usuario_id) {
            const u = (typeof usuariosCrmCache !== 'undefined' ? usuariosCrmCache : []).find(u => u.id === t.responsavel_usuario_id);
            responsavelTexto = u ? u.nome : 'Usuário';
        }

        const statusTexto = total === 0 ? 'sem leads vinculados' : (concluidaTotalmente ? 'concluída' : `${concluidos}/${total} concluído(s)`);
        const statusClasse = concluidaTotalmente ? 'tag-ativo' : (atrasada ? 'tag-error' : 'tag-warning');

        return `
            <div class="info-box" style="cursor:pointer; ${atrasada ? 'border-color:#dc2626;' : ''}" onclick="abrirEditarTarefa(${t.id})">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                    <div>
                        <strong>${escapeHTML(t.titulo)}</strong>
                        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                            ${escapeHTML(responsavelTexto)} · ${t.filial ? escapeHTML(t.filial) : 'Agência (todas as filiais)'}${t.prazo ? ' · prazo ' + (typeof formatarDataEvento === 'function' ? formatarDataEvento(t.prazo) : t.prazo) : ''}
                        </div>
                    </div>
                    <span class="tag ${statusClasse}">${statusTexto}</span>
                </div>
            </div>`;
    }).join('');
}

// ---------------------------------------------------------
// Sincronização coluna <-> tarefa (bidirecional)
// ---------------------------------------------------------
// Chamada de dentro de executarMovimentoParaColuna() (js/app.js) toda
// vez que 1+ leads mudam de coluna — marca como concluído (via='coluna')
// qualquer item de tarefa AINDA não concluído desses leads cuja
// coluna_gatilho_conclusao bata com a coluna nova. Best-effort: erro
// aqui nunca impede a movimentação em si (chamador já trata com .catch).
async function sincronizarTarefasAoMoverColuna(ids, novaColuna) {
    const { data: vinculos, error } = await window.supabaseClient
        .from('tarefa_leads')
        .select('id, tarefa_id, pessoaIdentificador, tarefas(coluna_gatilho_conclusao, cancelada)')
        .in('pessoaIdentificador', ids.map(String))
        .eq('concluida', false);
    if (error) { console.warn('Erro ao buscar tarefas pra sincronizar com a coluna:', error.message); return; }

    const paraConcluir = (vinculos || []).filter(v => v.tarefas && !v.tarefas.cancelada && v.tarefas.coluna_gatilho_conclusao === novaColuna);
    if (paraConcluir.length === 0) return;

    const agora = new Date().toISOString();
    await Promise.all(paraConcluir.map(v =>
        window.supabaseClient.from('tarefa_leads').update({ concluida: true, concluida_em: agora, concluida_via: 'coluna' }).eq('id', v.id)
    ));

    // Atualiza o cache local (se a aba Tarefas já tiver sido carregada
    // nesta sessão) — sem isso, o número "3/5 concluídos" só atualizaria
    // depois de reabrir a aba.
    paraConcluir.forEach(v => {
        const lista = tarefaLeadsPorTarefa[v.tarefa_id];
        if (!lista) return;
        const item = lista.find(l => l.id === v.id);
        if (item) { item.concluida = true; item.concluida_em = agora; item.concluida_via = 'coluna'; }
    });
    const abaTarefasAtiva = document.getElementById('tab-tarefas');
    if (abaTarefasAtiva && abaTarefasAtiva.classList.contains('active')) renderizarListaTarefas();
}

// Marcar/desmarcar 1 lead como concluído DENTRO da tarefa (checkbox no
// modal) — o inverso do gatilho acima: concluir manualmente move o lead
// pra `coluna_ao_concluir`, se a tarefa tiver isso configurado.
async function alternarConclusaoTarefaLead(tarefaId, pessoaIdentificador, novoValor) {
    if (!tarefaId) return;
    const agora = novoValor ? new Date().toISOString() : null;
    const { error } = await window.supabaseClient.from('tarefa_leads')
        .update({ concluida: novoValor, concluida_em: agora, concluida_via: novoValor ? 'manual' : null })
        .eq('tarefa_id', tarefaId).eq('pessoaIdentificador', String(pessoaIdentificador));
    if (error) { alert('Erro ao salvar: ' + error.message); return; }

    const itemModal = tarefaLeadsSelecionados.find(l => String(l.pessoaIdentificador) === String(pessoaIdentificador));
    if (itemModal) { itemModal.concluida = novoValor; itemModal.concluida_em = agora; }
    const listaCache = tarefaLeadsPorTarefa[tarefaId];
    if (listaCache) {
        const itemCache = listaCache.find(l => String(l.pessoaIdentificador) === String(pessoaIdentificador));
        if (itemCache) { itemCache.concluida = novoValor; itemCache.concluida_em = agora; itemCache.concluida_via = novoValor ? 'manual' : null; }
    }

    const t = tarefasCache.find(t => t.id === tarefaId);
    if (novoValor && t && t.coluna_ao_concluir && typeof moverLeadsParaColuna === 'function') {
        await moverLeadsParaColuna([String(pessoaIdentificador)], t.coluna_ao_concluir);
    }
    renderizarListaLeadsTarefaModal();
    renderizarListaTarefas();
}

// ---------------------------------------------------------
// Modal de criar/editar tarefa
// ---------------------------------------------------------
function popularSelectsTarefa() {
    const selFilial = document.getElementById('tarefaFilial');
    if (selFilial) {
        selFilial.innerHTML = '<option value="">Agência (todas as filiais)</option>' +
            (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : [])
                .map(f => `<option value="${escapeHTML(f.nome)}">${escapeHTML(f.nome)}</option>`).join('');
    }
    const selUsuario = document.getElementById('tarefaResponsavelUsuario');
    if (selUsuario) {
        selUsuario.innerHTML = (typeof usuariosCrmCache !== 'undefined' ? usuariosCrmCache : [])
            .filter(u => u.ativo).map(u => `<option value="${u.id}">${escapeHTML(u.nome)}</option>`).join('');
    }
    const selEquipe = document.getElementById('tarefaResponsavelEquipe');
    if (selEquipe) {
        selEquipe.innerHTML = equipesTarefasCache.map(eq => `<option value="${eq.id}">${escapeHTML(eq.nome)}</option>`).join('');
    }
    const opcoesColunas = '<option value="">Nenhuma</option>' +
        (typeof columnsConfig !== 'undefined' ? columnsConfig : []).map(c => `<option value="${escapeHTML(c.key)}">${escapeHTML(c.label)}</option>`).join('');
    const selGatilho = document.getElementById('tarefaColunaGatilho');
    const selDestino = document.getElementById('tarefaColunaDestino');
    if (selGatilho) selGatilho.innerHTML = opcoesColunas;
    if (selDestino) selDestino.innerHTML = opcoesColunas;
}

function atualizarTipoResponsavelTarefa() {
    const tipo = document.querySelector('input[name="tarefaTipoResponsavel"]:checked')?.value;
    document.getElementById('tarefaResponsavelUsuario').style.display = tipo === 'usuario' ? 'block' : 'none';
    document.getElementById('tarefaResponsavelEquipe').style.display = tipo === 'equipe' ? 'block' : 'none';
}

async function garantirCachesTarefaModal() {
    if (equipesTarefasCache.length === 0) await carregarEquipesTarefas();
    if ((typeof usuariosCrmCache === 'undefined' || usuariosCrmCache.length === 0) && typeof carregarUsuariosCrm === 'function') {
        await carregarUsuariosCrm();
    }
}

async function abrirNovaTarefa() {
    tarefaEditandoId = null;
    tarefaLeadsSelecionados = [];
    document.getElementById('modalTarefaTitulo').innerHTML = '<i class="fa-solid fa-list-check"></i> Nova Tarefa';
    document.getElementById('tarefaTitulo').value = '';
    document.getElementById('tarefaDescricao').value = '';
    document.getElementById('tarefaPrazo').value = '';
    document.getElementById('tarefaBtnCancelar').style.display = 'none';
    document.querySelector('input[name="tarefaTipoResponsavel"][value="usuario"]').checked = true;

    await garantirCachesTarefaModal();
    popularSelectsTarefa();
    document.getElementById('tarefaFilial').value = (typeof filialAtual !== 'undefined' && filialAtual) || '';
    document.getElementById('tarefaColunaGatilho').value = '';
    document.getElementById('tarefaColunaDestino').value = '';
    atualizarTipoResponsavelTarefa();
    renderizarListaLeadsTarefaModal();
    document.getElementById('modalTarefa').classList.add('open');
}

async function abrirEditarTarefa(id) {
    const t = tarefasCache.find(t => t.id === id);
    if (!t) return;
    tarefaEditandoId = id;
    const leadsExistentes = tarefaLeadsPorTarefa[id] || [];
    tarefaLeadsSelecionados = leadsExistentes.map(l => ({
        pessoaIdentificador: String(l.pessoaIdentificador), pessoaNome: l.pessoaNome,
        concluida: l.concluida, concluida_em: l.concluida_em, jaExistia: true,
    }));

    document.getElementById('modalTarefaTitulo').innerHTML = '<i class="fa-solid fa-list-check"></i> Editar Tarefa';
    document.getElementById('tarefaTitulo').value = t.titulo;
    document.getElementById('tarefaDescricao').value = t.descricao || '';
    document.getElementById('tarefaPrazo').value = t.prazo || '';
    document.getElementById('tarefaBtnCancelar').style.display = 'inline-flex';

    await garantirCachesTarefaModal();
    popularSelectsTarefa();
    document.getElementById('tarefaFilial').value = t.filial || '';

    if (t.responsavel_equipe_id) {
        document.querySelector('input[name="tarefaTipoResponsavel"][value="equipe"]').checked = true;
        document.getElementById('tarefaResponsavelEquipe').value = t.responsavel_equipe_id;
    } else if (t.responsavel_usuario_id) {
        document.querySelector('input[name="tarefaTipoResponsavel"][value="usuario"]').checked = true;
        document.getElementById('tarefaResponsavelUsuario').value = t.responsavel_usuario_id;
    } else {
        document.querySelector('input[name="tarefaTipoResponsavel"][value="nenhum"]').checked = true;
    }
    atualizarTipoResponsavelTarefa();

    document.getElementById('tarefaColunaGatilho').value = t.coluna_gatilho_conclusao || '';
    document.getElementById('tarefaColunaDestino').value = t.coluna_ao_concluir || '';

    renderizarListaLeadsTarefaModal();
    document.getElementById('modalTarefa').classList.add('open');
}

function fecharModalTarefa() {
    document.getElementById('modalTarefa').classList.remove('open');
}

// ---------------------------------------------------------
// Busca/adição de leads dentro do modal de tarefa
// ---------------------------------------------------------
function buscarLeadParaTarefa(termo) {
    clearTimeout(debounceBuscaLeadTarefa);
    const resultsEl = document.getElementById('tarefaBuscaLeadResultados');
    if (!resultsEl) return;
    termo = termo.trim();
    if (termo.length < 2) { resultsEl.innerHTML = ''; return; }
    debounceBuscaLeadTarefa = setTimeout(async () => {
        const termoSeguro = termo.replace(/,/g, ' ');
        const filialSelecionada = document.getElementById('tarefaFilial').value;
        // Sem filial escolhida (tarefa "Agência") busca em TODAS as
        // filiais — mesmo espírito de casamento cross-filial já usado na
        // Importação em Lote de Conversas de WhatsApp.
        let query = window.supabaseClient.from(NOME_TABELA)
            .select('pessoaIdentificador, pessoaNome, filial')
            .is('lixeira_em', null)
            .or(`pessoaNome.ilike.%${termoSeguro}%,pessoaTelefoneNumero.ilike.%${termoSeguro}%`)
            .limit(15);
        if (filialSelecionada) query = query.eq('filial', filialSelecionada);
        const { data, error } = await query;
        if (resultsEl !== document.getElementById('tarefaBuscaLeadResultados')) return; // modal fechou no meio tempo
        if (error) { resultsEl.innerHTML = `<p style="font-size:11px; color:#dc2626;">Erro: ${escapeHTML(error.message)}</p>`; return; }

        const jaSelecionados = new Set(tarefaLeadsSelecionados.map(l => String(l.pessoaIdentificador)));
        const filtrados = (data || []).filter(r => !jaSelecionados.has(String(r.pessoaIdentificador)));
        if (filtrados.length === 0) { resultsEl.innerHTML = '<p style="font-size:11px; color:var(--text-muted);">Nenhum lead novo encontrado.</p>'; return; }

        resultsEl.innerHTML = filtrados.map(r => `
            <div class="info-box" style="cursor:pointer; margin-bottom:4px; padding:6px 8px;" onclick="adicionarLeadNaTarefa('${r.pessoaIdentificador}', '${escapeHTML(r.pessoaNome).replace(/'/g, "\\'")}')">
                <i class="fa-solid fa-user-plus"></i> ${escapeHTML(r.pessoaNome)} <span style="color:var(--text-muted); font-size:11px;">(${escapeHTML(r.filial)})</span>
            </div>
        `).join('');
    }, 250);
}

function adicionarLeadNaTarefa(pessoaIdentificador, pessoaNome) {
    tarefaLeadsSelecionados.push({ pessoaIdentificador: String(pessoaIdentificador), pessoaNome, concluida: false, jaExistia: false });
    document.getElementById('tarefaBuscaLead').value = '';
    document.getElementById('tarefaBuscaLeadResultados').innerHTML = '';
    renderizarListaLeadsTarefaModal();
}

function removerLeadDaTarefaModal(pessoaIdentificador) {
    tarefaLeadsSelecionados = tarefaLeadsSelecionados.filter(l => String(l.pessoaIdentificador) !== String(pessoaIdentificador));
    renderizarListaLeadsTarefaModal();
}

function renderizarListaLeadsTarefaModal() {
    const container = document.getElementById('tarefaListaLeads');
    if (!container) return;
    if (tarefaLeadsSelecionados.length === 0) {
        container.innerHTML = '<p style="font-size:11px; color:var(--text-muted);">Nenhum lead adicionado ainda.</p>';
        return;
    }
    container.innerHTML = tarefaLeadsSelecionados.map(l => `
        <div style="display:flex; align-items:center; gap:8px; padding:5px 8px; border:1px solid var(--border-color); border-radius:6px; font-size:12px;">
            ${l.jaExistia
                ? `<input type="checkbox" ${l.concluida ? 'checked' : ''} onchange="alternarConclusaoTarefaLead(${tarefaEditandoId}, '${l.pessoaIdentificador}', this.checked)" title="Marcar como concluído">`
                : '<i class="fa-solid fa-circle-plus" style="color:var(--na-green);" title="Novo — vinculado ao Salvar"></i>'}
            <span style="flex:1; ${l.concluida ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${escapeHTML(l.pessoaNome)}</span>
            <button class="icon-btn danger" onclick="removerLeadDaTarefaModal('${l.pessoaIdentificador}')" title="Remover"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `).join('');
}

// ---------------------------------------------------------
// Salvar / cancelar tarefa
// ---------------------------------------------------------
async function salvarTarefa() {
    const titulo = document.getElementById('tarefaTitulo').value.trim();
    if (!titulo) { alert('Digite um título pra tarefa.'); return; }

    const tipoResponsavel = document.querySelector('input[name="tarefaTipoResponsavel"]:checked')?.value;
    const usuario = typeof usuarioLogado === 'function' ? usuarioLogado() : null;

    const payload = {
        titulo,
        descricao: document.getElementById('tarefaDescricao').value.trim() || null,
        filial: document.getElementById('tarefaFilial').value || null,
        prazo: document.getElementById('tarefaPrazo').value || null,
        coluna_gatilho_conclusao: document.getElementById('tarefaColunaGatilho').value || null,
        coluna_ao_concluir: document.getElementById('tarefaColunaDestino').value || null,
        responsavel_usuario_id: tipoResponsavel === 'usuario' ? (document.getElementById('tarefaResponsavelUsuario').value || null) : null,
        responsavel_equipe_id: tipoResponsavel === 'equipe' ? (document.getElementById('tarefaResponsavelEquipe').value || null) : null,
        criado_por: (usuario && usuario.nome) || null,
    };

    let tarefaId = tarefaEditandoId;
    if (tarefaId) {
        const { error } = await window.supabaseClient.from('tarefas').update(payload).eq('id', tarefaId);
        if (error) { alert('Erro ao salvar tarefa: ' + error.message); return; }
    } else {
        const { data, error } = await window.supabaseClient.from('tarefas').insert(payload).select('id').single();
        if (error) { alert('Erro ao criar tarefa: ' + error.message); return; }
        tarefaId = data.id;
    }

    // Só insere os leads NOVOS (o status dos que já existiam é editado
    // direto pelo checkbox, ver alternarConclusaoTarefaLead()).
    const novos = tarefaLeadsSelecionados.filter(l => !l.jaExistia);
    if (novos.length > 0) {
        const { error: erroLeads } = await window.supabaseClient.from('tarefa_leads').insert(
            novos.map(l => ({ tarefa_id: tarefaId, pessoaIdentificador: String(l.pessoaIdentificador) }))
        );
        if (erroLeads) alert('Tarefa salva, mas houve erro ao vincular algum(ns) lead(s): ' + erroLeads.message);
    }

    fecharModalTarefa();
    await carregarTarefas();
}

async function cancelarTarefaAtual() {
    if (!tarefaEditandoId) return;
    if (!confirm('Cancelar esta tarefa? Ela some da lista (fica marcada como cancelada no banco, não é apagada).')) return;
    const { error } = await window.supabaseClient.from('tarefas').update({ cancelada: true }).eq('id', tarefaEditandoId);
    if (error) { alert('Erro ao cancelar tarefa: ' + error.message); return; }
    fecharModalTarefa();
    await carregarTarefas();
}

// ==========================================================
// AGENDA DE EVENTOS — atividades/capacidade por filial (MVP)
// ==========================================================
// Cadastro manual (sem integração com o site institucional nem com o
// Ulisses — nenhum dos dois tem API externa conhecida). "Confirmados" é
// calculado no navegador cruzando o nome+data do evento com
// historico_eventos de cada lead já carregado — é uma métrica-proxy,
// mesmo espírito dos KPIs do Dashboard (não é uma contagem exata do banco
// inteiro se ainda houver "Carregar Mais" pendente na aba CRM).
//
// Depende de variáveis/funções já definidas em app.js, que carrega ANTES
// deste arquivo: NOME_TABELA_FILIAIS (não usado aqui, só referência),
// filialAtual, leadsAtuais, escapeHTML(), parseDataBR().

const NOME_TABELA_EVENTOS = 'eventos';
const NOME_TABELA_TIPOS_EVENTO = 'tipos_evento';
const NOME_TABELA_EVENTO_LEADS = 'evento_leads';

let eventosAtuais = [];
let eventoEditandoId = null;
let mostrarEventosPassados = false;

// Resumo agregado de evento_leads por evento (evento_id -> {total, confirmados,
// recusados, pendentes, compareceram}), carregado junto com carregarEventos()
// e atualizado ao fechar o modal de Participantes — evita 1 fetch por card.
let participantesResumoPorEvento = new Map();
let eventoParticipantesId = null;
let participantesAtuais = []; // linhas de evento_leads + dados do lead, só do evento aberto no modal
// "Matriculado" só faz sentido pra eventos de Abertura de Turma (pedido
// explícito do usuário) — os demais tipos (Palestra, Workshop etc.) não
// mostram esse campo nem no modal nem na barra de ações em massa.
let permiteMatriculaEventoAtual = false;

// Catálogo de tipos de evento (compartilhado, editável em "Gerenciar
// Tipos") — usado pra popular o <select> do modal de Evento. Padrão
// embutido só cobre o caso de a migração ainda não ter rodado, pra o
// formulário não ficar sem nenhuma opção.
let TIPOS_EVENTO = ['Palestra', 'Workshop', 'Oficina', 'Curso', 'Aula Inaugural', 'Leitura Comentada', 'Filosofilme', 'Café Cultural', 'Abertura de Turma', 'Outro'];
let tiposEventoModalCache = []; // [{id, nome, ordem}], carregado ao abrir "Gerenciar Tipos"

// ==========================================
// CARREGAMENTO
// ==========================================
async function carregarEventos() {
    const container = document.getElementById('agendaLista');
    if (!container || !filialAtual) return;

    await carregarTiposEvento();

    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA_EVENTOS)
        .select('*')
        .eq('filial', filialAtual)
        .eq('ativo', true)
        .order('data', { ascending: true })
        .order('hora', { ascending: true });

    if (error) {
        console.warn('Não foi possível carregar a tabela "eventos" (rode migracao_eventos.sql se ainda não rodou).', error);
        container.innerHTML = '<div class="agenda-vazio">Agenda indisponível — rode migracao_eventos.sql no Supabase.</div>';
        return;
    }

    eventosAtuais = data || [];
    await carregarResumoParticipantes(eventosAtuais);
    renderizarListaEventos();
}

function resumoParticipantesVazio() {
    return { total: 0, confirmados: 0, recusados: 0, pendentes: 0, compareceram: 0, matriculados: 0, naoCompareceuConfirmados: 0 };
}

// Uma única query pra todos os eventos da filial (não 1 por card) — só a
// contagem por resposta/comparecimento, os dados de cada lead só são
// buscados quando o modal de Participantes de um evento específico abre.
//
// Eventos com "participantes_unificados" fazem parte de um grupo
// multi-filial cuja lista é COMPARTILHADA — o resumo de qualquer evento do
// grupo precisa somar os evento_leads de TODAS as filiais do grupo, não só
// desta. Isso exige 1 query extra (achar os evento_id irmãos por
// grupo_evento_id) só quando existe pelo menos 1 evento unificado nesta
// filial.
async function carregarResumoParticipantes(eventos) {
    participantesResumoPorEvento = new Map();
    if (!eventos || eventos.length === 0) return;

    const gruposUnificados = new Map(); // grupo_evento_id -> [evento_id, ...]
    const idsNormais = [];
    eventos.forEach(ev => {
        if (ev.participantes_unificados && ev.grupo_evento_id) {
            if (!gruposUnificados.has(ev.grupo_evento_id)) gruposUnificados.set(ev.grupo_evento_id, []);
        } else {
            idsNormais.push(ev.id);
        }
    });

    let idsParaConsulta = [...idsNormais];
    if (gruposUnificados.size > 0) {
        const { data: irmaos, error: erroIrmaos } = await window.supabaseClient
            .from(NOME_TABELA_EVENTOS)
            .select('id, grupo_evento_id')
            .in('grupo_evento_id', Array.from(gruposUnificados.keys()));
        if (erroIrmaos) {
            console.warn('Não foi possível resolver os eventos irmãos de grupos multi-filial.', erroIrmaos);
        } else {
            (irmaos || []).forEach(ir => {
                gruposUnificados.get(ir.grupo_evento_id).push(ir.id);
                idsParaConsulta.push(ir.id);
            });
        }
    }
    if (idsParaConsulta.length === 0) return;

    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA_EVENTO_LEADS)
        .select('evento_id, resposta_convite, compareceu, matriculado')
        .in('evento_id', idsParaConsulta);

    if (error) {
        console.warn('Não foi possível carregar resumo de participantes (rode migracao_evento_leads.sql e migracao_evento_leads_matriculado.sql se ainda não rodou).', error);
        return;
    }

    const resumoPorId = new Map();
    (data || []).forEach(row => {
        if (!resumoPorId.has(row.evento_id)) resumoPorId.set(row.evento_id, resumoParticipantesVazio());
        const r = resumoPorId.get(row.evento_id);
        r.total++;
        if (row.resposta_convite === 'confirmado') r.confirmados++;
        else if (row.resposta_convite === 'recusado') r.recusados++;
        else r.pendentes++;
        if (row.compareceu === true) r.compareceram++;
        if (row.matriculado === true) r.matriculados++;
        // Confirmou presença mas não compareceu — o time precisa entrar em
        // contato de novo (ver moverLeadsParaRecontato() abaixo).
        if (row.resposta_convite === 'confirmado' && row.compareceu === false) r.naoCompareceuConfirmados++;
    });

    idsNormais.forEach(id => {
        if (resumoPorId.has(id)) participantesResumoPorEvento.set(id, resumoPorId.get(id));
    });

    // Grupo unificado: soma os evento_id do grupo inteiro e replica o MESMO
    // total pra cada um — assim o card de qualquer filial do grupo mostra
    // o número agregado certo, mesmo que o vínculo tenha sido feito por
    // outra filial.
    gruposUnificados.forEach(idsDoGrupo => {
        const agregado = resumoParticipantesVazio();
        idsDoGrupo.forEach(id => {
            const r = resumoPorId.get(id);
            if (!r) return;
            Object.keys(agregado).forEach(campo => { agregado[campo] += r[campo]; });
        });
        idsDoGrupo.forEach(id => participantesResumoPorEvento.set(id, agregado));
    });
}

async function carregarTiposEvento() {
    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA_TIPOS_EVENTO)
        .select('nome')
        .order('ordem', { ascending: true });

    if (error) {
        console.warn('Não foi possível carregar a tabela "tipos_evento" (rode migracao_tipos_evento.sql se ainda não rodou) — usando lista padrão.', error);
    } else if (data && data.length > 0) {
        TIPOS_EVENTO = data.map(row => row.nome);
    }
    montarSelectTipoEvento();
}

function montarSelectTipoEvento() {
    const select = document.getElementById('eventoTipoInput');
    if (!select) return;
    const valorAtual = select.value;
    select.innerHTML = TIPOS_EVENTO.map(t => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`).join('');
    if (valorAtual && TIPOS_EVENTO.includes(valorAtual)) select.value = valorAtual;
}

// ==========================================
// GERENCIAR TIPOS DE EVENTO (catálogo compartilhado)
// ==========================================
async function abrirGerenciarTiposEvento() {
    await renderizarListaTiposEventoModal();
    document.getElementById('modalTiposEvento').classList.add('open');
    document.getElementById('overlayModalTiposEvento').classList.add('active');
}
function fecharGerenciarTiposEvento() {
    document.getElementById('modalTiposEvento').classList.remove('open');
    document.getElementById('overlayModalTiposEvento').classList.remove('active');
    carregarTiposEvento(); // repopula TIPOS_EVENTO + o <select> do modal de Evento
}

// trilha/palavras_chave só existem depois de migracao_tipos_evento_trilha.sql
// — sem elas, os 2 campos extras somem da lista (best-effort, não trava a
// Agenda) e um aviso aparece no topo.
let colunasTrilhaDisponiveis = true;
const TRILHAS_DISPONIVEIS = ['Filosófica', 'Desenvolvimento Pessoal', 'Artes'];

async function renderizarListaTiposEventoModal() {
    const container = document.getElementById('tiposEventoList');
    if (!container) return;
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Carregando...</p>';

    let { data, error } = await window.supabaseClient
        .from(NOME_TABELA_TIPOS_EVENTO)
        .select('id, nome, ordem, trilha, palavras_chave')
        .order('ordem', { ascending: true });

    colunasTrilhaDisponiveis = !error;
    if (error) {
        // Provavelmente a migração de trilha/palavras_chave ainda não rodou
        // — tenta de novo só com as colunas originais, pra não travar a
        // tela toda por causa de 2 campos extras opcionais.
        const fallback = await window.supabaseClient
            .from(NOME_TABELA_TIPOS_EVENTO)
            .select('id, nome, ordem')
            .order('ordem', { ascending: true });
        data = fallback.data;
        error = fallback.error;
    }

    if (error) {
        container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro ao carregar tipos: ${escapeHTML(error.message)}. Rode migracao_tipos_evento.sql se ainda não rodou.</p>`;
        return;
    }

    tiposEventoModalCache = data || [];
    const aviso = !colunasTrilhaDisponiveis
        ? '<p style="font-size:11px; color:#b45309; margin-bottom:10px;"><i class="fa-solid fa-triangle-exclamation"></i> Rode migracao_tipos_evento_trilha.sql pra habilitar Trilha e Palavras-chave por tipo.</p>'
        : '';
    container.innerHTML = aviso + tiposEventoModalCache.map((tipo, i) => `
        <div class="coluna-row" data-idx="${i}" style="flex-wrap:wrap; align-items:flex-start;" draggable="true" ondragstart="iniciarArrastoLista(event, '${tipo.id}')" ondragend="this.style.opacity='1'" ondragover="event.preventDefault()" ondrop="soltarNaLista(event, 'tipos-evento', '${tipo.id}')">
            <i class="fa-solid fa-grip-vertical" style="color:var(--text-muted); cursor:grab; align-self:center;" title="Arraste pra reordenar"></i>
            <input type="text" value="${escapeHTML(tipo.nome)}" onchange="atualizarNomeTipoEvento(${tipo.id}, this.value)" style="min-width:140px;">
            ${colunasTrilhaDisponiveis ? `
                <select onchange="atualizarTrilhaTipoEvento(${tipo.id}, this.value)" title="Trilha de interesse (sistema de follow-up)">
                    <option value="">Trilha: nenhuma</option>
                    ${TRILHAS_DISPONIVEIS.map(t => `<option value="${escapeHTML(t)}" ${tipo.trilha === t ? 'selected' : ''}>${escapeHTML(t)}</option>`).join('')}
                </select>
                <input type="text" value="${escapeHTML(tipo.palavras_chave || '')}" placeholder="Palavras-chave separadas por vírgula (classificação automática na importação)" onchange="atualizarPalavrasChaveTipoEvento(${tipo.id}, this.value)" style="min-width:220px;">
            ` : ''}
            <button class="icon-btn danger" title="Remover" onclick="removerTipoEvento(${tipo.id})"><i class="fa-solid fa-trash"></i></button>
        </div>
    `).join('');
}
REORDENADORES_LISTA['tipos-evento'] = (idOrigem, idDestino) =>
    reordenarESalvarOrdem(NOME_TABELA_TIPOS_EVENTO, tiposEventoModalCache, idOrigem, idDestino, renderizarListaTiposEventoModal);

async function atualizarNomeTipoEvento(id, novoNome) {
    novoNome = novoNome.trim();
    if (!novoNome) return;
    const { error } = await window.supabaseClient.from(NOME_TABELA_TIPOS_EVENTO).update({ nome: novoNome }).eq('id', id);
    if (error) { alert('Erro ao renomear tipo: ' + error.message); return; }
    renderizarListaTiposEventoModal();
}

async function atualizarTrilhaTipoEvento(id, novaTrilha) {
    const { error } = await window.supabaseClient.from(NOME_TABELA_TIPOS_EVENTO).update({ trilha: novaTrilha || null }).eq('id', id);
    if (error) { alert('Erro ao salvar trilha: ' + error.message); return; }
}

async function atualizarPalavrasChaveTipoEvento(id, novasPalavras) {
    const { error } = await window.supabaseClient.from(NOME_TABELA_TIPOS_EVENTO).update({ palavras_chave: novasPalavras.trim() || null }).eq('id', id);
    if (error) { alert('Erro ao salvar palavras-chave: ' + error.message); return; }
}

async function adicionarTipoEvento() {
    const input = document.getElementById('novoTipoEventoTexto');
    if (!input) return;
    const nome = input.value.trim();
    if (!nome) return;

    const proximaOrdem = tiposEventoModalCache.length;
    const { error } = await window.supabaseClient
        .from(NOME_TABELA_TIPOS_EVENTO)
        .insert({ nome, ordem: proximaOrdem });

    if (error) { alert('Erro ao adicionar tipo: ' + error.message); return; }
    input.value = '';
    renderizarListaTiposEventoModal();
}

async function removerTipoEvento(id) {
    const { error } = await window.supabaseClient.from(NOME_TABELA_TIPOS_EVENTO).delete().eq('id', id);
    if (error) { alert('Erro ao remover tipo: ' + error.message); return; }
    renderizarListaTiposEventoModal();
}

function toggleEventosPassados() {
    mostrarEventosPassados = !mostrarEventosPassados;
    const btn = document.getElementById('btnTogglePassadosEventos');
    if (btn) btn.classList.toggle('active', mostrarEventosPassados);
    renderizarListaEventos();
}

// ==========================================
// RENDERIZAÇÃO (sem fetch — reaproveita eventosAtuais em cache, chamada
// toda vez que renderizarCards() roda, pra manter "Confirmados" em dia
// conforme leadsAtuais muda, sem bater no banco a cada re-render)
// ==========================================
// Data "efetiva" pra decidir se o evento já passou — normalmente é a
// própria data do evento, mas eventos com prazo de inscrição maior (ex:
// "Abertura de Turma", cuja turma dura ~6 meses a partir da data do evento)
// usam data_limite_inscricao no lugar, pra continuar "ativo" (visível por
// padrão, disponível pra convidar leads) até essa data em vez de virar
// "passado" no dia seguinte ao evento em si.
function dataEfetivaLimite(evento) {
    return evento.data_limite_inscricao || evento.data;
}

function renderizarListaEventos() {
    const container = document.getElementById('agendaLista');
    if (!container) return;

    const hojeISO = new Date().toISOString().slice(0, 10);
    // Futuros: cronológico normal (o mais próximo primeiro — é "o que vem
    // a seguir"). Passados: ORDEM INVERTIDA (o mais recente primeiro,
    // descendo pros mais antigos) — pedido explícito do usuário; do jeito
    // que estava antes (tudo num sort só, ascendente), abrir "Mostrar
    // passados" mostrava o evento mais ANTIGO da filial no topo, obrigando
    // rolar a lista toda pra achar algo recente.
    const chave = ev => ev.data + (ev.hora || '');
    const futuros = eventosAtuais.filter(ev => dataEfetivaLimite(ev) >= hojeISO).sort((a, b) => chave(a).localeCompare(chave(b)));
    const passados = mostrarEventosPassados
        ? eventosAtuais.filter(ev => dataEfetivaLimite(ev) < hojeISO).sort((a, b) => chave(b).localeCompare(chave(a)))
        : [];
    const lista = [...futuros, ...passados];

    if (lista.length === 0) {
        container.innerHTML = `<div class="agenda-vazio">Nenhum evento ${mostrarEventosPassados ? 'cadastrado' : 'futuro'} pra esta filial ainda. Clique em "Novo Evento" pra cadastrar o primeiro.</div>`;
        return;
    }

    container.innerHTML = lista.map(ev => {
        const passado = dataEfetivaLimite(ev) < hojeISO;
        const resumo = participantesResumoPorEvento.get(ev.id);
        // Prioriza o "Confirmado" real (resposta_convite em evento_leads,
        // gerenciado no modal de Participantes) sobre o proxy antigo por
        // historico_eventos — esse só reagia depois que o evento já tinha
        // sido reimportado numa planilha futura, então nunca refletia uma
        // confirmação feita ANTES do evento acontecer. Eventos que nunca
        // usaram o modal de Participantes (resumo vazio) continuam com o
        // proxy, pra não perder informação de importações antigas.
        const confirmados = (resumo && resumo.total > 0) ? resumo.confirmados : contarConfirmadosEvento(ev);
        const capacidade = ev.capacidade;
        const temLimite = capacidade !== null && capacidade !== undefined && capacidade !== '';
        const pct = temLimite && capacidade > 0 ? Math.min(100, Math.round((confirmados / capacidade) * 100)) : 0;
        const lotado = temLimite && confirmados >= capacidade;

        return `
            <div class="evento-card ${passado ? 'evento-passado' : ''}">
                ${ev.imagem_url ? `<img class="evento-thumb" src="${escapeHTML(ev.imagem_url)}" alt="" onerror="this.style.display='none';">` : ''}
                <div class="evento-card-info">
                    <div class="evento-nome">
                        ${escapeHTML(ev.nome)}
                        ${ev.tipo ? `<span class="tag tag-nivel">${escapeHTML(ev.tipo)}</span>` : ''}
                        ${ev.grupo_evento_id ? `<span class="tag tag-success" title="Faz parte de um ciclo cadastrado pra várias filiais"><i class="fa-solid fa-diagram-project"></i> Multi-filial</span>` : ''}
                    </div>
                    <div class="evento-meta">
                        <span><i class="fa-solid fa-calendar"></i> ${formatarDataEvento(ev.data)}${ev.hora ? ' às ' + formatarHoraEvento(ev.hora) : ''}</span>
                        <span><i class="fa-solid fa-ticket"></i> ${ev.ingresso ? escapeHTML(ev.ingresso) : 'Não informado'}</span>
                        ${ev.data_limite_inscricao ? `<span><i class="fa-solid fa-hourglass-half"></i> Inscrições até ${formatarDataEvento(ev.data_limite_inscricao)}</span>` : ''}
                    </div>
                    ${ev.descricao ? `<div class="evento-descricao">${escapeHTML(ev.descricao)}</div>` : ''}
                    ${resumo && resumo.total > 0 ? `
                        <div class="evento-participantes-resumo">
                            <i class="fa-solid fa-users"></i> ${resumo.total} lead${resumo.total === 1 ? '' : 's'} vinculado${resumo.total === 1 ? '' : 's'}
                            ${resumo.confirmados ? ` <span class="part-confirmado">${resumo.confirmados} confirmado${resumo.confirmados === 1 ? '' : 's'}</span>` : ''}
                            ${resumo.recusados ? ` <span class="part-recusado">${resumo.recusados} recusado${resumo.recusados === 1 ? '' : 's'}</span>` : ''}
                            ${resumo.pendentes ? ` <span class="part-pendente">${resumo.pendentes} pendente${resumo.pendentes === 1 ? '' : 's'}</span>` : ''}
                            ${passado && resumo.compareceram ? ` <span class="part-compareceu">${resumo.compareceram} compareceu/compareceram</span>` : ''}
                            ${resumo.naoCompareceuConfirmados ? ` <span class="part-nao-compareceu">${resumo.naoCompareceuConfirmados} confirmado(s) sem comparecer</span>` : ''}
                            ${resumo.matriculados ? ` <span class="part-matriculado">${resumo.matriculados} matriculado${resumo.matriculados === 1 ? '' : 's'} 🎉</span>` : ''}
                        </div>
                    ` : ''}
                </div>
                <div class="evento-vagas">
                    <div class="evento-vagas-label">${confirmados} ${temLimite ? '/ ' + capacidade : ''} confirmado${confirmados === 1 ? '' : 's'}</div>
                    ${temLimite ? `
                        <div class="evento-vagas-bar-wrapper">
                            <div class="evento-vagas-bar-fill ${lotado ? 'evento-lotado' : ''}" style="width:${pct}%;"></div>
                        </div>
                    ` : ''}
                </div>
                <div class="evento-actions">
                    <button class="icon-btn" title="Gerenciar Participantes" onclick="abrirParticipantesEvento(${ev.id})"><i class="fa-solid fa-users"></i></button>
                    <button class="icon-btn" title="Editar" onclick="abrirFormEvento(${ev.id})"><i class="fa-solid fa-pen"></i></button>
                </div>
            </div>
        `;
    }).join('');

    if (typeof verificarNotificacoesEventoLotado === 'function') verificarNotificacoesEventoLotado();
}

// Cruza nome (normalizado) + data do evento contra o historico_eventos de
// cada lead já carregado no navegador. Proxy, não é o banco inteiro.
function normalizarNomeEventoAgenda(nome) {
    return String(nome || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/\s+/g, ' ').trim();
}

function contarConfirmadosEvento(evento) {
    const nomeAlvo = normalizarNomeEventoAgenda(evento.nome);
    const dataAlvo = new Date(evento.data + 'T00:00:00');
    const leads = (typeof leadsAtuais !== 'undefined') ? leadsAtuais : [];

    let count = 0;
    leads.forEach(lead => {
        const hist = Array.isArray(lead.historico_eventos) ? lead.historico_eventos : [];
        const bateu = hist.some(h => {
            if (normalizarNomeEventoAgenda(h.evento) !== nomeAlvo) return false;
            const d = (typeof parseDataBR === 'function') ? parseDataBR(h.data) : null;
            if (!d) return false;
            return d.getFullYear() === dataAlvo.getFullYear() && d.getMonth() === dataAlvo.getMonth() && d.getDate() === dataAlvo.getDate();
        });
        if (bateu) count++;
    });
    return count;
}

function formatarDataEvento(dataISO) {
    if (!dataISO) return '';
    const [ano, mes, dia] = String(dataISO).split('-');
    return `${dia}/${mes}/${ano}`;
}
function formatarHoraEvento(horaStr) {
    if (!horaStr) return '';
    return String(horaStr).slice(0, 5); // "HH:MM:SS" -> "HH:MM"
}

// ==========================================
// CRIAR / EDITAR / DESATIVAR
// ==========================================
function abrirFormEvento(id) {
    eventoEditandoId = id || null;
    const titulo = document.getElementById('eventoModalTitulo');
    const btnDesativar = document.getElementById('btnDesativarEvento');

    if (eventoEditandoId) {
        const ev = eventosAtuais.find(e => e.id === eventoEditandoId);
        if (!ev) return;
        titulo.innerText = 'Editar Evento';
        document.getElementById('eventoNomeInput').value = ev.nome || '';
        document.getElementById('eventoTipoInput').value = ev.tipo || 'Palestra';
        document.getElementById('eventoImagemInput').value = ev.imagem_url || '';
        document.getElementById('eventoDescricaoInput').value = ev.descricao || '';
        document.getElementById('eventoDataInput').value = ev.data || '';
        document.getElementById('eventoHoraInput').value = ev.hora ? String(ev.hora).slice(0, 5) : '';
        document.getElementById('eventoIngressoInput').value = ev.ingresso || '';
        document.getElementById('eventoCapacidadeInput').value = (ev.capacidade === null || ev.capacidade === undefined) ? '' : ev.capacidade;
        document.getElementById('eventoDataLimiteInput').value = ev.data_limite_inscricao || '';
        btnDesativar.style.display = 'inline-flex';
        // Edição sempre mexe só na linha desta filial, mesmo que o evento
        // faça parte de um grupo multi-filial — não dá pra "virar" um
        // evento de filial única de volta pra multi-filial editando.
        document.getElementById('eventoMultiFilialWrapper').style.display = 'none';
        toggleMultiFilialEvento(false);
        if (ev.grupo_evento_id) {
            document.getElementById('eventoMultiFilialWrapper').insertAdjacentHTML('afterend',
                '<p id="eventoGrupoAviso" style="font-size:11px; color:var(--text-muted); margin:-8px 0 14px;"><i class="fa-solid fa-circle-info"></i> Este evento faz parte de um grupo multi-filial — editar aqui muda só a data/hora/vagas desta filial, não das outras.</p>');
        }
    } else {
        titulo.innerText = 'Novo Evento';
        document.getElementById('eventoNomeInput').value = '';
        document.getElementById('eventoTipoInput').value = 'Palestra';
        document.getElementById('eventoImagemInput').value = '';
        document.getElementById('eventoDescricaoInput').value = '';
        document.getElementById('eventoDataInput').value = '';
        document.getElementById('eventoHoraInput').value = '';
        document.getElementById('eventoIngressoInput').value = '';
        document.getElementById('eventoCapacidadeInput').value = '';
        document.getElementById('eventoDataLimiteInput').value = '';
        document.getElementById('eventoMultiFilialWrapper').style.display = 'flex';
        document.getElementById('eventoMultiFilialCheck').checked = false;
        toggleMultiFilialEvento(false);
        btnDesativar.style.display = 'none';
    }

    document.getElementById('modalEvento').classList.add('open');
    document.getElementById('overlayModalEvento').classList.add('active');
}

// Alterna entre o bloco de filial única (Data/Hora/Capacidade direto) e o
// checklist de múltiplas filiais (cada uma com sua própria Data/Hora/
// Capacidade) — nome/tipo/imagem/descrição continuam compartilhados.
function toggleMultiFilialEvento(multi) {
    document.getElementById('eventoUnicaFilialBloco').style.display = multi ? 'none' : 'block';
    document.getElementById('eventoMultiFilialBloco').style.display = multi ? 'block' : 'none';
    // Data limite de inscrição fica só no modo filial única — em multi-filial
    // cada filial tende a ter datas de início bem diferentes, então uma
    // única data limite compartilhada não faz sentido; dá pra ajustar
    // depois editando cada filial individualmente.
    document.getElementById('eventoDataLimiteBloco').style.display = multi ? 'none' : 'block';
    if (multi) renderizarChecklistFiliaisEvento();
}

function renderizarChecklistFiliaisEvento() {
    const container = document.getElementById('eventoFiliaisChecklist');
    if (!container) return;
    const lista = (typeof filiaisDisponiveis !== 'undefined') ? filiaisDisponiveis : [];

    container.innerHTML = lista.map((f, i) => `
        <div class="evento-filial-row">
            <label class="col-tag-option">
                <input type="checkbox" class="evento-filial-check" data-filial="${escapeHTML(f.nome)}" onchange="document.getElementById('evento-filial-campos-${i}').style.display = this.checked ? 'flex' : 'none';">
                ${escapeHTML(f.nome)}
            </label>
            <div class="evento-filial-campos" id="evento-filial-campos-${i}" style="display:none;">
                <input type="date" class="evento-filial-data" title="Data">
                <input type="time" class="evento-filial-hora" title="Hora (opcional)">
                <input type="number" class="evento-filial-capacidade" min="0" placeholder="Vagas" title="Capacidade (opcional)">
            </div>
        </div>
    `).join('');
}

function fecharFormEvento() {
    eventoEditandoId = null;
    const aviso = document.getElementById('eventoGrupoAviso');
    if (aviso) aviso.remove();
    document.getElementById('modalEvento').classList.remove('open');
    document.getElementById('overlayModalEvento').classList.remove('active');
}

async function salvarEvento() {
    const nome = document.getElementById('eventoNomeInput').value.trim();
    const tipo = document.getElementById('eventoTipoInput').value;
    const imagemUrl = document.getElementById('eventoImagemInput').value.trim() || null;
    const descricao = document.getElementById('eventoDescricaoInput').value.trim() || null;
    const ingresso = document.getElementById('eventoIngressoInput').value.trim() || null;

    if (!nome) { alert('Digite o nome do evento.'); return; }

    const multiFilial = !eventoEditandoId && document.getElementById('eventoMultiFilialCheck').checked;

    if (multiFilial) {
        const linhas = Array.from(document.querySelectorAll('.evento-filial-row')).filter(row => row.querySelector('.evento-filial-check').checked).map(row => ({
            filial: row.querySelector('.evento-filial-check').dataset.filial,
            data: row.querySelector('.evento-filial-data').value,
            hora: row.querySelector('.evento-filial-hora').value || null,
            capacidadeStr: row.querySelector('.evento-filial-capacidade').value,
        }));

        if (linhas.length === 0) { alert('Marque ao menos uma filial.'); return; }
        if (linhas.some(l => !l.data)) { alert('Preencha a data de cada filial marcada.'); return; }

        const participantesUnificados = document.getElementById('eventoParticipantesUnificadosCheck').checked;
        const grupoEventoId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `grp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const registros = linhas.map(l => ({
            filial: l.filial, nome, tipo, ingresso,
            data: l.data, hora: l.hora,
            capacidade: l.capacidadeStr === '' ? null : Number(l.capacidadeStr),
            imagem_url: imagemUrl, descricao,
            grupo_evento_id: grupoEventoId,
            participantes_unificados: participantesUnificados,
        }));

        const { error } = await window.supabaseClient.from(NOME_TABELA_EVENTOS).insert(registros);
        if (error) { alert('Erro ao salvar evento: ' + error.message); return; }

        fecharFormEvento();
        carregarEventos();
        return;
    }

    const data = document.getElementById('eventoDataInput').value;
    const hora = document.getElementById('eventoHoraInput').value || null;
    const capacidadeStr = document.getElementById('eventoCapacidadeInput').value;
    const capacidade = capacidadeStr === '' ? null : Number(capacidadeStr);
    const dataLimiteInscricao = document.getElementById('eventoDataLimiteInput').value || null;

    if (!data) { alert('Selecione a data do evento.'); return; }
    if (dataLimiteInscricao && dataLimiteInscricao < data) { alert('A data limite de inscrição não pode ser antes da data do evento.'); return; }

    const payload = { filial: filialAtual, nome, tipo, data, hora, ingresso, capacidade, data_limite_inscricao: dataLimiteInscricao, imagem_url: imagemUrl, descricao };

    const { error } = eventoEditandoId
        ? await window.supabaseClient.from(NOME_TABELA_EVENTOS).update(payload).eq('id', eventoEditandoId)
        : await window.supabaseClient.from(NOME_TABELA_EVENTOS).insert(payload);

    if (error) { alert('Erro ao salvar evento: ' + error.message); return; }

    fecharFormEvento();
    carregarEventos();
}

async function desativarEventoAtual() {
    if (!eventoEditandoId) return;
    if (!confirm('Desativar este evento? Ele sai da agenda, mas o histórico dos leads que já vieram nele não é alterado.')) return;

    const { error } = await window.supabaseClient.from(NOME_TABELA_EVENTOS).update({ ativo: false }).eq('id', eventoEditandoId);
    if (error) { alert('Erro ao desativar evento: ' + error.message); return; }

    fecharFormEvento();
    carregarEventos();
}

// ==========================================
// PARTICIPANTES DO EVENTO (evento_leads) — quem está sendo trabalhado
// pra esse evento, como respondeu ao convite, se compareceu. Diferente de
// "Confirmados" (contarConfirmadosEvento(), proxy por historico_eventos —
// eventos passados já importados), isso é vínculo explícito, editável
// manualmente, útil sobretudo ANTES do evento acontecer.
// ==========================================
// Escopo do modal de Participantes aberto no momento — normalmente é só o
// próprio evento/filial, mas eventos "unificados" (grupo multi-filial)
// precisam enxergar/buscar em TODAS as filiais e evento_id do grupo.
let eventoIdsGrupoAtual = [];
let filiaisGrupoAtual = [];

async function abrirParticipantesEvento(eventoId) {
    eventoParticipantesId = eventoId;
    const ev = eventosAtuais.find(e => e.id === eventoId);

    eventoIdsGrupoAtual = [eventoId];
    filiaisGrupoAtual = [filialAtual];
    if (ev && ev.participantes_unificados && ev.grupo_evento_id) {
        const { data, error } = await window.supabaseClient
            .from(NOME_TABELA_EVENTOS)
            .select('id, filial')
            .eq('grupo_evento_id', ev.grupo_evento_id);
        if (!error && data && data.length > 0) {
            eventoIdsGrupoAtual = data.map(d => d.id);
            filiaisGrupoAtual = data.map(d => d.filial);
        }
    }

    const tituloEl = document.getElementById('participantesEventoTitulo');
    if (tituloEl) tituloEl.innerText = ev ? (ev.participantes_unificados ? `${ev.nome} (todas as filiais do grupo)` : ev.nome) : 'Evento';

    permiteMatriculaEventoAtual = !!ev && ev.tipo === 'Abertura de Turma';
    const bulkMatriculado = document.getElementById('participantesBulkMatriculado');
    if (bulkMatriculado) bulkMatriculado.style.display = permiteMatriculaEventoAtual ? '' : 'none';

    const buscaInput = document.getElementById('participantesBuscaInput');
    if (buscaInput) buscaInput.value = '';
    fecharResultadosBuscaParticipante();

    participantesSelecionados = new Set();
    atualizarBarraAcoesParticipantes();
    const checkTodos = document.getElementById('participantesSelecionarTodos');
    if (checkTodos) checkTodos.checked = false;

    carregarParticipantesEvento();

    document.getElementById('modalParticipantesEvento').classList.add('open');
    document.getElementById('overlayModalParticipantesEvento').classList.add('active');
}

async function fecharParticipantesEvento() {
    const idFechado = eventoParticipantesId;
    eventoParticipantesId = null;
    participantesAtuais = [];
    document.getElementById('modalParticipantesEvento').classList.remove('open');
    document.getElementById('overlayModalParticipantesEvento').classList.remove('active');

    // Atualiza só o resumo desse evento (não recarrega a agenda inteira)
    // pra refletir na hora qualquer mudança feita dentro do modal.
    if (idFechado) {
        await carregarResumoParticipantes(eventosAtuais);
        renderizarListaEventos();
    }
}

async function carregarParticipantesEvento() {
    const container = document.getElementById('participantesLista');
    if (!container || !eventoParticipantesId) return;
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Carregando...</p>';

    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA_EVENTO_LEADS)
        .select('*')
        .in('evento_id', eventoIdsGrupoAtual)
        .order('criado_em', { ascending: true });

    if (error) {
        container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro ao carregar participantes: ${escapeHTML(error.message)}. Rode migracao_evento_leads.sql se ainda não rodou.</p>`;
        return;
    }

    const linhas = data || [];
    if (linhas.length === 0) {
        participantesAtuais = [];
        container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhum lead vinculado ainda. Busque acima pra adicionar.</p>';
        return;
    }

    const ids = linhas.map(l => l["pessoaIdentificador"]);
    const { data: leadsInfo, error: erroLeads } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero')
        .in('pessoaIdentificador', ids);

    if (erroLeads) {
        container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro ao carregar dados dos leads: ${escapeHTML(erroLeads.message)}</p>`;
        return;
    }

    const infoPorId = new Map((leadsInfo || []).map(l => [String(l.pessoaIdentificador), l]));
    participantesAtuais = linhas.map(l => ({ ...l, _lead: infoPorId.get(String(l["pessoaIdentificador"])) || null }));

    renderizarListaParticipantes();
}

function renderizarListaParticipantes() {
    const container = document.getElementById('participantesLista');
    if (!container) return;

    container.innerHTML = participantesAtuais.map(p => {
        const lead = p._lead;
        const nome = lead ? lead.pessoaNome : `Lead ${p["pessoaIdentificador"]} (não encontrado)`;
        const telefone = lead && lead.pessoaTelefoneNumero ? [lead.pessoaTelefoneDDD, lead.pessoaTelefoneNumero].filter(Boolean).join(' ') : '';
        const compareceuValor = p.compareceu === true ? 'sim' : (p.compareceu === false ? 'nao' : '');
        const matriculadoValor = p.matriculado === true ? 'sim' : (p.matriculado === false ? 'nao' : '');

        return `
            <div class="participante-row">
                <input type="checkbox" class="participante-select" ${participantesSelecionados.has(p.id) ? 'checked' : ''} onchange="toggleParticipanteSelecionado(${p.id}, this.checked)">
                <div class="participante-info">
                    <div class="participante-nome">${lead ? `<a href="javascript:void(0)" onclick="abrirResultadoBuscaGlobal('${p["pessoaIdentificador"]}')">${escapeHTML(nome)}</a>` : escapeHTML(nome)}</div>
                    ${telefone ? `<div class="participante-telefone"><i class="fa-solid fa-phone"></i> ${escapeHTML(telefone)}</div>` : ''}
                </div>
                <select class="participante-resposta" onchange="atualizarRespostaParticipante(${p.id}, this.value)">
                    <option value="pendente" ${p.resposta_convite === 'pendente' ? 'selected' : ''}>Pendente</option>
                    <option value="confirmado" ${p.resposta_convite === 'confirmado' ? 'selected' : ''}>Confirmado</option>
                    <option value="recusado" ${p.resposta_convite === 'recusado' ? 'selected' : ''}>Recusado</option>
                </select>
                <select class="participante-compareceu" onchange="atualizarCompareceuParticipante(${p.id}, this.value)">
                    <option value="" ${compareceuValor === '' ? 'selected' : ''}>Compareceu? --</option>
                    <option value="sim" ${compareceuValor === 'sim' ? 'selected' : ''}>Compareceu: Sim</option>
                    <option value="nao" ${compareceuValor === 'nao' ? 'selected' : ''}>Compareceu: Não</option>
                </select>
                ${permiteMatriculaEventoAtual ? `
                <select class="participante-matriculado" onchange="atualizarMatriculadoParticipante(${p.id}, this.value)">
                    <option value="" ${matriculadoValor === '' ? 'selected' : ''}>Matriculado? --</option>
                    <option value="sim" ${matriculadoValor === 'sim' ? 'selected' : ''}>Matriculado: Sim 🎉</option>
                    <option value="nao" ${matriculadoValor === 'nao' ? 'selected' : ''}>Matriculado: Não</option>
                </select>` : ''}
                <button class="icon-btn danger" title="Remover da lista" onclick="removerParticipante(${p.id})"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
    }).join('');

    const checkTodos = document.getElementById('participantesSelecionarTodos');
    if (checkTodos) checkTodos.checked = participantesAtuais.length > 0 && participantesSelecionados.size === participantesAtuais.length;
    atualizarBarraAcoesParticipantes();
}

async function atualizarRespostaParticipante(id, valor) {
    const { error } = await window.supabaseClient
        .from(NOME_TABELA_EVENTO_LEADS)
        .update({ resposta_convite: valor, atualizado_em: new Date().toISOString() })
        .eq('id', id);
    if (error) { alert('Erro ao atualizar resposta: ' + error.message); return; }
    const p = participantesAtuais.find(x => x.id === id);
    if (p) p.resposta_convite = valor;
}

async function atualizarCompareceuParticipante(id, valor) {
    const compareceu = valor === '' ? null : (valor === 'sim');
    const { error } = await window.supabaseClient
        .from(NOME_TABELA_EVENTO_LEADS)
        .update({ compareceu, atualizado_em: new Date().toISOString() })
        .eq('id', id);
    if (error) { alert('Erro ao atualizar comparecimento: ' + error.message); return; }

    const p = participantesAtuais.find(x => x.id === id);
    if (p) p.compareceu = compareceu;

    // Confirmou presença mas não veio: precisa reabrir contato — joga pra
    // uma coluna de recontato dedicada (ver encontrarColunaRecontato()).
    if (compareceu === false && p && p.resposta_convite === 'confirmado') {
        moverLeadsParaRecontato([p["pessoaIdentificador"]]);
    }

    await carregarResumoParticipantes(eventosAtuais);
    renderizarListaEventos();
}

// Coluna de destino pra "confirmou mas não compareceu" — mesmo espírito da
// heurística de "Matriculados" (busca por nome, nunca cria sozinha): o
// time precisa ter uma coluna com "Recontato" ou "Não Compareceu" no nome
// pra essa movimentação automática funcionar.
function encontrarColunaRecontato() {
    if (typeof columnsConfig === 'undefined') return null;
    const normalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const col = columnsConfig.find(c => {
        const chave = normalizar(c.key);
        const label = normalizar(c.label);
        return chave.includes('RECONTATO') || label.includes('RECONTATO') || chave.includes('NAO COMPARECEU') || label.includes('NAO COMPARECEU');
    });
    return col ? col.key : null;
}

function moverLeadsParaRecontato(pessoaIds) {
    const colunaKey = encontrarColunaRecontato();
    if (!colunaKey) {
        console.warn('Nenhuma coluna de recontato encontrada (crie uma coluna do Kanban com "Recontato" ou "Não Compareceu" no nome) — lead(s) confirmado(s) sem comparecimento não foram movidos automaticamente.');
        return;
    }
    if (typeof moverLeadsParaColuna === 'function') moverLeadsParaColuna(pessoaIds, colunaKey);
}

async function atualizarMatriculadoParticipante(id, valor) {
    const matriculado = valor === '' ? null : (valor === 'sim');
    const { error } = await window.supabaseClient
        .from(NOME_TABELA_EVENTO_LEADS)
        .update({ matriculado, atualizado_em: new Date().toISOString() })
        .eq('id', id);
    if (error) { alert('Erro ao atualizar matrícula: ' + error.message); return; }

    const p = participantesAtuais.find(x => x.id === id);
    if (p) p.matriculado = matriculado;

    if (matriculado === true && p) await efetivarMatriculasEmMassa([p["pessoaIdentificador"]]);

    await carregarResumoParticipantes(eventosAtuais);
    renderizarListaEventos();
}

// Marcar "Matriculado: Sim" não é só um campo informativo — efetiva a
// matrícula de verdade: move o lead pra coluna de Matriculados (mesma
// heurística já usada no Dashboard/Relatórios: primeira coluna cujo nome
// contém "matricul") e registra data_matricula = hoje, se o lead ainda não
// tiver uma (não sobrescreve uma data já registrada, ex: pela importação
// de matrícula via print). Reaproveita moverLeadsParaColuna() (js/app.js)
// pra já ganhar o update otimista + barra de desfazer de graça. Recebe uma
// lista de ids pra servir tanto o toggle individual quanto a ação em massa
// com 1 única chamada em lote.
async function efetivarMatriculasEmMassa(pessoaIds) {
    if (!pessoaIds || pessoaIds.length === 0) return;
    if (typeof getColumnKeys !== 'function') return;

    const validKeys = getColumnKeys();
    const matriculadosKey = validKeys.find(k => k.toLowerCase().includes('matricul'));
    if (!matriculadosKey) {
        alert('Nenhuma coluna com "Matriculados" no nome foi encontrada — crie ou renomeie uma coluna do Kanban pra isso antes de marcar matrícula por aqui.');
        return;
    }

    if (typeof moverLeadsParaColuna === 'function') moverLeadsParaColuna(pessoaIds, matriculadosKey);

    const hojeISO = new Date().toISOString().slice(0, 10);
    const semDataMatricula = pessoaIds.filter(id => {
        const lead = (typeof leadsAtuais !== 'undefined') ? leadsAtuais.find(l => String(l.pessoaIdentificador) === String(id)) : null;
        return !lead || !lead.data_matricula;
    });
    if (semDataMatricula.length === 0) return;

    semDataMatricula.forEach(id => {
        const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(id));
        if (lead) lead.data_matricula = hojeISO;
    });
    await window.supabaseClient.from(NOME_TABELA).update({ data_matricula: hojeISO }).in('pessoaIdentificador', semDataMatricula);
}

async function removerParticipante(id) {
    if (!confirm('Remover este lead da lista de participantes do evento? Isso não apaga o lead, só o vínculo com o evento.')) return;
    const { error } = await window.supabaseClient.from(NOME_TABELA_EVENTO_LEADS).delete().eq('id', id);
    if (error) { alert('Erro ao remover participante: ' + error.message); return; }
    participantesAtuais = participantesAtuais.filter(p => p.id !== id);
    participantesSelecionados.delete(id);
    renderizarListaParticipantes();
}

// Busca de lead pra vincular ao evento — mesmo padrão de processarBuscaGlobal()
// (js/app.js), com debounce e restrito à filial atual.
let debounceBuscaParticipante = null;
function processarBuscaParticipante() {
    clearTimeout(debounceBuscaParticipante);
    debounceBuscaParticipante = setTimeout(buscarLeadParaParticipante, 250);
}

function fecharResultadosBuscaParticipante() {
    const resultsEl = document.getElementById('participantesBuscaResultados');
    if (resultsEl) { resultsEl.classList.remove('open'); resultsEl.innerHTML = ''; }
}

async function buscarLeadParaParticipante() {
    const input = document.getElementById('participantesBuscaInput');
    const resultsEl = document.getElementById('participantesBuscaResultados');
    if (!input || !resultsEl) return;
    const termo = input.value.trim();
    if (termo.length < 2) { fecharResultadosBuscaParticipante(); return; }

    resultsEl.innerHTML = '<div class="global-search-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Buscando...</div>';
    resultsEl.classList.add('open');

    const termoSeguro = termo.replace(/,/g, ' ');
    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero')
        .in('filial', filiaisGrupoAtual.length > 0 ? filiaisGrupoAtual : [filialAtual])
        .or(`pessoaNome.ilike.%${termoSeguro}%,pessoaTelefoneNumero.ilike.%${termoSeguro}%`)
        .limit(15);

    if (input.value.trim() !== termo) return; // termo já mudou enquanto a busca rodava

    if (error) {
        resultsEl.innerHTML = '<div class="global-search-empty">Erro na busca — veja o console (F12).</div>';
        console.error('Erro na busca de participante:', error);
        return;
    }

    const jaVinculados = new Set(participantesAtuais.map(p => String(p["pessoaIdentificador"])));
    const candidatos = (data || []).filter(l => !jaVinculados.has(String(l.pessoaIdentificador)));

    if (candidatos.length === 0) {
        resultsEl.innerHTML = '<div class="global-search-empty">Nenhum lead novo encontrado.</div>';
        return;
    }

    resultsEl.innerHTML = candidatos.map(l => {
        const tel = [l.pessoaTelefoneDDD, l.pessoaTelefoneNumero].filter(Boolean).join(' ') || 'Sem telefone';
        return `
            <div class="global-search-result-item" onclick="adicionarParticipante('${l.pessoaIdentificador}')">
                <div class="global-search-result-name">${escapeHTML(l.pessoaNome || 'Sem nome')}</div>
                <div class="global-search-result-meta"><span><i class="fa-solid fa-phone"></i> ${escapeHTML(tel)}</span></div>
            </div>
        `;
    }).join('');
}

async function adicionarParticipante(pessoaId) {
    if (!eventoParticipantesId) return;

    const { error } = await window.supabaseClient
        .from(NOME_TABELA_EVENTO_LEADS)
        .insert({ evento_id: eventoParticipantesId, "pessoaIdentificador": pessoaId });

    if (error) { alert('Erro ao adicionar participante: ' + error.message); return; }

    const buscaInput = document.getElementById('participantesBuscaInput');
    if (buscaInput) buscaInput.value = '';
    fecharResultadosBuscaParticipante();

    carregarParticipantesEvento();
}

// ==========================================
// AÇÕES EM MASSA (modal de Participantes) — marcar resposta/comparecimento
// de vários participantes de uma vez, ou remover vários. Mesmo espírito do
// bulkActionBar do Kanban (js/app.js), mas escopo local ao modal.
// ==========================================
let participantesSelecionados = new Set(); // ids de linhas de evento_leads

function toggleParticipanteSelecionado(id, marcado) {
    if (marcado) participantesSelecionados.add(id);
    else participantesSelecionados.delete(id);
    atualizarBarraAcoesParticipantes();
}

function toggleSelecionarTodosParticipantes(marcado) {
    participantesSelecionados = marcado ? new Set(participantesAtuais.map(p => p.id)) : new Set();
    renderizarListaParticipantes();
}

function atualizarBarraAcoesParticipantes() {
    const barra = document.getElementById('participantesBulkBar');
    const contador = document.getElementById('participantesBulkContador');
    if (!barra) return;
    const n = participantesSelecionados.size;
    barra.style.display = n > 0 ? 'flex' : 'none';
    if (contador) contador.innerText = `${n} selecionado${n === 1 ? '' : 's'}`;
}

async function aplicarRespostaEmMassaParticipantes() {
    const valor = document.getElementById('participantesBulkResposta').value;
    if (!valor || participantesSelecionados.size === 0) return;
    const ids = Array.from(participantesSelecionados);

    const { error } = await window.supabaseClient
        .from(NOME_TABELA_EVENTO_LEADS)
        .update({ resposta_convite: valor, atualizado_em: new Date().toISOString() })
        .in('id', ids);

    if (error) { alert('Erro ao atualizar em massa: ' + error.message); return; }

    participantesAtuais.forEach(p => { if (participantesSelecionados.has(p.id)) p.resposta_convite = valor; });
    document.getElementById('participantesBulkResposta').value = '';
    renderizarListaParticipantes();
}

async function aplicarCompareceuEmMassaParticipantes() {
    const valor = document.getElementById('participantesBulkCompareceu').value;
    if (valor === '' || participantesSelecionados.size === 0) return;
    const compareceu = valor === 'sim';
    const ids = Array.from(participantesSelecionados);

    const { error } = await window.supabaseClient
        .from(NOME_TABELA_EVENTO_LEADS)
        .update({ compareceu, atualizado_em: new Date().toISOString() })
        .in('id', ids);

    if (error) { alert('Erro ao atualizar em massa: ' + error.message); return; }

    const pessoaIdsParaRecontato = [];
    participantesAtuais.forEach(p => {
        if (!participantesSelecionados.has(p.id)) return;
        if (compareceu === false && p.resposta_convite === 'confirmado') pessoaIdsParaRecontato.push(p["pessoaIdentificador"]);
        p.compareceu = compareceu;
    });
    document.getElementById('participantesBulkCompareceu').value = '';
    renderizarListaParticipantes();

    if (pessoaIdsParaRecontato.length > 0) moverLeadsParaRecontato(pessoaIdsParaRecontato);

    await carregarResumoParticipantes(eventosAtuais);
    renderizarListaEventos();
}

async function aplicarMatriculadoEmMassaParticipantes() {
    const valor = document.getElementById('participantesBulkMatriculado').value;
    if (valor === '' || participantesSelecionados.size === 0) return;
    const matriculado = valor === 'sim';
    const ids = Array.from(participantesSelecionados);

    const { error } = await window.supabaseClient
        .from(NOME_TABELA_EVENTO_LEADS)
        .update({ matriculado, atualizado_em: new Date().toISOString() })
        .in('id', ids);

    if (error) { alert('Erro ao atualizar em massa: ' + error.message); return; }

    const pessoaIdsMatriculados = [];
    participantesAtuais.forEach(p => {
        if (participantesSelecionados.has(p.id)) {
            p.matriculado = matriculado;
            if (matriculado) pessoaIdsMatriculados.push(p["pessoaIdentificador"]);
        }
    });
    document.getElementById('participantesBulkMatriculado').value = '';
    renderizarListaParticipantes();

    if (pessoaIdsMatriculados.length > 0) await efetivarMatriculasEmMassa(pessoaIdsMatriculados);

    await carregarResumoParticipantes(eventosAtuais);
    renderizarListaEventos();
}

async function removerParticipantesEmMassa() {
    const ids = Array.from(participantesSelecionados);
    if (ids.length === 0) return;
    if (!confirm(`Remover ${ids.length} lead(s) da lista de participantes do evento? Isso não apaga nenhum lead, só o vínculo com o evento.`)) return;

    const { error } = await window.supabaseClient.from(NOME_TABELA_EVENTO_LEADS).delete().in('id', ids);
    if (error) { alert('Erro ao remover em massa: ' + error.message); return; }

    participantesAtuais = participantesAtuais.filter(p => !participantesSelecionados.has(p.id));
    participantesSelecionados = new Set();
    renderizarListaParticipantes();
}

// ==========================================
// EVENTOS DO LEAD (gaveta) — em quais eventos esse lead está sendo
// trabalhado (evento_leads), com opção de convidar pra um evento novo.
// Diferente do modal de Participantes (por evento), aqui é a mesma
// informação vista pela ótica do lead.
// ==========================================
let eventosDoLeadAtual = []; // linhas de evento_leads (com o evento embutido) do lead na gaveta
let pessoaIdGavetaEventos = null;

const ROTULOS_RESPOSTA_CONVITE = { pendente: 'Pendente', confirmado: 'Confirmado', recusado: 'Recusado' };
const CLASSES_RESPOSTA_CONVITE = { pendente: 'tag-warning', confirmado: 'tag-ativo', recusado: 'tag-error' };

async function carregarEventosDoLead(pessoaId) {
    const container = document.getElementById('drawer-eventos-lista');
    if (!container) return;
    pessoaIdGavetaEventos = pessoaId;
    container.innerHTML = '<span style="font-size:11px; color:var(--text-muted);">Carregando...</span>';

    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA_EVENTO_LEADS)
        .select('*, eventos(nome, data, hora)')
        .eq('pessoaIdentificador', pessoaId)
        .order('criado_em', { ascending: false });

    if (error) {
        console.warn('Não foi possível carregar eventos do lead (rode migracao_evento_leads.sql se ainda não rodou).', error);
        container.innerHTML = '<span style="font-size:11px; color:var(--text-muted);">Indisponível — rode migracao_evento_leads.sql.</span>';
        eventosDoLeadAtual = [];
        return;
    }

    eventosDoLeadAtual = data || [];
    renderizarEventosDoLead();
}

function renderizarEventosDoLead() {
    const container = document.getElementById('drawer-eventos-lista');
    if (!container) return;

    if (eventosDoLeadAtual.length === 0) {
        container.innerHTML = '<span style="font-size:11px; color:var(--text-muted);">Nenhum evento vinculado ainda.</span>';
        return;
    }

    container.innerHTML = eventosDoLeadAtual.map(el => {
        const ev = el.eventos;
        const nome = ev ? ev.nome : `Evento ${el.evento_id} (removido)`;
        const data = ev ? formatarDataEvento(ev.data) : '';
        const compareceuTxt = el.compareceu === true ? ' · Compareceu' : (el.compareceu === false ? ' · Não compareceu' : '');
        const matriculadoTxt = el.matriculado === true ? ' · Matriculado 🎉' : '';
        return `
            <div class="drawer-evento-item">
                <div class="drawer-evento-item-info">
                    <strong>${escapeHTML(nome)}</strong>
                    ${data ? `<span style="color:#94a3b8;"> — ${escapeHTML(data)}</span>` : ''}
                </div>
                <div class="drawer-evento-item-status">
                    <span class="tag ${CLASSES_RESPOSTA_CONVITE[el.resposta_convite] || ''}">${ROTULOS_RESPOSTA_CONVITE[el.resposta_convite] || el.resposta_convite}</span>
                    ${compareceuTxt}${matriculadoTxt}
                    <button class="icon-btn danger" title="Remover convite" onclick="removerEventoDoLeadNaGaveta(${el.id})"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

async function removerEventoDoLeadNaGaveta(id) {
    if (!confirm('Remover o vínculo deste lead com o evento?')) return;
    const { error } = await window.supabaseClient.from(NOME_TABELA_EVENTO_LEADS).delete().eq('id', id);
    if (error) { alert('Erro ao remover: ' + error.message); return; }
    eventosDoLeadAtual = eventosDoLeadAtual.filter(el => el.id !== id);
    renderizarEventosDoLead();
}

function abrirFormConvidarEventoNaGaveta() {
    const form = document.getElementById('drawer-eventos-form');
    const select = document.getElementById('drawer-eventos-select');
    if (!form || !select) return;

    // Só oferece eventos ainda "ativos" (não passaram da data efetiva —
    // ver dataEfetivaLimite()) — um "Abertura de Turma" com data limite de
    // inscrição preenchida continua aparecendo aqui até essa data, mesmo
    // que a data do evento em si já tenha passado.
    const hojeISO = new Date().toISOString().slice(0, 10);
    const jaVinculados = new Set(eventosDoLeadAtual.map(el => el.evento_id));
    const disponiveis = eventosAtuais
        .filter(ev => !jaVinculados.has(ev.id) && dataEfetivaLimite(ev) >= hojeISO)
        .slice()
        .sort((a, b) => (a.data + (a.hora || '')).localeCompare(b.data + (b.hora || '')));

    if (disponiveis.length === 0) {
        select.innerHTML = '<option value="">Nenhum evento disponível pra convidar</option>';
    } else {
        select.innerHTML = disponiveis.map(ev => `<option value="${ev.id}">${escapeHTML(ev.nome)} — ${formatarDataEvento(ev.data)}</option>`).join('');
    }

    if (typeof gavetaLeadAberta !== 'undefined') {
        gavetaLeadAberta.eventos = true;
        aplicarEstadoGavetasLead();
    }
    form.style.display = 'block';
}

function fecharFormConvidarEventoNaGaveta() {
    const form = document.getElementById('drawer-eventos-form');
    if (form) form.style.display = 'none';
}

async function confirmarConvidarEventoNaGaveta() {
    const select = document.getElementById('drawer-eventos-select');
    const eventoId = select ? Number(select.value) : null;
    if (!eventoId || !pessoaIdGavetaEventos) { fecharFormConvidarEventoNaGaveta(); return; }

    const { error } = await window.supabaseClient
        .from(NOME_TABELA_EVENTO_LEADS)
        .insert({ evento_id: eventoId, "pessoaIdentificador": pessoaIdGavetaEventos });

    if (error) { alert('Erro ao convidar pro evento: ' + error.message); return; }

    fecharFormConvidarEventoNaGaveta();
    await carregarEventosDoLead(pessoaIdGavetaEventos);
    await carregarResumoParticipantes(eventosAtuais);
    renderizarListaEventos();
}

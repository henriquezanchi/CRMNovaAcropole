// ==========================================================
// AGENDA DO DIA — TODAS AS FILIAIS (js/visao-geral.js)
// ==========================================================
// Bloco no topo da aba "Visão Geral" (tab-dashboard) que junta o que
// precisa de atenção HOJE, cruzando TODAS as filiais de uma vez —
// diferente do resto do Dashboard (que é sempre sobre a filial
// selecionada no topo). Chamado de dentro de switchModule() sempre que
// a aba abre, e por um botão "Atualizar" manual (é uma consulta pesada,
// não entra em polling automático).
//
// Pedido do usuário: "quero uma parte da 'visão geral' que junte todas
// as filiais, com uma 'agenda' para o trabalho daquele dia, independente
// se a filial está selecionada ou não."

async function atualizarAgendaGeral() {
    carregarAgendaGeralAniversariantes();
    carregarAgendaGeralLeadsPrioritarios();
    carregarAgendaGeralWhatsapp();
    carregarAgendaGeralEventosRecentes();
}

// ---------------------------------------------------------
// 1. Aniversariantes de HOJE, todas as filiais
// ---------------------------------------------------------
async function carregarAgendaGeralAniversariantes() {
    const container = document.getElementById('agendaGeralAniversariantes');
    if (!container) return;
    container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Carregando...</div>';

    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('pessoaIdentificador, pessoaNome, data_nascimento, filial')
        .not('data_nascimento', 'is', null);

    if (error) {
        container.innerHTML = '<div style="font-size:11px; color:var(--text-muted);">Indisponível (rode migracao_data_nascimento.sql).</div>';
        return;
    }

    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const diaAtual = hoje.getDate();

    const doDia = (data || []).filter(l => {
        const [, mes, dia] = l.data_nascimento.split('-').map(Number);
        return mes === mesAtual && dia === diaAtual;
    });

    if (doDia.length === 0) {
        container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhum aniversariante hoje, em nenhuma filial.</div>';
        return;
    }

    container.innerHTML = doDia.map(l => `
        <div class="activity-item activity-item-festiva" style="cursor:pointer;" onclick="abrirResultadoBuscaGlobal('${l.pessoaIdentificador}')">
            <div class="activity-dot activity-dot-festiva"></div>
            <div>
                <div><strong>${escapeHTML(l.pessoaNome || 'Lead sem nome')}</strong> 🎂 <strong>hoje!</strong></div>
                <div class="activity-time">${escapeHTML(l.filial || '')}</div>
            </div>
        </div>`).join('');
}

// ---------------------------------------------------------
// 2. 50 leads mais prioritários pra contatar, TODAS as filiais
// ---------------------------------------------------------
// Critério: quem já tem uma inscrição futura numa Abertura de Turma vem
// primeiro (ordenado pela data mais próxima — é quem tem prazo real),
// depois o resto ordenado pelo funil de conversão (Jornada de
// Interesse/Lead Forte — mesmas tags de sistema já calculadas na
// importação, ver js/importador.js). Só 50 no TOTAL, não por filial —
// é uma lista única de "quem ligar primeiro hoje". Exclui quem já está
// numa coluna de Matriculados (não precisa mais ser contatado pra isso).
const LIMITE_AGENDA_GERAL_LEADS = 50;

function _diasParaAberturaTurma(lead) {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    let melhor = Infinity;
    (Array.isArray(lead.historico_eventos) ? lead.historico_eventos : []).forEach(ev => {
        if (ev.tipo !== 'Abertura de Turma') return;
        const m = String(ev.data || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (!m) return;
        const dataEvento = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        const dias = Math.round((dataEvento - hoje) / 86400000);
        if (dias >= 0 && dias < melhor) melhor = dias;
    });
    return melhor;
}

function _rankJornadaAgendaGeral(lead) {
    const tags = parseTags(lead.tags).map(t => t.trim());
    if (tags.includes('Jornada: Engajado')) return 1;
    if (tags.includes('Jornada: Interesse Emergente')) return 2;
    if (tags.includes('Jornada: Descoberta')) return 3;
    return 9;
}

async function carregarAgendaGeralLeadsPrioritarios() {
    const container = document.getElementById('agendaGeralLeadsPrioritarios');
    if (!container) return;
    container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Carregando...</div>';

    // Candidatos: só quem já tem algum sinal de prioridade (evita puxar a
    // base inteira todo dia). O filtro por CONTEÚDO de `tags` (jsonb) não
    // dá pra fazer com `.ilike()`/`.or()` do supabase-js — o PostgREST não
    // aceita cast (`coluna::tipo`) nem solto nem dentro do filtro `or=(...)`,
    // sempre cai no operador cru de jsonb ("operator does not exist: jsonb
    // ~~* unknown"). Resolvido com uma função SQL simples
    // (leads_agenda_geral_prioritarios(), migracao_rpc_leads_agenda_geral.sql).
    const { data, error } = await window.supabaseClient.rpc('leads_agenda_geral_prioritarios');

    if (error) {
        container.innerHTML = '<div style="font-size:11px; color:var(--text-muted);">Erro ao carregar leads prioritários — veja o console.</div>';
        console.error(error);
        return;
    }

    const candidatos = (data || []).filter(l => !/matricul/i.test(l.funil_agencia || ''));

    candidatos.forEach(l => {
        l._diasAbertura = _diasParaAberturaTurma(l);
        l._rankForte = rankLeadForte(l);
        l._rankJornada = _rankJornadaAgendaGeral(l);
    });

    candidatos.sort((a, b) => {
        if (a._diasAbertura !== b._diasAbertura) return a._diasAbertura - b._diasAbertura;
        if (a._rankForte !== b._rankForte) return a._rankForte - b._rankForte;
        if (a._rankJornada !== b._rankJornada) return a._rankJornada - b._rankJornada;
        return contarTags(b) - contarTags(a);
    });

    const top50 = candidatos.slice(0, LIMITE_AGENDA_GERAL_LEADS);

    if (top50.length === 0) {
        container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhum lead prioritário identificado hoje.</div>';
        return;
    }

    container.innerHTML = top50.map(l => {
        const motivo = l._diasAbertura !== Infinity
            ? `<span class="tag-inscrito-turma" style="display:inline-block; padding:1px 6px; border-radius:4px; font-size:10px;">Turma em ${l._diasAbertura === 0 ? 'HOJE' : `${l._diasAbertura}d`}</span>`
            : (l._rankForte < 99 ? `<span class="tag-strong tag-strong-${l._rankForte}" style="display:inline-block; padding:1px 6px; border-radius:4px; font-size:10px;">Lead Forte ${l._rankForte}</span>` : '');
        return `
            <div class="activity-item" style="cursor:pointer;" onclick="abrirResultadoBuscaGlobal('${l.pessoaIdentificador}')">
                <div class="activity-dot"></div>
                <div>
                    <div><strong>${escapeHTML(l.pessoaNome || 'Lead sem nome')}</strong> ${motivo}</div>
                    <div class="activity-time">${escapeHTML(l.filial || '')}</div>
                </div>
            </div>`;
    }).join('');
}

// ---------------------------------------------------------
// 3. WhatsApp recente, TODAS as filiais
// ---------------------------------------------------------
async function carregarAgendaGeralWhatsapp() {
    const container = document.getElementById('agendaGeralWhatsapp');
    if (!container) return;
    container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Carregando...</div>';

    const { data: mensagens, error } = await window.supabaseClient
        .from('mensagens_whatsapp')
        .select('pessoaIdentificador, filial, direcao, tipo, corpo_texto, criado_em, atendente_nome')
        .order('criado_em', { ascending: false })
        .limit(20);

    if (error) {
        container.innerHTML = '<div style="font-size:11px; color:var(--text-muted);">Erro ao carregar WhatsApp — veja o console.</div>';
        console.error(error);
        return;
    }

    const ids = [...new Set((mensagens || []).map(m => m.pessoaIdentificador).filter(Boolean))];
    let nomesPorId = new Map();
    if (ids.length > 0) {
        const { data: leads } = await window.supabaseClient
            .from(NOME_TABELA)
            .select('pessoaIdentificador, pessoaNome')
            .in('pessoaIdentificador', ids);
        (leads || []).forEach(l => nomesPorId.set(String(l.pessoaIdentificador), l.pessoaNome));
    }

    if (!mensagens || mensagens.length === 0) {
        container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhuma mensagem de WhatsApp registrada ainda.</div>';
        return;
    }

    container.innerHTML = mensagens.map(m => {
        const nome = nomesPorId.get(String(m.pessoaIdentificador)) || (m.pessoaIdentificador ? 'Lead não carregado' : 'Não identificado');
        const seta = m.direcao === 'saida' ? '<i class="fa-solid fa-arrow-up" style="color:#16a34a;"></i>' : '<i class="fa-solid fa-arrow-down" style="color:#2563eb;"></i>';
        const quando = new Date(m.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const clique = m.pessoaIdentificador ? `onclick="abrirResultadoBuscaGlobal('${m.pessoaIdentificador}')" style="cursor:pointer;"` : '';
        return `
            <div class="activity-item" ${clique}>
                <div class="activity-dot"></div>
                <div>
                    <div>${seta} <strong>${escapeHTML(nome)}</strong> <span style="color:var(--text-muted); font-size:11px;">(${escapeHTML(m.filial || '?')})</span></div>
                    <div class="activity-time">${escapeHTML((m.corpo_texto || '').slice(0, 60))} — ${quando}</div>
                </div>
            </div>`;
    }).join('');
}

// ---------------------------------------------------------
// 4. Inscritos em eventos RECENTES (últimos 7 dias) — confirmar presença/feedback
// ---------------------------------------------------------
async function carregarAgendaGeralEventosRecentes() {
    const container = document.getElementById('agendaGeralEventosRecentes');
    if (!container) return;
    container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Carregando...</div>';

    const hoje = new Date();
    const seteDiasAtras = new Date(hoje); seteDiasAtras.setDate(hoje.getDate() - 7);
    const isoHoje = hoje.toISOString().slice(0, 10);
    const isoAtras = seteDiasAtras.toISOString().slice(0, 10);

    const { data: eventos, error: erroEventos } = await window.supabaseClient
        .from('eventos')
        .select('id, nome, data, filial')
        .gte('data', isoAtras)
        .lte('data', isoHoje);

    if (erroEventos || !eventos || eventos.length === 0) {
        container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhum evento nos últimos 7 dias, em nenhuma filial.</div>';
        return;
    }

    const idsEventos = eventos.map(e => e.id);
    const { data: vinculos, error: erroVinculos } = await window.supabaseClient
        .from('evento_leads')
        .select('evento_id, pessoaIdentificador, resposta_convite, compareceu')
        .in('evento_id', idsEventos)
        .in('resposta_convite', ['confirmado', 'pendente']);

    if (erroVinculos || !vinculos || vinculos.length === 0) {
        container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhum inscrito vinculado (modal de Participantes) nesses eventos ainda.</div>';
        return;
    }

    const idsLeads = [...new Set(vinculos.map(v => v.pessoaIdentificador))];
    const { data: leads } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('pessoaIdentificador, pessoaNome')
        .in('pessoaIdentificador', idsLeads);
    const nomesPorId = new Map((leads || []).map(l => [String(l.pessoaIdentificador), l.pessoaNome]));
    const eventosPorId = new Map(eventos.map(e => [e.id, e]));

    const linhas = vinculos
        .filter(v => v.compareceu === null || v.compareceu === undefined) // ainda não confirmado — é o que precisa de ação
        .map(v => ({ ...v, evento: eventosPorId.get(v.evento_id), nome: nomesPorId.get(String(v.pessoaIdentificador)) }))
        .filter(v => v.evento)
        .sort((a, b) => new Date(b.evento.data) - new Date(a.evento.data));

    if (linhas.length === 0) {
        container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Todo mundo já teve o comparecimento marcado nesses eventos.</div>';
        return;
    }

    container.innerHTML = linhas.map(v => {
        const dataFmt = (typeof formatarDataEvento === 'function') ? formatarDataEvento(v.evento.data) : v.evento.data;
        const badgeResposta = v.resposta_convite === 'confirmado'
            ? '<span style="color:#16a34a; font-size:10px;">confirmado</span>'
            : '<span style="color:#b45309; font-size:10px;">pendente</span>';
        return `
            <div class="activity-item" style="cursor:pointer;" onclick="abrirResultadoBuscaGlobal('${v.pessoaIdentificador}')">
                <div class="activity-dot"></div>
                <div>
                    <div><strong>${escapeHTML(v.nome || 'Lead')}</strong> ${badgeResposta}</div>
                    <div class="activity-time">${escapeHTML(v.evento.nome)} — ${escapeHTML(v.evento.filial)} — ${dataFmt}</div>
                </div>
            </div>`;
    }).join('');
}

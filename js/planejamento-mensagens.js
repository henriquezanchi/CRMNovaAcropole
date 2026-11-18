// Planejamento de Mensagens (18/11/2026, pedido do usuário): convites de campanha previstos para os próximos
// 7 dias, dia a dia, por tipo de campanha e por escola. Hoje mostra a fila real; os dias seguintes são uma
// estimativa feita com a MESMA conta do agendador das 08:25 (campanha-whatsapp: teto do dia, cota fixa,
// divisão por proximidade da aula com reforço na véspera, ordem de prioridade). Não considera o tamanho da
// lista de pessoas a convidar nem o freio de lotação do evento, então pode sair um pouco acima do real.

const PRIORIDADES_CAMPANHA = [
    null,
    { rotulo: 'Aula experimental', cor: '#086357' },
    { rotulo: 'Abertura de turma', cor: '#1d6fb8' },
    { rotulo: 'Curso pago', cor: '#8a5a00' },
    { rotulo: 'Outro tipo de evento', cor: '#6b4fa3' },
    { rotulo: 'Relacionamento', cor: '#5b6b73' },
    { rotulo: 'Pós-evento', cor: '#7a7a7a' },
];
const MARGEM_LIMITE_PLANEJAMENTO = 20;   // mesma folga do agendador (MARGEM_LIMITE)
const DIAS_PLANEJAMENTO = 7;

// Mesma regra de prioridadeCampanha() em supabase/functions/campanha-whatsapp/index.ts.
function prioridadeCampanha(c, ev) {
    if (c.config?.pos_evento) return 6;
    if (!c.evento_id || !ev) return 5;
    const nome = String(ev.nome || ''), tipo = String(ev.tipo || '');
    if (/experimental/i.test(nome) || /aula inaugural/i.test(tipo)) return 1;
    if (/abertura de turma/i.test(tipo) || /turma/i.test(nome)) return 2;
    if (/curso|workshop|oficina/i.test(tipo + ' ' + nome)) return 3;
    return 4;
}

function hojeBrasiliaPlanejamento() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
function somarDiasISO(iso, n) {
    const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function diferencaDias(fimISO, diaISO) {
    return Math.round((Date.parse(fimISO + 'T12:00:00Z') - Date.parse(diaISO + 'T12:00:00Z')) / 86400000);
}
function rotuloDiaPlanejamento(iso) {
    const d = new Date(iso + 'T12:00:00Z');
    const sem = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d.getUTCDay()];
    return `${sem} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}
function limiteDoTierPlanejamento(tier) {
    const t = String(tier || '').toUpperCase();
    if (/^\d+$/.test(t)) return Number(t);
    if (t.includes('UNLIMITED') || t.includes('100K')) return 100000;
    if (t.includes('10K')) return 10000;
    if (t.includes('2K')) return 2000;
    if (t.includes('1K')) return 1000;
    return 250;
}
function nomeCurtoFilialPlanejamento(nome) {
    return String(nome || '').replace(/^Goiânia - /, '').replace(/\/MT$/, '');
}

// Campanha como ela vai estar no dia (aplica config.fase_seguinte a partir da data dela).
function campanhaNoDia(c, dia) {
    const f = c.config?.fase_seguinte;
    if (!f || !f.desde || dia < f.desde) return { ...c, proximidadeDesde: c.config?.proximidade_desde };
    return {
        ...c,
        evento_id: f.evento_id ?? c.evento_id,
        evento_data_curta: f.evento_data_curta ?? c.evento_data_curta,
        fim_convites: f.fim_convites ?? c.fim_convites,
        proximidadeDesde: f.proximidade_desde ?? c.config?.proximidade_desde,
    };
}

// Divisão por proximidade da aula (espelho de aplicarCotasPorProximidade() do agendador).
function distribuirProximidade(dinamicas, disponivel, dia, feitoDe) {
    const cota = new Map();
    const dias = (fim) => diferencaDias(fim, dia) + 1;
    const ativas = dinamicas.filter((c) => dia >= c.inicio && dia <= c.fim_convites);
    if (!ativas.length) return cota;
    const feito = new Map(ativas.map((c) => [c.id, feitoDe(c)]));
    const fimMax = Math.max(...ativas.map((c) => dias(c.fim_convites)));
    const fatia = (disponivel * fimMax + [...feito.values()].reduce((t, v) => t + v, 0)) / ativas.length;
    const parteHoje = (D) => { let soma = 0; for (let k = 1; k <= D; k++) soma += 1 / k; return (1 / D) / soma; };
    const necessidade = ativas.map((c) => ({ c, v: Math.max(0, fatia - feito.get(c.id)) * parteHoje(dias(c.fim_convites)) }));
    const somaNec = necessidade.reduce((t, x) => t + x.v, 0);
    const partes = necessidade.map((x) => ({ c: x.c, ideal: somaNec ? disponivel * x.v / somaNec : 0 }));
    for (const p of partes) cota.set(p.c.id, Math.floor(p.ideal));
    let sobra = disponivel - partes.reduce((t, p) => t + cota.get(p.c.id), 0);
    for (const p of [...partes].sort((x, y) => (y.ideal % 1) - (x.ideal % 1))) { if (sobra <= 0) break; cota.set(p.c.id, cota.get(p.c.id) + 1); sobra--; }
    return cota;
}

async function renderizarPlanejamentoMensagens() {
    const alvo = document.getElementById('relatorioPlanejamentoMensagens');
    if (!alvo) return;
    alvo.innerHTML = '<p class="report-sub"><i class="fa-solid fa-spinner fa-spin"></i> Montando o planejamento...</p>';
    try {
        const sb = window.supabaseClient;
        const hoje = hojeBrasiliaPlanejamento();
        const diasLista = Array.from({ length: DIAS_PLANEJAMENTO }, (_, i) => somarDiasISO(hoje, i));

        const [{ data: campanhas, error: e1 }, { data: param }, { data: saude }] = await Promise.all([
            sb.from('campanhas_whatsapp').select('id, slug, nome, filiais, evento_id, evento_data_curta, inicio, fim_convites, cota_diaria, config').eq('ativa', true),
            sb.from('campanha_parametros').select('teto_diario').eq('id', 1).maybeSingle(),
            sb.from('whatsapp_saude_conta').select('quality_rating, status, messaging_limit_tier').order('verificado_em', { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (e1) throw new Error(e1.message);

        const idsEventos = new Set();
        for (const c of campanhas) { if (c.evento_id) idsEventos.add(c.evento_id); if (c.config?.fase_seguinte?.evento_id) idsEventos.add(c.config.fase_seguinte.evento_id); }
        const { data: eventos } = idsEventos.size
            ? await sb.from('eventos').select('id, nome, tipo, data').in('id', [...idsEventos]) : { data: [] };
        const evPorId = new Map((eventos || []).map((e) => [e.id, e]));

        // Convites já agendados (não cancelados), por campanha e dia, desde a data mais antiga que a conta usa.
        const desdeMin = campanhas.map((c) => c.config?.proximidade_desde).filter(Boolean).sort()[0] || hoje;
        const realPorCampDia = new Map();      // chave "campanha|dia" -> agendados
        const enviadosHoje = new Map();
        for (let de = 0; ; de += 1000) {
            const { data: linhas, error } = await sb.from('campanha_fila').select('campanha_id, agendado_para, status')
                .eq('tipo', 'convite').neq('status', 'cancelado')
                .gte('agendado_para', desdeMin + 'T03:00:00Z').order('id').range(de, de + 999);
            if (error) throw new Error(error.message);
            for (const l of linhas || []) {
                const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(l.agendado_para));
                const k = l.campanha_id + '|' + dia;
                realPorCampDia.set(k, (realPorCampDia.get(k) || 0) + 1);
                if (dia === hoje && l.status === 'enviado') enviadosHoje.set(l.campanha_id, (enviadosHoje.get(l.campanha_id) || 0) + 1);
            }
            if (!linhas || linhas.length < 1000) break;
        }

        const limiteMeta = limiteDoTierPlanejamento(saude?.messaging_limit_tier);
        const q = String(saude?.quality_rating || '').toUpperCase();
        const fator = (saude?.status && saude.status !== 'CONNECTED') || q === 'RED' || q === 'LOW' ? 0 : (q === 'YELLOW' || q === 'MEDIUM' ? 0.3 : 1);
        const teto = Number(param?.teto_diario ?? 100);
        const tetoEfetivo = Math.floor(Math.min(teto, limiteMeta - MARGEM_LIMITE_PLANEJAMENTO) * fator);

        // Projeção dia a dia.
        const previsto = new Map();   // chave "campanha|dia" -> convites
        for (const dia of diasLista) {
            if (dia === hoje) {
                for (const c of campanhas) { const n = realPorCampDia.get(c.id + '|' + dia) || 0; if (n) previsto.set(c.id + '|' + dia, n); }
                continue;
            }
            const doDia = campanhas.map((c) => campanhaNoDia(c, dia));
            const fixas = doDia.filter((c) => !c.config?.cota_por_proximidade).reduce((t, c) => t + Number(c.cota_diaria || 0), 0);
            const disponivel = Math.max(0, tetoEfetivo - fixas);
            const feitoDe = (c) => {
                const desde = c.proximidadeDesde || dia; let soma = 0;
                for (let d = desde; d < dia; d = somarDiasISO(d, 1)) soma += (dia > hoje && d > hoje ? previsto.get(c.id + '|' + d) : realPorCampDia.get(c.id + '|' + d)) || 0;
                return soma;
            };
            const cotaDin = distribuirProximidade(doDia.filter((c) => c.config?.cota_por_proximidade), disponivel, dia, feitoDe);
            const ordenadas = [...doDia].sort((x, y) => prioridadeCampanha(x, evPorId.get(x.evento_id)) - prioridadeCampanha(y, evPorId.get(y.evento_id))
                || Number(y.cota_diaria) - Number(x.cota_diaria) || x.id - y.id);
            let restante = Math.min(limiteMeta - MARGEM_LIMITE_PLANEJAMENTO, tetoEfetivo);
            for (const c of ordenadas) {
                const pode = dia >= c.inicio && dia <= c.fim_convites;
                const cota = !pode ? 0 : c.config?.cota_por_proximidade ? (cotaDin.get(c.id) || 0) : Number(c.cota_diaria || 0);
                const n = Math.max(0, Math.min(cota, restante));
                restante -= n;
                if (n) previsto.set(c.id + '|' + dia, n);
            }
        }

        // Linhas por (tipo, campanha): o tipo pode mudar no meio da semana (aula experimental -> turma).
        const linhas = new Map();
        for (const c of campanhas) {
            for (const dia of diasLista) {
                const n = previsto.get(c.id + '|' + dia) || 0;
                if (!n) continue;
                const cd = campanhaNoDia(c, dia);
                const ev = evPorId.get(cd.evento_id);
                const prio = prioridadeCampanha(cd, ev);
                const chave = prio + '|' + c.id;
                if (!linhas.has(chave)) linhas.set(chave, { prio, c, ev, porDia: {}, enviados: enviadosHoje.get(c.id) || 0 });
                linhas.get(chave).porDia[dia] = n;
            }
        }
        const listaLinhas = [...linhas.values()].sort((a, b) => a.prio - b.prio || nomeCurtoFilialPlanejamento(a.c.filiais?.[0]).localeCompare(nomeCurtoFilialPlanejamento(b.c.filiais?.[0]), 'pt-BR'));

        const totalDia = (lista, dia) => lista.reduce((t, l) => t + (l.porDia[dia] || 0), 0);
        const totalLinha = (l) => diasLista.reduce((t, d) => t + (l.porDia[d] || 0), 0);
        const cab = `<tr><th style="text-align:left;">Campanha</th>${diasLista.map((d) => `<th${d === hoje ? ' class="pm-hoje"' : ''}>${d === hoje ? 'Hoje<br><small>' + rotuloDiaPlanejamento(d) + '</small>' : rotuloDiaPlanejamento(d)}</th>`).join('')}<th>Semana</th></tr>`;
        const celula = (n, dia) => `<td${dia === hoje ? ' class="pm-hoje"' : ''}>${n ? n : '<span class="pm-zero">–</span>'}</td>`;

        let corpo = '';
        for (let prio = 1; prio <= 6; prio++) {
            const doTipo = listaLinhas.filter((l) => l.prio === prio);
            if (!doTipo.length) continue;
            const info = PRIORIDADES_CAMPANHA[prio];
            corpo += `<tr class="pm-grupo"><td colspan="${DIAS_PLANEJAMENTO + 2}"><span class="pm-bolinha" style="background:${info.cor}"></span>${prio}. ${escapeHTML(info.rotulo)}</td></tr>`;
            for (const l of doTipo) {
                const escolas = (l.c.filiais || []).length === 1 ? nomeCurtoFilialPlanejamento(l.c.filiais[0]) : `${(l.c.filiais || []).length} escolas`;
                const evTxt = l.ev ? `${escapeHTML(l.ev.nome || '')}${l.ev.data ? ' · ' + l.ev.data.slice(8, 10) + '/' + l.ev.data.slice(5, 7) : ''}` : escapeHTML(l.c.nome || l.c.slug);
                corpo += `<tr><td style="text-align:left;"><strong>${escapeHTML(escolas)}</strong><div class="pm-evento">${evTxt}</div></td>`
                    + diasLista.map((d) => celula(l.porDia[d] || 0, d) + '').join('')
                    + `<td><strong>${totalLinha(l)}</strong></td></tr>`;
            }
            corpo += `<tr class="pm-subtotal"><td style="text-align:left;">Subtotal</td>${diasLista.map((d) => celula(totalDia(doTipo, d), d)).join('')}<td>${doTipo.reduce((t, l) => t + totalLinha(l), 0)}</td></tr>`;
        }
        const totalSemana = listaLinhas.reduce((t, l) => t + totalLinha(l), 0);
        corpo += `<tr class="pm-total"><td style="text-align:left;">Total do dia</td>${diasLista.map((d) => celula(totalDia(listaLinhas, d), d)).join('')}<td>${totalSemana}</td></tr>`;
        corpo += `<tr class="pm-folga"><td style="text-align:left;">Sobra do limite diário (${tetoEfetivo})</td>${diasLista.map((d) => `<td${d === hoje ? ' class="pm-hoje"' : ''}>${Math.max(0, tetoEfetivo - totalDia(listaLinhas, d))}</td>`).join('')}<td></td></tr>`;

        // Por escola.
        const porEscola = new Map();
        for (const l of listaLinhas) {
            const nomes = (l.c.filiais || []).length === 1 ? [nomeCurtoFilialPlanejamento(l.c.filiais[0])] : ['Várias escolas'];
            const k = nomes[0];
            if (!porEscola.has(k)) porEscola.set(k, {});
            for (const d of diasLista) porEscola.get(k)[d] = (porEscola.get(k)[d] || 0) + (l.porDia[d] || 0);
        }
        const linhasEscola = [...porEscola.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([nome, dias]) =>
            `<tr><td style="text-align:left;">${escapeHTML(nome)}</td>${diasLista.map((d) => celula(dias[d] || 0, d)).join('')}<td><strong>${diasLista.reduce((t, d) => t + (dias[d] || 0), 0)}</strong></td></tr>`).join('');

        const enviadosTotalHoje = [...enviadosHoje.values()].reduce((t, n) => t + n, 0);
        const qualidadeTxt = fator === 1 ? 'verde' : fator === 0 ? 'parada' : 'amarela (30%)';
        alvo.innerHTML = `
            <div class="pm-resumo">
                <div><span>Limite de convites por dia</span><strong>${tetoEfetivo}</strong><small>conta ${qualidadeTxt}</small></div>
                <div><span>Hoje</span><strong>${totalDia(listaLinhas, hoje)}</strong><small>${enviadosTotalHoje} já enviados</small></div>
                <div><span>Próximos 7 dias</span><strong>${totalSemana}</strong><small>convites previstos</small></div>
            </div>
            <div class="pm-tabela-wrap"><table class="pm-tabela"><thead>${cab}</thead><tbody>${corpo || `<tr><td colspan="${DIAS_PLANEJAMENTO + 2}">Nenhum convite previsto.</td></tr>`}</tbody></table></div>
            <h4 style="margin:18px 0 8px;">Por escola</h4>
            <div class="pm-tabela-wrap"><table class="pm-tabela"><thead>${cab.replace('Campanha', 'Escola')}</thead><tbody>${linhasEscola || ''}</tbody></table></div>
            <p class="report-sub" style="margin-top:10px;">Hoje = fila real do dia. Os outros dias são estimativa pela mesma conta do agendador das 08:25 (teto do dia, cota fixa, divisão por proximidade da aula com reforço na véspera e a ordem de prioridade acima). Mudanças já agendadas nas campanhas entram na conta. Pode ficar um pouco acima do real quando a lista de pessoas a convidar de uma escola acaba ou o evento lota. Respostas do robô e 2ª tentativa não entram.</p>`;
    } catch (e) {
        alvo.innerHTML = `<p class="report-sub" style="color:var(--cor-erro);">Não consegui montar o planejamento: ${escapeHTML(String(e.message || e))}</p>`;
    }
}

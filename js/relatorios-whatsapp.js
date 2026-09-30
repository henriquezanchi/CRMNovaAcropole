// ==========================================================
// Relatórios de WhatsApp — pedido do usuário (2026-09-30):
// "SLA de PRIMEIRA resposta", "painel de performance por atendente" e
// "relatório de volume por período/filial". As 3 RPCs (só leitura, nunca
// decidem nada) vivem em migracao_rpc_relatorios_whatsapp.sql.
//
// Módulo separado (mesmo padrão de js/leads-a-tratar.js/js/tarefas.js) —
// depende de `filialAtual`/`escapeHTML`/`window.supabaseClient`, já
// carregados antes deste arquivo.
// ==========================================================

async function carregarRelatoriosWhatsApp() {
    if (!filialAtual) return;
    const boxSla = document.getElementById('relatorioSlaWhatsApp');
    const boxDesempenho = document.getElementById('relatorioDesempenhoAtendentes');
    const boxVolume = document.getElementById('relatorioVolumeWhatsApp');
    if (!boxSla || !boxDesempenho || !boxVolume) return;
    boxSla.innerHTML = boxDesempenho.innerHTML = boxVolume.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Carregando...</div>';

    const [sla, desempenho, volume] = await Promise.all([
        window.supabaseClient.rpc('sla_primeira_resposta_whatsapp', { p_filial: filialAtual, p_dias: 30 }),
        window.supabaseClient.rpc('desempenho_atendentes_whatsapp', { p_filial: filialAtual, p_dias: 30 }),
        window.supabaseClient.rpc('volume_whatsapp_por_periodo', { p_filial: filialAtual, p_dias: 30 }),
    ]);

    // SLA
    if (sla.error) {
        boxSla.innerHTML = `<div style="font-size:11px; color:#b91c1c;">Erro ao carregar SLA: ${escapeHTML(sla.error.message)}</div>`;
    } else {
        const s = (sla.data && sla.data[0]) || {};
        boxSla.innerHTML = s.total_respondidas > 0
            ? `<div class="kpi-grid" style="grid-template-columns: repeat(3, minmax(170px, 1fr));">
                <div class="kpi-card"><div class="kpi-icon" style="background:#eff6ff; color:#2563eb;"><i class="fa-solid fa-reply"></i></div><div class="kpi-info"><div class="kpi-value">${s.total_respondidas}</div><div class="kpi-label">Mensagens respondidas</div></div></div>
                <div class="kpi-card"><div class="kpi-icon" style="background:#f0fdf4; color:var(--na-green-dark);"><i class="fa-solid fa-stopwatch"></i></div><div class="kpi-info"><div class="kpi-value">${formatarMinutosWppRel(s.media_minutos)}</div><div class="kpi-label">Tempo médio de 1ª resposta</div></div></div>
                <div class="kpi-card"><div class="kpi-icon" style="background:#fdfaf5; color:var(--na-gold);"><i class="fa-solid fa-chart-line"></i></div><div class="kpi-info"><div class="kpi-value">${formatarMinutosWppRel(s.mediana_minutos)}</div><div class="kpi-label">Mediana</div></div></div>
              </div>`
            : '<div style="font-size:12px; color:var(--text-muted);">Sem dados suficientes nos últimos 30 dias.</div>';
    }

    // Desempenho por atendente
    if (desempenho.error) {
        boxDesempenho.innerHTML = `<div style="font-size:11px; color:#b91c1c;">Erro ao carregar desempenho: ${escapeHTML(desempenho.error.message)}</div>`;
    } else if (!desempenho.data || desempenho.data.length === 0) {
        boxDesempenho.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhuma mensagem enviada com atendente identificado nos últimos 30 dias.</div>';
    } else {
        boxDesempenho.innerHTML = `
            <table class="tabela-simples" style="width:100%; font-size:12px; border-collapse:collapse;">
                <thead><tr style="text-align:left; border-bottom:1px solid var(--border-color);">
                    <th style="padding:6px 8px;">Atendente</th><th style="padding:6px 8px;">Mensagens enviadas</th><th style="padding:6px 8px;">Tempo médio de resposta</th>
                </tr></thead>
                <tbody>${desempenho.data.map(d => `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:6px 8px;">${escapeHTML(d.atendente_nome || '—')}</td>
                        <td style="padding:6px 8px;">${d.mensagens_enviadas}</td>
                        <td style="padding:6px 8px;">${d.media_minutos_resposta != null ? formatarMinutosWppRel(d.media_minutos_resposta) : '—'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    }

    // Volume por dia
    if (volume.error) {
        boxVolume.innerHTML = `<div style="font-size:11px; color:#b91c1c;">Erro ao carregar volume: ${escapeHTML(volume.error.message)}</div>`;
    } else if (!volume.data || volume.data.length === 0) {
        boxVolume.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Sem mensagens nos últimos 30 dias.</div>';
    } else {
        const maiorValor = Math.max(1, ...volume.data.map(d => Math.max(d.enviadas, d.recebidas, d.falhas)));
        boxVolume.innerHTML = `
            <div style="display:flex; gap:4px; align-items:flex-end; height:120px; overflow-x:auto; padding:4px 0;">
                ${volume.data.map(d => `
                    <div title="${escapeHTML(d.dia)}: ${d.enviadas} enviadas, ${d.recebidas} recebidas, ${d.falhas} falhas" style="display:flex; flex-direction:column; justify-content:flex-end; align-items:center; gap:1px; min-width:14px;">
                        <div style="width:6px; background:#16a34a; height:${Math.max(2, d.enviadas / maiorValor * 90)}px;"></div>
                        <div style="width:6px; background:#2563eb; height:${Math.max(2, d.recebidas / maiorValor * 90)}px;"></div>
                        <div style="width:6px; background:#dc2626; height:${Math.max(2, d.falhas / maiorValor * 90)}px;"></div>
                        <div style="font-size:8px; color:var(--text-muted); writing-mode:vertical-rl; margin-top:2px;">${d.dia.slice(5)}</div>
                    </div>
                `).join('')}
            </div>
            <div style="font-size:10.5px; color:var(--text-muted); margin-top:4px;">
                <span style="color:#16a34a;">■</span> Enviadas &nbsp; <span style="color:#2563eb;">■</span> Recebidas &nbsp; <span style="color:#dc2626;">■</span> Falhas
            </div>`;
    }
}

function formatarMinutosWppRel(minutos) {
    const m = Number(minutos) || 0;
    if (m < 60) return `${Math.round(m)} min`;
    if (m < 1440) return `${(m / 60).toFixed(1)}h`;
    return `${(m / 1440).toFixed(1)}d`;
}

// "Resumo do Trabalho" na tela — mesma lógica do Resumo Semanal pro Chefe
// (log_atividade), só que exibida aqui em vez de mandar WhatsApp.
// Reaproveita a MESMA Edge Function (resumo-semanal-chefe), com
// modoPreview:true pra devolver os dados já computados sem enviar nada.
async function carregarResumoTrabalho() {
    if (!filialAtual) return;
    const container = document.getElementById('resumoTrabalhoContainer');
    const selectDias = document.getElementById('resumoTrabalhoDiasSelect');
    if (!container) return;
    const dias = selectDias ? Number(selectDias.value) : 7;
    container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Carregando...</div>';

    const { data, error } = await window.supabaseClient.functions.invoke('resumo-semanal-chefe', {
        body: { filial: filialAtual, modoPreview: true, dias }
    });

    if (error || !data) {
        container.innerHTML = `<div style="font-size:11px; color:#b91c1c;">Erro ao carregar: ${escapeHTML((error && error.message) || 'erro desconhecido')}</div>`;
        return;
    }
    const resultado = data.resultados && data.resultados[filialAtual];
    if (!resultado || resultado.semAtividade) {
        container.innerHTML = `<div style="font-size:12px; color:var(--text-muted);">Nenhum lead foi tocado (mover/tag/mesclar) nesta filial nos últimos ${dias} dias.</div>`;
        return;
    }
    if (resultado.ok === false) {
        container.innerHTML = `<div style="font-size:11px; color:#b91c1c;">Erro: ${escapeHTML(resultado.erro || 'erro desconhecido')}</div>`;
        return;
    }

    container.innerHTML = `
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:8px;"><strong>${resultado.total}</strong> lead(s) contatado(s)/atualizado(s) nos últimos ${dias} dias:</p>
        <div style="display:flex; flex-direction:column; gap:4px; max-height:320px; overflow-y:auto;">
            ${resultado.leads.map(l => `
                <div class="activity-item" style="cursor:pointer;" onclick="abrirResultadoBuscaGlobal('${l.pessoaIdentificador}')">
                    <div class="activity-dot"></div>
                    <div>
                        <div><strong>${escapeHTML(l.pessoaNome || 'Lead sem nome')}</strong></div>
                        <div class="activity-time">Coluna: ${escapeHTML(l.funil_agencia || '?')}${l.tags.length ? ` · ${l.tags.map(escapeHTML).join(', ')}` : ''}</div>
                    </div>
                </div>
            `).join('')}
        </div>`;
}

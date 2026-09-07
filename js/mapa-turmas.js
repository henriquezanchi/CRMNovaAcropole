// ==========================================================
// MAPA DE TURMAS — grade semanal (dia x horário) por filial, estilo
// agenda/calendário. Dados vêm da tabela `turmas` (migracao_turmas.sql),
// sincronizada automaticamente pelo scraper do Mercúrio
// (processarMatriculasRecentesTurmas(), scraper/mercurio.js — visita
// cada turma da filial e grava dia/horário de TODAS, não só as que têm
// matrícula nova). Não tem cadastro manual aqui de propósito — é um
// espelho do que já existe no Mercúrio, sempre que o scraper rodar.
// ==========================================================

const ORDEM_DIAS_SEMANA = ['SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO', 'DOMINGO'];

// NÃO remove acento — o Mercúrio já manda "TERÇA"/"SÁBADO" com acento
// certo, e ORDEM_DIAS_SEMANA acima também está acentuado; só normaliza
// caixa e espaço. Bug real confirmado num teste visual: uma versão
// anterior removia acento aqui SEM remover de ORDEM_DIAS_SEMANA também,
// então "TERÇA" (extraído) nunca batia com "TERÇA" (na lista) depois da
// remoção virar "TERCA" só de um lado — a coluna de terça-feira saía da
// ordem certa (foi parar no fim, junto aos "dias extras" desconhecidos).
function normalizarDiaSemana(dia) {
    return String(dia || '').toUpperCase().trim();
}

async function carregarMapaTurmas() {
    const container = document.getElementById('mapaTurmasGrade');
    if (!container || !filialAtual) return;
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando...</p>';

    const { data, error } = await window.supabaseClient
        .from('turmas')
        .select('nome, dia, horario')
        .eq('filial', filialAtual)
        .eq('ativo', true);

    if (error) {
        container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro ao carregar turmas: ${escapeHTML(error.message)}. Rode migracao_turmas.sql se ainda não rodou.</p>`;
        return;
    }

    const turmas = (data || []).filter(t => t.dia && t.horario);
    if (turmas.length === 0) {
        container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhuma turma sincronizada ainda pra esta filial — a próxima rodada do scraper do Mercúrio preenche isso automaticamente.</p>';
        return;
    }

    // Colunas: só os dias da semana que TÊM pelo menos 1 turma, na ordem
    // padrão (Segunda -> Domingo) — evita coluna vazia de dia que a
    // escola nunca usa.
    const diasComTurma = ORDEM_DIAS_SEMANA.filter(d => turmas.some(t => normalizarDiaSemana(t.dia) === d));
    const diasExtras = [...new Set(turmas.map(t => normalizarDiaSemana(t.dia)))].filter(d => !ORDEM_DIAS_SEMANA.includes(d));
    const dias = [...diasComTurma, ...diasExtras]; // dia com grafia inesperada ainda aparece, só no fim

    // Linhas: todo horário distinto observado, ordenado (string HH:MM
    // ordena certo por ordem lexicográfica já que vem sempre com 2
    // dígitos + ":" do próprio Mercúrio).
    const horarios = [...new Set(turmas.map(t => t.horario.trim()))].sort();

    // Mapa[dia][horario] = [nomes de turma] — pode ter mais de 1 turma no
    // mesmo horário/dia (times/níveis diferentes na mesma faixa).
    const mapa = {};
    turmas.forEach(t => {
        const d = normalizarDiaSemana(t.dia);
        const h = t.horario.trim();
        mapa[d] = mapa[d] || {};
        mapa[d][h] = mapa[d][h] || [];
        mapa[d][h].push(t.nome);
    });

    const linhasHtml = horarios.map(h => {
        const celulas = dias.map(d => {
            const turmasNoSlot = (mapa[d] && mapa[d][h]) || [];
            if (turmasNoSlot.length === 0) {
                return `<td class="mapa-turmas-livre" title="Horário livre">—</td>`;
            }
            return `<td class="mapa-turmas-ocupado">${turmasNoSlot.map(n => escapeHTML(n)).join('<br>')}</td>`;
        }).join('');
        return `<tr><th class="mapa-turmas-horario">${escapeHTML(h)}</th>${celulas}</tr>`;
    }).join('');

    const cabecalhoHtml = dias.map(d => `<th>${escapeHTML(formatarTextoPadrao(d))}</th>`).join('');

    container.innerHTML = `
        <table class="mapa-turmas-tabela">
            <thead><tr><th></th>${cabecalhoHtml}</tr></thead>
            <tbody>${linhasHtml}</tbody>
        </table>
        <p style="font-size:11px; color:var(--text-muted); margin-top:10px;"><span class="mapa-turmas-legenda-livre"></span> Horário livre &nbsp;&nbsp; <span class="mapa-turmas-legenda-ocupado"></span> Turma existente</p>
    `;
}

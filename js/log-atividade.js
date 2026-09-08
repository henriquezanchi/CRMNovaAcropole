// ==========================================
// LOG DE ATIVIDADE (auditoria durável, Supabase)
// ==========================================
// Registro append-only das ações mais importantes feitas no CRM — pedido
// do usuário como rede de segurança enquanto o app ainda muda muito de
// uma sessão de código pra outra: mesmo que um bug futuro no front-end
// apague/corrompa alguma coisa na tela, o que foi feito continua
// registrado aqui. A garantia de "não vai se perder" está na RLS da
// tabela (migracao_log_atividade.sql): só existem policies de SELECT e
// INSERT — nem o próprio app consegue alterar ou apagar uma linha já
// gravada.
//
// Best-effort de propósito: uma falha ao gravar o log NUNCA deve impedir
// a ação real de completar (por isso sempre `catch`, nunca propaga erro
// pro chamador, e nunca é `await`ado antes da ação principal).
function registrarLogAtividade(acao, { pessoaIds = null, detalhes = null, filial = null } = {}) {
    try {
        if (!window.supabaseClient) return;
        // Lê o nome do atendente direto do localStorage (mesma chave de
        // js/whatsapp.js) — NUNCA chama obterNomeAtendente(), que dispara
        // um prompt() na primeira vez; logar em segundo plano não pode
        // interromper a pessoa com uma pergunta.
        const autor = localStorage.getItem('crm_na_nome_atendente') || null;
        const filialFinal = filial || (typeof filialAtual !== 'undefined' ? filialAtual : null);
        window.supabaseClient.from('log_atividade').insert({
            acao,
            autor,
            filial: filialFinal,
            pessoa_ids: pessoaIds,
            detalhes
        }).then(({ error }) => {
            if (error) console.warn('[log-atividade] Falha ao registrar "' + acao + '":', error.message);
        });
    } catch (e) {
        console.warn('[log-atividade] Falha inesperada ao registrar "' + acao + '":', e.message || e);
    }
}

// Painel simples de consulta ("Ver Log de Atividade", botão na aba
// Relatórios) — só leitura, sem filtro sofisticado por enquanto: mostra
// as últimas N entradas da filial atual, mais recente primeiro. Pensado
// pra "o que aconteceu aqui hoje", não um relatório analítico.
const LIMITE_LOG_ATIVIDADE = 200;

async function abrirLogAtividade() {
    document.getElementById('modalLogAtividade').classList.add('open');
    await carregarLogAtividade();
}
function fecharLogAtividade() {
    document.getElementById('modalLogAtividade').classList.remove('open');
}

const ROTULOS_ACAO_LOG = {
    mover_lead: 'Moveu lead(s) de coluna',
    tag_adicionar: 'Adicionou tag',
    tag_remover: 'Removeu tag',
    tag_massa: 'Editou tags em massa',
    mesclar_leads: 'Mesclou leads',
    excluir_leads_filial: 'Excluiu leads da filial (Zona de Perigo)',
    importacao: 'Importação de planilha',
    motivo_perda: 'Registrou motivo de perda',
};

async function carregarLogAtividade() {
    const container = document.getElementById('logAtividadeLista');
    if (!container) return;
    container.innerHTML = '<p style="color:var(--text-muted); font-size:12px;">Carregando...</p>';

    let query = window.supabaseClient
        .from('log_atividade')
        .select('*')
        .order('criado_em', { ascending: false })
        .limit(LIMITE_LOG_ATIVIDADE);
    if (typeof filialAtual !== 'undefined' && filialAtual) query = query.eq('filial', filialAtual);

    const { data, error } = await query;
    if (error) {
        container.innerHTML = `<p style="color:var(--danger,#dc2626); font-size:12px;">Erro ao carregar: ${escapeHTML(error.message)}${error.message.includes('does not exist') ? ' — rode migracao_log_atividade.sql no SQL Editor do Supabase.' : ''}</p>`;
        return;
    }
    if (!data || data.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:12px;">Nenhuma atividade registrada ainda nesta filial.</p>';
        return;
    }

    container.innerHTML = data.map(l => {
        const data_ = new Date(l.criado_em);
        const dataFmt = data_.toLocaleString('pt-BR');
        const rotulo = ROTULOS_ACAO_LOG[l.acao] || l.acao;
        const qtd = Array.isArray(l.pessoa_ids) ? l.pessoa_ids.length : null;
        const detalhesTxt = l.detalhes ? Object.entries(l.detalhes).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '';
        return `
            <div style="padding:8px 10px; border-bottom:1px solid #eef2f7; font-size:12px;">
                <div style="display:flex; justify-content:space-between; gap:10px;">
                    <strong>${escapeHTML(rotulo)}</strong>
                    <span style="color:var(--text-muted); white-space:nowrap;">${escapeHTML(dataFmt)}</span>
                </div>
                <div style="color:var(--text-muted); margin-top:2px;">
                    ${l.autor ? `por ${escapeHTML(l.autor)} · ` : ''}${qtd !== null ? `${qtd} lead(s) · ` : ''}${escapeHTML(detalhesTxt)}
                </div>
            </div>
        `;
    }).join('');
}

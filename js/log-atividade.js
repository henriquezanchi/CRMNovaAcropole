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
        // Prioriza o nome do usuário LOGADO (js/usuarios.js — login nominal
        // por conta, ver migracao_usuarios_crm.sql); cai pro nome antigo de
        // atendente (localStorage, js/whatsapp.js) só pra sessões que ainda
        // não fizeram o login novo. Lido direto do localStorage (nunca
        // chama obterNomeAtendente(), que dispara um prompt() na 1ª vez —
        // logar em segundo plano não pode interromper a pessoa com uma
        // pergunta).
        let autor = null;
        try {
            const usuarioBruto = localStorage.getItem('crm_na_usuario_logado');
            if (usuarioBruto) autor = JSON.parse(usuarioBruto).nome || null;
        } catch { /* ignora */ }
        if (!autor) autor = localStorage.getItem('crm_na_nome_atendente') || null;
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
    limpeza_total_reimportacao: 'Limpeza total pra reimportação',
    importar_conversa_whatsapp: 'Importou conversa de WhatsApp',
};

// Mostra até esse nº de nomes por entrada antes de resumir em "e mais N" —
// evita um bloco gigante numa ação em massa (ex: tag_massa em 500 leads).
const LIMITE_NOMES_LOG_ATIVIDADE = 6;

// Resolve pessoa_ids -> nome pra deixar CADA entrada legível ("quem foi
// movido", não só "1 lead(s)") — bug real relatado pelo usuário
// (2026-09-10): o log registrava a ação certa, mas nunca dizia QUEM,
// deixando a auditoria inútil pra reconstruir "o que aconteceu com o
// Fulano". 1 única query em lote (todos os ids de todas as entradas da
// página, não 1 query por linha) — mesmo padrão de eficiência já usado em
// outros lugares do app (ex: `carregarResumoParticipantes()`).
async function resolverNomesLeadsLog(entradas) {
    const idsUnicos = [...new Set(
        entradas.flatMap(l => Array.isArray(l.pessoa_ids) ? l.pessoa_ids : [])
    )];
    const mapa = new Map();
    if (idsUnicos.length === 0) return mapa;
    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('pessoaIdentificador, pessoaNome')
        .in('pessoaIdentificador', idsUnicos);
    if (error) { console.warn('[log-atividade] Falha ao resolver nomes:', error.message); return mapa; }
    (data || []).forEach(l => mapa.set(String(l.pessoaIdentificador), l.pessoaNome));
    return mapa;
}

// Monta "Fulano, Ciclano, Beltrano e mais 3" a partir de uma lista de ids —
// cada nome é um link clicável que abre o lead na hora (mesma função da
// busca global). Id sem nome resolvido (lead já apagado/mesclado desde
// então) mostra "lead #ID (não encontrado)" em vez de sumir silenciosamente
// — é informação relevante pra auditoria, não um erro a esconder.
function renderizarNomesLog(ids, mapaNomes) {
    if (!Array.isArray(ids) || ids.length === 0) return '';
    const visiveis = ids.slice(0, LIMITE_NOMES_LOG_ATIVIDADE);
    const resto = ids.length - visiveis.length;
    const links = visiveis.map(id => {
        const nome = mapaNomes.get(String(id));
        const rotulo = nome ? escapeHTML(nome) : `lead #${escapeHTML(String(id))} (não encontrado)`;
        return `<a href="#" onclick="event.preventDefault(); abrirResultadoBuscaGlobal('${escapeHTML(String(id))}');" style="color:var(--na-green-dark,#166534); text-decoration:underline;">${rotulo}</a>`;
    });
    return links.join(', ') + (resto > 0 ? ` e mais ${resto}` : '');
}

// Descrição por tipo de ação, cruzando `detalhes` (payload livre já
// gravado por cada chamador) com os nomes resolvidos acima — substitui o
// dump genérico "chave: valor" de antes, que exigia adivinhar o que
// "novaColuna"/"colunasAnteriores" significavam. Ação não reconhecida cai
// no dump genérico como fallback (nunca escondido, só menos bonito).
function formatarDetalhesLog(l, mapaNomes) {
    const d = l.detalhes || {};
    const nomes = renderizarNomesLog(l.pessoa_ids, mapaNomes);
    switch (l.acao) {
        case 'mover_lead': {
            const de = Array.isArray(d.colunasAnteriores) ? d.colunasAnteriores.join(', ') : '?';
            return `moveu ${nomes || '(sem lead identificado)'} de <strong>${escapeHTML(de)}</strong> para <strong>${escapeHTML(d.novaColuna || '?')}</strong>`;
        }
        case 'tag_adicionar':
            return `adicionou a tag <strong>"${escapeHTML(d.tag || '?')}"</strong> em ${nomes || '(sem lead identificado)'}`;
        case 'tag_remover':
            return `removeu a tag <strong>"${escapeHTML(d.tag || '?')}"</strong> de ${nomes || '(sem lead identificado)'}`;
        case 'tag_massa':
            return `${d.modo === 'remove' ? 'removeu' : 'adicionou'} a tag <strong>"${escapeHTML(d.tag || '?')}"</strong> em massa, em ${nomes || '(sem lead identificado)'}`;
        case 'mesclar_leads': {
            const apagados = Array.isArray(d.apagados) ? d.apagados.map(escapeHTML).join(', ') : '?';
            return `mesclou (${d.origem === 'automatica' ? 'sugestão do sistema' : 'seleção manual'}) — manteve <strong>${escapeHTML(d.sobrevivente || '?')}</strong>, apagou: ${apagados}`;
        }
        case 'excluir_leads_filial':
            return `apagou <strong>${escapeHTML(String(d.quantidade ?? '?'))} lead(s)</strong> de "${escapeHTML(l.filial || '?')}" pela Zona de Perigo`;
        case 'limpeza_total_reimportacao':
            return `apagou <strong>${escapeHTML(String(d.leads ?? '?'))} lead(s)</strong>, <strong>${escapeHTML(String(d.eventos ?? '?'))} evento(s)</strong> e <strong>${escapeHTML(String(d.vinculos ?? '?'))} vínculo(s)</strong> de "${escapeHTML(l.filial || '?')}" — ${escapeHTML(d.motivo || 'dado do scraper considerado não confiável')}`;
        case 'motivo_perda':
            return `registrou motivo de perda (<strong>${escapeHTML(d.motivo || '?')}</strong>) em ${nomes || '(sem lead identificado)'}`;
        case 'importacao':
            return `importou planilha em "${escapeHTML(l.filial || '?')}" (modo: ${escapeHTML(d.modo ? JSON.stringify(d.modo) : '?')}) — ${escapeHTML(String(d.enviados ?? '?'))} lead(s) enviado(s)`;
        case 'importar_conversa_whatsapp':
            return `importou ${escapeHTML(String(d.quantidade ?? '?'))} mensagem(ns) de WhatsApp em ${nomes || '(sem lead identificado)'}`;
        default:
            return Object.entries(d).map(([k, v]) => `${escapeHTML(k)}: ${escapeHTML(typeof v === 'object' ? JSON.stringify(v) : String(v))}`).join(' · ');
    }
}

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

    const mapaNomes = await resolverNomesLeadsLog(data);

    container.innerHTML = data.map(l => {
        const data_ = new Date(l.criado_em);
        const dataFmt = data_.toLocaleString('pt-BR');
        const rotulo = ROTULOS_ACAO_LOG[l.acao] || l.acao;
        return `
            <div style="padding:8px 10px; border-bottom:1px solid #eef2f7; font-size:12px;">
                <div style="display:flex; justify-content:space-between; gap:10px;">
                    <strong>${escapeHTML(rotulo)}</strong>
                    <span style="color:var(--text-muted); white-space:nowrap;">${escapeHTML(dataFmt)}</span>
                </div>
                <div style="color:var(--text-muted); margin-top:2px;">
                    ${l.autor ? `por ${escapeHTML(l.autor)} · ` : ''}${formatarDetalhesLog(l, mapaNomes)}
                </div>
            </div>
        `;
    }).join('');
}

// ==========================================
// IMPORTAR CONVERSA DE WHATSAPP (feita "por fora" do CRM)
// ==========================================
// Enquanto a API do Meta está bloqueada (ver "Bloqueio da API do
// WhatsApp" no CLAUDE.md), o time continua atendendo pelo WhatsApp de
// verdade — esse módulo deixa colar o .txt exportado nativamente (menu
// da conversa → Exportar conversa → Sem mídia) direto na gaveta do lead
// aberto, sem digitar mensagem por mensagem na mão. Grava em
// mensagens_whatsapp via Edge Function `whatsapp-importar-conversa`
// (service_role — essa tabela não tem policy de INSERT pro público, ver
// migracao_whatsapp.sql) e a gaveta já enxerga as mensagens novas pelo
// MESMO canal Realtime que já existe (criarChatController(),
// js/whatsapp.js) — não precisa recarregar nada manualmente depois.

// Início de uma linha de mensagem exportada: "DD/MM/AAAA HH:MM - resto".
// Confirmado contra um export real (sem comma entre data e hora, sem
// segundos) — outros formatos (iOS usa "[DD/MM/AA, HH:MM:SS]") podem
// precisar de ajuste se aparecerem na prática.
const RE_INICIO_LINHA_WPP = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}) - ([\s\S]*)$/;
// Dentro do "resto" de uma linha, "Nome: mensagem" — mensagens de SISTEMA
// (aviso de criptografia etc.) não têm esse padrão (não são "Nome: algo"),
// e são ignoradas por não bater aqui.
const RE_REMETENTE_WPP = /^([^:\n]{1,60}): ([\s\S]*)$/;

// Parser puro, sem nenhuma chamada de rede — retorna um array de
// {remetente, texto, dia, mes, ano, hora, minuto}. Linhas que não começam
// com o timestamp são tratadas como CONTINUAÇÃO da mensagem anterior
// (parágrafo multi-linha, ex: um texto longo colado com quebras de linha).
function parseTextoConversaWhatsApp(textoColado) {
    const linhas = (textoColado || '').replace(/\r\n/g, '\n').split('\n');
    const mensagens = [];
    let atual = null;

    linhas.forEach(linha => {
        const m = linha.match(RE_INICIO_LINHA_WPP);
        if (m) {
            const [, dia, mes, ano, hora, minuto, resto] = m;
            const remMatch = resto.match(RE_REMETENTE_WPP);
            if (!remMatch) { atual = null; return; } // aviso de sistema (sem remetente) — ignorado
            atual = {
                remetente: remMatch[1].trim(),
                texto: remMatch[2],
                dia: Number(dia), mes: Number(mes), ano: Number(ano),
                hora: Number(hora), minuto: Number(minuto)
            };
            mensagens.push(atual);
        } else if (atual) {
            atual.texto += '\n' + linha;
        }
    });

    mensagens.forEach(m => { m.texto = m.texto.trim(); });
    return mensagens.filter(m => m.texto !== '');
}

let conversaWppParseada = null; // { mensagens, remetentes }
let remetenteAtendenteEscolhido = null;

function abrirImportarConversaWpp() {
    if (!currentLeadId) return;
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(currentLeadId));
    if (!lead) return;

    conversaWppParseada = null;
    remetenteAtendenteEscolhido = null;
    document.getElementById('importarConversaWppLeadInfo').textContent = `${lead.pessoaNome} — ${filialAtual}`;
    document.getElementById('importarConversaWppTexto').value = '';
    const revisao = document.getElementById('importarConversaWppRevisao');
    revisao.style.display = 'none';
    revisao.innerHTML = '';
    document.getElementById('importarConversaWppBtnConfirmar').style.display = 'none';
    document.getElementById('modalImportarConversaWpp').classList.add('open');
}
function fecharImportarConversaWpp() {
    document.getElementById('modalImportarConversaWpp').classList.remove('open');
}

function processarConversaWpp() {
    const texto = document.getElementById('importarConversaWppTexto').value;
    const revisao = document.getElementById('importarConversaWppRevisao');
    const btnConfirmar = document.getElementById('importarConversaWppBtnConfirmar');
    btnConfirmar.style.display = 'none';
    revisao.style.display = 'block';

    const mensagens = parseTextoConversaWhatsApp(texto);
    if (mensagens.length === 0) {
        revisao.innerHTML = '<p style="color:#dc2626; font-size:12px;"><i class="fa-solid fa-triangle-exclamation"></i> Não consegui identificar nenhuma mensagem nesse texto. Confirme que colou o conteúdo do .txt exportado (menu da conversa → Exportar conversa → Sem mídia).</p>';
        return;
    }

    const remetentes = Array.from(new Set(mensagens.map(m => m.remetente)));
    if (remetentes.length > 2) {
        revisao.innerHTML = `<p style="color:#dc2626; font-size:12px;"><i class="fa-solid fa-triangle-exclamation"></i> Encontrei ${remetentes.length} pessoas diferentes escrevendo (${remetentes.map(escapeHTML).join(', ')}) — isso parece ser uma conversa em GRUPO. Esse recurso só funciona pra conversa individual (1 pessoa só de cada lado).</p>`;
        return;
    }

    conversaWppParseada = { mensagens, remetentes };

    // Palpite: o remetente com o primeiro nome MAIS PARECIDO com o nome do
    // lead no CRM provavelmente é o próprio lead — pré-marca o OUTRO como
    // atendente, mas sempre deixa confirmar/trocar antes de importar (nunca
    // decide sozinho quem é quem).
    const lead = leadsAtuais.find(l => String(l.pessoaIdentificador) === String(currentLeadId));
    const primeiroNomeLead = normalizarNomeImport((lead && lead.pessoaNome || '').split(' ')[0] || '');
    let palpiteAtendente = remetentes[0];
    if (remetentes.length === 2 && primeiroNomeLead) {
        const bateA = normalizarNomeImport(remetentes[0]).includes(primeiroNomeLead);
        const bateB = normalizarNomeImport(remetentes[1]).includes(primeiroNomeLead);
        if (bateA && !bateB) palpiteAtendente = remetentes[1];
        else if (bateB && !bateA) palpiteAtendente = remetentes[0];
    }
    remetenteAtendenteEscolhido = palpiteAtendente;

    const primeiraData = `${String(mensagens[0].dia).padStart(2, '0')}/${String(mensagens[0].mes).padStart(2, '0')}/${mensagens[0].ano}`;
    const ultimaData = `${String(mensagens[mensagens.length - 1].dia).padStart(2, '0')}/${String(mensagens[mensagens.length - 1].mes).padStart(2, '0')}/${mensagens[mensagens.length - 1].ano}`;

    const previaLinhas = (lista, seta) => lista.map(m => `<div>${m.remetente === remetenteAtendenteEscolhido ? seta : '←'} <strong>${escapeHTML(m.remetente)}</strong>: ${escapeHTML(m.texto.slice(0, 90).replace(/\n/g, ' '))}</div>`).join('');

    revisao.innerHTML = `
        <p style="font-size:12px; margin-bottom:8px;"><strong>${mensagens.length} mensagem(ns)</strong> encontrada(s), de ${primeiraData} até ${ultimaData}.</p>
        <p style="font-size:12px; font-weight:600; margin-bottom:4px;">Qual desses nomes é VOCÊ (quem atendeu)?</p>
        <div style="display:flex; gap:16px; margin-bottom:10px;">
            ${remetentes.map(r => `
                <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer;">
                    <input type="radio" name="importarConversaWppAtendente" value="${escapeHTML(r)}" ${r === palpiteAtendente ? 'checked' : ''} onchange="remetenteAtendenteEscolhido = this.value; processarConversaWpp.reprocessarPreview && processarConversaWpp.reprocessarPreview();">
                    ${escapeHTML(r)}
                </label>
            `).join('')}
        </div>
        <div id="importarConversaWppPreviaMsgs" style="max-height:220px; overflow-y:auto; border:1px solid #eef2f7; border-radius:8px; padding:8px; font-size:11px; background:#f8fafc; line-height:1.6;">
            ${previaLinhas(mensagens.slice(0, 4), '→')}
            ${mensagens.length > 8 ? `<div style="text-align:center; color:var(--text-muted); margin:4px 0;">... ${mensagens.length - 8} mensagem(ns) no meio ...</div>` : ''}
            ${mensagens.length > 4 ? previaLinhas(mensagens.slice(-4), '→') : ''}
        </div>
    `;

    // Reprocessa só a prévia (setas de direção) quando o rádio de atendente
    // muda, sem perder o scroll/estado do resto do formulário.
    processarConversaWpp.reprocessarPreview = () => {
        const container = document.getElementById('importarConversaWppPreviaMsgs');
        if (!container) return;
        container.innerHTML = previaLinhas(mensagens.slice(0, 4), '→')
            + (mensagens.length > 8 ? `<div style="text-align:center; color:var(--text-muted); margin:4px 0;">... ${mensagens.length - 8} mensagem(ns) no meio ...</div>` : '')
            + (mensagens.length > 4 ? previaLinhas(mensagens.slice(-4), '→') : '');
    };

    btnConfirmar.style.display = 'inline-flex';
}

async function confirmarImportarConversaWpp() {
    if (!conversaWppParseada || !currentLeadId) return;
    const btn = document.getElementById('importarConversaWppBtnConfirmar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Importando...';

    // Índice global como deslocamento em ms — o .txt exportado só tem
    // HH:MM (sem segundos); isso garante que mensagens do MESMO minuto
    // continuem em ordem correta no chat (Date normaliza overflow de ms
    // pra segundos/minutos sozinho, sem risco de virar minuto errado com
    // conversas de tamanho normal).
    const mensagensPayload = conversaWppParseada.mensagens.map((m, i) => ({
        direcao: m.remetente === remetenteAtendenteEscolhido ? 'saida' : 'entrada',
        texto: m.texto,
        timestamp: new Date(m.ano, m.mes - 1, m.dia, m.hora, m.minuto, 0, i).toISOString()
    }));

    const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-importar-conversa', {
        body: { pessoaIdentificador: currentLeadId, mensagens: mensagensPayload }
    });

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Confirmar Importação';

    if (error || !data || !data.ok) {
        alert('Erro ao importar a conversa: ' + (error?.message || data?.detalhe || data?.erro || 'erro desconhecido'));
        return;
    }

    registrarLogAtividade('importar_conversa_whatsapp', {
        pessoaIds: [String(currentLeadId)],
        detalhes: { quantidade: data.importadas }
    });

    fecharImportarConversaWpp();
    alert(`${data.importadas} mensagem(ns) importada(s) com sucesso — já aparecem no chat da gaveta.`);
}

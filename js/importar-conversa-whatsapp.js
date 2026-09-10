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

// ==========================================================
// ZIP — extrai o .txt de dentro do .zip exportado (JSZip, CDN).
// ==========================================================
// O WhatsApp empacota em .zip tanto quando exporta "com mídia" quanto,
// em alguns aparelhos, mesmo escolhendo "sem mídia" — dentro tem sempre
// exatamente 1 arquivo .txt (o histórico) + eventualmente arquivos de
// mídia (ignorados aqui, só o texto interessa). Assumido UTF-8 (padrão
// do WhatsApp); se aparecer um .zip com encoding diferente, ajustar aqui
// depois de confirmar com uma amostra real (mesmo princípio de nunca
// adivinhar formato de sistema externo usado no resto do projeto).
async function extrairTextoDoZip(file) {
    const zip = await JSZip.loadAsync(file);
    const nomeArquivoTxt = Object.keys(zip.files).find(nome => nome.toLowerCase().endsWith('.txt') && !zip.files[nome].dir);
    if (!nomeArquivoTxt) throw new Error('Não encontrei nenhum .txt dentro do .zip — confirme que é um export de conversa do WhatsApp.');
    return await zip.files[nomeArquivoTxt].async('string');
}

// Handler do <input type="file"> no modal de importação de 1 lead —
// extrai o texto do zip escolhido, cola na textarea (mesmo caminho de
// sempre) e já processa, sem passo extra.
async function processarZipConversaWpp(file) {
    if (!file) return;
    const textoEl = document.getElementById('importarConversaWppTexto');
    try {
        const texto = await extrairTextoDoZip(file);
        textoEl.value = texto;
        processarConversaWpp();
    } catch (e) {
        const revisao = document.getElementById('importarConversaWppRevisao');
        revisao.style.display = 'block';
        revisao.innerHTML = `<p style="color:#dc2626; font-size:12px;"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHTML(e.message || String(e))}</p>`;
    }
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

// ==========================================================
// IMPORTAÇÃO EM LOTE — vários .zip de uma vez (js/leads-a-tratar.js
// mostra o que não casou com confiança, na seção "Conversas Importadas").
// ==========================================================
// Pedido do usuário: subir os .zip de várias conversas de uma vez, SEM
// separar por filial antes (casa contra a base INTEIRA de uma vez, e
// deixa pra "procurar o lead em cada filial" só quem ficar ambíguo) —
// casando cada uma com um lead por TELEFONE (quando o contato exportado
// não estava salvo, o "nome" que aparece já É o número) e, se não bater,
// por NOME EXATO — o que não resolver com confiança vai pra uma tela "a
// tratar" pra vinculação manual, nunca decidido sozinho na duvida.

// Extrai dígitos e decide se um rótulo de remetente "parece telefone"
// (contato não salvo no celular de quem exportou) — WhatsApp mostra
// nesse caso algo como "+55 62 99999-8888" ou "+55 (62) 8888-8888".
function pareceTelefone(rotulo) {
    const digitos = String(rotulo || '').replace(/\D/g, '');
    if (digitos.length < 10 || digitos.length > 13) return null;
    return digitos;
}
// Reduz os dígitos brutos a {ddd, numero} — remove o "55" (Brasil) do
// início quando sobra DDD+8/9 dígitos depois disso.
function normalizarDigitosTelefoneBr(digitos) {
    let d = digitos;
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    if (d.length < 10 || d.length > 11) return null;
    return { ddd: d.slice(0, 2), numero: d.slice(2) };
}

async function abrirImportarConversasLote() {
    const meuNomeEl = document.getElementById('loteConversasMeuNome');
    if (!meuNomeEl.value && typeof obterNomeAtendente === 'function') {
        const nome = obterNomeAtendente();
        if (nome) meuNomeEl.value = nome.replace(/^(o|a)\s+/i, ''); // tira artigo ("o Henrique" -> "Henrique") — nos exports o nome salvo no contato raramente vem com artigo
    }
    document.getElementById('loteConversasResultado').innerHTML = '';
    document.getElementById('modalImportarConversasLote').classList.add('open');
}
function fecharImportarConversasLote() {
    document.getElementById('modalImportarConversasLote').classList.remove('open');
}

// Busca TODOS os leads de TODAS as filiais (paginado, mesmo padrão de
// exatidão de detectarLeadsATratar()/carregarLeadsParaMatchMatricula()) —
// pedido do usuário: não separar a importação por filial, casar contra a
// base inteira e deixar o que ficar ambíguo (ex: mesmo nome em 2 filiais
// diferentes) pra resolução manual. Usado só na hora de processar o
// lote, não fica em cache entre aberturas do modal (a base pode ter
// mudado).
async function carregarTodosLeadsParaMatchLoteConversas() {
    const TAMANHO_PAGINA = 1000;
    let todos = [];
    for (let de = 0; ; de += TAMANHO_PAGINA) {
        const { data, error } = await window.supabaseClient
            .from(NOME_TABELA)
            .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero, filial')
            .order('pessoaIdentificador', { ascending: true })
            .range(de, de + TAMANHO_PAGINA - 1);
        if (error) throw new Error('Erro ao carregar leads: ' + error.message);
        todos = todos.concat(data || []);
        if (!data || data.length < TAMANHO_PAGINA) break;
    }
    return todos;
}

async function processarLoteConversasWpp() {
    const meuNome = document.getElementById('loteConversasMeuNome').value.trim();
    const arquivos = [...document.getElementById('loteConversasArquivos').files];
    const resultadoEl = document.getElementById('loteConversasResultado');

    if (!meuNome) { alert('Preencha "Seu nome nas conversas" — é como o CRM identifica qual dos 2 remetentes é você (o atendente), não o lead.'); return; }
    if (arquivos.length === 0) { alert('Escolha 1 ou mais arquivos .zip.'); return; }

    resultadoEl.innerHTML = `<p><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando leads de todas as filiais...</p>`;
    let leads;
    try {
        leads = await carregarTodosLeadsParaMatchLoteConversas();
    } catch (e) {
        resultadoEl.innerHTML = `<p style="color:#dc2626;">${escapeHTML(e.message)}</p>`;
        return;
    }

    const porTelefone = new Map(); // chave normalizada -> [leads]
    const porNome = new Map(); // nome normalizado -> [leads]
    leads.forEach(l => {
        const chaveTel = normalizarTelefoneParaChave(l.pessoaTelefoneDDD, l.pessoaTelefoneNumero);
        if (chaveTel) { if (!porTelefone.has(chaveTel)) porTelefone.set(chaveTel, []); porTelefone.get(chaveTel).push(l); }
        const chaveNome = normalizarNomeImport(l.pessoaNome || '');
        if (chaveNome) { if (!porNome.has(chaveNome)) porNome.set(chaveNome, []); porNome.get(chaveNome).push(l); }
    });

    let resolvidosTelefone = 0, resolvidosNome = 0, aTratar = 0, semAtendente = 0, semRemetentes = 0, comErro = 0;

    for (let i = 0; i < arquivos.length; i++) {
        const arquivo = arquivos[i];
        resultadoEl.innerHTML = `<p><i class="fa-solid fa-circle-notch fa-spin"></i> Processando ${i + 1}/${arquivos.length}: ${escapeHTML(arquivo.name)}...</p>`;
        try {
            const texto = await extrairTextoDoZip(arquivo);
            const mensagens = parseTextoConversaWhatsApp(texto);
            if (mensagens.length === 0) { comErro++; continue; }

            const remetentes = Array.from(new Set(mensagens.map(m => m.remetente)));
            if (remetentes.length === 0 || remetentes.length > 2) { semRemetentes++; continue; }

            // Quem é "eu" (o atendente) — precisa bater com "Seu nome nas
            // conversas" pra saber a direção; sem isso, MESMO que a
            // conversa case com um lead, não daria pra confiar em quem
            // mandou o quê. Aceita 1 remetente só (conversa consigo mesmo/
            // grupo de 1) tratando ele como o lead, sem atendente.
            const meuNomeNorm = normalizarNomeImport(meuNome);
            let atendente = null, rotuloLead = remetentes[0];
            if (remetentes.length === 2) {
                const bateA = normalizarNomeImport(remetentes[0]).includes(meuNomeNorm) || meuNomeNorm.includes(normalizarNomeImport(remetentes[0]));
                const bateB = normalizarNomeImport(remetentes[1]).includes(meuNomeNorm) || meuNomeNorm.includes(normalizarNomeImport(remetentes[1]));
                if (bateA && !bateB) { atendente = remetentes[0]; rotuloLead = remetentes[1]; }
                else if (bateB && !bateA) { atendente = remetentes[1]; rotuloLead = remetentes[0]; }
                else { semAtendente++; continue; } // ambíguo ou nenhum bate — não arrisca a direção
            }

            // Casamento: telefone primeiro (mais confiável), depois nome exato.
            let pessoaIdentificador = null, telefoneDetectado = null;
            const digitos = pareceTelefone(rotuloLead);
            if (digitos) {
                telefoneDetectado = digitos;
                const normalizado = normalizarDigitosTelefoneBr(digitos);
                const chave = normalizado && normalizarTelefoneParaChave(normalizado.ddd, normalizado.numero);
                const candidatos = (chave && porTelefone.get(chave)) || [];
                if (candidatos.length === 1) pessoaIdentificador = candidatos[0].pessoaIdentificador;
            } else {
                const candidatos = porNome.get(normalizarNomeImport(rotuloLead)) || [];
                if (candidatos.length === 1) pessoaIdentificador = candidatos[0].pessoaIdentificador;
            }

            const mensagensPayload = mensagens.map((m, idx) => ({
                direcao: atendente ? (m.remetente === atendente ? 'saida' : 'entrada') : 'entrada',
                texto: m.texto,
                timestamp: new Date(m.ano, m.mes - 1, m.dia, m.hora, m.minuto, 0, idx).toISOString()
            }));

            const corpo = pessoaIdentificador
                ? { pessoaIdentificador, mensagens: mensagensPayload }
                : { nomeBruto: rotuloLead, telefoneDetectado, loteImportacaoId: crypto.randomUUID(), mensagens: mensagensPayload };

            const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-importar-conversa', { body: corpo });
            if (error || !data || !data.ok) { comErro++; continue; }

            if (pessoaIdentificador) { if (digitos) resolvidosTelefone++; else resolvidosNome++; }
            else aTratar++;
        } catch (e) {
            comErro++;
            console.error('Erro processando ' + arquivo.name + ':', e);
        }
    }

    resultadoEl.innerHTML = `
        <p style="font-weight:600; margin-bottom:6px;">Concluído — ${arquivos.length} arquivo(s) processado(s):</p>
        <ul style="margin:0 0 8px 18px; padding:0;">
            <li>${resolvidosTelefone} vinculada(s) por telefone</li>
            <li>${resolvidosNome} vinculada(s) por nome exato</li>
            <li>${aTratar} foram pra "Leads a Tratar &gt; Conversas Importadas" (sem lead com confiança)</li>
            <li>${semAtendente} ignorada(s) — não consegui identificar qual remetente é você ("Seu nome nas conversas" não bateu)</li>
            <li>${semRemetentes} ignorada(s) — conversa em grupo (3+ remetentes) ou vazia</li>
            <li>${comErro} com erro (veja o console)</li>
        </ul>
    `;
    if (typeof carregarConversasImportadasATratar === 'function') carregarConversasImportadasATratar();
}

// ==========================================================
// Tela "a tratar": vincular manualmente uma conversa em lote sem lead
// ==========================================================
async function carregarConversasImportadasATratar() {
    const container = document.getElementById('conversasImportadasATratarLista');
    if (!container) return;
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Carregando...</p>';

    // Sem filtro de filial de propósito — a Importação em Lote casa
    // contra a base INTEIRA (todas as filiais), então o que sobrou sem
    // lead também precisa aparecer aqui independente de qual filial está
    // selecionada no topo agora.
    const { data, error } = await window.supabaseClient
        .from('mensagens_whatsapp')
        .select('lote_importacao_id, nome_bruto_importado, telefone_whatsapp, corpo_texto, criado_em')
        .is('pessoaIdentificador', null)
        .not('lote_importacao_id', 'is', null)
        .order('criado_em', { ascending: true });

    if (error) { container.innerHTML = `<p style="color:#dc2626; font-size:12px;">Erro: ${escapeHTML(error.message)}</p>`; return; }
    if (!data || data.length === 0) { container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Nenhuma conversa importada pendente de vínculo.</p>'; return; }

    const porLote = new Map();
    data.forEach(m => {
        if (!porLote.has(m.lote_importacao_id)) porLote.set(m.lote_importacao_id, { ...m, qtd: 0, primeiraData: m.criado_em, ultimaData: m.criado_em, ultimoTexto: m.corpo_texto });
        const g = porLote.get(m.lote_importacao_id);
        g.qtd++;
        g.ultimaData = m.criado_em;
        g.ultimoTexto = m.corpo_texto;
    });

    container.innerHTML = [...porLote.values()].map(g => `
        <div class="info-box" style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:6px;">
            <div>
                <strong>${escapeHTML(g.nome_bruto_importado || 'Sem nome')}</strong>
                ${g.telefone_whatsapp ? ` <span style="color:var(--text-muted); font-size:11px;">(${escapeHTML(g.telefone_whatsapp)})</span>` : ''}
                <div style="font-size:11px; color:var(--text-muted);">${g.qtd} mensagem(ns) — última: "${escapeHTML((g.ultimoTexto || '').slice(0, 60))}"</div>
            </div>
            <button class="btn-mini btn-secondary-mini" onclick="abrirVincularConversaImportada('${g.lote_importacao_id}', '${escapeHTML(g.nome_bruto_importado || '').replace(/'/g, "\\'")}')"><i class="fa-solid fa-link"></i> Vincular</button>
        </div>
    `).join('');
}

let loteImportacaoIdEmVinculacao = null;
function abrirVincularConversaImportada(loteId, nomeBruto) {
    loteImportacaoIdEmVinculacao = loteId;
    document.getElementById('vincularConversaNomeOriginal').textContent = nomeBruto || '(sem nome)';
    document.getElementById('vincularConversaBuscaInput').value = '';
    document.getElementById('vincularConversaBuscaResultados').innerHTML = '';
    document.getElementById('modalVincularConversaImportada').classList.add('open');
}
function fecharVincularConversaImportada() {
    document.getElementById('modalVincularConversaImportada').classList.remove('open');
    loteImportacaoIdEmVinculacao = null;
}

let debounceVincularConversa = null;
function buscarLeadParaVincularConversa() {
    clearTimeout(debounceVincularConversa);
    debounceVincularConversa = setTimeout(async () => {
        const input = document.getElementById('vincularConversaBuscaInput');
        const resultados = document.getElementById('vincularConversaBuscaResultados');
        const termo = input.value.trim();
        if (termo.length < 2) { resultados.innerHTML = ''; return; }

        // Sem filtro de filial — busca em QUALQUER unidade (pedido do
        // usuário: "procurar os leads em cada filial pra fazer a
        // atribuição correta"), por isso mostra a filial de cada
        // resultado, pra diferenciar homônimos de unidades diferentes.
        const termoSeguro = termo.replace(/,/g, ' ');
        const { data, error } = await window.supabaseClient
            .from(NOME_TABELA)
            .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero, filial')
            .or(`pessoaNome.ilike.%${termoSeguro}%,pessoaTelefoneNumero.ilike.%${termoSeguro}%`)
            .limit(15);

        if (error) { resultados.innerHTML = `<p style="font-size:11px; color:#dc2626;">Erro: ${escapeHTML(error.message)}</p>`; return; }
        if (!data || data.length === 0) { resultados.innerHTML = '<p style="font-size:11px; color:var(--text-muted);">Nenhum lead encontrado.</p>'; return; }

        resultados.innerHTML = data.map(r => `
            <div class="info-box" style="cursor:pointer; margin-bottom:4px;" onclick="vincularConversaImportada('${r.pessoaIdentificador}', '${escapeHTML(r.filial || '').replace(/'/g, "\\'")}')">
                <i class="fa-solid fa-user-plus"></i> ${escapeHTML(r.pessoaNome)} <span style="color:var(--text-muted); font-size:11px;">(${escapeHTML(r.pessoaTelefoneDDD || '')} ${escapeHTML(r.pessoaTelefoneNumero || 'sem tel.')} — ${escapeHTML(r.filial || '?')})</span>
            </div>
        `).join('');
    }, 300);
}

async function vincularConversaImportada(idLead, filialLead) {
    if (!loteImportacaoIdEmVinculacao) return;
    // Mesma policy de UPDATE já usada pra "não identificados" (webhook) —
    // só libera linhas que AINDA estão sem pessoaIdentificador. Grava
    // também a filial do lead escolhido (as linhas ficam com filial=null
    // até serem vinculadas, já que a Importação em Lote não pede pra
    // escolher filial de antemão) — sem isso, o selo de filial da
    // conversa na aba WhatsApp Unificada ficaria em branco pra sempre.
    const { error } = await window.supabaseClient
        .from('mensagens_whatsapp')
        .update({ pessoaIdentificador: idLead, filial: filialLead || null })
        .eq('lote_importacao_id', loteImportacaoIdEmVinculacao)
        .is('pessoaIdentificador', null);
    if (error) { alert('Erro ao vincular: ' + error.message); return; }

    fecharVincularConversaImportada();
    carregarConversasImportadasATratar();
}

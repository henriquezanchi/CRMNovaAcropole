// Modelos de mensagem do WhatsApp na Meta (27/11/2026): listar e criar pelo CRM.
//
// Botão "Modelos de mensagem" em Gerenciar Filiais. O modelo é criado na conta do WhatsApp da escola escolhida
// (quando ela conectou o próprio número) ou na conta da agência, e entra em análise na Meta. Tudo passa pela Edge
// Function whatsapp-modelos, que exige administrador e a senha do CRM.

let modelosWppFilial = '';
let modelosWppSenhaHash = null;

async function chamarWhatsappModelos(corpo) {
    const usuario = typeof usuarioLogado === 'function' ? usuarioLogado() : null;
    if (!usuario || !usuario.ehAdmin) { avisar('Só um administrador mexe nos modelos de mensagem.'); return null; }
    if (!modelosWppSenhaHash) {
        // Campo na própria tela (não prompt): navegadores automatizados e alguns bloqueadores engolem o prompt().
        const senha = (document.getElementById('modelosWppSenha')?.value || '').trim();
        if (!senha) { avisar('Digite a sua senha do CRM no campo "Senha" para consultar a Meta.'); return null; }
        modelosWppSenhaHash = await calcularHashSenha(senha);
        document.getElementById('modelosWppSenha').value = '';
    }
    const { data, error } = await window.supabaseClient.functions.invoke('whatsapp-modelos', {
        body: { ...corpo, usuario: usuario.nome, senhaHash: modelosWppSenhaHash },
    });
    if (error) {
        let detalhe = error.message;
        try { const j = await error.context?.json(); if (j?.erro) detalhe = j.erro; } catch (_) { /* sem corpo */ }
        if (/senha/i.test(detalhe)) modelosWppSenhaHash = null;
        return { ok: false, erro: detalhe };
    }
    return data || { ok: false, erro: 'Sem resposta do servidor.' };
}

function abrirModelosWhatsapp() {
    document.getElementById('modalModelosWpp').classList.add('open');
    document.getElementById('overlayModalModelosWpp').classList.add('active');
    const sel = document.getElementById('modelosWppFilial');
    const filiais = (typeof filiaisDisponiveis !== 'undefined' ? filiaisDisponiveis : []).filter(f => f.ativo !== false);
    sel.innerHTML = '<option value="">Conta da agência (número compartilhado)</option>' +
        filiais.map(f => `<option value="${escapeHTML(f.nome)}">${escapeHTML(f.nome)}</option>`).join('');
    sel.value = modelosWppFilial;
    if (modelosWppSenhaHash) carregarModelosWhatsapp();
    else document.getElementById('modelosWppLista').innerHTML = '<p class="filial-campo-ajuda">Digite a senha e clique em "Consultar a Meta".</p>';
}
function fecharModelosWhatsapp() {
    document.getElementById('modalModelosWpp').classList.remove('open');
    document.getElementById('overlayModalModelosWpp').classList.remove('active');
}

const ROTULO_STATUS_MODELO = { APPROVED: ['Aprovado', 'filial-chip-ok'], PENDING: ['Em análise', ''], REJECTED: ['Recusado', 'filial-chip-alerta'], PAUSED: ['Pausado', 'filial-chip-alerta'], DISABLED: ['Desativado', 'filial-chip-alerta'] };

async function carregarModelosWhatsapp() {
    modelosWppFilial = document.getElementById('modelosWppFilial').value;
    const lista = document.getElementById('modelosWppLista');
    lista.innerHTML = '<p class="filial-campo-ajuda">Consultando a Meta...</p>';
    const r = await chamarWhatsappModelos({ acao: 'listar', filial: modelosWppFilial || null });
    if (!r) { lista.innerHTML = ''; return; }
    if (!r.ok) { lista.innerHTML = `<p class="wpp-oficial-aviso">${escapeHTML(r.erro)}</p>`; return; }
    window.__modelosWppUltimo = r;
    document.getElementById('modelosWppOrigem').textContent = `${r.origem} · conta ${r.contas.join(', ')}`;
    if (!r.modelos.length) { lista.innerHTML = '<p class="filial-campo-ajuda">Nenhum modelo nesta conta ainda.</p>'; return; }
    lista.innerHTML = r.modelos.map(m => {
        if (m.erro) return `<p class="wpp-oficial-aviso">Conta ${escapeHTML(m.conta)}: ${escapeHTML(m.erro)}</p>`;
        const [rotulo, classe] = ROTULO_STATUS_MODELO[m.status] || [m.status, ''];
        return `<div class="modelo-wpp">
            <div class="modelo-wpp-topo"><strong>${escapeHTML(m.nome)}</strong> <span class="filial-chip ${classe}">${escapeHTML(rotulo)}</span>
                <span class="filial-chip">${escapeHTML(m.categoria || '')}</span> <span class="filial-chip">${escapeHTML(m.idioma || '')}</span></div>
            <div class="modelo-wpp-corpo">${escapeHTML(m.corpo || '')}</div>
            ${m.rodape ? `<div class="filial-campo-ajuda">${escapeHTML(m.rodape)}</div>` : ''}
            ${m.motivo ? `<div class="wpp-oficial-aviso">Motivo da recusa: ${escapeHTML(m.motivo)}</div>` : ''}
        </div>`;
    }).join('');
}

async function criarModeloWhatsapp() {
    const nome = document.getElementById('modeloWppNome').value.trim().toLowerCase().replace(/\s+/g, '_');
    const categoria = document.getElementById('modeloWppCategoria').value;
    const corpo = document.getElementById('modeloWppCorpo').value.trim();
    const rodape = document.getElementById('modeloWppRodape').value.trim();
    if (!/^[a-z0-9_]{3,}$/.test(nome)) { avisar('Nome do modelo: só letras minúsculas, números e _ (ex.: lembrete_evento).'); return; }
    if (!corpo) { avisar('Escreva o texto do modelo.'); return; }
    const btn = document.getElementById('modeloWppCriar');
    btn.disabled = true; btn.textContent = 'Enviando para a Meta...';
    const r = await chamarWhatsappModelos({ acao: 'criar', filial: modelosWppFilial || null, nome, categoria, idioma: 'pt_BR', corpo, rodape });
    btn.disabled = false; btn.textContent = 'Criar modelo na Meta';
    if (!r) return;
    if (!r.ok) { avisar('A Meta recusou: ' + r.erro); return; }
    avisar(`Modelo "${nome}" criado (${r.status === 'APPROVED' ? 'aprovado' : 'em análise'}). Ele só pode ser usado depois de aprovado.`);
    document.getElementById('modeloWppNome').value = '';
    document.getElementById('modeloWppCorpo').value = '';
    document.getElementById('modeloWppRodape').value = '';
    carregarModelosWhatsapp();
}

// Copia os modelos aprovados da conta da agência para a conta da escola escolhida (1 clique por escola conectada).
async function copiarModelosDaAgencia() {
    const filial = document.getElementById('modelosWppFilial').value;
    if (!filial) { avisar('Escolha a escola de destino (com número próprio conectado).'); return; }
    if (!confirm(`Copiar todos os modelos aprovados da agência para a conta do WhatsApp de ${filial}? Cada um entra em análise na Meta.`)) return;
    const btn = document.getElementById('modelosWppCopiar');
    btn.disabled = true; btn.textContent = 'Copiando...';
    const r = await chamarWhatsappModelos({ acao: 'copiar', filial });
    btn.disabled = false; btn.textContent = 'Copiar modelos da agência';
    if (!r) return;
    if (!r.ok) { avisar('Não deu: ' + r.erro); return; }
    const ok = r.resultado.filter(x => x.status).length, pul = r.resultado.filter(x => x.pulado).length, err = r.resultado.filter(x => x.erro);
    avisar(`${ok} modelo(s) enviado(s) para análise, ${pul} pulado(s)${err.length ? `, ${err.length} com erro: ${err.map(x => x.nome + ' (' + x.erro + ')').join('; ')}` : ''}.`);
    carregarModelosWhatsapp();
}

// ==========================================================
// CONTAS DE USUÁRIO — permissão por módulo (js/usuarios.js)
// ==========================================================
// Login nominal (ver js/acesso.js) + esta tela "Gerenciar Usuários" (só
// pra quem é admin) — cadastra voluntários/atendentes, escolhe quais
// módulos (abas da sidebar) cada um vê, reseta senha, ativa/desativa.
//
// Rótulos amigáveis dos módulos — mesmas chaves de ICONES_MODULO (js/app.js).
const MODULOS_CRM = [
    { id: 'tab-dashboard', label: 'Visão Geral / Dashboard' },
    { id: 'tab-crm', label: 'CRM e Prospecção (Kanban)' },
    { id: 'tab-agenda', label: 'Agenda de Eventos' },
    { id: 'tab-mapa-turmas', label: 'Mapa de Turmas' },
    { id: 'tab-whatsapp', label: 'WhatsApp Unificado' },
    { id: 'tab-relatorios', label: 'Relatórios' },
    { id: 'tab-leads-tratar', label: 'Leads a Tratar' },
    { id: 'tab-importar', label: 'Importar Planilhas' },
];

// ---------------------------------------------------------
// Aplica a permissão do usuário logado: mostra o nome/pill no topbar,
// esconde da sidebar qualquer módulo que ele não tenha, e garante que a
// aba aberta no momento seja uma permitida (senão pula pra 1ª liberada).
// Chamada assim que o login acontece (js/acesso.js) e no boot da página.
// ---------------------------------------------------------
function aplicarPermissoesModulosUsuario() {
    const usuario = typeof usuarioLogado === 'function' ? usuarioLogado() : null;
    const pill = document.getElementById('usuarioLogadoPill');
    const nomeSpan = document.getElementById('usuarioLogadoNome');
    const btnUsuarios = document.getElementById('btnGerenciarUsuarios');

    if (!usuario) {
        if (pill) pill.style.display = 'none';
        if (btnUsuarios) btnUsuarios.style.display = 'none';
        return;
    }

    if (pill) pill.style.display = 'flex';
    if (nomeSpan) nomeSpan.textContent = usuario.nome;
    if (btnUsuarios) btnUsuarios.style.display = usuario.ehAdmin ? 'inline-flex' : 'none';

    const modulosPermitidos = Array.isArray(usuario.modulos) ? usuario.modulos : [];
    let primeiroPermitido = null;
    document.querySelectorAll('.sidebar-icon[data-tab]').forEach(icone => {
        const tabId = icone.getAttribute('data-tab');
        const permitido = modulosPermitidos.includes(tabId);
        icone.style.display = permitido ? '' : 'none';
        if (permitido && !primeiroPermitido) primeiroPermitido = tabId;
    });

    // Se a aba ativa hoje não é permitida (ex: sessão antiga, ou permissão
    // mudou), pula pra primeira liberada — sem isso a pessoa ficaria
    // olhando pra uma tela vazia sem entender por quê.
    const abaAtiva = document.querySelector('.tab-pane.active');
    if (abaAtiva && !modulosPermitidos.includes(abaAtiva.id) && primeiroPermitido) {
        const icone = document.querySelector(`.sidebar-icon[data-tab="${primeiroPermitido}"]`);
        if (icone) icone.click();
    }
}

// ---------------------------------------------------------
// Tela "Gerenciar Usuários"
// ---------------------------------------------------------
let usuariosCrmCache = [];

async function abrirGerenciarUsuarios() {
    const usuario = usuarioLogado();
    if (!usuario || !usuario.ehAdmin) { alert('Só administradores gerenciam usuários.'); return; }
    document.getElementById('modalGerenciarUsuarios').classList.add('open');
    await carregarUsuariosCrm();
}
function fecharGerenciarUsuarios() {
    document.getElementById('modalGerenciarUsuarios').classList.remove('open');
}

async function carregarUsuariosCrm() {
    const { data, error } = await window.supabaseClient
        .from('usuarios_crm')
        .select('id, nome, modulos, eh_admin, ativo, criado_em')
        .order('criado_em');
    if (error) { alert('Erro ao carregar usuários: ' + error.message); return; }
    usuariosCrmCache = data || [];
    renderizarListaUsuariosCrm();
}

function renderizarListaUsuariosCrm() {
    const container = document.getElementById('listaUsuariosCrm');
    if (!container) return;
    if (usuariosCrmCache.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">Nenhum usuário cadastrado.</div>';
        return;
    }
    container.innerHTML = usuariosCrmCache.map(u => {
        const modulosSet = new Set(Array.isArray(u.modulos) ? u.modulos : []);
        const checkboxes = MODULOS_CRM.map(m => `
            <label style="display:flex; align-items:center; gap:5px; font-size:11px; font-weight:400;">
                <input type="checkbox" data-usuario="${u.id}" data-modulo="${m.id}" ${modulosSet.has(m.id) ? 'checked' : ''} onchange="salvarModulosUsuarioCrm('${u.id}')">
                ${m.label}
            </label>`).join('');
        return `
            <div style="border:1px solid var(--border-color); border-radius:8px; padding:12px; margin-bottom:10px; ${u.ativo ? '' : 'opacity:0.5;'}">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">
                    <strong>${escapeHTML(u.nome)}</strong>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <label style="font-size:11px; display:flex; align-items:center; gap:4px;"><input type="checkbox" ${u.eh_admin ? 'checked' : ''} onchange="alternarAdminUsuarioCrm('${u.id}', this.checked)"> Admin</label>
                        <label style="font-size:11px; display:flex; align-items:center; gap:4px;"><input type="checkbox" ${u.ativo ? 'checked' : ''} onchange="alternarAtivoUsuarioCrm('${u.id}', this.checked)"> Ativo</label>
                        <button class="btn-mini btn-secondary-mini" onclick="resetarSenhaUsuarioCrm('${u.id}')" title="Definir nova senha"><i class="fa-solid fa-key"></i></button>
                        <button class="btn-mini btn-secondary-mini" onclick="excluirUsuarioCrm('${u.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap:4px;">${checkboxes}</div>
            </div>`;
    }).join('');
}

async function salvarModulosUsuarioCrm(idUsuario) {
    const checks = document.querySelectorAll(`input[data-usuario="${idUsuario}"]`);
    const modulos = [...checks].filter(c => c.checked).map(c => c.getAttribute('data-modulo'));
    const { error } = await window.supabaseClient.from('usuarios_crm').update({ modulos }).eq('id', idUsuario);
    if (error) alert('Erro ao salvar módulos: ' + error.message);
    else {
        const u = usuariosCrmCache.find(u => u.id === idUsuario);
        if (u) u.modulos = modulos;
        // Se for o próprio usuário logado, reaplica na hora (sem precisar relogar).
        const logado = usuarioLogado();
        if (logado && logado.id === idUsuario) {
            logado.modulos = modulos;
            localStorage.setItem(CHAVE_USUARIO_LOGADO, JSON.stringify(logado));
            aplicarPermissoesModulosUsuario();
        }
    }
}

async function alternarAdminUsuarioCrm(idUsuario, valor) {
    const { error } = await window.supabaseClient.from('usuarios_crm').update({ eh_admin: valor }).eq('id', idUsuario);
    if (error) { alert('Erro: ' + error.message); return; }
    await carregarUsuariosCrm();
}
async function alternarAtivoUsuarioCrm(idUsuario, valor) {
    const { error } = await window.supabaseClient.from('usuarios_crm').update({ ativo: valor }).eq('id', idUsuario);
    if (error) { alert('Erro: ' + error.message); return; }
    await carregarUsuariosCrm();
}

async function resetarSenhaUsuarioCrm(idUsuario) {
    const nova = prompt('Nova senha pra este usuário:');
    if (!nova || !nova.trim()) return;
    const hash = await calcularHashSenha(nova.trim());
    const { error } = await window.supabaseClient.from('usuarios_crm').update({ senha_hash: hash }).eq('id', idUsuario);
    if (error) alert('Erro ao trocar senha: ' + error.message);
    else alert('Senha atualizada.');
}

async function excluirUsuarioCrm(idUsuario) {
    const u = usuariosCrmCache.find(u => u.id === idUsuario);
    if (!u) return;
    if (!confirm(`Excluir o usuário "${u.nome}"? Ele perde o acesso imediatamente.`)) return;
    const { error } = await window.supabaseClient.from('usuarios_crm').delete().eq('id', idUsuario);
    if (error) alert('Erro ao excluir: ' + error.message);
    else await carregarUsuariosCrm();
}

async function criarUsuarioCrm() {
    const nomeInput = document.getElementById('novoUsuarioNome');
    const senhaInput = document.getElementById('novoUsuarioSenha');
    const nome = nomeInput.value.trim();
    const senha = senhaInput.value.trim();
    if (!nome || !senha) { alert('Preencha nome e senha.'); return; }

    const hash = await calcularHashSenha(senha);
    const { error } = await window.supabaseClient.from('usuarios_crm').insert({
        nome, senha_hash: hash, modulos: ['tab-crm', 'tab-whatsapp'], eh_admin: false, ativo: true,
    });
    if (error) { alert('Erro ao criar usuário: ' + error.message); return; }
    nomeInput.value = '';
    senhaInput.value = '';
    await carregarUsuariosCrm();
}

document.addEventListener('DOMContentLoaded', () => {
    // Só aplica de cara se já tiver login salvo — se não tiver, quem
    // aplica é tentarAcesso() (js/acesso.js) depois do login.
    if (typeof usuarioLogado === 'function' && usuarioLogado()) aplicarPermissoesModulosUsuario();
});

// ==========================================================
// PORTÃO DE ACESSO — login NOMINAL (nome + senha), por usuário.
// ==========================================================
// Substituiu a senha única compartilhada pelo time (js/acesso.js
// original) — pedido do usuário: "implementar acessos por usuário ao
// sistema... para que eu possa escolher quais módulos cada usuário terá
// acesso, e no whatsapp precisa aparecer o nome do usuário que está
// logado". Ver tabela `usuarios_crm` (migracao_usuarios_crm.sql) e
// js/usuarios.js (tela "Gerenciar Usuários", só pra admins).
//
// MESMO MODELO DE SEGURANÇA de antes: NÃO é proteção contra um atacante
// técnico determinado (a chave publishable do Supabase já dá acesso
// total a quem tiver o código-fonte, com ou sem login) — é só dar
// identidade a cada atendente/voluntário e deixar visível quem fez o
// quê. A senha nunca fica em texto puro, só o hash SHA-256
// (usuarios_crm.senha_hash).
const CHAVE_USUARIO_LOGADO = 'crm_na_usuario_logado';

async function calcularHashSenha(texto) {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function usuarioLogado() {
    try {
        const bruto = localStorage.getItem(CHAVE_USUARIO_LOGADO);
        return bruto ? JSON.parse(bruto) : null;
    } catch { return null; }
}

function mostrarOverlayAcesso() {
    const overlay = document.getElementById('acessoOverlay');
    if (overlay) overlay.style.display = 'flex';
}
function esconderOverlayAcesso() {
    const overlay = document.getElementById('acessoOverlay');
    if (overlay) overlay.style.display = 'none';
}

async function tentarAcesso() {
    const nomeInput = document.getElementById('acessoNomeInput');
    const senhaInput = document.getElementById('acessoSenhaInput');
    const erro = document.getElementById('acessoErro');
    if (!nomeInput || !senhaInput) return;

    const nome = nomeInput.value.trim();
    if (!nome) { if (erro) { erro.textContent = 'Escolha seu nome.'; erro.style.display = 'block'; } return; }

    const { data: usuario, error } = await window.supabaseClient
        .from('usuarios_crm')
        .select('id, nome, senha_hash, modulos, eh_admin, ativo')
        .eq('nome', nome)
        .eq('ativo', true)
        .maybeSingle();

    const hashDigitado = await calcularHashSenha(senhaInput.value);
    if (error || !usuario || hashDigitado !== usuario.senha_hash) {
        if (erro) { erro.textContent = 'Nome ou senha incorretos.'; erro.style.display = 'block'; }
        senhaInput.value = '';
        senhaInput.focus();
        return;
    }

    localStorage.setItem(CHAVE_USUARIO_LOGADO, JSON.stringify({
        id: usuario.id, nome: usuario.nome, modulos: usuario.modulos || [], ehAdmin: !!usuario.eh_admin,
    }));
    esconderOverlayAcesso();
    if (typeof aplicarPermissoesModulosUsuario === 'function') aplicarPermissoesModulosUsuario();
}

function sairDoCrm() {
    if (!confirm('Sair do CRM?')) return;
    localStorage.removeItem(CHAVE_USUARIO_LOGADO);
    location.reload();
}

// Popula o <select> de nomes do overlay com os usuários ativos — evita
// digitar o nome exato (erro de digitação = "senha incorreta" confuso).
async function popularSeletorNomesAcesso() {
    const select = document.getElementById('acessoNomeInput');
    if (!select) return;
    const { data, error } = await window.supabaseClient
        .from('usuarios_crm')
        .select('nome')
        .eq('ativo', true)
        .order('nome');
    if (error || !data || data.length === 0) {
        select.innerHTML = '<option value="">Nenhum usuário cadastrado ainda</option>';
        return;
    }
    select.innerHTML = '<option value="">Selecione seu nome...</option>' +
        data.map(u => `<option value="${u.nome.replace(/"/g, '&quot;')}">${u.nome}</option>`).join('');
}

// Roda antes de qualquer outro script depender do DOM — só CHECA e
// eventualmente mostra o overlay; não bloqueia o carregamento dos outros
// scripts (eles continuam rodando por baixo, mas o overlay cobre a tela
// inteira até o login ser feito).
document.addEventListener('DOMContentLoaded', () => {
    popularSeletorNomesAcesso();
    if (usuarioLogado()) return;
    mostrarOverlayAcesso();
    const senhaInput = document.getElementById('acessoSenhaInput');
    if (senhaInput) senhaInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tentarAcesso(); });
});

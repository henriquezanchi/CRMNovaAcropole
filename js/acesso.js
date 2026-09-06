// ==========================================================
// PORTÃO DE ACESSO — senha única compartilhada pelo time.
// ==========================================================
// NÃO é um sistema de login de verdade (sem usuários individuais, sem
// registro de quem entrou) — o objetivo é só impedir que alguém que ache
// o link do CRM por acaso (agora que ele está publicado numa URL pública,
// não só local) consiga abrir direto. Um visitante com conhecimento
// técnico ainda consegue contornar isso lendo o código-fonte (a chave
// publishable do Supabase já fica visível de qualquer forma, com ou sem
// esse portão) — não é proteção contra um atacante determinado, é só
// "manter gente honesta honesta".
//
// A senha certa nunca fica em texto puro no código — só o HASH SHA-256
// dela (SENHA_ACESSO_HASH abaixo). Pra trocar a senha, gere o hash da
// nova senha colando isto no console do navegador (F12):
//
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('SUA_SENHA_AQUI'))
//     .then(buf => console.log(Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')));
//
// e cole o resultado na constante abaixo.
const SENHA_ACESSO_HASH = 'TROCAR_ESTE_HASH_AQUI'; // ver instrução acima

const CHAVE_ACESSO_LIBERADO = 'crm_na_acesso_liberado';

async function calcularHashSenha(texto) {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
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
    const input = document.getElementById('acessoSenhaInput');
    const erro = document.getElementById('acessoErro');
    if (!input) return;

    const hashDigitado = await calcularHashSenha(input.value);
    if (hashDigitado === SENHA_ACESSO_HASH) {
        localStorage.setItem(CHAVE_ACESSO_LIBERADO, '1');
        esconderOverlayAcesso();
    } else {
        if (erro) erro.style.display = 'block';
        input.value = '';
        input.focus();
    }
}

// Roda antes de qualquer outro script depender do DOM — só CHECA e
// eventualmente mostra o overlay; não bloqueia o carregamento dos outros
// scripts (eles continuam rodando por baixo, mas o overlay cobre a tela
// inteira até a senha certa ser digitada).
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem(CHAVE_ACESSO_LIBERADO) === '1') return;
    if (SENHA_ACESSO_HASH === 'TROCAR_ESTE_HASH_AQUI') {
        console.warn('js/acesso.js: SENHA_ACESSO_HASH ainda não foi configurado — o portão de acesso está desativado (qualquer um entra). Veja as instruções no topo do arquivo.');
        return;
    }
    mostrarOverlayAcesso();
    const input = document.getElementById('acessoSenhaInput');
    if (input) {
        input.focus();
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tentarAcesso(); });
    }
});

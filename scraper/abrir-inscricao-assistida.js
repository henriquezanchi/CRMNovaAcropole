// Abre um Chromium VISÍVEL, direto na página pública de inscrição de um
// evento do Ulisses — pedido do usuário (2026-09-28, reunião com a
// Ediliene): "podemos retomar a ideia de que o próprio crm fará as
// inscrições... nem que eu tenha que acionar um botão manualmente, para
// abrir o navegador e a partir daí o crm começar a preencher os dados".
//
// Etapa 1 de 2 (a que dá pra construir SEM risco): só NAVEGA até a URL
// certa — zero seletor novo, então não depende de nenhum HTML ainda não
// confirmado. Preenchimento automático dos campos (nome/telefone/e-mail)
// é a Etapa 2, e SÓ pode ser escrita depois que o HTML real do
// formulário de inscrição (inscricao.acropolebrasil.com.br) for
// confirmado — CLAUDE.md, seção "Inscrição assistida no Ulisses": nunca
// escrever seletor "no chute" neste projeto. Enquanto isso, o SDR já tem
// os dados na área de transferência (copiarDadosInscreverEvento(),
// js/eventos.js, chamado ANTES de navegar pra este protocolo) e só
// precisa colar.
//
// Acionado pelo botão "Abrir e Preparar Inscrição" (js/eventos.js,
// modal #modalInscreverEvento) via protocolo customizado
// `abririnscricao://rodar?url=...` — MESMO mecanismo já registrado no
// Windows pra `abrirulisses://`/`abrirulissesapi://` (ver CLAUDE.md,
// "'Botão' de acionar o Ulisses"). Registro ainda PENDENTE nesta sessão
// (só o código; o `HKCU\Software\Classes\abririnscricao` no Windows
// precisa ser criado antes do botão funcionar de verdade) — mesmo
// padrão exato de registro do `abrirulissesapi://`: apontar DIRETO pro
// node.exe, nunca por um `.bat`/`cmd.exe` no meio (isso corrompe a
// querystring codificada — `%20`/`%C3` etc. — já documentado como bug
// real achado antes).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

process.chdir(path.dirname(fileURLToPath(import.meta.url)));

const argRaw = process.argv[2];
let urlDestino = null;
if (argRaw && argRaw.startsWith('abririnscricao://')) {
    try { urlDestino = new URL(argRaw).searchParams.get('url'); } catch { /* URL malformada — trata como ausente abaixo */ }
} else {
    // Também aceita passar a URL direto (uso manual/teste, sem protocolo):
    // node abrir-inscricao-assistida.js "https://inscricao.acropolebrasil.com.br/?eventoId=..."
    urlDestino = argRaw || null;
}

if (!urlDestino) {
    console.error('Uso: node abrir-inscricao-assistida.js "<url de inscrição>"\nOu via protocolo: abririnscricao://rodar?url=<url codificada>');
    process.exit(1);
}

console.log('Abrindo:', urlDestino);
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto(urlDestino, { waitUntil: 'domcontentloaded' });
console.log('Página aberta — cole os dados (já copiados pelo CRM) e conclua a inscrição manualmente. Esta janela fica aberta até você fechar.');
// Nunca fecha o browser sozinho — o SDR trabalha nesta janela até
// terminar; fechar cedo demais interromperia o preenchimento manual.

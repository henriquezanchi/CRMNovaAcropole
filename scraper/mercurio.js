// Scraper do Mercúrio (mercurio.oinabn.com.br) — MARCO 1: só login. Uma
// senha só cobre todas as filiais que o usuário tem acesso (visto no
// print: "Funções do Sistema Autorizadas para <matrícula> - <nome>",
// listando várias filiais na mesma tela) — por isso é lida com
// filial='GLOBAL' (ver migracao_credenciais_scraper.sql).
//
// Formulário simples (Matrícula + Senha), sem framework — mas é um site
// antigo (PHP puro, a julgar pela URL pós-login "ger_frame.php") onde o
// texto do rótulo pode NÃO estar associado ao campo via <label for="...">
// de verdade (comum em tabelas HTML antigas) — por isso cada campo tenta
// getByLabel() primeiro e cai num seletor mais genérico se não achar,
// em vez de travar direto no primeiro try.
//
// Ainda NÃO SEI onde fica o export de Ativos/Inativos dentro do menu
// (provavelmente em "CADASTRO" de cada filial) — ver TODO no fim.
import { chromium } from 'playwright';
import { lerCredencial, registrarStatusSincronizacao } from './lib/supabaseAdmin.js';
import fs from 'node:fs';

const URL_LOGIN = 'https://mercurio.oinabn.com.br/';

async function preencherComFallback(page, getByLabelRegex, seletorFallback, valor) {
    try {
        const campo = page.getByLabel(getByLabelRegex);
        await campo.waitFor({ timeout: 3000 });
        await campo.fill(valor);
        return;
    } catch {
        // Rótulo não associado de verdade ao input (comum em tabela HTML
        // antiga) — usa o seletor de fallback.
        await page.locator(seletorFallback).first().fill(valor);
    }
}

async function loginMercurio(page, matricula, senha) {
    await page.goto(URL_LOGIN, { waitUntil: 'networkidle' });

    await preencherComFallback(page, /matr[ií]cula/i, 'input[type="text"]', matricula);
    await preencherComFallback(page, /senha/i, 'input[type="password"]', senha);

    try {
        await page.getByRole('button', { name: /entrar/i }).click();
    } catch {
        await page.getByText('Entrar', { exact: false }).click();
    }

    await page.waitForURL(/ger_frame\.php/, { timeout: 20000 });
}

async function main() {
    const page = await (await chromium.launch()).newPage();
    try {
        const { usuario, senha } = await lerCredencial('mercurio', null);
        // "usuario" aqui é a matrícula, se foi salva; senão usa a senha só
        // (ajuste conforme o que de fato foi cadastrado em "Login Automático").
        await loginMercurio(page, usuario, senha);

        console.log('[mercurio] Login OK');
        await registrarStatusSincronizacao('mercurio', null, true, 'Login confirmado (marco 1 — export ainda não implementado).');

        // TODO (marco 2): navegar até "CADASTRO" de cada filial e achar
        // onde exportar Ativos/Inativos — precisa de mais um print/
        // descrição de dentro dessa tela pra escrever certo.
    } catch (e) {
        console.error('[mercurio] Falha:', e.message);
        fs.mkdirSync('scraper/debug', { recursive: true });
        await page.screenshot({ path: 'scraper/debug/mercurio.png', fullPage: true }).catch(() => {});
        await registrarStatusSincronizacao('mercurio', null, false, e.message);
        process.exitCode = 1;
    } finally {
        await page.context().browser().close();
    }
}

main();

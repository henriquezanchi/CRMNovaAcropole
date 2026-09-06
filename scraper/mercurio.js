// Scraper do Mercúrio (mercurio.oinabn.com.br) — MARCO 1: só login. Uma
// senha só cobre todas as filiais que o usuário tem acesso (visto no
// print: "Funções do Sistema Autorizadas para <matrícula> - <nome>",
// listando várias filiais na mesma tela) — por isso é lida com
// filial='GLOBAL' (ver migracao_credenciais_scraper.sql).
//
// DUAS camadas de autenticação, descobertas testando de verdade:
//   1. Autenticação HTTP básica do navegador (pop-up cinza nativo) — uma
//      credencial ÚNICA compartilhada por TODOS os usuários, que muda 1x
//      por ano. Fica salva no navegador de quem usa no dia a dia, por
//      isso passa despercebida — mas o Playwright (sessão nova, sem nada
//      salvo) precisa dela. Guardada como sistema='mercurio_http'
//      (migracao_credenciais_scraper_mercurio_http.sql).
//   2. A tela de Matrícula + Senha em si (formulário simples, PHP puro).
//
// Formulário da camada 2 é antigo — o texto do rótulo pode NÃO estar
// associado ao campo via <label for="..."> de verdade (comum em tabela
// HTML antiga) — por isso cada campo tenta getByLabel() primeiro e cai
// num seletor mais genérico se não achar.
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
    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });

    // O campo de Matrícula não tem type="text" explícito no HTML (comum
    // em site antigo — "texto" é o padrão do navegador quando não se
    // declara) — confirmado no primeiro teste real (o seletor exato
    // input[type="text"] não achava nada e travava esperando 30s). Este
    // seletor pega qualquer input que NÃO seja senha/oculto/botão/
    // checkbox, o que cobre tanto "type ausente" quanto "type="text"".
    const SELETOR_CAMPO_TEXTO = 'input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"])';
    await preencherComFallback(page, /matr[ií]cula/i, SELETOR_CAMPO_TEXTO, matricula);
    await preencherComFallback(page, /senha/i, 'input[type="password"]', senha);

    try {
        await page.getByRole('button', { name: /entrar/i }).click();
    } catch {
        await page.getByText('Entrar', { exact: false }).click();
    }

    await page.waitForURL(/ger_frame\.php/, { timeout: 20000 });
}

async function main() {
    let browser;
    try {
        const httpAuth = await lerCredencial('mercurio_http', null);
        const { usuario: matricula, senha } = await lerCredencial('mercurio', null);

        browser = await chromium.launch();
        const context = await browser.newContext({
            httpCredentials: { username: httpAuth.usuario, password: httpAuth.senha },
        });
        const page = await context.newPage();

        await loginMercurio(page, matricula, senha);

        console.log('[mercurio] Login OK');
        await registrarStatusSincronizacao('mercurio', null, true, 'Login confirmado (marco 1 — export ainda não implementado).');

        // TODO (marco 2): navegar até "CADASTRO" de cada filial e achar
        // onde exportar Ativos/Inativos — precisa de mais um print/
        // descrição de dentro dessa tela pra escrever certo.
        await browser.close();
    } catch (e) {
        console.error('[mercurio] Falha:', e.message);
        try {
            fs.mkdirSync('debug', { recursive: true });
            const pages = browser ? browser.contexts().flatMap(c => c.pages()) : [];
            if (pages[0]) await pages[0].screenshot({ path: 'debug/mercurio.png', fullPage: true }).catch(() => {});
        } catch { /* melhor esforço — não deixa o print quebrar o registro do erro */ }
        await registrarStatusSincronizacao('mercurio', null, false, e.message);
        if (browser) await browser.close();
        process.exitCode = 1;
    }
}

main();

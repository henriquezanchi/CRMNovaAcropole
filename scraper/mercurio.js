// Scraper do Mercúrio (mercurio.oinabn.com.br) — MARCO 2: login + exportar
// Ativos e Inativos de cada filial (CSVs no mesmo formato que o
// importador manual já espera — Matr/Nome/Nivel/Dia/Turma pra Ativos,
// Nome/Telefones/Ni/Data/Motivo pra Inativos). Mapeado só com PRINTS de
// tela reais (sem HTML), então tem boa chance de precisar de ajuste no
// primeiro teste — ver comentários de cada função.
//
// DUAS camadas de autenticação, descobertas testando de verdade:
//   1. Autenticação HTTP básica do navegador (pop-up cinza nativo) — uma
//      credencial ÚNICA compartilhada por TODOS os usuários, que muda 1x
//      por ano. Guardada como sistema='mercurio_http'
//      (migracao_credenciais_scraper_mercurio_http.sql).
//   2. A tela de Matrícula + Senha em si (formulário simples, PHP puro).
//
// Navegação pós-login: "Funções do Sistema" (ger_frame.php) lista um link
// "CADASTRO" por filial — 1 login cobre várias filiais de uma vez (visto
// no print: a tela lista várias colunas de filial pra mesma matrícula).
// Dentro de "CADASTRO" (uni_frame.php), um menu lateral tem "Ativos" e
// "Inativos". O nome "uni_FRAME.php" sugere que pode ser um <frameset>
// clássico (comum em sites desse período) — por isso as buscas abaixo
// tentam a página principal E qualquer frame filho antes de desistir.
import { chromium } from 'playwright';
import { lerCredencial, registrarStatusSincronizacao } from './lib/supabaseAdmin.js';
import fs from 'node:fs';

const URL_LOGIN = 'https://mercurio.oinabn.com.br/';
const URL_FUNCOES = 'https://mercurio.oinabn.com.br/ger_frame.php';
const PASTA_EXPORTS = 'exports';

async function preencherComFallback(contexto, getByLabelRegex, seletorFallback, valor) {
    try {
        const campo = contexto.getByLabel(getByLabelRegex);
        await campo.waitFor({ timeout: 3000 });
        await campo.fill(valor);
        return;
    } catch {
        // Rótulo não associado de verdade ao input (comum em tabela HTML
        // antiga) — usa o seletor de fallback.
        await contexto.locator(seletorFallback).first().fill(valor);
    }
}

async function loginMercurio(page, matricula, senha) {
    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });

    // Confirmado por print real: o form de Matrícula/Senha carrega e
    // aparece normalmente na tela — mas `page.locator()` procura só no
    // frame principal por padrão, e esse site usa frameset clássico em
    // TODAS as outras telas (ger_frame.php, uni_frame.php); é bem provável
    // que o login em si também seja servido dentro de um frame filho, daí
    // o timeout de 30s procurando o campo sem nunca achar. Localiza o
    // contexto certo (página principal OU frame filho) antes de preencher.
    const ctx = await acharContextoComTexto(page, 'Matr', 15000);

    // O campo de Matrícula não tem type="text" explícito no HTML (comum
    // em site antigo — "texto" é o padrão do navegador quando não se
    // declara) — confirmado no primeiro teste real (o seletor exato
    // input[type="text"] não achava nada e travava esperando 30s). Este
    // seletor pega qualquer input que NÃO seja senha/oculto/botão/
    // checkbox, o que cobre tanto "type ausente" quanto "type="text"".
    const SELETOR_CAMPO_TEXTO = 'input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"])';
    await preencherComFallback(ctx, /matr[ií]cula/i, SELETOR_CAMPO_TEXTO, matricula);
    await preencherComFallback(ctx, /senha/i, 'input[type="password"]', senha);

    try {
        await ctx.getByRole('button', { name: /entrar/i }).click();
    } catch {
        await ctx.getByText('Entrar', { exact: false }).click();
    }

    await page.waitForURL(/ger_frame\.php/, { timeout: 20000 });
}

// Acha o texto num contexto que pode ser a página principal OU um dos
// frames filhos (site antigo, "uni_frame.php" sugere <frameset> clássico)
// — devolve o contexto certo (page ou Frame) pra continuar procurando
// dentro dele, em vez de presumir qual é. Só usada pro LOGIN em si, onde
// ainda não dá pra contar com nome de frame nenhum — a partir do login,
// ver esperarFrame() abaixo (mais confiável: os frames pós-login têm
// nome fixo, confirmado ao vivo).
async function acharContextoComTexto(page, textoAlvo, timeoutMs = 10000) {
    const fim = Date.now() + timeoutMs;
    while (Date.now() < fim) {
        if (await page.getByText(textoAlvo, { exact: false }).count() > 0) return page;
        for (const frame of page.frames()) {
            if (frame === page.mainFrame()) continue;
            try {
                if (await frame.getByText(textoAlvo, { exact: false }).count() > 0) return frame;
            } catch { /* frame pode ter sido destruído entre a checagem e o uso — ignora e tenta o próximo */ }
        }
        await page.waitForTimeout(300);
    }
    throw new Error(`Não encontrei "${textoAlvo}" nem na página principal nem em nenhum frame filho (timeout ${timeoutMs}ms).`);
}

// Espera um frame FILHO com o `nome` dado (atributo name="..." do
// <frame>) existir e já ter navegado pra uma URL que bate com `regexUrl`
// — confirmado ao vivo (Playwright DevTools) que o site usa nomes fixos
// de frame em TODAS as telas pós-login: "cabecalho" (topo), "principal"
// (conteúdo — é onde ficam os links "CADASTRO" logo após o login, e
// depois as telas de Ativos/Inativos) e, dentro de uma filial (depois de
// clicar CADASTRO), também "indice" (o menu lateral com "Ativos"/
// "Inativos"). Bem mais confiável que procurar por texto (que já causou
// bug real: "Turma" batia tanto na tabela de Ativos quanto no item de
// menu "Turmas" do próprio menu lateral, sempre presente, fazendo o
// código pensar que já estava na tela certa antes de realmente estar).
async function esperarFrame(page, nome, regexUrl, timeoutMs = 10000) {
    const fim = Date.now() + timeoutMs;
    while (Date.now() < fim) {
        const frame = page.frame({ name: nome });
        if (frame && regexUrl.test(frame.url())) return frame;
        await page.waitForTimeout(200);
    }
    throw new Error(`Frame "${nome}" não chegou numa URL batendo com ${regexUrl} a tempo (timeout ${timeoutMs}ms).`);
}

// Lê a PRIMEIRA <table> cujo cabeçalho contenha todas as colunas
// esperadas (case-insensitive) — evita precisar de um seletor exato pra
// tabela certa numa página que pode ter várias. Devolve um array de
// arrays (célula por célula, na ordem visual), pulando a linha de
// cabeçalho.
async function lerTabelaPorCabecalho(contexto, colunasEsperadas) {
    const tabelas = contexto.locator('table');
    const total = await tabelas.count();
    for (let i = 0; i < total; i++) {
        const tabela = tabelas.nth(i);
        const textoCabecalho = (await tabela.locator('tr').first().innerText().catch(() => '')).toLowerCase();
        const bate = colunasEsperadas.every(c => textoCabecalho.includes(c.toLowerCase()));
        if (!bate) continue;

        const linhas = tabela.locator('tr');
        const totalLinhas = await linhas.count();
        const registros = [];
        for (let j = 1; j < totalLinhas; j++) { // pula o cabeçalho
            const celulas = await linhas.nth(j).locator('td, th').allInnerTexts();
            if (celulas.length === 0) continue;
            registros.push(celulas.map(c => c.trim()));
        }
        return registros;
    }
    throw new Error(`Nenhuma tabela encontrada com as colunas: ${colunasEsperadas.join(', ')}`);
}

function paraCSV(cabecalhos, linhas) {
    const escapar = (v) => {
        const s = String(v ?? '');
        return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cabecalhos, ...linhas].map(l => l.map(escapar).join(';')).join('\r\n');
}

// Encontra cada link "CADASTRO" (1 por filial) dentro do frame
// "principal" (confirmado ao vivo — ver esperarFrame()) e identifica de
// qual filial é subindo até a <table class="menu"> que envolve o link (1
// tabela por filial no HTML real) e lendo o <a class="menu_tit"> dela —
// o cabeçalho da tabela com o NOME da filial (ex: "GOIÂNIA UNIVERSITARIO:
// BARRA DO GARÇAS"), um elemento IRMÃO do link "CADASTRO", não ancestral
// dele. **Bug real corrigido**: a versão anterior subia só 1 <td> (o da
// própria célula do link "CADASTRO"), então o "nome da filial" lido era
// sempre a palavra "CADASTRO" de novo — confirmado no 1º teste real (as
// 4 filiais saíram todas rotuladas "CADASTRO"). Se não conseguir
// identificar, usa um rótulo genérico (filial_N) em vez de travar tudo.
async function listarLinksCadastro(page) {
    const framePrincipal = await esperarFrame(page, 'principal', /ger_funcao\.php/, 15000);
    const links = framePrincipal.getByRole('link', { name: 'CADASTRO', exact: true });
    const total = await links.count();
    const resultado = [];
    for (let i = 0; i < total; i++) {
        let label = `filial_${i + 1}`;
        try {
            const tabelaMenu = links.nth(i).locator('xpath=ancestor::table[contains(concat(" ", normalize-space(@class), " "), " menu ")][1]');
            const texto = (await tabelaMenu.locator('a.menu_tit').first().innerText()).replace(/\s+/g, ' ').trim();
            if (texto) label = texto;
        } catch { /* mantém o rótulo genérico */ }
        resultado.push({ label, indice: i });
    }
    return resultado;
}

// Exporta Ativos + Inativos de UMA filial — assume que a página já está
// na tela "Funções do Sistema" (ger_frame.php) com os links "CADASTRO"
// disponíveis, e que `indice` é a posição do link daquela filial entre
// TODOS os links "CADASTRO" da página (estável entre reloads, desde que
// a lista de filiais não mude no meio da execução).
//
// Navegação mapeada ao vivo (Playwright, sessão real — não é mais só
// PRINT): clicar num link "CADASTRO" (dentro do frame "principal")
// navega a página INTEIRA pra um novo frameset, "unidade/uni_frame.php",
// com 2 frames novos: "indice" (menu lateral — Ativos/Inativos/etc) e
// "principal" de novo, agora mostrando uma tela de contato por padrão.
// Clicar "Ativos"/"Inativos" no frame "indice" só troca o `src` do frame
// "principal" (o frameset em si não muda de novo) — por isso não precisa
// re-navegar pro "indice", só esperar o "principal" chegar na URL certa
// a cada passo. **Bug real corrigido**: a versão anterior procurava a
// tabela de Ativos usando "Turma" como texto-âncora — mas "Turma(s)" TAMBÉM
// aparece no menu lateral (item "Turmas", sempre visível), então o código
// achava a tabela antes mesmo da navegação de verdade acontecer, caindo
// sempre na tela de contato padrão em vez da tabela (confirmado no 1º
// teste real: erro "Nenhuma tabela encontrada" com o print mostrando a
// tela "CONTATOS, SUPORTE E ORIENTAÇÕES..."). Agora usa o NOME do frame
// (estável, visto ao vivo), não mais texto.
async function exportarAtivosEInativos(page, label, indice) {
    const framePrincipal1 = await esperarFrame(page, 'principal', /ger_funcao\.php/, 15000);
    await framePrincipal1.getByRole('link', { name: 'CADASTRO', exact: true }).nth(indice).click();

    const frameIndice = await esperarFrame(page, 'indice', /uni_indice\.php/, 15000);

    // ATIVOS — colunas na tela: N., Matr., Nome, Nivel, Dia, Turma, Funções
    await frameIndice.getByText('Ativos', { exact: true }).click();
    const framePrincipalAtivos = await esperarFrame(page, 'principal', /uni_newati\.php/, 15000);
    const linhasAtivos = await lerTabelaPorCabecalho(framePrincipalAtivos, ['Nome', 'Nivel']);
    const registrosAtivos = linhasAtivos.map(cel => [cel[1] || '', cel[2] || '', cel[3] || '', cel[4] || '', cel[5] || '']); // Matr, Nome, Nivel, Dia, Turma

    // INATIVOS — colunas na tela: Nome, Telefones, Ni, Data, Motivo. Por
    // padrão a tela só mostra os "RECENTES" (bem poucas linhas) — tem um
    // <select name="cmbData"> com opção "TODOS" que traz o histórico
    // completo (confirmado ao vivo + pelo usuário); escolher a opção já
    // resubmete o formulário sozinho (onchange="this.form.submit()").
    await frameIndice.getByText('Inativos', { exact: true }).click();
    const framePrincipalInativos = await esperarFrame(page, 'principal', /uni_cadlis\.php/, 15000);
    const seletorData = framePrincipalInativos.locator('select[name="cmbData"]');
    if (await seletorData.count() > 0) {
        await seletorData.selectOption({ label: 'TODOS' });
        // Sem indicador de carregamento claro (mesmo padrão já aceito em
        // exportarComparecimento() do Ulisses) — espera curta e fixa.
        await page.waitForTimeout(1200);
    }
    const linhasInativos = await lerTabelaPorCabecalho(framePrincipalInativos, ['Nome', 'Telefones']);
    const registrosInativos = linhasInativos.map(cel => [cel[0] || '', cel[1] || '', cel[2] || '', cel[3] || '', cel[4] || '']); // Nome, Telefones, Ni, Data, Motivo

    fs.mkdirSync(PASTA_EXPORTS, { recursive: true });
    const slug = label.replace(/[^a-z0-9]/gi, '_');
    const caminhoAtivos = `${PASTA_EXPORTS}/mercurio-ativos-${slug}.csv`;
    const caminhoInativos = `${PASTA_EXPORTS}/mercurio-inativos-${slug}.csv`;
    // ISO-8859-1 (latin1), mesmo encoding que a exportação manual do
    // Excel já usa — o importador (js/importador.js) já espera isso.
    fs.writeFileSync(caminhoAtivos, paraCSV(['Matr', 'Nome', 'Nivel', 'Dia', 'Turma'], registrosAtivos), 'latin1');
    fs.writeFileSync(caminhoInativos, paraCSV(['Nome', 'Telefones', 'Ni', 'Data', 'Motivo'], registrosInativos), 'latin1');
    return { caminhoAtivos, caminhoInativos };
}

async function main() {
    let browser;
    let page;
    try {
        const httpAuth = await lerCredencial('mercurio_http', null);
        const { usuario: matricula, senha } = await lerCredencial('mercurio', null);

        browser = await chromium.launch();
        const context = await browser.newContext({
            httpCredentials: { username: httpAuth.usuario, password: httpAuth.senha },
        });
        page = await context.newPage();

        await loginMercurio(page, matricula, senha);
        console.log('[mercurio] Login OK');

        const cadastros = await listarLinksCadastro(page);
        if (cadastros.length === 0) throw new Error('Nenhum link "CADASTRO" encontrado na tela pós-login — layout pode ter mudado.');
        console.log(`[mercurio] ${cadastros.length} filial(is) encontrada(s): ${cadastros.map(c => c.label).join(', ')}`);

        let algumaFalha = false;
        for (const { label, indice } of cadastros) {
            try {
                const { caminhoAtivos, caminhoInativos } = await exportarAtivosEInativos(page, label, indice);
                console.log(`[mercurio] Ativos/Inativos exportados — ${label}: ${caminhoAtivos}, ${caminhoInativos}`);
            } catch (e) {
                algumaFalha = true;
                console.error(`[mercurio] Falha ao exportar Ativos/Inativos de "${label}":`, e.message);
                fs.mkdirSync('debug', { recursive: true });
                await page.screenshot({ path: `debug/mercurio-${label.replace(/[^a-z0-9]/gi, '_')}.png`, fullPage: true }).catch(() => {});
            }
            // Volta pra tela de funções antes da próxima filial, com ou
            // sem erro — senão a próxima iteração começa num lugar errado.
            await page.goto(URL_FUNCOES, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }

        await registrarStatusSincronizacao('mercurio', null, !algumaFalha, algumaFalha
            ? 'Login OK, mas 1+ exportação de Ativos/Inativos falhou — ver logs e prints do workflow.'
            : `Login + exportação de Ativos/Inativos OK para ${cadastros.length} filial(is) (marco 2 — ainda não alimenta o CRM automaticamente).`);
    } catch (e) {
        console.error('[mercurio] Falha:', e.message);
        try {
            fs.mkdirSync('debug', { recursive: true });
            if (page) await page.screenshot({ path: 'debug/mercurio.png', fullPage: true }).catch(() => {});
        } catch { /* melhor esforço — não deixa o print quebrar o registro do erro */ }
        await registrarStatusSincronizacao('mercurio', null, false, e.message);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
    }
}

main();

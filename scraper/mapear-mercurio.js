// Mapeamento exploratório do Mercúrio — pedido do usuário (2026-10-08):
// a equipe do Mercúrio (professor JG) topou liberar uma "view" (sempre
// atualizada, automática) pra nós, MAS pediu que a gente diga exatamente
// quais dados precisa, pra não gerar trabalho excessivo numa extração
// que pode não ser útil ("O cadastro completo é muito amplo e está
// distribuído em diversas tabelas do bd relacional").
//
// Este script NÃO faz parte do job diário (nunca é chamado por main()
// de mercurio.js, nunca roda sozinho) — é uma ferramenta de RECONHECIMENTO,
// rodada manualmente 1 vez (ou poucas), pra inventariar a ESTRUTURA (nomes
// de tabela/coluna/campo, NUNCA dado de aluno em si — nenhuma linha de
// dado real é lida além do cabeçalho) de TODA a área que aparecer no menu
// pós-login de 1 filial (CADASTRO, TESOURARIA, e qualquer outra que
// existir, sem supor nome nenhum de antemão).
//
// Por que só 1 filial: a ESTRUTURA (schema) é a mesma pra todas — é
// questão de sistema, não de dado específico de cada unidade. Mapear
// várias só repetiria o mesmo inventário à toa (o oposto do que o
// professor JG pediu).
//
// ⚠️ NUNCA rode isto enquanto o job diário/disparo manual do Mercúrio
// ainda estiver em andamento — usa a MESMA credencial compartilhada
// (Matrícula+Senha), e 2 sessões simultâneas já causaram colisão real de
// dado entre filiais (ver CLAUDE.md, "Bug real GRAVÍSSIMO"). O script
// confere isso sozinho antes de logar (verificarRodadaJaEmAndamento()),
// e aborta com um aviso claro se encontrar uma rodada ativa — mas também
// vale conferir "Sincronização Automática" na aba Importar do CRM antes.
//
// Uso: dentro de C:\Scrapper\scraper (ou onde este script estiver
// rodando de verdade — Playwright não roda de forma confiável no drive
// G:\, ver CLAUDE.md):
//   node mapear-mercurio.js                 -> mapeia a 1ª filial da lista
//   node mapear-mercurio.js "Jardim América" -> mapeia uma filial específica
import { chromium } from 'playwright';
import { lerCredencial } from './lib/supabaseAdmin.js';
import {
    loginMercurio,
    esperarFrame,
    listarTodosLinksPorFilial,
    verificarRodadaJaEmAndamento,
    URL_FUNCOES,
} from './mercurio.js';
import fs from 'node:fs';

const PASTA_EXPORTS = 'exports';
const FILIAL_ALVO = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;

// Lê SÓ estrutura de uma tela: cabeçalho (1ª linha) de toda <table> com
// 2+ colunas (ignora tabela de layout, quase sempre 1 coluna só) + nome/
// tipo de todo campo de formulário (<input>/<select>/<textarea> com
// atributo `name`). NUNCA lê uma 2ª linha de tabela nenhuma — não
// precisamos (e não queremos) puxar dado de aluno nenhum aqui, só saber
// QUE CAMPOS existem.
async function inventariarTela(contexto) {
    const resultado = { tabelas: [], campos: [] };
    try {
        const tabelas = contexto.locator('table');
        const totalTabelas = await tabelas.count();
        for (let i = 0; i < totalTabelas; i++) {
            const cab = (await tabelas.nth(i).locator('tr').first().locator('td, th').allInnerTexts().catch(() => []))
                .map(c => c.replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            if (cab.length > 1) resultado.tabelas.push(cab);
        }
    } catch { /* best-effort — tela sem tabela nenhuma é um resultado válido */ }
    try {
        const campos = contexto.locator('input[name], select[name], textarea[name]');
        const total = await campos.count();
        const vistos = new Set();
        for (let i = 0; i < total; i++) {
            const nome = await campos.nth(i).getAttribute('name').catch(() => null);
            if (!nome || vistos.has(nome)) continue;
            vistos.add(nome);
            const tipo = (await campos.nth(i).getAttribute('type').catch(() => null)) || 'texto/select';
            resultado.campos.push({ nome, tipo });
        }
    } catch { /* best-effort */ }
    return resultado;
}

// Explora 1 área do menu (ex: "CADASTRO"/"TESOURARIA") — já clicada antes
// de chamar esta função. Tenta o padrão conhecido (frame "indice" com
// submenu lateral, mesmo de CADASTRO); se essa área tiver uma estrutura
// diferente (sem frame "indice" reconhecido), cai num fallback genérico
// que inventaria TODOS os frames da página atual, sem supor nome nenhum.
async function mapearArea(page, nomeArea) {
    console.log(`\n=== Área: "${nomeArea}" ===`);
    const mapa = { area: nomeArea, submenus: [] };

    let frameIndice = null;
    try { frameIndice = await esperarFrame(page, 'indice', /.?/, 6000); } catch { /* nem toda área tem submenu lateral com esse nome */ }

    if (frameIndice) {
        const itensMenu = [...new Set((await frameIndice.locator('a').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean))];
        console.log(`  ${itensMenu.length} item(ns) de submenu (frame "indice"): ${itensMenu.join(', ') || '(nenhum)'}`);
        for (const item of itensMenu) {
            try {
                await frameIndice.getByText(item, { exact: true }).first().click();
                await page.waitForTimeout(800); // sem indicador de carregamento confiável — espera curta e fixa, mesmo padrão do resto do scraper
                const framePrincipal = page.frame({ name: 'principal' }) || frameIndice;
                const dados = await inventariarTela(framePrincipal);
                mapa.submenus.push({ item, ...dados });
                console.log(`  - "${item}": ${dados.tabelas.length} tabela(s), ${dados.campos.length} campo(s) de formulário`);
            } catch (e) {
                console.warn(`  [mapear] Falha no item "${item}":`, e.message);
            }
        }
        return mapa;
    }

    console.log('  Sem frame "indice" reconhecido — inventariando todos os frames visíveis da tela atual (fallback genérico).');
    for (const frame of page.frames()) {
        try {
            const dados = await inventariarTela(frame);
            if (dados.tabelas.length || dados.campos.length) {
                mapa.submenus.push({ item: `(frame: ${frame.name() || frame.url()})`, ...dados });
                console.log(`  - frame "${frame.name() || frame.url()}": ${dados.tabelas.length} tabela(s), ${dados.campos.length} campo(s)`);
            }
        } catch { /* frame pode não estar pronto/acessível — ignora e segue pro próximo */ }
    }
    return mapa;
}

async function main() {
    const rodadaAtiva = await verificarRodadaJaEmAndamento();
    if (rodadaAtiva) {
        console.error(`[mapear-mercurio] ABORTANDO — já existe uma rodada do job diário/disparo manual em andamento (filial "${rodadaAtiva.filial}", etapa "${rodadaAtiva.etapa}"). Rodar o mapeamento agora arriscaria colisão de sessão na mesma credencial compartilhada (bug real já documentado). Espere terminar e rode de novo.`);
        process.exit(1);
    }

    const httpAuth = await lerCredencial('mercurio_http', null);
    const matriculaSenha = await lerCredencial('mercurio', null);
    if (!httpAuth || !matriculaSenha) throw new Error('Credenciais do Mercúrio não encontradas no cofre (sistema="mercurio_http"/"mercurio", filial="GLOBAL") — cadastre em "Login Automático" na aba Importar do CRM antes de rodar isto.');

    const browser = await chromium.launch({ headless: false }); // visível de propósito — exploração supervisionada, não um job automático
    const context = await browser.newContext({ httpCredentials: { username: httpAuth.usuario, password: httpAuth.senha } });
    const page = await context.newPage();

    console.log('[mapear-mercurio] Entrando no Mercúrio...');
    await loginMercurio(page, matriculaSenha.usuario, matriculaSenha.senha);

    const porFilial = await listarTodosLinksPorFilial(page);
    const alvo = FILIAL_ALVO
        ? porFilial.find(f => f.filial.toLowerCase().includes(FILIAL_ALVO.toLowerCase()))
        : porFilial[0];
    if (!alvo) {
        console.error(`[mapear-mercurio] Filial "${FILIAL_ALVO}" não encontrada. Filiais disponíveis: ${porFilial.map(f => f.filial).join(' | ')}`);
        await browser.close();
        process.exit(1);
    }
    console.log(`[mapear-mercurio] Mapeando "${alvo.filial}" — áreas de menu encontradas: ${alvo.links.join(', ')}`);

    const relatorio = { geradoEm: new Date().toISOString(), filial: alvo.filial, areasDisponiveis: alvo.links, areas: [] };

    for (const nomeArea of alvo.links) {
        try {
            const framePrincipal = await esperarFrame(page, 'principal', /ger_funcao\.php/, 15000);
            await framePrincipal.getByRole('link', { name: nomeArea, exact: true }).first().click();
            const mapa = await mapearArea(page, nomeArea);
            relatorio.areas.push(mapa);
        } catch (e) {
            console.warn(`[mapear-mercurio] Falha ao entrar na área "${nomeArea}":`, e.message);
            relatorio.areas.push({ area: nomeArea, erro: e.message, submenus: [] });
        } finally {
            await page.goto(URL_FUNCOES, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }
    }

    fs.mkdirSync(PASTA_EXPORTS, { recursive: true });
    const caminho = `${PASTA_EXPORTS}/mapa-mercurio-${alvo.filial.replace(/[^a-z0-9]/gi, '_')}.json`;
    fs.writeFileSync(caminho, JSON.stringify(relatorio, null, 2), 'utf-8');
    console.log(`\n[mapear-mercurio] Relatório salvo em: ${caminho}`);
    console.log('[mapear-mercurio] Cole o conteúdo desse arquivo de volta na conversa (ou mande o caminho) pra eu analisar e compilar a lista do que pedir ao professor JG.');

    await browser.close();
}

main().catch(e => { console.error('[mapear-mercurio] Erro fatal:', e); process.exit(1); });

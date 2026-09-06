// Scraper do Ulisses — MODO LOCAL/ASSISTIDO. Roda na SUA máquina
// (`node ulisses-local.js`), NÃO no GitHub Actions.
//
// Por quê existe: o Cloudflare na frente do acropolebrasil.com.br
// bloqueia qualquer acesso automatizado vindo de IP de datacenter (GitHub
// Actions) com um desafio "Verify you are human" que nenhum script
// resolve sozinho — confirmado testando de verdade (ver comentário no
// topo de ulisses.js e a seção do scraper em CLAUDE.md). Rodando da sua
// própria máquina, é o SEU IP normal — o Cloudflare tende a não barrar, e
// se barrar mesmo assim, é VOCÊ quem resolve o desafio e faz o login à
// mão, numa janela do Chromium que abre visível (não headless). O script
// só entra em ação DEPOIS que detecta que você já está logado — a partir
// daí reaproveita 100% das mesmas funções de exportação de ulisses.js
// (CSV de Inscrições, catálogo de eventos, comparecimento), sem duplicar
// nada.
//
// Como usar:
//   1. Copie scraper/.env.example pra scraper/.env e preencha
//      SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CREDENCIAIS_SCRAPER_CHAVE
//      (os mesmos valores usados nos Secrets do GitHub Actions — pegue
//      em Settings > Secrets and variables > Actions do repositório, ou
//      direto no painel do Supabase pras 2 primeiras).
//   2. cd scraper && npm install (só na 1ª vez)
//   3. npm run ulisses-local
//   4. Uma janela do Chromium abre pra cada filial ativa, uma de cada
//      vez. Faça login manualmente nela (resolva o Cloudflare se
//      aparecer, entre com e-mail e senha do Ulisses daquela filial — o
//      terminal mostra qual e-mail está cadastrado, se houver) — o script
//      espera até 5 minutos e continua sozinho assim que detectar que o
//      login deu certo. Pode deixar a janela em segundo plano enquanto
//      espera; não precisa voltar pro terminal.
//
// Testar com 1 filial só (mais rápido enquanto ainda está em ajuste, não
// precisa logar em todas de novo a cada tentativa): passe um pedaço do
// nome da filial depois de "--":
//   npm run ulisses-local -- "Setor Oeste"
import 'dotenv/config';
import { chromium } from 'playwright';
import { supabaseAdmin, lerCredencial, registrarStatusSincronizacao } from './lib/supabaseAdmin.js';
import { exportarCsvInscricoes, exportarCatalogoEventos, exportarComparecimento, salvarScreenshotErro } from './ulisses.js';

const URL_LOGIN = 'https://www.acropolebrasil.com.br/login.html';
const TIMEOUT_LOGIN_MANUAL_MS = 5 * 60 * 1000; // 5 min pra você fazer login na janela

// Sem tentar preencher nada nem adivinhar seletor do Auth0 aqui de
// propósito — é exatamente essa parte "cega" (escrita só com prints, sem
// HTML real) que já causou retrabalho no modo automático. Você faz a tela
// inteira de login à mão; o script só espera o sinal de que deu certo (o
// menu "Exportar CSV", que só aparece autenticado — mesmo sinal que
// loginUlisses() já usa no modo automático).
async function aguardarLoginManual(page) {
    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
    console.log('   Aguardando você concluir o login nessa janela (até 5 minutos)...');
    await page.getByText('Exportar CSV', { exact: false }).waitFor({ timeout: TIMEOUT_LOGIN_MANUAL_MS });
}

async function processarFilialLocal(browser, filial) {
    console.log(`\n[ulisses-local] Filial: ${filial}`);

    let usuario = null;
    try {
        usuario = (await lerCredencial('ulisses', filial)).usuario;
    } catch {
        // Sem credencial salva no cofre ainda não impede o modo assistido
        // (você pode digitar o e-mail de cabeça) — só não dá pra mostrar
        // a dica abaixo.
    }
    if (usuario) console.log(`   E-mail cadastrado pra essa filial: ${usuario}`);

    const page = await browser.newPage();
    try {
        await aguardarLoginManual(page);
        console.log('   Login detectado — exportando...');
    } catch (e) {
        console.error(`   Não detectei login concluído a tempo: ${e.message}`);
        await salvarScreenshotErro(page, filial, 'login-manual');
        await registrarStatusSincronizacao('ulisses', filial, false, `Login manual não concluído a tempo: ${e.message}`);
        await page.close();
        return;
    }

    const etapas = [
        { nome: 'exportar-csv-inscricoes', executar: () => exportarCsvInscricoes(page, filial) },
        { nome: 'catalogo-eventos', executar: () => exportarCatalogoEventos(page, filial) },
        { nome: 'comparecimento', executar: () => exportarComparecimento(page, filial) },
    ];
    let algumaFalha = false;
    for (const etapa of etapas) {
        try {
            const caminho = await etapa.executar();
            console.log(`   ${etapa.nome} OK: ${caminho}`);
        } catch (e) {
            algumaFalha = true;
            console.error(`   Falha em ${etapa.nome}:`, e.message);
            await salvarScreenshotErro(page, filial, etapa.nome);
        }
    }

    await registrarStatusSincronizacao('ulisses', filial, !algumaFalha, algumaFalha
        ? 'Login manual (modo assistido) OK, mas 1+ exportação falhou — ver logs e prints locais (pasta debug/).'
        : 'Login manual (modo assistido) + exportação de Inscrições, catálogo de eventos e comparecimento OK.');
    await page.close();
}

async function main() {
    const { data: filiaisTodas, error } = await supabaseAdmin.from('filiais').select('nome').eq('ativo', true);
    if (error) throw new Error('Erro ao buscar filiais: ' + error.message);

    // Filtro opcional por linha de comando (npm run ulisses-local -- "Setor
    // Oeste") — testa só as filiais cujo nome contém esse texto, pra não
    // precisar logar em todas de novo a cada ajuste no código.
    const filtro = process.argv[2];
    const filiais = filtro
        ? (filiaisTodas || []).filter(f => f.nome.toLowerCase().includes(filtro.toLowerCase()))
        : (filiaisTodas || []);

    if (filiais.length === 0) {
        console.log(filtro ? `Nenhuma filial ativa bate com "${filtro}".` : 'Nenhuma filial ativa encontrada.');
        return;
    }

    console.log(`${filiais.length} filial(is) ativa(s): ${filiais.map(f => f.nome).join(', ')}`);
    console.log('Uma janela do Chromium vai abrir por vez — faça login em cada uma quando ela aparecer.\n');

    const browser = await chromium.launch({ headless: false });
    for (const f of filiais) {
        await processarFilialLocal(browser, f.nome);
    }
    await browser.close();
    console.log('\nConcluído. Arquivos em scraper/exports/.');
}

main().catch(e => { console.error('[ulisses-local] Erro fatal:', e); process.exit(1); });

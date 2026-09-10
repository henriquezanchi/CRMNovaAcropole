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
// Rodar 1 filial só de cada vez (recomendado se você tende a se confundir
// sobre qual filial está logando em qual janela — cada rodada abre só 1
// janela, e o e-mail certo aparece bem grande no terminal ANTES dela
// abrir): passe um pedaço do nome da filial depois de "--":
//   npm run ulisses-local -- "Setor Oeste"
// Sem esse argumento, roda TODAS as filiais ativas em sequência, uma
// janela por vez (nunca 2 ao mesmo tempo) — ver aguardarLoginManual()
// mais abaixo pra como o e-mail esperado é mostrado/pré-preenchido.
import 'dotenv/config';
import { chromium } from 'playwright';
import { supabaseAdmin, lerCredencial, registrarStatusSincronizacao } from './lib/supabaseAdmin.js';
import { exportarCsvInscricoes, exportarCatalogoEventos, exportarComparecimento, sincronizarCatalogoEventosNoCrm, sincronizarComparecimentoNoCrm, salvarScreenshotErro } from './ulisses.js';

const URL_LOGIN = 'https://www.acropolebrasil.com.br/login.html';
const TIMEOUT_LOGIN_MANUAL_MS = 5 * 60 * 1000; // 5 min pra você fazer login na janela

// Não preenchemos SENHA nem clicamos em nada do Auth0 aqui de propósito
// — é exatamente essa parte "cega" (escrita só com prints, sem HTML real)
// que já causou retrabalho no modo automático. Você digita a senha e
// resolve o Cloudflare se aparecer; o script só espera o sinal de que deu
// certo (o menu "Exportar CSV", que só aparece autenticado — mesmo sinal
// que loginUlisses() já usa no modo automático).
//
// O E-MAIL, porém, tentamos PRÉ-PREENCHER — pedido do usuário depois de
// confundir a filial e digitar a senha errada na janela errada (login
// automático não avisa "essa senha é de outra filial", só falha ou, pior,
// loga em conta errada se a senha coincidir). Passamos `login_hint` na
// URL — parâmetro padrão do Auth0/OIDC que a maioria dos apps que usam o
// SDK de redirect (auth0-spa-js) já repassa sozinho pro Universal Login,
// pré-preenchendo o campo de e-mail. **Não confirmado contra o app real**
// (não sei se ele de fato repassa esse parâmetro) — se não funcionar,
// nada quebra, só continua exatamente como antes (campo vazio, você
// digita os dois). De qualquer forma, o e-mail esperado sempre aparece
// no terminal ANTES de abrir a janela, pra conferir antes de digitar.
async function aguardarLoginManual(page, emailEsperado) {
    const url = emailEsperado ? `${URL_LOGIN}?login_hint=${encodeURIComponent(emailEsperado)}` : URL_LOGIN;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
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
        // a dica abaixo, nem tentar pré-preencher.
    }
    if (usuario) {
        console.log(`   >>> E-mail desta filial: ${usuario} <<<`);
        console.log('   (confira que é este e-mail antes de digitar a senha — o campo pode já vir preenchido, mas confirme.)');
    } else {
        console.log('   Nenhuma credencial salva pra essa filial ainda — digite o e-mail de cabeça.');
    }

    const page = await browser.newPage();
    try {
        await aguardarLoginManual(page, usuario);
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
        { nome: 'sincronizar-eventos-crm', executar: () => sincronizarCatalogoEventosNoCrm(filial) },
        { nome: 'comparecimento', executar: () => exportarComparecimento(page, filial) },
        { nome: 'sincronizar-comparecimento-crm', executar: () => sincronizarComparecimentoNoCrm(filial) },
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

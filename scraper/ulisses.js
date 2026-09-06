// Scraper do Ulisses (acropolebrasil.com.br) — MARCO 2: login + exportar
// (a) o CSV de Inscrições, (b) o catálogo de eventos (título/imagem/
// descrição, tela "Links") e (c) comparecimento por evento (tela
// "Pré-inscrições" > "Recepção") — por filial. Arquivos salvos em
// scraper/exports/ (o workflow sobe como artifact) — ainda NÃO alimenta o
// CRM sozinho (marco 3, pendente da mesma peça do lado do Mercúrio).
//
// (b) e (c) foram escritos só com PRINTS de tela, sem o HTML real — ao
// contrário do login/exportar CSV (que já foram testados e confirmados),
// estas duas usam heurísticas de leitura mais "cegas" (regex em cima do
// texto visível, âncoras por elemento mais confiável tipo checkbox) e
// têm boa chance de precisar de ajuste depois do primeiro teste real. Se
// falhar, o jeito mais rápido de corrigir é o usuário abrir a tela no
// DevTools (botão direito > Inspecionar no elemento certo > Copy >
// Copy outerHTML) e mandar o HTML de verdade, em vez de mais um print.
//
// Login é via Auth0 (Universal Login padrão) — usamos os RÓTULOS visíveis
// dos campos ("Endereço de e-mail"/"Senha") em vez de seletores CSS
// exatos, porque não tenho o HTML real da página (só um print) e rótulos
// tendem a ser mais estáveis que atributos internos numa página gerada
// pelo Auth0.
//
// 🛑 BLOQUEADO no GitHub Actions, confirmado por teste real: quem barra
// não é o Auth0, é o Cloudflare na frente do próprio acropolebrasil.com.br
// — todo acesso vindo do IP de datacenter do GitHub Actions cai numa tela
// "Verify you are human" antes de sequer chegar no formulário de login, e
// fica preso lá pra sempre (não tem captcha pra resolver via código, e não
// vamos tentar contornar essa proteção). Por isso esse arquivo NÃO roda
// mais no workflow (`if: false` em .github/workflows/scraper.yml) — as
// funções de exportação abaixo (exportarCsvInscricoes/
// exportarCatalogoEventos/exportarComparecimento) continuam existindo e
// são REAPROVEITADAS por `ulisses-local.js`, que roda na SUA máquina (seu
// IP normal, sem bloqueio) com login feito à mão por você — ver esse
// arquivo pra instruções de uso.
import { chromium } from 'playwright';
import { supabaseAdmin, lerCredencial, registrarStatusSincronizacao } from './lib/supabaseAdmin.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_LOGIN = 'https://www.acropolebrasil.com.br/login.html';
const PASTA_EXPORTS = 'exports';

async function loginUlisses(page, email, senha) {
    // 'networkidle' trava pra sempre em sites com alguma conexão de fundo
    // que nunca "para" (chat ao vivo, analytics, websocket) — confirmado
    // no primeiro teste real (timeout de 30s em TODAS as filiais, sem
    // nem chegar no Auth0). 'domcontentloaded' basta aqui, já que o passo
    // seguinte espera o sinal de verdade (a URL virar a do Auth0).
    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });

    // O site redireciona pro Auth0 (acropolebrasil.us.auth0.com/u/login) —
    // espera isso acontecer antes de procurar os campos.
    await page.waitForURL(/auth0\.com\/u\/login/, { timeout: 20000 });

    await page.getByLabel(/e-?mail/i).fill(email);
    await page.getByLabel(/senha/i).fill(senha);
    await page.getByRole('button', { name: /continuar/i }).click();

    // Depois do login, o app volta pra acropolebrasil.com.br (SPA, rota
    // #/evento) — espera sair da tela do Auth0 como sinal de sucesso.
    await page.waitForURL(/acropolebrasil\.com\.br/, { timeout: 20000 });

    // Confirmação extra: o menu "Exportar CSV" só aparece autenticado.
    await page.getByText('Exportar CSV', { exact: false }).waitFor({ timeout: 15000 });
}

// Aviso de cookies/LGPD aparece por cima da tela logo após o login
// (confirmado no 1º teste real, print do usuário) e barra qualquer
// clique em elementos atrás dele — mesmo que o Playwright ache o
// elemento "visível" (ele está pintado na tela, só que embaixo do
// aviso), o clique de verdade é interceptado pela camada do aviso, o que
// faz o download nunca disparar / os cards do catálogo nunca reagirem ao
// clique ("element is not enabled"/"not stable"). Cada filial abre numa
// aba isolada (contexto novo, sem cookie de "já aceitei"), então isso
// pode acontecer de novo em toda filial — best-effort, se o aviso já não
// existir mais não faz nada.
export async function fecharAvisoLGPD(page) {
    await page.getByRole('button', { name: /aceitar/i }).click({ timeout: 3000 }).catch(() => {});
}

// Clique único — dispara o download direto, sem formulário/seletor de
// evento no meio (confirmado testando de verdade). Salva com o nome da
// filial pra não sobrescrever entre uma filial e outra na mesma rodada.
export async function exportarCsvInscricoes(page, filial) {
    await fecharAvisoLGPD(page);
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.getByText('Exportar CSV', { exact: false }).click(),
    ]);

    fs.mkdirSync(PASTA_EXPORTS, { recursive: true });
    const caminho = `${PASTA_EXPORTS}/inscricoes-${filial.replace(/[^a-z0-9]/gi, '_')}.csv`;
    await download.saveAs(caminho);
    return caminho;
}

// Catálogo de eventos (tela "Links", que é a home pós-login em #/evento) —
// clica em cada card da lista (identificado pela data DD/MM/AAAA que todo
// card mostra, já que não temos o HTML real pra um seletor mais preciso)
// e lê os campos do formulário à direita por RÓTULO. Salva um JSON (não
// CSV — os campos têm texto livre/multilinha, ex: descrição).
export async function exportarCatalogoEventos(page, filial) {
    await fecharAvisoLGPD(page);
    if (!page.url().includes('#/evento')) {
        // 'networkidle' trava pra sempre nesse site (ver comentário em
        // loginUlisses()) — usa 'domcontentloaded' + espera o próprio
        // elemento que precisamos, mais abaixo.
        await page.goto('https://www.acropolebrasil.com.br/#/evento', { waitUntil: 'domcontentloaded' });
    }
    await page.getByRole('button', { name: /^ativo$/i }).click({ timeout: 5000 }).catch(() => {});

    const cards = page.locator('text=/\\d{2}\\/\\d{2}\\/\\d{4}/').locator('..');
    const total = await cards.count();
    if (total === 0) throw new Error('Nenhum card de evento encontrado na lista (seletor pode estar errado — ver comentário no topo do arquivo).');

    const ler = async (rotulo) => {
        try { return (await page.getByLabel(new RegExp(rotulo, 'i')).first().inputValue()).trim() || null; }
        catch { return null; }
    };

    const eventos = [];
    for (let i = 0; i < total; i++) {
        try {
            await cards.nth(i).click();
            await page.waitForTimeout(500); // painel da direita atualiza
            eventos.push({
                titulo: await ler('t[íi]tulo'),
                tipo_link: await ler('tipo link'),
                imagem_url: await ler('imagem'),
                subtitulo: await ler('subt[íi]tulo'),
                informacao: await ler('informa[çc][ãa]o'),
                descricao: await ler('descri[çc][ãa]o'),
            });
        } catch (e) {
            console.warn(`[ulisses] Não consegui ler o evento ${i} do catálogo (${filial}):`, e.message);
        }
    }

    fs.mkdirSync(PASTA_EXPORTS, { recursive: true });
    const caminho = `${PASTA_EXPORTS}/catalogo-eventos-${filial.replace(/[^a-z0-9]/gi, '_')}.json`;
    fs.writeFileSync(caminho, JSON.stringify(eventos, null, 2), 'utf-8');
    return caminho;
}

// Comparecimento por evento (tela "Pré-inscrições" > "Recepção") — a
// recepção marca manualmente no dia, então NÃO é 100% confiável (a
// pessoa marcada "não compareceu" pode ter ido mesmo assim). Ancora nos
// checkboxes (mais estável que tentar achar cada campo de nome/e-mail/
// telefone) e extrai o resto por REGEX do texto ao redor.
async function extrairPessoasComComparecimento(page) {
    const checkboxes = page.locator('input[type="checkbox"]');
    const total = await checkboxes.count();
    const pessoas = [];

    for (let i = 0; i < total; i++) {
        const cb = checkboxes.nth(i);
        const compareceu = await cb.isChecked().catch(() => null);
        // Sobe até o ancestor mais próximo que contenha um e-mail no
        // texto — heurística pra pegar "a linha inteira" sem depender da
        // estrutura exata de tabela/div.
        const container = cb.locator('xpath=ancestor::*[contains(., "@")][1]');
        const texto = await container.innerText().catch(() => '');
        const email = (texto.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || null;
        const telefone = (texto.match(/\b\d{2}\s?\d{8,9}\b/) || [])[0] || null;
        const nome = texto.split('\n')[0]?.trim() || null;
        pessoas.push({ nome, email, telefone, compareceu });
    }
    return pessoas;
}

export async function exportarComparecimento(page, filial) {
    await fecharAvisoLGPD(page);
    await page.getByText('Pré-inscrições', { exact: false }).click({ timeout: 10000 });
    await page.getByText('Recepção', { exact: false }).click({ timeout: 10000 });
    await page.waitForURL(/recepcao/i, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);

    // Tenta achar um <select> nativo com a lista de eventos; se não achar
    // (pode ser um dropdown customizado), captura só o evento que já
    // estiver selecionado por padrão — melhor que falhar tudo.
    const combobox = page.getByRole('combobox').first();
    let opcoesEventos = [];
    if (await combobox.count() > 0) {
        opcoesEventos = (await combobox.locator('option').allTextContents()).map(t => t.trim()).filter(Boolean);
    }
    if (opcoesEventos.length === 0) {
        console.warn('[ulisses] Não consegui listar eventos no seletor da Recepção — capturando só o evento já selecionado.');
        opcoesEventos = [null]; // null = não muda o seletor, usa o que já está na tela
    }

    const registros = [];
    for (const nomeEvento of opcoesEventos) {
        try {
            if (nomeEvento !== null) {
                await combobox.selectOption({ label: nomeEvento });
                await page.waitForTimeout(800); // lista de pessoas recarrega
            }
            const pessoas = await extrairPessoasComComparecimento(page);
            pessoas.forEach(p => registros.push({ evento: nomeEvento, filial, ...p }));
        } catch (e) {
            console.warn(`[ulisses] Falha ao ler comparecimento do evento "${nomeEvento}" (${filial}):`, e.message);
        }
    }

    fs.mkdirSync(PASTA_EXPORTS, { recursive: true });
    const caminho = `${PASTA_EXPORTS}/comparecimento-${filial.replace(/[^a-z0-9]/gi, '_')}.json`;
    fs.writeFileSync(caminho, JSON.stringify(registros, null, 2), 'utf-8');
    return caminho;
}

export async function salvarScreenshotErro(page, filial, etapa) {
    fs.mkdirSync('debug', { recursive: true });
    await page.screenshot({ path: `debug/ulisses-${etapa}-${filial.replace(/[^a-z0-9]/gi, '_')}.png`, fullPage: true }).catch(() => {});
}

async function processarFilial(browser, filial) {
    const page = await browser.newPage();

    try {
        const { usuario, senha } = await lerCredencial('ulisses', filial);
        await loginUlisses(page, usuario, senha);
        console.log(`[ulisses] Login OK — ${filial}`);
    } catch (e) {
        console.error(`[ulisses] Falha no login em ${filial}:`, e.message);
        await salvarScreenshotErro(page, filial, 'login');
        await registrarStatusSincronizacao('ulisses', filial, false, `Login falhou: ${e.message}`);
        await page.close();
        return;
    }

    // A partir daqui o login já funcionou — cada exportação roda
    // independente, uma falhar não impede as outras (e cada uma vira um
    // print de erro próprio, mais fácil de diagnosticar que 1 só genérico).
    const etapas = [
        { nome: 'exportar-csv-inscricoes', executar: () => exportarCsvInscricoes(page, filial) },
        { nome: 'catalogo-eventos', executar: () => exportarCatalogoEventos(page, filial) },
        { nome: 'comparecimento', executar: () => exportarComparecimento(page, filial) },
    ];
    let algumaFalha = false;
    for (const etapa of etapas) {
        try {
            const caminho = await etapa.executar();
            console.log(`[ulisses] ${etapa.nome} OK — ${filial}: ${caminho}`);
        } catch (e) {
            algumaFalha = true;
            console.error(`[ulisses] Falha em ${etapa.nome} (${filial}):`, e.message);
            await salvarScreenshotErro(page, filial, etapa.nome);
        }
    }

    await registrarStatusSincronizacao('ulisses', filial, !algumaFalha, algumaFalha
        ? 'Login OK, mas 1+ exportação falhou — ver logs e prints do workflow.'
        : 'Login + exportação de Inscrições, catálogo de eventos e comparecimento OK (marco 2 — ainda não alimenta o CRM automaticamente).');

    await page.close();
}

async function main() {
    const { data: filiais, error } = await supabaseAdmin.from('filiais').select('nome').eq('ativo', true);
    if (error) throw new Error('Erro ao buscar filiais: ' + error.message);
    if (!filiais || filiais.length === 0) { console.log('Nenhuma filial ativa encontrada.'); return; }

    const browser = await chromium.launch();
    for (const f of filiais) {
        await processarFilial(browser, f.nome);
    }
    await browser.close();
}

// Só roda main() quando o arquivo é executado diretamente (`node
// ulisses.js`, é o que o workflow faz) — `ulisses-local.js` importa as
// funções de exportação deste arquivo pra reaproveitar, e sem essa guarda
// esse main() (que tenta login 100% automático, sempre barrado pelo
// Cloudflare) rodaria também nesse import, por cima do fluxo assistido.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(e => { console.error('[ulisses] Erro fatal:', e); process.exit(1); });
}

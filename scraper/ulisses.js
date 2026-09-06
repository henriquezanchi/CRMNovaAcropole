// Scraper do Ulisses (acropolebrasil.com.br) — MARCO 2: login + exportar
// o CSV de Inscrições por filial (clique único, sem formulário no meio —
// confirmado testando de verdade). O arquivo baixado é salvo em
// scraper/exports/ (o workflow sobe como artifact) — ainda NÃO alimenta o
// CRM sozinho (marco 3, pendente da mesma peça do lado do Mercúrio).
//
// Login é via Auth0 (Universal Login padrão) — usamos os RÓTULOS visíveis
// dos campos ("Endereço de e-mail"/"Senha") em vez de seletores CSS
// exatos, porque não tenho o HTML real da página (só um print) e rótulos
// tendem a ser mais estáveis que atributos internos numa página gerada
// pelo Auth0.
//
// ⚠️ Risco conhecido: o Auth0 pode ativar "Bot Detection" e pedir captcha
// pra logins vindos de IP de datacenter (como o do GitHub Actions) — se
// esse script falhar sempre no mesmo ponto (depois de preencher e clicar
// "Continuar", sem navegar pra frente), é provavelmente isso. Não tem
// como contornar automaticamente; a saída nesse caso seria alguma
// plataforma que rode com IP residencial, ou desativar o Bot Detection
// pro seu tenant Auth0 (se você tiver acesso a isso).
import { chromium } from 'playwright';
import { supabaseAdmin, lerCredencial, registrarStatusSincronizacao } from './lib/supabaseAdmin.js';
import fs from 'node:fs';

const URL_LOGIN = 'https://www.acropolebrasil.com.br/login.html';
const PASTA_EXPORTS = 'exports';

async function loginUlisses(page, email, senha) {
    await page.goto(URL_LOGIN, { waitUntil: 'networkidle' });

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

// Clique único — dispara o download direto, sem formulário/seletor de
// evento no meio (confirmado testando de verdade). Salva com o nome da
// filial pra não sobrescrever entre uma filial e outra na mesma rodada.
async function exportarCsvInscricoes(page, filial) {
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.getByText('Exportar CSV', { exact: false }).click(),
    ]);

    fs.mkdirSync(PASTA_EXPORTS, { recursive: true });
    const caminho = `${PASTA_EXPORTS}/inscricoes-${filial.replace(/[^a-z0-9]/gi, '_')}.csv`;
    await download.saveAs(caminho);
    return caminho;
}

async function processarFilial(browser, filial) {
    const page = await browser.newPage();
    try {
        const { usuario, senha } = await lerCredencial('ulisses', filial);
        await loginUlisses(page, usuario, senha);
        console.log(`[ulisses] Login OK — ${filial}`);

        const caminho = await exportarCsvInscricoes(page, filial);
        console.log(`[ulisses] CSV exportado — ${filial}: ${caminho}`);

        await registrarStatusSincronizacao('ulisses', filial, true, `CSV de Inscrições exportado em ${caminho} (marco 2 — ainda não alimenta o CRM automaticamente).`);

        // TODO (marco 3): alimentar o CRM de verdade com este arquivo —
        // depende da mesma peça do lado do Mercúrio (Ativos/Inativos)
        // estar pronta, já que a importação exige as 3 planilhas juntas.
    } catch (e) {
        console.error(`[ulisses] Falha em ${filial}:`, e.message);
        // Caminho relativo ao diretório de trabalho do workflow (scraper/),
        // que já é o CWD deste script — vira scraper/debug/... visto da
        // raiz do repositório, batendo com o "path" do upload-artifact.
        fs.mkdirSync('debug', { recursive: true });
        await page.screenshot({ path: `debug/ulisses-${filial.replace(/[^a-z0-9]/gi, '_')}.png`, fullPage: true }).catch(() => {});
        await registrarStatusSincronizacao('ulisses', filial, false, e.message);
    } finally {
        await page.close();
    }
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

main().catch(e => { console.error('[ulisses] Erro fatal:', e); process.exit(1); });

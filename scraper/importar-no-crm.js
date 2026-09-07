// MARCO 3 do scraper: em vez de reimplementar em Node a lógica de
// cruzamento/tags/Lead Forte que já existe em js/importador.js (risco de
// duas versões divergirem com o tempo), o Playwright abre o CRM PUBLICADO
// (ver seção "Publicação/Deploy" do CLAUDE.md) e pilota a tela de
// Importar como um usuário faria: sobe os 3 arquivos, clica em
// "Processar", espera a prévia, clica em "Confirmar e Enviar". Reaproveita
// 100% da lógica de importação existente, sem duplicar nada.
//
// Seletores confirmados direto no código-fonte (index.html/js/importador.js
// — não por print/adivinhação):
//   - Portão de senha: #acessoOverlay / #acessoSenhaInput / botão "Entrar"
//     (js/acesso.js) — só aparece se o navegador (contexto novo do
//     Playwright, sem localStorage) ainda não tiver a senha salva.
//   - Aba Importar: .sidebar-icon[data-tab="tab-importar"]
//   - Filial de destino da importação (SELECT PRÓPRIO da aba, diferente do
//     seletor de filial do topbar): #importFilialSelect
//   - Os 3 inputs de arquivo, cada um aceita só 1 arquivo (sem
//     "multiple"): #fileAtivos / #fileInativos / #fileInscricoes
//   - Botão "Processar (não envia nada ainda)" — sem id, tem onclick
//     ="processarPlanilhas()"
//   - Botão "Confirmar e Enviar para o Supabase" — só existe no DOM
//     DEPOIS que a prévia é montada (renderizarPreviaImportacao()); por
//     isso, esperar esse botão aparecer já serve de sinal de "processou".
//   - Resultado final: #importProgressLabel vira "Concluído!" (sucesso)
//     ou "Erro — veja o log acima." (falha) — texto completo do log em
//     #importLog.
//   - NENHUM alert()/confirm() nativo aparece nesse fluxo (só existem em
//     telas auxiliares — "Critérios de Lead Forte"/"Login Automático" — e
//     na Zona de Perigo, nunca tocada por este script).
import { lerCredencial } from './lib/supabaseAdmin.js';

const URL_CRM = 'https://crm-nova-acropole-5dv3.vercel.app/';

async function esperarTexto(page, seletor, regex, timeoutMs) {
    const fim = Date.now() + timeoutMs;
    let ultimoTexto = '';
    while (Date.now() < fim) {
        ultimoTexto = await page.locator(seletor).innerText().catch(() => '');
        if (regex.test(ultimoTexto)) return ultimoTexto;
        await page.waitForTimeout(500);
    }
    throw new Error(`Texto esperado (${regex}) não apareceu em "${seletor}" a tempo (timeout ${timeoutMs}ms) — último texto visto: "${ultimoTexto}"`);
}

// Abre o CRM publicado e passa pelo portão de senha, se aparecer (sessão
// nova do Playwright não tem nada em localStorage ainda). Idempotente —
// se a senha já tiver sido "lembrada" nesse mesmo `page`/contexto (ex:
// chamado 2x seguidas na mesma sessão do navegador), não faz nada.
export async function abrirCrmComAcesso(page) {
    await page.goto(URL_CRM, { waitUntil: 'domcontentloaded' });
    const overlay = page.locator('#acessoOverlay');
    const precisaSenha = await overlay.isVisible().catch(() => false);
    if (!precisaSenha) return;

    const { senha } = await lerCredencial('crm_acesso', null);
    await page.locator('#acessoSenhaInput').fill(senha);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await overlay.waitFor({ state: 'hidden', timeout: 10000 });
}

// Importa os 3 arquivos (CSVs de Ativos/Inativos/Inscrições, já
// exportados pelo Mercúrio/Ulisses) pra UMA filial, pilotando a tela de
// Importar do CRM publicado. `arquivos` = { caminhoAtivos, caminhoInativos,
// caminhoInscricoes } — caminhos LOCAIS de arquivo (Playwright lê do disco
// e simula o upload, não precisa que o arquivo já esteja em lugar
// nenhum acessível pela internet). `filial` precisa ser o nome EXATO como
// aparece em `filiais.nome` no Supabase (mesmo texto do <option> do
// seletor) — nome do Mercúrio/Ulisses, se vier diferente, precisa ser
// traduzido ANTES de chamar esta função (ver resolverFilialCrm() em
// mercurio.js pro caso do Mercúrio).
export async function importarNoCrm(page, filial, { caminhoAtivos, caminhoInativos, caminhoInscricoes }) {
    await abrirCrmComAcesso(page);

    await page.locator('.sidebar-icon[data-tab="tab-importar"]').click();
    await page.locator('#importFilialSelect').waitFor({ timeout: 10000 });
    await page.locator('#importFilialSelect').selectOption({ label: filial });

    await page.locator('#fileAtivos').setInputFiles(caminhoAtivos);
    await page.locator('#fileInativos').setInputFiles(caminhoInativos);
    await page.locator('#fileInscricoes').setInputFiles(caminhoInscricoes);

    await page.getByRole('button', { name: /^Processar/ }).click();

    // Só existe depois que processarPlanilhas() monta a prévia — esperar
    // ele aparecer já é o sinal de "processamento terminou" (pode levar
    // um tempo real: cruzamento de milhares de linhas + classificação de
    // temas de evento por IA).
    const btnConfirmar = page.getByRole('button', { name: 'Confirmar e Enviar para o Supabase' });
    await btnConfirmar.waitFor({ timeout: 120000 });
    await btnConfirmar.click();

    const textoFinal = await esperarTexto(page, '#importProgressLabel', /Concluído!|Erro/, 180000);
    const logCompleto = await page.locator('#importLog').innerText().catch(() => '');

    if (/Erro/.test(textoFinal)) {
        throw new Error(`Importação no CRM falhou (${filial}): ${logCompleto.slice(-2000)}`);
    }
    return logCompleto;
}

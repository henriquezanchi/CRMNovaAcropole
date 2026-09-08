// Pilota a tela "Importar Matrícula" do CRM publicado (js/matricula-
// importar.js) — mesmo espírito do marco 3 (scraper/importar-no-crm.js):
// reaproveita 100% da lógica de casamento/tags/dedup já existente (por
// telefone > nome, tags de Turma/Dia/Horário, matricula_mercurio pra não
// duplicar entre rodadas) em vez de reimplementar em Node.
//
// Seletores confirmados no código-fonte (index.html/js/matricula-
// importar.js): botão "Importar Matrícula" (.col-import-matricula-btn,
// só existe na coluna cujo nome/chave contém "matricul"), textarea
// #matriculaImportarTexto, botões #matriculaImportarBtnProcessar /
// #matriculaImportarBtnConfirmar, modal final #modalRelatorioMatricula.
//
// ⚠️ confirmarImportacaoMatricula() dispara um confirm() NATIVO do
// navegador antes de aplicar — precisa de page.once('dialog', ...) ANTES
// de clicar em Confirmar, senão o script trava esperando alguém clicar
// num diálogo que não existe numa sessão headless.
import { abrirCrmComAcesso } from './importar-no-crm.js';

// Abre o CRM e troca pra filial certa no seletor do TOPBAR (#filialSelect
// — diferente do #importFilialSelect da aba Importar!) — chamar 1 vez só
// por filial, antes do loop de turmas (evita recarregar a página inteira
// a cada turma).
export async function abrirCrmNaFilialParaMatricula(page, filial) {
    await abrirCrmComAcesso(page);
    await page.locator('#filialSelect').selectOption({ label: filial });
    await page.waitForTimeout(2000); // trocarFilial() -> carregarLeads() (pode levar um tempo real em filiais grandes)
}

// Sobe 1 texto colado (já filtrado/pronto, 1 turma por vez — a metadata
// Turma/Dia/Horário é por turma) pela tela de Importar Matrícula. Espera
// `abrirCrmNaFilialParaMatricula` já ter rodado antes (mesma `page`,
// mesma filial). Não damos throw em "0 processado" — algumas linhas
// podem cair em "sem_match"/duplicado, isso é normal e não é falha.
//
// O botão "Importar Matrícula" saiu da coluna do Kanban (o time passou a
// usar o disparo do Mercúrio sob demanda em vez de colar manualmente) —
// a função `abrirImportarMatricula(colKey)` continua existindo/funcional
// em js/matricula-importar.js, só não tem mais um elemento clicável.
// Chamamos ela direto via page.evaluate(), com a MESMA heurística por
// substring "matricul" já usada em js/app.js pra achar a coluna certa.
export async function importarMatriculaViaTexto(page, textoColado) {
    const abriu = await page.evaluate(() => {
        // `columnsConfig` é `let` no escopo do script (js/app.js) — não vira
        // propriedade de `window`, mas continua acessível como identificador
        // solto em qualquer avaliação nesse mesmo realm (mesmo princípio do
        // console do DevTools enxergar variáveis top-level da página).
        const col = (typeof columnsConfig !== 'undefined' ? columnsConfig : []).find(c =>
            c.key.toLowerCase().includes('matricul') || c.label.toLowerCase().includes('matricul')
        );
        if (!col) return false;
        abrirImportarMatricula(col.key);
        return true;
    });
    if (!abriu) throw new Error('Nenhuma coluna com "matricul" no nome/chave encontrada no Kanban desta filial.');

    await page.locator('#modalImportarMatricula.open').waitFor({ timeout: 10000 });

    await page.locator('#matriculaImportarTexto').fill(textoColado);
    // dispara manualmente o handler de habilitar o botão — .fill() já
    // dispara 'input', mas por segurança (oninput no textarea real) não custa garantir.
    await page.locator('#matriculaImportarTexto').dispatchEvent('input');

    const btnProcessar = page.locator('#matriculaImportarBtnProcessar');
    await btnProcessar.waitFor({ timeout: 5000 });
    await btnProcessar.click();

    const btnConfirmar = page.locator('#matriculaImportarBtnConfirmar');
    await btnConfirmar.waitFor({ timeout: 20000 }); // processarTextoMatricula() busca todos os leads da filial (paginado)

    // O botão fica DESABILITADO quando 0 linhas casaram com um lead real
    // (renderizarRevisaoMatricula(), js/matricula-importar.js) — confirmado
    // ao vivo num teste com dado propositalmente falso. Nesse caso não tem
    // nada pra confirmar; só fecha o modal em vez de esperar um clique que
    // nunca vai ser aceito.
    if (await btnConfirmar.isDisabled()) {
        await page.locator('#modalImportarMatricula button:has(i.fa-xmark)').first().click().catch(() => {});
        return;
    }

    page.once('dialog', d => d.accept().catch(() => {})); // confirm() nativo de confirmarImportacaoMatricula()
    await btnConfirmar.click();

    // Espera o relatório final abrir (sinal de que confirmarImportacaoMatricula
    // terminou) e fecha, pra deixar a tela pronta pra próxima turma.
    const modalRelatorio = page.locator('#modalRelatorioMatricula.open');
    await modalRelatorio.waitFor({ timeout: 30000 }).catch(() => {});
    const btnConcluir = page.getByRole('button', { name: 'Concluir' });
    if (await btnConcluir.count() > 0) await btnConcluir.first().click().catch(() => {});
}

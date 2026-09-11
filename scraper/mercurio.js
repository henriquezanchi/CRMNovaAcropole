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
import { supabaseAdmin, lerCredencial, registrarStatusSincronizacao } from './lib/supabaseAdmin.js';
import { abrirCrmNaFilialParaMatricula, importarMatriculaViaTexto } from './importar-matricula-no-crm.js';
import { importarNoCrm } from './importar-no-crm.js';
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

// Escreve com retentativa — confirmado por teste real que o Windows às
// vezes trava um arquivo recém-criado por um instante (EBUSY/EPERM,
// provavelmente antivírus ou indexação de busca fazendo scan do arquivo
// novo), fazendo a exportação de 2 filiais falhar por completo mesmo com
// os dados já lidos certinho da tela. Um retry curto resolve sem precisar
// entender a causa exata (fora do nosso controle).
async function escreverComRetentativa(caminho, conteudo, encoding, tentativas = 5) {
    for (let i = 0; i < tentativas; i++) {
        try {
            fs.writeFileSync(caminho, conteudo, encoding);
            return;
        } catch (e) {
            if (i === tentativas - 1) throw e;
            await new Promise(r => setTimeout(r, 400 * (i + 1)));
        }
    }
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

// BUG REAL, GRAVÍSSIMO, confirmado em produção (2026-09-10): as 3 funções
// abaixo (exportarAtivosEInativos/exportarAniversariantes/
// processarMatriculasRecentesTurmas) recebiam um `indice` numérico
// capturado UMA VEZ, antes do laço de `main()` percorrer todas as
// filiais — mas entre uma filial e outra a página recarrega
// `ger_funcao.php` várias vezes (`page.goto(URL_FUNCOES, ...)`, ver
// main()). Nada garante que a ORDEM dos links "CADASTRO" nessa tela seja
// estável entre um carregamento e outro — e, confirmado lendo
// `log_atividade` (mesmíssimos números — "171 enviados, 77 ativos, 94
// ex-aluno" — batendo tanto pra "Goiânia - Setor Oeste" quanto pra
// "Barra do Garças/MT" no mesmo dia), ela NÃO é: em alguns dos ciclos do
// dia, `indice` continuava apontando pro NÚMERO certo, mas naquele
// carregamento específico da tela aquele número agora correspondia a
// OUTRA filial — resultado: os dados reais de uma filial (Setor Oeste)
// foram lidos e importados no CRM sob o nome de outra (Barra do Garças).
// Isso explica todos os sintomas relatados: alunos Ativos aparecendo na
// unidade errada, e eventos de uma filial aparecendo na Agenda de outra
// (mesmo mecanismo, ver `processarMatriculasRecentesTurmas` mais abaixo).
//
// Corrigido eliminando `indice` como algo que "atravessa" reloads: as 3
// funções agora recebem só o `label` e resolvem o índice ATUAL, de
// verdade, chamando `listarLinksCadastro()` de novo bem ali, no MESMO
// carregamento de página onde vão clicar — nunca há uma navegação entre
// "descobrir o índice" e "usar o índice", então não tem como desalinhar.
async function indiceAtualParaLabel(page, label) {
    const atuais = await listarLinksCadastro(page);
    const achado = atuais.find(c => c.label === label);
    return achado ? achado.indice : null;
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
async function exportarAtivosEInativos(page, label) {
    const indice = await indiceAtualParaLabel(page, label);
    if (indice === null) throw new Error(`Link "CADASTRO" de "${label}" não encontrado nesta tela (a ordem pode ter mudado, ou a filial não está mais listada) — pulando pra não arriscar ler dados de outra filial.`);
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
    await escreverComRetentativa(caminhoAtivos, paraCSV(['Matr', 'Nome', 'Nivel', 'Dia', 'Turma'], registrosAtivos), 'latin1');
    await escreverComRetentativa(caminhoInativos, paraCSV(['Nome', 'Telefones', 'Ni', 'Data', 'Motivo'], registrosInativos), 'latin1');
    return { caminhoAtivos, caminhoInativos };
}

// As 6 opções REAIS do <select name="sit"> da tela "Aniversariantes"
// (confirmado ao vivo) — inclui "INA" (Inativos) de propósito, a pedido
// do usuário ("pegar os aniversários de todo mundo, inclusive
// inativos"). Não é a mesma lista de níveis usada em Ativos/Inativos
// (TA/JN/PP/N1/Membro do resto do app) — é o vocabulário PRÓPRIO dessa
// tela do Mercúrio, só usado aqui.
const SITUACOES_ANIVERSARIANTES = ['N1', 'CIR', 'MEM', 'COR', 'JAN', 'INA'];
const MESES_ANIVERSARIANTES = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

// Célula "Endereço" da tela Aniversariantes — confirmada por print real
// (2026-09-11): 4 linhas dentro da mesma célula (quebra por <br>, vira
// "\n" no innerText()) — Logradouro / Bairro / "CIDADE-UF-CEP" (CEP
// aparece como "0" quando não preenchido) / E-mail. Ex.: "RUA FIDALGO
// S/N\nJARDIM NOVA BARRA\nBARRA DO GARÇAS-MT-78606629\ncelso@gmail.com".
// Extrai só e-mail/cidade/UF — **NÃO telefone** (a coluna "Fone" desta
// tela vem sem DDD, confirmado pelo usuário, então não dá pra usar com
// confiança; telefone continua vindo só da lista de Turma/Inativos).
// Procura pela linha-formato (não por posição fixa), tolerando ordem
// diferente ou linha faltando.
function extrairEnderecoAniversariante(textoEndereco) {
    const linhas = String(textoEndereco || '').split('\n').map(l => l.trim()).filter(Boolean);
    let email = null, cidade = null, uf = null;
    for (const linha of linhas) {
        if (!email && /@/.test(linha)) { email = linha; continue; }
        const m = !cidade && linha.match(/^(.+?)-([A-Z]{2})-\d+$/);
        if (m) { cidade = m[1].trim(); uf = m[2]; }
    }
    return { email, cidade, uf };
}

// Aniversariantes (menu "Relatórios" → "Aniversariantes", uni_cadani.php)
// — a tela só mostra 1 situação + 1 mês por vez (2 <select>, cada um
// resubmete o formulário sozinho no onchange), sem opção "todos" em
// nenhum dos dois — por isso a varredura completa (pedida pelo usuário,
// "todo mundo, inclusive inativos") precisa passar pelas 6 situações x
// 12 meses = 72 combinações, por filial. Colunas da tabela: Nome, Sit.,
// Nasc. (DD/MM/AAAA — data completa, com ano), Fone (sem DDD, não usado),
// Endereço (e-mail/cidade/UF embutidos — ver extrairEnderecoAniversariante()),
// Dia de Aula. **Cobre Ativos E Inativos** (INA está em
// SITUACOES_ANIVERSARIANTES) — é o único caminho automático hoje que
// alcança os dois grupos sem depender do Ulisses, pedido explícito do
// usuário (2026-09-11): "ativo e inativos completos... não depender do
// Ulisses pra nada".
async function exportarAniversariantes(page, label) {
    const indice = await indiceAtualParaLabel(page, label);
    if (indice === null) throw new Error(`Link "CADASTRO" de "${label}" não encontrado nesta tela (a ordem pode ter mudado, ou a filial não está mais listada) — pulando pra não arriscar ler dados de outra filial.`);
    const framePrincipal1 = await esperarFrame(page, 'principal', /ger_funcao\.php/, 15000);
    await framePrincipal1.getByRole('link', { name: 'CADASTRO', exact: true }).nth(indice).click();
    const frameIndice = await esperarFrame(page, 'indice', /uni_indice\.php/, 15000);

    await frameIndice.getByText('Aniversariantes', { exact: true }).click();
    const frame = await esperarFrame(page, 'principal', /uni_cadani\.php/, 15000);

    const registros = [];
    const vistos = new Set(); // matr (ou nome, se não achou matr) — evita duplicar quem aparece 2x (ex: mudou de situação no meio do ano)
    for (const sit of SITUACOES_ANIVERSARIANTES) {
        // BUG REAL GRAVE, achado em produção (2026-09-11) — datas de
        // nascimento erradas em pessoas reais: `onchange="this.form.
        // submit()"` neste <select> dispara uma RECARGA DE PÁGINA
        // completa (não uma troca de conteúdo via AJAX) — a versão
        // anterior só esperava 700ms fixos antes de ler a tabela, sem
        // confirmar que o reload de fato tinha terminado. Numa resposta
        // mais lenta do servidor (comum, dado que essa tela pode ter
        // milhares de linhas de histórico), a leitura acontecia no meio
        // do carregamento — linhas com dado misto/desatualizado.
        // Confirmado: os valores errados gravados no banco não batem com
        // NENHUMA linha de um re-scrape limpo (nem sequer aparecem no
        // JSON exportado). Corrigido esperando a NAVEGAÇÃO de verdade
        // (`waitForNavigation`) em vez de um tempo fixo — mesmo espírito
        // da "espera ativa" já usada em exportarComparecimento() (Ulisses).
        await Promise.all([
            frame.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
            frame.locator('select[name="sit"]').selectOption({ value: sit }),
        ]);
        await page.waitForTimeout(300); // pequena folga extra depois do reload confirmado
        for (const mes of MESES_ANIVERSARIANTES) {
            await Promise.all([
                frame.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
                frame.locator('select[name="mes"]').selectOption({ value: mes }),
            ]);
            await page.waitForTimeout(300);

            const linhas = frame.locator('table tr');
            const total = await linhas.count();
            for (let i = 1; i < total; i++) { // pula o cabeçalho (<th>, não <td>)
                const celulas = linhas.nth(i).locator('td');
                if (await celulas.count() < 3) continue;
                const linkNome = celulas.nth(0).locator('a');
                const temLink = await linkNome.count() > 0;
                const nome = (temLink ? await linkNome.first().innerText() : await celulas.nth(0).innerText()).trim();
                const href = temLink ? await linkNome.first().getAttribute('href') : null;
                const matricula = href ? (href.match(/matr=(\d+)/) || [])[1] || null : null;
                const nascimento = (await celulas.nth(2).innerText()).trim(); // DD/MM/AAAA
                if (!nome || !/^\d{2}\/\d{2}\/\d{4}$/.test(nascimento)) continue;

                const chave = matricula || `${nome}|||${nascimento}`;
                if (vistos.has(chave)) continue;
                vistos.add(chave);
                const textoEndereco = await celulas.nth(4).innerText().catch(() => '');
                const { email, cidade, uf } = extrairEnderecoAniversariante(textoEndereco);
                registros.push({ matricula, nome, nascimento, situacao: sit, email, cidade, uf });
            }
        }
    }

    fs.mkdirSync(PASTA_EXPORTS, { recursive: true });
    const slug = label.replace(/[^a-z0-9]/gi, '_');
    const caminho = `${PASTA_EXPORTS}/mercurio-aniversariantes-${slug}.json`;
    await escreverComRetentativa(caminho, JSON.stringify(registros, null, 2), 'utf-8');
    return caminho;
}

// As 4 listas "COMPLEMENTAR" do Mercúrio — confirmadas por print real
// (2026-09-11): Círculo de Amigos/Correntinha/Távolas/Janos NUNCA
// aparecem na lista "Ativos" (Programa Branco) — são listas PRÓPRIAS,
// paralelas. Sem isso, essas pessoas nunca ganhavam lead nem tag nenhuma
// no CRM (pedido do usuário: "ativos e inativos completos... sem
// depender do Ulisses"). `nivelTag` casa com classificarNivel()
// (js/importador.js): CA fica com tag própria, Correntinha/Távolas
// dobram em "Merlin" (mesmo programa de filosofia infantil), Janos fica
// "JN".
const PROGRAMAS_COMPLEMENTARES = [
    { menu: 'C. de Amigos', nivelTag: 'CA' },
    { menu: 'Correntinha', nivelTag: 'Merlin' },
    { menu: 'Távolas', nivelTag: 'Merlin' },
    { menu: 'Janos', nivelTag: 'JN' },
];

// Lê 1 das 4 telas acima — 2 formatos de cabeçalho confirmados por print:
// "C. de Amigos" (Matr./Nome/Turma/Dia+Horário JUNTO ex. "QUI/20:00"/
// Ingresso/Mídia — SEM nascimento) e as outras 3 (Matr./Nome/Nasc./
// Turma/Dia/Horário SEPARADOS/Ingresso). Nenhuma tem telefone/e-mail. Lê
// por NOME de coluna (não posição fixa), tolerando as 2 formas — mais
// robusto que hardcoded índices já que só vi 1 das 4 telas com dado real
// (as outras 3 estavam vazias no print). **"Matr." aqui já é a
// matrícula REAL** (confirmado no print: 52948/52664/25268 — não é um
// índice sequencial 1/2/3 como na tabela de Turma), então não precisa
// extrair do href de um link.
// ⚠️ URL exata de cada tela NÃO confirmada (só o texto do menu e as
// colunas foram vistos) — usa o frame "principal" direto em vez de
// esperar por uma URL específica; se a navegação não completar a tempo,
// best-effort (log de aviso, pula esse programa, nunca trava a filial).
async function exportarComplementar(page, label, nomeMenu) {
    const indice = await indiceAtualParaLabel(page, label);
    if (indice === null) throw new Error(`Link "CADASTRO" de "${label}" não encontrado nesta tela — pulando "${nomeMenu}" pra não arriscar ler dados de outra filial.`);
    const framePrincipal1 = await esperarFrame(page, 'principal', /ger_funcao\.php/, 15000);
    await framePrincipal1.getByRole('link', { name: 'CADASTRO', exact: true }).nth(indice).click();
    const frameIndice = await esperarFrame(page, 'indice', /uni_indice\.php/, 15000);

    await frameIndice.getByText(nomeMenu, { exact: true }).click();
    await page.waitForTimeout(800); // sem URL/indicador de carregamento confirmado — espera curta e fixa, mesmo padrão do resto do arquivo
    const frame = page.frame({ name: 'principal' });
    if (!frame) return [];

    const tabelas = frame.locator('table');
    const totalTabelas = await tabelas.count();
    let tabela = null;
    for (let i = 0; i < totalTabelas; i++) {
        const cab = (await tabelas.nth(i).locator('tr').first().innerText().catch(() => '')).toLowerCase();
        if (cab.includes('nome') && cab.includes('ingresso')) { tabela = tabelas.nth(i); break; }
    }
    if (!tabela) return [];

    const cabecalho = (await tabela.locator('tr').first().locator('td, th').allInnerTexts()).map(c => c.trim().toLowerCase());
    const idxDe = (nomeColuna) => cabecalho.findIndex(c => c.includes(nomeColuna));
    const idxMatr = idxDe('matr');
    const idxNome = idxDe('nome');
    const idxNasc = idxDe('nasc');
    const idxIngresso = idxDe('ingresso');

    const linhas = tabela.locator('tr');
    const totalLinhas = await linhas.count();
    const registros = [];
    for (let j = 1; j < totalLinhas; j++) {
        const celulas = await linhas.nth(j).locator('td').allInnerTexts();
        if (celulas.length === 0) continue;
        const matr = idxMatr !== -1 ? (celulas[idxMatr] || '').trim() : '';
        const nome = idxNome !== -1 ? (celulas[idxNome] || '').trim() : '';
        if (!matr || !/^\d+$/.test(matr) || !nome) continue;
        registros.push({
            matr,
            nome,
            nascimento: idxNasc !== -1 ? (celulas[idxNasc] || '').trim() : '',
            ingresso: idxIngresso !== -1 ? (celulas[idxIngresso] || '').trim() : '',
        });
    }
    return registros;
}

// ID sintético pra quem só existe nas listas COMPLEMENTAR — baseado na
// MATRÍCULA REAL (não um índice), então a mesma pessoa nunca duplica
// entre rodadas. Faixa própria (970000000+), distinta de todas as outras
// já em uso no projeto (ver BASE_ID_LEAD_MANUAL, js/app.js, pro mapa
// completo de faixas).
const BASE_ID_COMPLEMENTAR = 970000000;

// Cria/enriquece leads a partir das 4 listas COMPLEMENTAR — pra quem já
// existe no CRM (casado por nome, mesma técnica de
// carregarMapaLeadsPorNome() usada em processarTurmas()), só adiciona
// "Ativo" + o nível (CA/Merlin/JN) e a data de nascimento se vier e o
// lead ainda não tiver nenhuma; pra quem não existe, cria um lead novo
// (coluna "Frios" — mesmo padrão default de columnsPadrao(), js/app.js,
// usado por toda criação de lead sintético deste arquivo). Nome ambíguo
// (2+ leads com o mesmo nome normalizado) nunca é escolhido automático —
// mesma cautela de sempre.
async function processarComplementar(page, filialCrm, label) {
    const mapaLeads = await carregarMapaLeadsPorNome(filialCrm);
    let totalNovos = 0, totalEnriquecidos = 0;

    for (const { menu, nivelTag } of PROGRAMAS_COMPLEMENTARES) {
      // BUG REAL corrigido (2026-09-11): os `continue` abaixo (registros
      // vazios, ou erro de leitura) pulavam DIRETO pra próxima iteração
      // do for-of, sem nunca chegar no `page.goto(URL_FUNCOES, ...)` que
      // ficava no FIM do bloco — a navegação de volta simplesmente não
      // acontecia toda vez que um programa dava 0 resultado (ex:
      // "Correntinha" vazia), deixando a página "perdida" pra próxima
      // iteração (ex: "Távolas" falhava com timeout esperando
      // ger_funcao.php, porque a página nunca voltou pra lá). Envolver em
      // try/finally garante que a navegação SEMPRE roda, mesmo com
      // `continue`/erro no meio.
      try {
        let registros;
        try {
            registros = await exportarComplementar(page, label, menu);
        } catch (e) {
            console.warn(`[complementar] Falha ao ler "${menu}" (${filialCrm}):`, e.message);
            continue;
        }
        if (registros.length === 0) continue;
        console.log(`[complementar] "${menu}" (${filialCrm}): ${registros.length} pessoa(s) encontrada(s).`);

        for (const r of registros) {
            try {
                const chave = normalizarNomeMercurio(r.nome);
                const existente = mapaLeads.get(chave);

                if (existente) {
                    if (existente.ambiguo) continue; // homônimo — nunca escolhe automático
                    const novasTags = [...existente.tags];
                    if (!novasTags.includes('Ativo')) novasTags.push('Ativo');
                    if (!novasTags.includes(nivelTag)) novasTags.push(nivelTag);
                    const patch = {};
                    if (novasTags.length !== existente.tags.length) patch.tags = JSON.stringify(novasTags);
                    const dataISO = dataBRParaISO(r.nascimento);
                    if (dataISO && !existente.temData) patch.data_nascimento = dataISO;
                    if (Object.keys(patch).length === 0) continue;

                    const { error } = await supabaseAdmin.from('leads_inscricoes').update(patch).eq('pessoaIdentificador', existente.pessoaIdentificador);
                    if (error) { console.warn(`[complementar] Falha ao atualizar "${r.nome}" (${filialCrm}):`, error.message); continue; }
                    if (patch.tags) existente.tags = novasTags;
                    if (patch.data_nascimento) existente.temData = true;
                    totalEnriquecidos++;
                } else {
                    const novoId = String(BASE_ID_COMPLEMENTAR + Number(r.matr));
                    const tags = ['Ativo', nivelTag, 'Sem Telefone', 'Sem E-mail'];
                    const registro = {
                        pessoaIdentificador: novoId,
                        pessoaNome: r.nome,
                        pessoaTelefoneDDD: '', pessoaTelefoneNumero: '', pessoaEmail: '',
                        pessoaStatus: '', telemarketingStatus: '',
                        eventoNome: '', eventoData: '', historico_eventos: [],
                        tags: JSON.stringify(tags),
                        data_nascimento: dataBRParaISO(r.nascimento),
                        funil_agencia: 'Frios',
                        filial: filialCrm,
                    };
                    const { error } = await supabaseAdmin.from('leads_inscricoes').upsert(registro, { onConflict: 'pessoaIdentificador' });
                    if (error) { console.warn(`[complementar] Falha ao criar lead "${r.nome}" (${filialCrm}):`, error.message); continue; }
                    mapaLeads.set(chave, {
                        pessoaIdentificador: novoId, tags, ambiguo: false,
                        temData: !!registro.data_nascimento, cidade: '', uf: '', telefoneAlternativo: '', pessoaEmail: '', pessoaTelefoneNumero: '',
                    });
                    totalNovos++;
                }
            } catch (e) {
                console.warn(`[complementar] Falha processando "${r.nome}" (${menu}, ${filialCrm}):`, e.message);
            }
        }
      } finally {
        // Volta pra tela de funções antes do próximo programa — cada
        // exportarComplementar() reabre a navegação do zero. Em `finally`
        // pra rodar SEMPRE (registros vazios, erro de leitura, ou sucesso
        // normal — ver comentário no início do `try`).
        await page.goto(URL_FUNCOES, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    }

    return { totalNovos, totalEnriquecidos };
}

function normalizarNomeMercurio(nome) {
    return String(nome || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function dataBRParaISO(dataBR) {
    const m = (dataBR || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Data (Date) a partir de "DD/MM/AAAA" — só pra COMPARAR (ingresso do
// aluno vs. início da turma, ver processarTurmas()), nunca pra gravar/
// exibir em lugar nenhum.
function dataBRParaDate(dataBR) {
    const m = (dataBR || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

// O Mercúrio e o CRM usam vocabulários DIFERENTES pra filial — o Mercúrio
// (visto no menu pós-login, ver listarLinksCadastro()) usa algo como
// "GOIÂNIA UNIVERSITARIO: BARRA DO GARÇAS", enquanto o CRM usa
// "Barra do Garças/MT" (tabela `filiais`, `js/app.js`). Sem resolver isso,
// um `.eq('filial', <rótulo do Mercúrio>)` contra `leads_inscricoes`
// NUNCA bate com nenhuma linha — bug real confirmado no 1º teste (0 de
// 3129 aniversariantes casaram, mesmo filiais com centenas de leads reais
// no banco). Resolve tirando as palavras genéricas ("GOIANIA",
// "UNIVERSITARIO", "MT" — aparecem nos 2 lados ou só atrapalham) do nome
// da filial do CRM, sobrando só o núcleo distintivo (ex: "GARAVELO",
// "SETOR OESTE", "BARRA DO GARCAS"), e checando se esse núcleo aparece
// dentro do rótulo (normalizado) que o Mercúrio deu. Evita precisar de
// uma tabela de mapeamento hardcoded, mas ainda é uma heurística — se uma
// filial nova tiver um nome sem nenhuma palavra em comum com o Mercúrio,
// fica sem resolver (log de aviso, não inventa).
const PALAVRAS_GENERICAS_FILIAL = new Set(['GOIANIA', 'UNIVERSITARIO', 'MT']);

function normalizarTextoFilial(s) {
    return String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[^A-Z]+/g, ' ')
        .trim();
}

// Extraído pra ser reaproveitado também pelo filtro de filial (`--`/
// `FILTRO_FILIAL`, ver `main()`) — bug real achado em produção
// (2026-09-10): o filtro comparava o valor bruto de `filiais.nome` (ex:
// "Goiânia - Garavelo", vindo direto do `<select>` do CRM) contra o
// rótulo do Mercúrio com um `.includes()` NAIVE, sem tirar acento nem
// palavra genérica — "goiânia - garavelo" nunca aparece dentro de
// "goiânia universitario: goiania garavelo" (estrutura de texto
// diferente: um usa " - ", o outro usa ": "), então filtrar por
// "Goiânia - Garavelo" ou "Barra do Garças/MT" (que tem o "/MT" que o
// Mercúrio não tem) sempre dava "Nenhuma filial bate com o filtro" — a
// causa exata do erro que o usuário viu ao tentar rodar só o Garavelo.
function nucleoDistintivoFilial(nomeFilial) {
    return normalizarTextoFilial(nomeFilial)
        .split(' ')
        .filter(p => p && !PALAVRAS_GENERICAS_FILIAL.has(p))
        .join(' ');
}

async function resolverFilialCrm(labelMercurio) {
    const { data: filiais, error } = await supabaseAdmin.from('filiais').select('nome').eq('ativo', true);
    if (error) throw new Error('Erro ao buscar filiais do CRM: ' + error.message);
    const labelNorm = normalizarTextoFilial(labelMercurio);
    for (const f of filiais || []) {
        const nucleo = nucleoDistintivoFilial(f.nome);
        if (nucleo && labelNorm.includes(nucleo)) return f.nome;
    }
    return null;
}

// Depois de exportar os aniversariantes (função acima), preenche
// `data_nascimento` (leads_inscricoes) de quem ainda não tem essa data —
// nenhuma das 3 planilhas de importação manual traz esse dado, então até
// agora só dava pra preencher um lead de cada vez, na mão, pela gaveta
// (ver `migracao_data_nascimento.sql`). Casa por NOME normalizado (mesma
// heurística de `normalizarNomeImport()` em js/importador.js — o
// Mercúrio não expõe telefone/e-mail nessa tela de um jeito fácil de
// casar com confiança, e o `matricula_mercurio` salvo em
// leads_inscricoes só existe pra quem já passou pela importação de
// matrícula via print, cobertura baixa demais pra ser o critério
// principal aqui). Homônimos (2+ leads com o mesmo nome normalizado na
// filial) ficam de fora de propósito — sem outro dado pra desempatar,
// arriscar a data errada é pior que não preencher. NUNCA sobrescreve uma
// data já preenchida (pode ter sido corrigida à mão).
export async function sincronizarAniversariantesNoCrm(labelMercurio) {
    const caminhoJson = `${PASTA_EXPORTS}/mercurio-aniversariantes-${labelMercurio.replace(/[^a-z0-9]/gi, '_')}.json`;
    if (!fs.existsSync(caminhoJson)) throw new Error('mercurio-aniversariantes.json não encontrado — a etapa "aniversariantes" precisa rodar antes desta.');

    const filial = await resolverFilialCrm(labelMercurio);
    if (!filial) return `Não consegui identificar a qual filial do CRM "${labelMercurio}" corresponde — pulando sincronização (o JSON exportado continua disponível).`;

    const registros = JSON.parse(fs.readFileSync(caminhoJson, 'utf-8'));
    if (registros.length === 0) return '0 aniversariantes exportados — nada a sincronizar.';

    const porNome = new Map(); // nome normalizado -> { pessoaIdentificador, temData, temEmail, temCidade, temUf, ambiguo }
    const TAMANHO_PAGINA = 1000;
    for (let de = 0; ; de += TAMANHO_PAGINA) {
        const { data: pagina, error } = await supabaseAdmin
            .from('leads_inscricoes')
            .select('pessoaIdentificador, pessoaNome, data_nascimento, "pessoaEmail", cidade, uf')
            .eq('filial', filial)
            .order('pessoaIdentificador', { ascending: true })
            .range(de, de + TAMANHO_PAGINA - 1);
        if (error) throw new Error('Erro ao buscar leads da filial: ' + error.message);
        for (const lead of pagina || []) {
            const chave = normalizarNomeMercurio(lead.pessoaNome);
            if (!chave) continue;
            const existente = porNome.get(chave);
            if (existente) existente.ambiguo = true;
            else porNome.set(chave, {
                pessoaIdentificador: lead.pessoaIdentificador,
                temData: !!lead.data_nascimento,
                temEmail: !!(lead.pessoaEmail && lead.pessoaEmail.trim()),
                temCidade: !!lead.cidade,
                temUf: !!lead.uf,
                ambiguo: false,
            });
        }
        if (!pagina || pagina.length < TAMANHO_PAGINA) break;
    }

    let atualizados = 0, semLead = 0, ambiguos = 0, jaTinhaData = 0;
    let comEmail = 0, comCidade = 0;
    for (const r of registros) {
        const alvo = porNome.get(normalizarNomeMercurio(r.nome));
        if (!alvo) { semLead++; continue; }
        if (alvo.ambiguo) { ambiguos++; continue; }

        // Monta o patch só com o que falta E veio preenchido nesta
        // rodada — nunca sobrescreve um valor já existente (pode ter
        // sido corrigido à mão, ou vindo de uma importação do Ulisses).
        const patch = {};
        const dataISO = dataBRParaISO(r.nascimento);
        if (dataISO && !alvo.temData) patch.data_nascimento = dataISO;
        else if (alvo.temData) jaTinhaData++;
        if (r.email && !alvo.temEmail) patch.pessoaEmail = r.email;
        if (r.cidade && !alvo.temCidade) patch.cidade = r.cidade;
        if (r.uf && !alvo.temUf) patch.uf = r.uf;
        if (Object.keys(patch).length === 0) continue;

        const { error } = await supabaseAdmin
            .from('leads_inscricoes')
            .update(patch)
            .eq('pessoaIdentificador', alvo.pessoaIdentificador);
        if (!error) {
            atualizados++;
            if (patch.data_nascimento) alvo.temData = true;
            if (patch.pessoaEmail) { alvo.temEmail = true; comEmail++; }
            if (patch.cidade) { alvo.temCidade = true; comCidade++; }
            if (patch.uf) alvo.temUf = true;
        }
    }

    return `${atualizados} lead(s) atualizado(s) (${comEmail} e-mail, ${comCidade} cidade/UF), de ${registros.length} aniversariante(s) do Mercúrio (${semLead} sem lead correspondente por nome, ${ambiguos} nome ambíguo/homônimo, ${jaTinhaData} já tinham data de nascimento).`;
}

// Data de hoje no fuso de Brasília (America/Sao_Paulo) — importante rodar
// no GitHub Actions, que roda em UTC por padrão; sem isso, "hoje" podia
// ficar 1 dia adiantado/atrasado dependendo da hora da execução.
function hojeBrasil() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); // "AAAA-MM-DD"
}
function somarDias(dataISO, dias) {
    const [a, m, d] = dataISO.split('-').map(Number);
    const dt = new Date(Date.UTC(a, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + dias);
    return dt.toISOString().slice(0, 10);
}

function parseTagsMercurio(tagsData) {
    if (!tagsData) return [];
    if (Array.isArray(tagsData)) return tagsData;
    try {
        const parsed = JSON.parse(tagsData);
        return Array.isArray(parsed) ? parsed : [tagsData];
    } catch { return [String(tagsData).replace(/[[\]"]/g, '')]; }
}

// Avisa o chefe da filial/professor responsável quando um aluno ATIVO
// (não qualquer lead — só quem já é aluno de verdade) faz aniversário
// hoje. Roda logo depois de sincronizarAniversariantesNoCrm() pra essa
// filial (que já garantiu data_nascimento preenchida em quem deu pra
// casar por nome) — best-effort, erro aqui nunca derruba o resto do job.
async function verificarAniversariosAtivosHoje(filialCrm) {
    try {
        const hoje = hojeBrasil(); // "AAAA-MM-DD"
        const { data: leads, error } = await supabaseAdmin
            .from('leads_inscricoes')
            .select('pessoaIdentificador, pessoaNome, tags, data_nascimento')
            .eq('filial', filialCrm)
            .not('data_nascimento', 'is', null);
        if (error) { console.warn(`[aniversario-ativo] Erro ao buscar leads de "${filialCrm}":`, error.message); return; }

        const aniversariantesAtivos = (leads || []).filter(l => {
            if (!l.data_nascimento?.endsWith(hoje.slice(4))) return false; // compara só MM-DD (ano de nascimento é diferente)
            const tags = parseTagsMercurio(l.tags).map(t => String(t).trim());
            return tags.includes('Ativo') || tags.includes('Aluno Ativo');
        });
        if (aniversariantesAtivos.length === 0) return;

        for (const lead of aniversariantesAtivos) {
            const texto = `🎂 Hoje é aniversário do(a) aluno(a) *${lead.pessoaNome}*! Que tal mandar um parabéns?`;
            const { data: resultado, error: erroEnvio } = await supabaseAdmin.functions.invoke('whatsapp-notificar-chefe-filial', { body: { filial: filialCrm, texto } });
            if (erroEnvio || (resultado && resultado.ok === false)) {
                console.warn(`[aniversario-ativo] Falha ao avisar aniversário de "${lead.pessoaNome}" (${filialCrm}):`, erroEnvio?.message || JSON.stringify(resultado));
            } else {
                console.log(`[aniversario-ativo] Aviso de aniversário enviado — ${lead.pessoaNome} (${filialCrm}).`);
            }
        }
    } catch (e) {
        console.warn('[aniversario-ativo] Erro inesperado (não interrompe o job):', e.message);
    }
}

function mesAnoDoIngresso(dataBR) {
    const m = (dataBR || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}` : null;
}

// Carrega TODOS os leads da filial num Map por nome normalizado — mesma
// técnica/limitação já usada em sincronizarAniversariantesNoCrm() acima:
// homônimo (2+ leads com o mesmo nome normalizado) fica marcado como
// `ambiguo` e nunca é escolhido automaticamente (arriscar o lead errado é
// pior que pular um aluno). Carregado 1x por filial por rodada (não 1x
// por aluno) — reaproveitado por toda a varredura de turmas.
async function carregarMapaLeadsPorNome(filialCrm) {
    const mapa = new Map();
    const TAMANHO_PAGINA = 1000;
    for (let de = 0; ; de += TAMANHO_PAGINA) {
        const { data, error } = await supabaseAdmin
            .from('leads_inscricoes')
            .select('pessoaIdentificador, pessoaNome, tags, cidade, uf, telefone_alternativo, pessoaEmail, pessoaTelefoneDDD, pessoaTelefoneNumero')
            .eq('filial', filialCrm)
            .order('pessoaIdentificador', { ascending: true })
            .range(de, de + TAMANHO_PAGINA - 1);
        if (error) throw new Error('Erro ao buscar leads da filial: ' + error.message);
        for (const lead of data || []) {
            const chave = normalizarNomeMercurio(lead.pessoaNome);
            if (!chave) continue;
            if (mapa.has(chave)) { mapa.get(chave).ambiguo = true; continue; }
            mapa.set(chave, {
                pessoaIdentificador: lead.pessoaIdentificador,
                tags: parseTagsMercurio(lead.tags).map(t => String(t).trim()),
                cidade: lead.cidade || '',
                uf: lead.uf || '',
                telefoneAlternativo: lead.telefone_alternativo || '',
                pessoaEmail: lead.pessoaEmail || '',
                pessoaTelefoneNumero: lead.pessoaTelefoneNumero || '',
                ambiguo: false,
            });
        }
        if (!data || data.length < TAMANHO_PAGINA) break;
    }
    return mapa;
}

// Extrai DDD + número de um telefone lido na coluna "Fone" da lista de
// alunos de uma turma (celulas[5], já capturada há tempos pra
// `processarTurmas()` — parte comprovadamente funcional, sem relação com
// os seletores NÃO testados de HISTÓRICO/ENDEREÇOS). Só dígitos; DDD = 2
// primeiros, resto = número — só aceita se sobrar 8 ou 9 dígitos depois
// do DDD (mesma validação de `salvarTelefoneLead()`, js/app.js). Formato
// exato do campo no Mercúrio ainda não confirmado com 100% de certeza —
// se vier sempre `null` daqui, o formato real é outro; mandar 1 exemplo
// de texto bruto resolve rápido.
function extrairDddNumero(foneMercurio) {
    const digitos = String(foneMercurio || '').replace(/\D/g, '');
    if (digitos.length < 10 || digitos.length > 11) return null;
    const ddd = digitos.slice(0, 2);
    const numero = digitos.slice(2);
    if (numero.length !== 8 && numero.length !== 9) return null;
    return { ddd, numero };
}

// Preenche o telefone de QUALQUER aluno sem telefone usando o dado que já
// vem de graça na lista de alunos da turma (não depende do Mercúrio ter
// "Ativos sem correspondência" cadastrados com telefone — a lista de
// Ativos do Mercúrio NUNCA teve coluna de telefone, só a Turma tem; ver
// CLAUDE.md). Roda pra TODO aluno de TODA turma, nos 2 modos (Incremental
// e Completo) — é dado já lido de qualquer forma, custo zero de
// navegação extra. NUNCA sobrescreve um telefone já preenchido (pode ter
// vindo de uma importação anterior do Ulisses, mais confiável). Também
// remove a tag "Sem Telefone" quando aplicável, senão o badge ficaria
// errado até a próxima reimportação completa.
async function aplicarTelefoneDaTurma(leadInfo, nomeAluno, foneMercurio) {
    if (leadInfo.pessoaTelefoneNumero) return false;
    const tel = extrairDddNumero(foneMercurio);
    if (!tel) return false;
    const novasTags = leadInfo.tags.includes('Sem Telefone') ? leadInfo.tags.filter(t => t !== 'Sem Telefone') : leadInfo.tags;
    const { error } = await supabaseAdmin.from('leads_inscricoes')
        .update({ pessoaTelefoneDDD: tel.ddd, pessoaTelefoneNumero: tel.numero, tags: JSON.stringify(novasTags) })
        .eq('pessoaIdentificador', leadInfo.pessoaIdentificador);
    if (error) { console.warn(`[telefone-turma] Falha ao gravar telefone de "${nomeAluno}":`, error.message); return false; }
    leadInfo.pessoaTelefoneNumero = tel.numero;
    leadInfo.tags = novasTags;
    return true;
}

// Grava a tag "Recuperado" (permanente, nunca removida em reimportação —
// ver ehTagDeSistema() em js/importador.js) quando o campo "Reingresso
// (Recuperação)" da tela HISTÓRICO do Mercúrio confirma que o aluno já
// saiu antes e voltou. Como a base foi zerada nesta sessão (não tem mais
// histórico de Inativo->Ativo pra comparar sozinho entre importações —
// ver CLAUDE.md), esta é a forma de detectar rematrícula de verdade daqui
// pra frente: direto do Mercúrio, não por comparação entre 2 importações.
// Idempotente (não duplica se já tinha a tag) e registra em
// `log_atividade` (acao='recuperacao_detectada_scraper') pra deixar uma
// trilha DATADA de quando foi detectado — base pra um relatório futuro de
// "Recuperações por Mês", se fizer sentido (ainda não construído).
async function aplicarTagRecuperado(filialCrm, leadInfo, nomeAluno, dataReingresso) {
    if (leadInfo.tags.includes('Recuperado')) return false;
    const novasTags = [...leadInfo.tags, 'Recuperado'];
    const { error } = await supabaseAdmin.from('leads_inscricoes')
        .update({ tags: JSON.stringify(novasTags) })
        .eq('pessoaIdentificador', leadInfo.pessoaIdentificador);
    if (error) { console.warn(`[recuperado] Falha ao gravar tag de "${nomeAluno}":`, error.message); return false; }
    leadInfo.tags = novasTags;
    await supabaseAdmin.from('log_atividade').insert({
        filial: filialCrm, acao: 'recuperacao_detectada_scraper', autor: 'Scraper Mercúrio',
        pessoa_ids: [String(leadInfo.pessoaIdentificador)], detalhes: { nome: nomeAluno, dataReingresso: dataReingresso || null },
    }).then(({ error: erroLog }) => { if (erroLog) console.warn('[log-atividade] Falha ao registrar recuperação:', erroLog.message); });
    return true;
}

// Grava e-mail/cidade/UF/telefone alternativo lidos da tela ENDEREÇOS
// (Modo Completo, ver processarTurmas()) — NUNCA sobrescreve um valor já
// preenchido (pode ter sido corrigido à mão no CRM), mesmo princípio já
// usado em sincronizarCatalogoEventosNoCrm() pro Ulisses.
async function aplicarDadosEndereco(leadInfo, nomeAluno, dados) {
    const patch = {};
    if (dados.email && !leadInfo.pessoaEmail) patch.pessoaEmail = dados.email;
    if (dados.cidade && !leadInfo.cidade) patch.cidade = dados.cidade;
    if (dados.uf && !leadInfo.uf) patch.uf = dados.uf;
    if (dados.telefoneAlternativo && !leadInfo.telefoneAlternativo) patch.telefone_alternativo = dados.telefoneAlternativo;
    if (Object.keys(patch).length === 0) return false;

    const { error } = await supabaseAdmin.from('leads_inscricoes').update(patch).eq('pessoaIdentificador', leadInfo.pessoaIdentificador);
    if (error) { console.warn(`[enderecos] Falha ao gravar dados de "${nomeAluno}":`, error.message); return false; }
    if (patch.pessoaEmail) leadInfo.pessoaEmail = patch.pessoaEmail;
    if (patch.cidade) leadInfo.cidade = patch.cidade;
    if (patch.uf) leadInfo.uf = patch.uf;
    if (patch.telefone_alternativo) leadInfo.telefoneAlternativo = patch.telefone_alternativo;
    return true;
}

// Abre a ficha do aluno (clique no nome — mesmo link uni_cadfun.php?matr=
// já usado pra extrair a matrícula real) e lê HISTÓRICO (campo "Aluno/
// Membro Recuperado") e/ou ENDEREÇOS (e-mail/cidade/UF/telefone
// alternativo), conforme pedido em `opcoes`.
//
// ⚠️ NÃO confirmado contra o HTML real do Mercúrio — mapeado só com
// descrição/print de tela (ver CLAUDE.md, mesmo estágio inicial de outras
// funções deste arquivo antes do 1º teste real). Escrito com seletor por
// RÓTULO (getByLabel) — mais tolerante a mudança de estrutura HTML que um
// seletor de posição, mas os rótulos exatos podem não bater de primeira;
// se vier tudo vazio/errado, mandar o HTML real da tela HISTÓRICO/
// ENDEREÇOS resolve rápido, mesmo padrão de sempre. Best-effort total:
// qualquer falha aqui só gera aviso no log, nunca trava a turma nem a
// filial inteira.
async function processarFichaAluno(page, linkNome, { verificarHistorico, verificarEnderecos }) {
    const resultado = {};
    try {
        await linkNome.click();
        await esperarFrame(page, 'principal', /uni_cadfun\.php/, 15000);
    } catch (e) {
        console.warn('[ficha-aluno] Falha ao abrir a ficha do aluno:', e.message);
        return resultado;
    }

    if (verificarHistorico) {
        try {
            const framePerfil = page.frame({ name: 'principal' });
            await framePerfil.getByText(/^HIST[ÓO]RICO$/i).first().click();
            await page.waitForTimeout(600); // sem indicador de carregamento claro — espera curta e fixa, mesmo padrão do resto do arquivo
            const ctx = page.frame({ name: 'principal' }) || framePerfil;
            const checkbox = ctx.getByLabel(/Aluno\/?\s*Membro Recuperado/i).first();
            const marcado = await checkbox.isChecked().catch(() => null);
            resultado.recuperado = !!marcado;
            if (marcado) {
                resultado.dataReingresso = (await ctx.getByLabel(/reingressou/i).first().inputValue().catch(() => '')) || null;
            }
        } catch (e) {
            console.warn('[ficha-aluno] Falha ao ler HISTÓRICO:', e.message);
        }
    }

    if (verificarEnderecos) {
        try {
            const framePerfil = page.frame({ name: 'principal' });
            await framePerfil.getByText(/^ENDERE[ÇC]OS$/i).first().click();
            await page.waitForTimeout(600);
            const ctx = page.frame({ name: 'principal' }) || framePerfil;
            resultado.email = (await ctx.getByLabel(/e-?mail/i).first().inputValue().catch(() => '')).trim();
            resultado.cidade = (await ctx.getByLabel(/^cidade$/i).first().inputValue().catch(() => '')).trim();
            resultado.uf = (await ctx.getByLabel(/^uf$/i).first().inputValue().catch(() => '')).trim();
            resultado.telefoneAlternativo = (await ctx.getByLabel(/alternativo/i).first().inputValue().catch(() => '')).trim();
        } catch (e) {
            console.warn('[ficha-aluno] Falha ao ler ENDEREÇOS:', e.message);
        }
    }
    return resultado;
}

// Varre TODAS as turmas da filial (menu "Turmas", uni_esctur.php) — entra
// em cada uma e faz 3 coisas:
// (1) grava dia/horário/início de TODA turma em `turmas`
//     (migracao_turmas.sql), base do "Mapa de Turmas" no CRM
//     (js/mapa-turmas.js) — só dia/horário são gravados lá, "início" é
//     usado só aqui dentro pra decidir quem investigar (item 2);
// (2) lê a tabela de alunos (Matr./Nome/Origem/Ingresso/Fone): quem
//     ingressou no MÊS CORRENTE é colado na tela "Importar Matrícula" do
//     CRM publicado (marco 3 — scraper/importar-matricula-no-crm.js,
//     reaproveitando 100% da lógica de casamento/tags/dedup que já
//     existe); quem ingressou ANTES da própria turma existir — logicamente
//     impossível ter entrado "fresco" nela — é candidato a REINGRESSO/
//     TRANSFERÊNCIA e tem a ficha (HISTÓRICO) verificada, pra aplicar a
//     tag "Recuperado" quando confirmado (pedido do usuário, 2026-09-10,
//     com exemplo real da turma "AMIGOS": início 27/08/2026, aluno com
//     ingresso 20/06/2019 só pode ser reingresso). Só quem AINDA não tem
//     a tag "Recuperado" é revisitado (dedup — a tag é permanente, ver
//     aplicarTagRecuperado());
// (3) em MODO COMPLETO (`modoCompleto=true`, pensado pra importação
//     inicial/pontual, não pro job diário), a ficha de TODO ALUNO da
//     turma (não só os candidatos a reingresso) também é visitada pra
//     capturar e-mail/cidade/UF/telefone alternativo (tela ENDEREÇOS) —
//     bem mais lento, por isso não roda por padrão.
//
// A "Matr." VISÍVEL na tabela de alunos é só um índice de linha (1, 2,
// 3...), NÃO a matrícula real — confirmado no HTML ao vivo (a matrícula
// de verdade só existe no href do link do nome, uni_cadfun.php?matr=XXXXX).
// Por isso não dá pra só imitar um "copiar e colar" ingênuo — o texto
// colado é montado aqui já com o número certo extraído do link, e o mesmo
// link é reaproveitado pra abrir a ficha do aluno (item 2/3 acima).
//
// BUG REAL, ainda sem causa raiz confirmada (achado em produção,
// 2026-09-11): `importarMatriculaViaTexto()` (que pilota a UI do CRM
// publicado pra aplicar a matrícula) grava `matricula_mercurio`/
// `data_matricula`/tags de turma corretamente, mas `funil_agencia`
// continua "Frios" em vez de ir pra "Matriculados" — confirmado contra
// produção (4 leads reais em Barra do Garças/MT). Testado isoladamente
// que `ehMatriculaRecente()`/`columnsConfig` (tem "Matriculados" por
// padrão) funcionam certinho fora desse fluxo — a causa exata dentro do
// fluxo de UI não foi encontrada a tempo. Corrigido com uma rede de
// segurança DIRETA no banco (`corrigirFunilMatriculados()`, abaixo) em
// vez de continuar sem mover ninguém — roda depois de
// `importarMatriculaViaTexto()`, usando `matricula_mercurio` (já gravado
// certo) pra achar quem precisa ser corrigido.
async function corrigirFunilMatriculados(filialCrm, recentes) {
    for (const r of recentes) {
        try {
            const { data, error } = await supabaseAdmin
                .from('leads_inscricoes')
                .select('pessoaIdentificador, funil_agencia')
                .eq('filial', filialCrm)
                .eq('matricula_mercurio', Number(r.matr))
                .maybeSingle();
            if (error || !data) continue;
            if (String(data.funil_agencia || '').toLowerCase().includes('matricul')) continue; // já está lá — nada a fazer
            const { error: erroUpdate } = await supabaseAdmin.from('leads_inscricoes').update({ funil_agencia: 'Matriculados' }).eq('pessoaIdentificador', data.pessoaIdentificador);
            if (!erroUpdate) console.log(`[matricula-turma] "${r.nome}" movido pra "Matriculados" (correção direta — ver bug real acima).`);
        } catch (e) {
            console.warn(`[matricula-turma] Falha ao corrigir funil de "${r.nome}" (${filialCrm}):`, e.message);
        }
    }
}
async function processarTurmas(page, pageCrm, filialCrm, label, modoCompleto = false, filtroTurma = null) {
    const mesAtual = hojeBrasil().slice(0, 7); // "AAAA-MM"
    let crmAberto = false;
    let totalProcessadas = 0;
    let totalRecuperados = 0;
    let totalEnderecosAtualizados = 0;
    let totalTelefonesPreenchidos = 0;

    const mapaLeads = await carregarMapaLeadsPorNome(filialCrm);

    const entrarNoIndiceDaFilial = async () => {
        const indice = await indiceAtualParaLabel(page, label);
        if (indice === null) throw new Error(`Link "CADASTRO" de "${label}" não encontrado nesta tela (a ordem pode ter mudado, ou a filial não está mais listada) — pulando pra não arriscar ler dados de outra filial.`);
        const fp = await esperarFrame(page, 'principal', /ger_funcao\.php/, 15000);
        await fp.getByRole('link', { name: 'CADASTRO', exact: true }).nth(indice).click();
        return esperarFrame(page, 'indice', /uni_indice\.php/, 15000);
    };

    // Reentra na turma DO ZERO (volta pra ger_funcao.php -> CADASTRO ->
    // Turmas -> clica na turma) — usado pra visitar a ficha de 1 aluno
    // específico sem depender de "voltar" no meio de um <frameset>
    // (comportamento incerto sem teste real), reaproveitando o mesmo
    // padrão já usado no resto do arquivo pra resetar a navegação pra um
    // estado conhecido. BUG REAL corrigido (2026-09-10, achado no 1º teste
    // de verdade — MODO COMPLETO): faltava o `page.goto(URL_FUNCOES, ...)`
    // antes de `entrarNoIndiceDaFilial()` — sem ele, a função tentava
    // clicar em "CADASTRO" onde quer que a página estivesse no momento
    // (ficha de um aluno anterior, ou a própria tela da turma), nunca
    // achava o frame "principal" em ger_funcao.php, e todo aluno de todo
    // MODO COMPLETO falhava com timeout — 100% das visitas de ficha
    // fracassaram na 1ª rodada real por causa disso.
    const entrarNaTurma = async (nomeTurma) => {
        await page.goto(URL_FUNCOES, { waitUntil: 'domcontentloaded' });
        const fi = await entrarNoIndiceDaFilial();
        await fi.getByText('Turmas', { exact: true }).first().click();
        const ft = await esperarFrame(page, 'principal', /uni_esctur\.php/, 15000);
        await ft.getByRole('link', { name: nomeTurma, exact: true }).click();
        return esperarFrame(page, 'principal', /uni_esctal\.php/, 15000);
    };

    let frameIndice = await entrarNoIndiceDaFilial();
    await frameIndice.getByText('Turmas', { exact: true }).first().click();
    let frameTurmas = await esperarFrame(page, 'principal', /uni_esctur\.php/, 15000);

    const nomesTurmasTodas = [...new Set((await frameTurmas.locator('a[href^="uni_esctal.php?turma="]').allTextContents()).map(t => t.trim()).filter(Boolean))];
    // Filtro opcional por nome de turma (substring, case-insensitive) —
    // pensado pra um teste RÁPIDO e pequeno (1 turma só) antes de soltar
    // uma rodada completa de horas — ver `--turma`/env `FILTRO_TURMA` em main().
    const nomesTurmas = filtroTurma
        ? nomesTurmasTodas.filter(n => n.toLowerCase().includes(filtroTurma.toLowerCase()))
        : nomesTurmasTodas;
    if (filtroTurma && nomesTurmas.length === 0) {
        console.warn(`[turmas] Nenhuma turma de "${filialCrm}" bate com o filtro "${filtroTurma}" (turmas encontradas: ${nomesTurmasTodas.join(', ')}).`);
    }
    console.log(`[turmas] ${nomesTurmas.length} turma(s) encontrada(s) em ${filialCrm}${filtroTurma ? ` (filtro: "${filtroTurma}")` : ''}${modoCompleto ? ' (MODO COMPLETO — visita a ficha de todo aluno)' : ` — procurando ingressos de ${mesAtual} e candidatos a reingresso`}.`);
    let totalAlunosLidos = 0;

    for (const nomeTurma of nomesTurmas) {
        try {
            frameTurmas = await esperarFrame(page, 'principal', /uni_esctur\.php/, 15000);
            await frameTurmas.getByRole('link', { name: nomeTurma, exact: true }).click();
            const frameDetalhe = await esperarFrame(page, 'principal', /uni_esctal\.php/, 15000);

            const diaTexto = await frameDetalhe.locator('td:has-text("Dia:")').first().innerText().catch(() => '');
            const horarioTexto = await frameDetalhe.locator('td:has-text("Horário:")').first().innerText().catch(() => '');
            const inicioTexto = await frameDetalhe.locator('td:has-text("Início:")').first().innerText().catch(() => '');
            const dia = diaTexto.replace(/^Dia:\s*/i, '').trim();
            const horario = horarioTexto.replace(/^Horário:\s*/i, '').trim();
            const inicioTurma = inicioTexto.replace(/^Início:\s*/i, '').trim(); // "DD/MM/AAAA"
            const inicioTurmaData = dataBRParaDate(inicioTurma);

            // Grava dia/horário de TODA turma visitada (tenha matrícula
            // recente ou não) — base do "Mapa de Turmas" no CRM
            // (migracao_turmas.sql). Best-effort, não impede o resto do
            // processamento desta turma se falhar.
            await supabaseAdmin.from('turmas')
                .upsert({ filial: filialCrm, nome: nomeTurma, dia, horario, atualizado_em: new Date().toISOString() }, { onConflict: 'filial,nome' })
                .then(({ error }) => { if (error) console.warn(`[mapa-turmas] Falha ao gravar turma "${nomeTurma}" (${filialCrm}):`, error.message); });

            const tabelas = frameDetalhe.locator('table');
            const totalTabelas = await tabelas.count();
            let tabelaAlunos = null;
            for (let i = 0; i < totalTabelas; i++) {
                const cab = (await tabelas.nth(i).locator('tr').first().innerText().catch(() => '')).toLowerCase();
                if (cab.includes('nome') && cab.includes('ingresso')) { tabelaAlunos = tabelas.nth(i); break; }
            }
            if (!tabelaAlunos) continue;

            const linhas = tabelaAlunos.locator('tr');
            const totalLinhas = await linhas.count();
            const recentes = [];
            const alunosLidos = []; // TODOS os alunos da turma (matr/nome/ingresso/fone) — base pra reingresso + modo completo
            for (let j = 1; j < totalLinhas; j++) {
                const linkNome = linhas.nth(j).locator('a[href*="uni_cadfun.php?matr="]');
                if (await linkNome.count() === 0) continue;
                const href = await linkNome.first().getAttribute('href');
                const matr = (href.match(/matr=(\d+)/) || [])[1];
                const nome = (await linkNome.first().innerText()).trim();
                const celulas = await linhas.nth(j).locator('td').allInnerTexts();
                const origem = (celulas[2] || '').trim();
                const ingresso = (celulas[3] || '').trim();
                const fone = (celulas[5] || '').trim();
                totalAlunosLidos++;
                if (matr && nome) alunosLidos.push({ matr, nome, origem, ingresso, fone });
                if (!matr || !nome || mesAnoDoIngresso(ingresso) !== mesAtual) continue;
                recentes.push({ matr, nome, origem, ingresso, fone });
            }

            // ---- Backfill de telefone pra QUALQUER aluno sem telefone,
            // usando o que já veio de graça nesta mesma leitura da turma
            // (celulas[5] acima) — roda nos 2 modos, não depende de
            // HISTÓRICO/ENDEREÇOS (seletores ainda não confirmados). A
            // lista "Ativos" do Mercúrio nunca teve telefone — só a Turma
            // tem — então isso é a única fonte automática hoje pra quem
            // não veio (ou não vem mais) do Ulisses.
            for (const aluno of alunosLidos) {
                const lead = mapaLeads.get(normalizarNomeMercurio(aluno.nome));
                if (!lead || lead.ambiguo) continue;
                const preencheu = await aplicarTelefoneDaTurma(lead, aluno.nome, aluno.fone);
                if (preencheu) totalTelefonesPreenchidos++;
            }

            if (recentes.length > 0) {
                const textoColado = [
                    'Matr.\tNome\tOrigem\tIngresso\tFormatura\tFone\tFunções\t\t\t\tObservações',
                    `Turma:\t${nomeTurma}\tDia:\t${dia}\tHorário:\t${horario}`,
                    ...recentes.map(l => [l.matr, l.nome, l.origem, l.ingresso, '', l.fone, '', '', '', '-', '-'].join('\t')),
                ].join('\n');

                if (!crmAberto) {
                    await abrirCrmNaFilialParaMatricula(pageCrm, filialCrm);
                    crmAberto = true;
                }
                await importarMatriculaViaTexto(pageCrm, textoColado);
                await corrigirFunilMatriculados(filialCrm, recentes);
                totalProcessadas += recentes.length;
                console.log(`[matricula-turma] ${recentes.length} matrícula(s) de ${mesAtual} na turma "${nomeTurma}" (${filialCrm}) processada(s).`);
            }

            // ---- Reingresso + Modo Completo: decide quem precisa ter a
            // ficha aberta. Só entra aqui quem casou com EXATAMENTE 1 lead
            // (nome ambíguo/sem lead correspondente fica de fora — arriscar
            // o lead errado é pior que pular).
            const alvos = alunosLidos
                .map(a => ({ aluno: a, lead: mapaLeads.get(normalizarNomeMercurio(a.nome)) }))
                .filter(({ lead }) => lead && !lead.ambiguo)
                .map(({ aluno, lead }) => {
                    const ingressoData = dataBRParaDate(aluno.ingresso);
                    const precisaHistorico = !!(inicioTurmaData && ingressoData && ingressoData < inicioTurmaData && !lead.tags.includes('Recuperado'));
                    return { aluno, lead, precisaHistorico };
                })
                .filter(({ precisaHistorico }) => precisaHistorico || modoCompleto);

            for (const { aluno, lead, precisaHistorico } of alvos) {
                try {
                    const frameDetalheAtual = await entrarNaTurma(nomeTurma);
                    const linkNomeAtual = frameDetalheAtual.locator(`a[href*="uni_cadfun.php?matr=${aluno.matr}"]`).first();
                    if (await linkNomeAtual.count() === 0) { console.warn(`[ficha-aluno] Link de "${aluno.nome}" (matr ${aluno.matr}) não encontrado de novo na turma "${nomeTurma}".`); continue; }

                    const dados = await processarFichaAluno(page, linkNomeAtual, { verificarHistorico: precisaHistorico, verificarEnderecos: modoCompleto });

                    if (precisaHistorico && dados.recuperado) {
                        const gravou = await aplicarTagRecuperado(filialCrm, lead, aluno.nome, dados.dataReingresso);
                        if (gravou) { totalRecuperados++; console.log(`[recuperado] "${aluno.nome}" (${filialCrm}) marcado como Recuperado (reingresso em ${dados.dataReingresso || '?'}).`); }
                    }
                    if (modoCompleto && (dados.email || dados.cidade || dados.uf || dados.telefoneAlternativo)) {
                        const gravou = await aplicarDadosEndereco(lead, aluno.nome, dados);
                        if (gravou) totalEnderecosAtualizados++;
                    }
                } catch (e) {
                    console.warn(`[ficha-aluno] Falha processando "${aluno.nome}" (turma "${nomeTurma}", ${filialCrm}):`, e.message);
                }
            }
            console.log(`[turma] "${nomeTurma}" (${filialCrm}): ${alunosLidos.length} aluno(s) na lista, ${alvos.length} ficha(s) visitada(s) neste modo.`);
        } catch (e) {
            console.warn(`[matricula-turma] Falha na turma "${nomeTurma}" (${filialCrm}):`, e.message);
        }
        // Volta CADASTRO -> Turmas pra próxima iteração (só mexe no `page`
        // do Mercúrio — `pageCrm`, se aberto, fica intacto numa aba/
        // contexto separado, sem precisar reabrir o CRM a cada turma).
        await page.goto(URL_FUNCOES, { waitUntil: 'domcontentloaded' }).catch(() => {});
        try {
            frameIndice = await entrarNoIndiceDaFilial();
            await frameIndice.getByText('Turmas', { exact: true }).first().click();
        } catch { /* se falhar aqui, a próxima iteração do for vai falhar rápido e seguir também */ }
    }

    console.log(`[turmas] ${totalAlunosLidos} aluno(s) lidos no total em ${filialCrm}; ${totalProcessadas} matrícula(s) de ${mesAtual}; ${totalRecuperados} recuperação(ões) detectada(s); ${totalEnderecosAtualizados} ficha(s) de endereço atualizada(s); ${totalTelefonesPreenchidos} telefone(s) preenchido(s) via lista de turma.`);
    return { totalProcessadas, totalRecuperados, totalEnderecosAtualizados, totalTelefonesPreenchidos };
}

// O Ulisses NUNCA vai rodar sozinho (Cloudflare exige login manual — ver
// topo do arquivo/CLAUDE.md), então esquecer de rodar é o risco real. Em
// vez de confiar na memória, esta checagem roda TODO DIA dentro do job
// automático do Mercúrio (que já roda sozinho) e manda um WhatsApp de
// lembrete pro admin quando: (a) existe algum evento (qualquer filial)
// com data de ontem, hoje ou amanhã — marcado como IMPORTANTE, é quando
// os dados de comparecimento/matrícula mais importam estarem frescos; ou
// (b) é o dia da checagem semanal de rotina (segunda-feira), mesmo sem
// evento por perto, pra não deixar a base ficar desatualizada por muito
// tempo. Best-effort: qualquer erro aqui é só logado, nunca derruba o
// resto do job do Mercúrio.
async function verificarLembreteImportacaoUlisses() {
    try {
        const hoje = hojeBrasil();
        const ontem = somarDias(hoje, -1);
        const amanha = somarDias(hoje, 1);

        const { data: eventosProximos, error } = await supabaseAdmin
            .from('eventos')
            .select('filial, nome, data')
            .in('data', [ontem, hoje, amanha])
            .order('data', { ascending: true });
        if (error) { console.warn('[lembrete] Erro ao buscar eventos próximos:', error.message); return; }

        const ehSegunda = new Date(`${hoje}T12:00:00`).getDay() === 1; // meio-dia evita virada de fuso na conversão
        const temEvento = (eventosProximos || []).length > 0;
        if (!temEvento && !ehSegunda) {
            console.log('[lembrete] Nada a lembrar hoje (sem evento por perto, não é segunda-feira).');
            return;
        }

        let texto = temEvento
            ? '⚠️ *Lembrete importante* — tem evento por perto, rode a importação do Ulisses hoje pra manter presença/matrícula em dia!\n\nEventos:\n'
            : '🔔 Checagem semanal — vale rodar a importação do Ulisses pra não deixar a base desatualizada.\n';
        if (temEvento) {
            for (const ev of eventosProximos) {
                const rotulo = ev.data === hoje ? 'HOJE' : (ev.data === ontem ? 'ontem' : 'amanhã');
                texto += `• ${ev.nome} (${ev.filial}) — ${rotulo}\n`;
            }
        }

        const { data: resultado, error: erroEnvio } = await supabaseAdmin.functions.invoke('lembrete-scraper', { body: { texto } });
        if (erroEnvio || (resultado && resultado.ok === false)) {
            console.warn('[lembrete] Falha ao enviar lembrete por WhatsApp:', erroEnvio?.message || JSON.stringify(resultado));
        } else {
            console.log('[lembrete] Lembrete de importação do Ulisses enviado por WhatsApp.');
        }
    } catch (e) {
        console.warn('[lembrete] Erro inesperado (não interrompe o job):', e.message);
    }
}

async function main() {
    let browser;
    let page;
    let pageCrm; // aba/contexto SEPARADO pro CRM publicado (sem httpCredentials do Mercúrio) — usado só quando alguma turma tem matrícula recente
    try {
        const httpAuth = await lerCredencial('mercurio_http', null);
        const { usuario: matricula, senha } = await lerCredencial('mercurio', null);

        browser = await chromium.launch();
        const context = await browser.newContext({
            httpCredentials: { username: httpAuth.usuario, password: httpAuth.senha },
        });
        page = await context.newPage();
        pageCrm = await (await browser.newContext()).newPage();

        await loginMercurio(page, matricula, senha);
        console.log('[mercurio] Login OK');

        const cadastrosTodos = await listarLinksCadastro(page);
        if (cadastrosTodos.length === 0) throw new Error('Nenhum link "CADASTRO" encontrado na tela pós-login — layout pode ter mudado.');

        // Filtro opcional por linha de comando (node mercurio.js -- "Garavelo"
        // ou npm run mercurio -- "Garavelo") — mesmo padrão de
        // ulisses-local.js, útil pra testar 1 filial só sem esperar todas.
        // `FILTRO_FILIAL` (env var) é o MESMO filtro, só que vindo do
        // workflow_dispatch do GitHub Actions (ver .github/workflows/
        // scraper.yml + supabase/functions/scraper-disparar) — é assim que
        // o botão "Rodar Mercúrio Agora" do CRM consegue disparar só 1
        // filial em vez de sempre rodar as 4 (pedido do usuário 2026-09-10:
        // testar mudança numa filial só, e evitar tráfego desnecessário no
        // Mercúrio conforme mais filiais forem entrando).
        // Comparação ROBUSTA (mesma técnica de resolverFilialCrm() acima):
        // tira acento e palavra genérica dos 2 lados antes de comparar, não
        // um `.includes()` bruto — funciona tanto pra uma palavra simples
        // digitada à mão ("Garavelo") quanto pro `filiais.nome` inteiro
        // vindo do CRM ("Goiânia - Garavelo", "Barra do Garças/MT").
        //
        // MODO COMPLETO (`--completo` ou env MODO_COMPLETO=true) — pensado
        // pra importação INICIAL (alimentar o CRM todo com e-mail/cidade/
        // UF de cada aluno, via tela ENDEREÇOS) ou uma reconferência pontual
        // — bem mais lento (visita a ficha de TODO aluno de TODA turma), de
        // propósito NÃO exposto como input do workflow_dispatch (ver
        // .github/workflows/scraper.yml): só roda via CLI/`.env` local
        // (`npm run mercurio-completo -- "Garavelo"`), nunca pelo botão
        // "Rodar Mercúrio Agora" do CRM nem pelo cron diário. Sem a flag,
        // roda no MODO INCREMENTAL de sempre (só ingressos do mês corrente
        // + candidatos a reingresso, ver processarTurmas()).
        // `--turma "NOME"` (ou env FILTRO_TURMA) — filtro extra, pensado
        // pra um teste RÁPIDO (1 turma só) validando HISTÓRICO/ENDEREÇOS
        // antes de soltar uma rodada completa de horas (ver
        // processarTurmas()) — combina com `--completo` pra também testar
        // ENDEREÇOS, não só o telefone/reingresso do modo incremental.
        // BUG REAL corrigido (2026-09-11, achado testando `--completo` +
        // filial + `--turma` juntos pela 1ª vez): quando o Node roda um
        // ARQUIVO .js (não `-e`) com um `--` solto na linha de comando (ex:
        // `node mercurio.js -- --completo "Garavelo"`, exatamente o padrão
        // usado pelo script `mercurio-completo` do package.json), esse `--`
        // fica LITERALMENTE dentro de `process.argv` — Node não remove
        // sozinho. Sem filtrar isso fora, `argv.find(...)` podia pegar o
        // próprio `'--'` como se fosse o filtro de filial (index 0 batendo
        // antes de "Garavelo"), fazendo a rodada processar TODAS as
        // filiais mesmo pedindo uma só.
        const argv = process.argv.slice(2).filter(a => a !== '--');
        const modoCompleto = argv.includes('--completo') || process.env.MODO_COMPLETO === 'true';
        const idxTurma = argv.indexOf('--turma');
        const filtroTurma = idxTurma !== -1 ? argv[idxTurma + 1] : (process.env.FILTRO_TURMA || null);
        // BUG REAL corrigido (2026-09-11): quando `--turma` está AUSENTE
        // (idxTurma = -1), `idxTurma + 1` vale 0 — e a exclusão abaixo
        // acabava descartando SEMPRE o elemento no índice 0, mesmo sem
        // nenhum --turma pra justificar isso. Como o nome da filial quase
        // sempre é o ÚNICO argumento (índice 0) quando não se usa
        // --completo/--turma, isso fazia o filtro de filial ser
        // silenciosamente ignorado (rodava nas 4 filiais mesmo pedindo 1)
        // — achado testando `node mercurio.js "Barra do Garças"` sem mais
        // nada. Só exclui o índice do valor de --turma quando --turma de
        // fato existir.
        const filtro = argv.find((a, i) => a !== '--completo' && a !== '--turma' && (idxTurma === -1 || i !== idxTurma + 1)) || process.env.FILTRO_FILIAL || null;
        const filtroNucleo = filtro ? nucleoDistintivoFilial(filtro) : null;
        const cadastros = filtroNucleo
            ? cadastrosTodos.filter(c => normalizarTextoFilial(c.label).includes(filtroNucleo))
            : cadastrosTodos;
        if (cadastros.length === 0) throw new Error(`Nenhuma filial bate com o filtro "${filtro}" (filiais encontradas: ${cadastrosTodos.map(c => c.label).join(', ')}).`);
        console.log(`[mercurio] ${cadastros.length} filial(is) encontrada(s): ${cadastros.map(c => c.label).join(', ')}`);

        let algumaFalha = false;
        let totalRecuperadosGeral = 0;
        let totalEnderecosGeral = 0;
        for (const { label } of cadastros) {
            let caminhoAtivos = null, caminhoInativos = null;
            try {
                ({ caminhoAtivos, caminhoInativos } = await exportarAtivosEInativos(page, label));
                console.log(`[mercurio] Ativos/Inativos exportados — ${label}: ${caminhoAtivos}, ${caminhoInativos}`);
            } catch (e) {
                algumaFalha = true;
                console.error(`[mercurio] Falha ao exportar Ativos/Inativos de "${label}":`, e.message);
                fs.mkdirSync('debug', { recursive: true });
                await page.screenshot({ path: `debug/mercurio-ativos-${label.replace(/[^a-z0-9]/gi, '_')}.png`, fullPage: true }).catch(() => {});
            }
            // filialCrm não depende de navegação nenhuma (é só uma busca
            // na tabela `filiais` do Supabase) — resolvido logo aqui,
            // antes de tudo que precisa dele.
            const filialCrm = await resolverFilialCrm(label);

            // Importa Ativos/Inativos DIRETO no CRM publicado (marco 3,
            // pilotando a tela de Importar — ver scraper/importar-no-crm.js),
            // agora que a importação aceita rodar só com Mercúrio (ver
            // "Importação PARCIAL" no CLAUDE.md). Sem isso, o job diário só
            // exportava o CSV pro disco (útil pra importação manual), mas
            // NUNCA atualizava tag Ativo/Inativo/Nível de ninguém no CRM
            // sozinho — a causa raiz de leads ficarem com a tag errada/
            // desatualizada até alguém reimportar manualmente pela aba
            // Importar. **BUG REAL corrigido (2026-09-11)**: este passo
            // rodava DEPOIS de Aniversariantes — numa filial recém-zerada
            // (ex: depois de uma limpeza total), o sync de Aniversariantes
            // (data_nascimento/e-mail/cidade/UF) tentava casar por nome
            // contra leads que AINDA NÃO EXISTIAM, e todo mundo caía em
            // "sem lead correspondente" (achado testando de verdade contra
            // Barra do Garças/MT, recém-zerada nesta sessão: 112 de 112
            // sem match). Agora roda ANTES de Aniversariantes/Turmas —
            // essas duas precisam de leads já existentes/atualizados no
            // CRM pra achar quem casar.
            if (filialCrm && (caminhoAtivos || caminhoInativos)) {
                try {
                    const log = await importarNoCrm(pageCrm, filialCrm, { caminhoAtivos, caminhoInativos, caminhoInscricoes: null });
                    console.log(`[mercurio] Ativos/Inativos importados no CRM — ${filialCrm}: ${log.slice(-500)}`);
                } catch (e) {
                    algumaFalha = true;
                    console.error(`[mercurio] Falha ao importar Ativos/Inativos no CRM de "${filialCrm}":`, e.message);
                    fs.mkdirSync('debug', { recursive: true });
                    await pageCrm.screenshot({ path: `debug/mercurio-importar-crm-${label.replace(/[^a-z0-9]/gi, '_')}.png`, fullPage: true }).catch(() => {});
                }
            }

            // Círculo de Amigos/Correntinha/Távolas/Janos — pessoas que
            // NUNCA aparecem em "Ativos" (confirmado por print real,
            // 2026-09-10/11), então sem isso nunca ganhavam lead nenhum.
            // Roda ANTES de Aniversariantes, pra quem for criado aqui
            // agora também já poder ser enriquecido com e-mail/cidade/UF
            // na etapa seguinte, se aparecer lá.
            await page.goto(URL_FUNCOES, { waitUntil: 'domcontentloaded' }).catch(() => {});
            if (filialCrm) {
                try {
                    const { totalNovos, totalEnriquecidos } = await processarComplementar(page, filialCrm, label);
                    console.log(`[complementar] ${filialCrm}: ${totalNovos} lead(s) novo(s), ${totalEnriquecidos} enriquecido(s) (Ativo/CA/Merlin/JN).`);
                } catch (e) {
                    algumaFalha = true;
                    console.error(`[mercurio] Falha ao processar programas Complementares de "${filialCrm}":`, e.message);
                    fs.mkdirSync('debug', { recursive: true });
                    await page.screenshot({ path: `debug/mercurio-complementar-${label.replace(/[^a-z0-9]/gi, '_')}.png`, fullPage: true }).catch(() => {});
                }
            }

            // Volta pra tela de funções antes de Aniversariantes — cada
            // etapa reabre a navegação (CADASTRO -> ...) do zero, mesmo
            // padrão de isolamento de falha já usado no Ulisses (uma
            // etapa falhar não devia impedir as outras).
            await page.goto(URL_FUNCOES, { waitUntil: 'domcontentloaded' }).catch(() => {});
            try {
                const caminhoAniversariantes = await exportarAniversariantes(page, label);
                const resultadoSync = await sincronizarAniversariantesNoCrm(label);
                console.log(`[mercurio] Aniversariantes exportados — ${label}: ${caminhoAniversariantes} — ${resultadoSync}`);
                if (filialCrm) await verificarAniversariosAtivosHoje(filialCrm);
            } catch (e) {
                algumaFalha = true;
                console.error(`[mercurio] Falha ao exportar/sincronizar Aniversariantes de "${label}":`, e.message);
                fs.mkdirSync('debug', { recursive: true });
                await page.screenshot({ path: `debug/mercurio-aniversariantes-${label.replace(/[^a-z0-9]/gi, '_')}.png`, fullPage: true }).catch(() => {});
            }
            await page.goto(URL_FUNCOES, { waitUntil: 'domcontentloaded' }).catch(() => {});

            try {
                if (filialCrm) {
                    const resultadoTurmas = await processarTurmas(page, pageCrm, filialCrm, label, modoCompleto, filtroTurma);
                    totalRecuperadosGeral += resultadoTurmas.totalRecuperados;
                    totalEnderecosGeral += resultadoTurmas.totalEnderecosAtualizados;
                    console.log(`[turmas] ${label}: ${resultadoTurmas.totalProcessadas} matrícula(s) do mês corrente, ${resultadoTurmas.totalRecuperados} recuperação(ões), ${resultadoTurmas.totalEnderecosAtualizados} endereço(s) atualizado(s), ${resultadoTurmas.totalTelefonesPreenchidos} telefone(s) preenchido(s).`);
                }
            } catch (e) {
                algumaFalha = true;
                console.error(`[mercurio] Falha na varredura de turmas de "${label}":`, e.message);
                fs.mkdirSync('debug', { recursive: true });
                await page.screenshot({ path: `debug/mercurio-turmas-${label.replace(/[^a-z0-9]/gi, '_')}.png`, fullPage: true }).catch(() => {});
            }
            // Volta pra tela de funções antes da próxima filial, com ou
            // sem erro — senão a próxima iteração começa num lugar errado.
            await page.goto(URL_FUNCOES, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }

        const sufixoFiltro = filtro ? ` (filtro: "${filtro}")` : '';
        const sufixoModo = modoCompleto ? ' [MODO COMPLETO]' : '';
        await registrarStatusSincronizacao('mercurio', null, !algumaFalha, algumaFalha
            ? `Login OK, mas 1+ exportação (Ativos/Inativos ou Aniversariantes) falhou — ver logs e prints do workflow.${sufixoFiltro}${sufixoModo}`
            : `Login + exportação de Ativos/Inativos + Aniversariantes (já sincronizados no CRM) OK para ${cadastros.length} filial(is)${sufixoFiltro}${sufixoModo} — ${totalRecuperadosGeral} recuperação(ões) detectada(s), ${totalEnderecosGeral} endereço(s) atualizado(s).`);

        // Roda sempre, mesmo se alguma filial falhou acima — o lembrete de
        // rodar o Ulisses importa MAIS ainda quando algo deu errado.
        await verificarLembreteImportacaoUlisses();
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

// Cancelar o workflow direto no GitHub Actions mata o processo com
// SIGINT/SIGTERM — sem um handler, ele simplesmente morre sem gravar
// NADA em status_sincronizacao_automatica, e a tela "Sincronização
// Automática" do CRM fica presa em "Rodando..." até o timeout de 20min do
// poll (bug real relatado pelo usuário, 2026-09-10: "parei direto no
// github, mas continue rodando no crm"). GitHub Actions dá ~7.5s de
// folga entre o SIGINT e o SIGKILL final — best-effort, com timeout
// próprio pra nunca segurar o processo além dessa janela.
let cancelamentoEmAndamento = false;
async function tratarCancelamento(sinal) {
    if (cancelamentoEmAndamento) return;
    cancelamentoEmAndamento = true;
    console.error(`[mercurio] Recebido ${sinal} — gravando status de cancelamento antes de sair...`);
    try {
        await Promise.race([
            registrarStatusSincronizacao('mercurio', null, false, `Cancelado (${sinal}) — provavelmente cancelamento manual direto no GitHub Actions. Nenhum dado foi processado por esta rodada.`),
            new Promise(resolve => setTimeout(resolve, 5000)),
        ]);
    } catch { /* melhor esforço — sair é mais importante que garantir o registro */ }
    process.exit(1);
}
process.on('SIGINT', () => tratarCancelamento('SIGINT'));
process.on('SIGTERM', () => tratarCancelamento('SIGTERM'));

main();

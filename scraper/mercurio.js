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

// Aniversariantes (menu "Relatórios" → "Aniversariantes", uni_cadani.php)
// — a tela só mostra 1 situação + 1 mês por vez (2 <select>, cada um
// resubmete o formulário sozinho no onchange), sem opção "todos" em
// nenhum dos dois — por isso a varredura completa (pedida pelo usuário,
// "todo mundo, inclusive inativos") precisa passar pelas 6 situações x
// 12 meses = 72 combinações, por filial. Colunas da tabela: Nome, Sit.,
// Nasc. (DD/MM/AAAA — data completa, com ano), Fone, Endereço (o e-mail
// vem embutido no fim desse texto livre, não usado aqui), Dia de Aula.
async function exportarAniversariantes(page, label, indice) {
    const framePrincipal1 = await esperarFrame(page, 'principal', /ger_funcao\.php/, 15000);
    await framePrincipal1.getByRole('link', { name: 'CADASTRO', exact: true }).nth(indice).click();
    const frameIndice = await esperarFrame(page, 'indice', /uni_indice\.php/, 15000);

    await frameIndice.getByText('Aniversariantes', { exact: true }).click();
    const frame = await esperarFrame(page, 'principal', /uni_cadani\.php/, 15000);

    const registros = [];
    const vistos = new Set(); // matr (ou nome, se não achou matr) — evita duplicar quem aparece 2x (ex: mudou de situação no meio do ano)
    for (const sit of SITUACOES_ANIVERSARIANTES) {
        await frame.locator('select[name="sit"]').selectOption({ value: sit });
        await page.waitForTimeout(700); // sem indicador de carregamento claro — espera curta e fixa, mesmo padrão do resto do arquivo
        for (const mes of MESES_ANIVERSARIANTES) {
            await frame.locator('select[name="mes"]').selectOption({ value: mes });
            await page.waitForTimeout(700);

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
                registros.push({ matricula, nome, nascimento, situacao: sit });
            }
        }
    }

    fs.mkdirSync(PASTA_EXPORTS, { recursive: true });
    const slug = label.replace(/[^a-z0-9]/gi, '_');
    const caminho = `${PASTA_EXPORTS}/mercurio-aniversariantes-${slug}.json`;
    await escreverComRetentativa(caminho, JSON.stringify(registros, null, 2), 'utf-8');
    return caminho;
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

async function resolverFilialCrm(labelMercurio) {
    const { data: filiais, error } = await supabaseAdmin.from('filiais').select('nome').eq('ativo', true);
    if (error) throw new Error('Erro ao buscar filiais do CRM: ' + error.message);
    const labelNorm = normalizarTextoFilial(labelMercurio);
    for (const f of filiais || []) {
        const nucleo = normalizarTextoFilial(f.nome)
            .split(' ')
            .filter(p => p && !PALAVRAS_GENERICAS_FILIAL.has(p))
            .join(' ');
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

    const porNome = new Map(); // nome normalizado -> { pessoaIdentificador, temData, ambiguo }
    const TAMANHO_PAGINA = 1000;
    for (let de = 0; ; de += TAMANHO_PAGINA) {
        const { data: pagina, error } = await supabaseAdmin
            .from('leads_inscricoes')
            .select('pessoaIdentificador, pessoaNome, data_nascimento')
            .eq('filial', filial)
            .order('pessoaIdentificador', { ascending: true })
            .range(de, de + TAMANHO_PAGINA - 1);
        if (error) throw new Error('Erro ao buscar leads da filial: ' + error.message);
        for (const lead of pagina || []) {
            const chave = normalizarNomeMercurio(lead.pessoaNome);
            if (!chave) continue;
            const existente = porNome.get(chave);
            if (existente) existente.ambiguo = true;
            else porNome.set(chave, { pessoaIdentificador: lead.pessoaIdentificador, temData: !!lead.data_nascimento, ambiguo: false });
        }
        if (!pagina || pagina.length < TAMANHO_PAGINA) break;
    }

    let atualizados = 0, semLead = 0, ambiguos = 0, jaTinhaData = 0;
    for (const r of registros) {
        const dataISO = dataBRParaISO(r.nascimento);
        if (!dataISO) continue;
        const alvo = porNome.get(normalizarNomeMercurio(r.nome));
        if (!alvo) { semLead++; continue; }
        if (alvo.ambiguo) { ambiguos++; continue; }
        if (alvo.temData) { jaTinhaData++; continue; }

        const { error } = await supabaseAdmin
            .from('leads_inscricoes')
            .update({ data_nascimento: dataISO })
            .eq('pessoaIdentificador', alvo.pessoaIdentificador);
        if (!error) {
            atualizados++;
            alvo.temData = true; // evita reprocessar se o mesmo nome aparecer 2x na exportação
        }
    }

    return `${atualizados} lead(s) com data de nascimento preenchida, de ${registros.length} aniversariante(s) do Mercúrio (${semLead} sem lead correspondente por nome, ${ambiguos} nome ambíguo/homônimo, ${jaTinhaData} já tinham data preenchida).`;
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

// Varre TODAS as turmas da filial (menu "Turmas", uni_esctur.php) — entra
// em cada uma e faz 2 coisas:
// (1) grava dia/horário de TODA turma em `turmas` (migracao_turmas.sql),
//     base do "Mapa de Turmas" no CRM (js/mapa-turmas.js);
// (2) lê a tabela de alunos (Matr./Nome/Origem/Ingresso/Fone) e separa
//     quem ingressou no MÊS CORRENTE (não o padrão de 90 dias usado no
//     paste manual, ehMatriculaRecente() em js/matricula-importar.js —
//     aqui é "matriculados NESTE MÊS" de propósito, pedido explícito do
//     usuário, e o pré-filtro acontece AQUI, antes de qualquer coisa
//     chegar na tela do CRM, então esse limite não afeta em nada o
//     fluxo manual). Quem bate é colado na tela "Importar Matrícula" do
//     CRM publicado (marco 3 — scraper/importar-matricula-no-crm.js),
//     reaproveitando 100% da lógica de casamento/tags/dedup que já
//     existe — não reimplementa nada disso aqui.
//
// A "Matr." VISÍVEL nessa tabela é só um índice de linha (1, 2, 3...),
// NÃO a matrícula real — confirmado no HTML ao vivo (a matrícula de
// verdade só existe no href do link do nome, uni_cadfun.php?matr=XXXXX).
// Por isso não dá pra só imitar um "copiar e colar" ingênuo — o texto
// colado é montado aqui já com o número certo extraído do link.
async function processarMatriculasRecentesTurmas(page, pageCrm, filialCrm, label, indice) {
    const mesAtual = hojeBrasil().slice(0, 7); // "AAAA-MM"
    let crmAberto = false;
    let totalProcessadas = 0;

    const entrarNoIndiceDaFilial = async () => {
        const fp = await esperarFrame(page, 'principal', /ger_funcao\.php/, 15000);
        await fp.getByRole('link', { name: 'CADASTRO', exact: true }).nth(indice).click();
        return esperarFrame(page, 'indice', /uni_indice\.php/, 15000);
    };

    let frameIndice = await entrarNoIndiceDaFilial();
    await frameIndice.getByText('Turmas', { exact: true }).first().click();
    let frameTurmas = await esperarFrame(page, 'principal', /uni_esctur\.php/, 15000);

    const nomesTurmas = [...new Set((await frameTurmas.locator('a[href^="uni_esctal.php?turma="]').allTextContents()).map(t => t.trim()).filter(Boolean))];
    console.log(`[matricula-turma] ${nomesTurmas.length} turma(s) encontrada(s) em ${filialCrm} — procurando ingressos de ${mesAtual}.`);
    let totalAlunosLidos = 0;

    for (const nomeTurma of nomesTurmas) {
        try {
            frameTurmas = await esperarFrame(page, 'principal', /uni_esctur\.php/, 15000);
            await frameTurmas.getByRole('link', { name: nomeTurma, exact: true }).click();
            const frameDetalhe = await esperarFrame(page, 'principal', /uni_esctal\.php/, 15000);

            const diaTexto = await frameDetalhe.locator('td:has-text("Dia:")').first().innerText().catch(() => '');
            const horarioTexto = await frameDetalhe.locator('td:has-text("Horário:")').first().innerText().catch(() => '');
            const dia = diaTexto.replace(/^Dia:\s*/i, '').trim();
            const horario = horarioTexto.replace(/^Horário:\s*/i, '').trim();

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
                if (!matr || !nome || mesAnoDoIngresso(ingresso) !== mesAtual) continue;
                recentes.push({ matr, nome, origem, ingresso, fone });
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
                totalProcessadas += recentes.length;
                console.log(`[matricula-turma] ${recentes.length} matrícula(s) de ${mesAtual} na turma "${nomeTurma}" (${filialCrm}) processada(s).`);
            }
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

    console.log(`[matricula-turma] ${totalAlunosLidos} aluno(s) lidos no total em ${filialCrm}; ${totalProcessadas} matrícula(s) de ${mesAtual} encontrada(s).`);
    return totalProcessadas;
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
        const filtro = process.argv[2];
        const cadastros = filtro
            ? cadastrosTodos.filter(c => c.label.toLowerCase().includes(filtro.toLowerCase()))
            : cadastrosTodos;
        if (cadastros.length === 0) throw new Error(`Nenhuma filial bate com o filtro "${filtro}" (filiais encontradas: ${cadastrosTodos.map(c => c.label).join(', ')}).`);
        console.log(`[mercurio] ${cadastros.length} filial(is) encontrada(s): ${cadastros.map(c => c.label).join(', ')}`);

        let algumaFalha = false;
        for (const { label, indice } of cadastros) {
            let caminhoAtivos = null, caminhoInativos = null;
            try {
                ({ caminhoAtivos, caminhoInativos } = await exportarAtivosEInativos(page, label, indice));
                console.log(`[mercurio] Ativos/Inativos exportados — ${label}: ${caminhoAtivos}, ${caminhoInativos}`);
            } catch (e) {
                algumaFalha = true;
                console.error(`[mercurio] Falha ao exportar Ativos/Inativos de "${label}":`, e.message);
                fs.mkdirSync('debug', { recursive: true });
                await page.screenshot({ path: `debug/mercurio-ativos-${label.replace(/[^a-z0-9]/gi, '_')}.png`, fullPage: true }).catch(() => {});
            }
            // Volta pra tela de funções antes de Aniversariantes — cada
            // etapa reabre a navegação (CADASTRO -> ...) do zero, mesmo
            // padrão de isolamento de falha já usado no Ulisses (uma
            // etapa falhar não devia impedir as outras).
            await page.goto(URL_FUNCOES, { waitUntil: 'domcontentloaded' }).catch(() => {});
            let filialCrm = null;
            try {
                const caminhoAniversariantes = await exportarAniversariantes(page, label, indice);
                const resultadoSync = await sincronizarAniversariantesNoCrm(label);
                console.log(`[mercurio] Aniversariantes exportados — ${label}: ${caminhoAniversariantes} — ${resultadoSync}`);
                filialCrm = await resolverFilialCrm(label);
                if (filialCrm) await verificarAniversariosAtivosHoje(filialCrm);
            } catch (e) {
                algumaFalha = true;
                console.error(`[mercurio] Falha ao exportar/sincronizar Aniversariantes de "${label}":`, e.message);
                fs.mkdirSync('debug', { recursive: true });
                await page.screenshot({ path: `debug/mercurio-aniversariantes-${label.replace(/[^a-z0-9]/gi, '_')}.png`, fullPage: true }).catch(() => {});
            }
            await page.goto(URL_FUNCOES, { waitUntil: 'domcontentloaded' }).catch(() => {});

            // Importa Ativos/Inativos DIRETO no CRM publicado (marco 3,
            // pilotando a tela de Importar — ver scraper/importar-no-crm.js),
            // agora que a importação aceita rodar só com Mercúrio (ver
            // "Importação PARCIAL" no CLAUDE.md). Sem isso, o job diário só
            // exportava o CSV pro disco (útil pra importação manual), mas
            // NUNCA atualizava tag Ativo/Inativo/Nível de ninguém no CRM
            // sozinho — a causa raiz de leads ficarem com a tag errada/
            // desatualizada até alguém reimportar manualmente pela aba
            // Importar. Roda ANTES da varredura de turmas (linha abaixo):
            // ela precisa de leads já existentes/atualizados no CRM pra
            // achar matrícula recente por telefone.
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

            try {
                if (filialCrm) {
                    const total = await processarMatriculasRecentesTurmas(page, pageCrm, filialCrm, label, indice);
                    console.log(`[matricula-turma] ${label}: ${total} matrícula(s) do mês corrente processada(s) via varredura de turmas.`);
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

        await registrarStatusSincronizacao('mercurio', null, !algumaFalha, algumaFalha
            ? 'Login OK, mas 1+ exportação (Ativos/Inativos ou Aniversariantes) falhou — ver logs e prints do workflow.'
            : `Login + exportação de Ativos/Inativos + Aniversariantes (já sincronizados no CRM) OK para ${cadastros.length} filial(is).`);

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

main();

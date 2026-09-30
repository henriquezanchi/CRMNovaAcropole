// Abre um Chromium VISÍVEL, direto na página pública de inscrição de um
// evento do Ulisses — pedido do usuário (2026-09-28, reunião com a
// Ediliene): "podemos retomar a ideia de que o próprio crm fará as
// inscrições... nem que eu tenha que acionar um botão manualmente, para
// abrir o navegador e a partir daí o crm começar a preencher os dados".
//
// Etapa 1: só NAVEGA até a URL certa — zero seletor novo. Preenchimento
// automático dos campos PESSOAIS (nome/telefone/e-mail) continua sendo a
// Etapa 2, travada até o HTML real do formulário de DADOS PESSOAIS
// chegar (CLAUDE.md: nunca escrever seletor "no chute"). Enquanto isso, o
// SDR já tem os dados na área de transferência
// (copiarDadosInscreverEvento(), js/eventos.js) e só precisa colar.
//
// 2026-09-30 — PARCIAL da Etapa 2, com HTML real confirmado (print do
// usuário, DevTools): a tela "Selecione a unidade de interesse" usa
// `<input type="radio" name="selecao" id="{filialId}">` — o `id` de cada
// rádio é o MESMO `filialId` do sistema do Ulisses já mapeado em
// CLAUDE.md/scraper/importar-ulisses-api.js (ex: id="14" = Ap. de
// Goiânia - Garavelo). Como isso é só NAVEGAÇÃO + CLIQUE num rádio (não
// digitar em campo nenhum), dá pra automatizar com segurança: o script
// agora recebe a filial do CRM e, se ela estiver no mapa conhecido, marca
// a unidade certa sozinho — o SDR só precisa colar nome/telefone/e-mail e
// clicar "Inscrever" (nunca feito por aqui, mesma cautela de sempre).
//
// Acionado pelo botão "Abrir e Preparar Inscrição" (js/eventos.js,
// modal #modalInscreverEvento) via protocolo customizado
// `abririnscricao://rodar?url=...&filial=...` — mesmo mecanismo já
// registrado no Windows pra `abrirulisses://`/`abrirulissesapi://` (ver
// CLAUDE.md, "'Botão' de acionar o Ulisses"). Registro do protocolo em si
// é feito 1x no Windows (fora deste arquivo) apontando DIRETO pro
// node.exe, nunca por um `.bat`/`cmd.exe` no meio (corrompe a querystring
// codificada — já documentado como bug real achado antes).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

process.chdir(path.dirname(fileURLToPath(import.meta.url)));

// Mesmo mapa já confirmado em scraper/importar-ulisses-api.js (achado
// consultando filiaisAtivas() da API oficial) — reproduzido aqui (não
// importado) porque este script não tem acesso à API/cofre de
// credenciais, só abre um navegador visível e clica.
const FILIAL_ID_ULISSES_POR_NOME_CRM = {
    'Goiânia - Jardim América': 15,
    'Goiânia - Setor Oeste': 132,
    'Goiânia - Garavelo': 14,
    'Barra do Garças/MT': 44,
    'Goiânia II': 65,
};

const argRaw = process.argv[2];
let urlDestino = null;
let filialCrm = null;
if (argRaw && argRaw.startsWith('abririnscricao://')) {
    try {
        const url = new URL(argRaw);
        urlDestino = url.searchParams.get('url');
        filialCrm = url.searchParams.get('filial');
    } catch { /* URL malformada — trata como ausente abaixo */ }
} else {
    // Também aceita passar a URL direto (uso manual/teste, sem protocolo):
    // node abrir-inscricao-assistida.js "https://inscricao.acropolebrasil.com.br/?eventoId=..." "Goiânia - Garavelo"
    urlDestino = argRaw || null;
    filialCrm = process.argv[3] || null;
}

if (!urlDestino) {
    console.error('Uso: node abrir-inscricao-assistida.js "<url de inscrição>" ["<filial>"]\nOu via protocolo: abririnscricao://rodar?url=<url codificada>&filial=<nome codificado>');
    process.exit(1);
}

console.log('Abrindo:', urlDestino);
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto(urlDestino, { waitUntil: 'domcontentloaded' });

// Seleção automática da unidade — só quando a filial é conhecida E o
// rádio correspondente existe de fato na página (evento pode não listar
// todas as unidades). Best-effort: qualquer falha aqui vira aviso, nunca
// impede o resto do fluxo manual.
const filialIdUlisses = filialCrm ? FILIAL_ID_ULISSES_POR_NOME_CRM[filialCrm] : null;
if (filialIdUlisses) {
    try {
        const radio = page.locator(`input[name="selecao"][id="${filialIdUlisses}"]`);
        await radio.waitFor({ state: 'visible', timeout: 8000 });
        await radio.check();
        console.log(`Unidade selecionada automaticamente: ${filialCrm} (id=${filialIdUlisses}).`);
    } catch (e) {
        console.warn(`Não consegui marcar a unidade "${filialCrm}" sozinho (talvez este evento não liste essa unidade) — selecione manualmente. Detalhe: ${e.message}`);
    }
} else if (filialCrm) {
    console.log(`Filial "${filialCrm}" ainda não está no mapa de seleção automática — selecione a unidade manualmente.`);
}

console.log('Página aberta — cole os dados (já copiados pelo CRM) e conclua a inscrição manualmente. Esta janela fica aberta até você fechar.');
// Nunca fecha o browser sozinho, e NUNCA clica em "Inscrever" — o SDR
// sempre confere e confirma manualmente (mesma cautela de
// scraper/importar-no-crm.js, que também nunca decide sozinho quando algo
// é ambíguo ou definitivo).

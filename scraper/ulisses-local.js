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
// mais abaixo pra como o e-mail esperado é mostrado no terminal (o campo
// da tela de login NÃO é pré-preenchido — ver comentário ali).
import 'dotenv/config';
import { chromium } from 'playwright';
import { supabaseAdmin, lerCredencial, registrarStatusSincronizacao } from './lib/supabaseAdmin.js';
import { exportarCsvInscricoes, exportarCatalogoEventos, exportarComparecimento, sincronizarCatalogoEventosNoCrm, sincronizarComparecimentoNoCrm, processarFilaDesativacaoUlisses, salvarScreenshotErro } from './ulisses.js';
import { verificarEventosPublicosDeTodasAsFiliais } from './verificar-eventos-publicos.js';
import { importarNoCrm } from './importar-no-crm.js';
// API oficial (eventos + Inscrições) — MOVIDA PRA CÁ (2026-09-21): rodava
// dentro de scraper/mercurio.js (GitHub Actions), mas confirmado testando
// de verdade (2 disparos reais, 2 bloqueios) que api.acropolebrasil.com.br
// está atrás do MESMO Cloudflare que já bloqueava o login por navegador —
// só que aqui o bloqueio acontece numa chamada HTTPS pura (com token
// Bearer válido, sem navegador nenhum envolvido), então "não é navegação
// de browser" NÃO era suficiente pra escapar dele, ao contrário do que se
// assumia. Resposta real recebida do GitHub Actions:
// `GET /facade/filiaisAtivas -> 403 ... "Just a moment..."` (a mesma
// página de desafio do Cloudflare, servida no lugar do JSON esperado).
// Rodando desta máquina (IP residencial, não datacenter), funciona sem
// desafio nenhum — mesmo motivo de sempre pro resto deste arquivo. Ver
// CLAUDE.md, seção "Origem dos vínculos evento_leads"/"API oficial do
// Ulisses" pro histórico completo.
import { sincronizarEventosUlissesApi, sincronizarInscricoesFilialViaApi, resolverFilialIdUlisses } from './importar-ulisses-api.js';
import { filiaisAtivas as filiaisAtivasUlissesApi } from './ulisses-api.js';

const URL_LOGIN = 'https://www.acropolebrasil.com.br/login.html';
const TIMEOUT_LOGIN_MANUAL_MS = 5 * 60 * 1000; // 5 min pra você fazer login na janela

// Não preenchemos SENHA nem clicamos em nada do Auth0 aqui de propósito
// — é exatamente essa parte "cega" (escrita só com prints, sem HTML real)
// que já causou retrabalho no modo automático. Você digita a senha e
// resolve o Cloudflare se aparecer; o script só espera o sinal de que deu
// certo (o menu "Exportar CSV", que só aparece autenticado — mesmo sinal
// que loginUlisses() já usa no modo automático).
//
// O E-MAIL: tentamos PRÉ-PREENCHER via `login_hint` na URL (parâmetro
// padrão do Auth0/OIDC) numa versão anterior — **testado ao vivo pelo
// usuário e revertido**: em vez de só "não funcionar silenciosamente"
// como esperado, o parâmetro quebrou a navegação de verdade (telas
// brancas, URL mudando sozinha em loop, login.html nunca chegou a
// carregar o formulário) — pior que o problema que tentava resolver.
// `login.html` provavelmente lê `location.search`/`location.href` pra
// alguma lógica própria de roteamento/redirect e não esperava esse
// parâmetro extra. Voltamos a navegar pra URL limpa, sem tentar
// preencher nada — a única ajuda que fica é mostrar o e-mail esperado
// bem grande no terminal ANTES da janela abrir, pra digitar de cabeça
// com confiança.
//
// O terminal, porém, NÃO É CONFIÁVEL pra isso na prática — o usuário
// relatou não ter visto a mensagem: o Chromium abre e rouba o foco na
// hora, deixando a janela do terminal escondida atrás dele, então a
// dica passa despercebida. Corrigido mostrando o e-mail DENTRO da
// própria janela do navegador — uma tela intermediária (`page.setContent()`,
// HTML local, sem rede) que exige um clique real do usuário pra
// continuar até a tela de login de verdade. Isso garante que a
// mensagem é vista (é a MESMA janela que a pessoa vai usar pra logar),
// sem depender de qual janela está em primeiro plano. O e-mail também
// continua no terminal, como registro.
async function aguardarLoginManual(page, emailEsperado) {
    if (emailEsperado) {
        await page.setContent(`
            <!doctype html><html><head><meta charset="utf-8">
            <title>E-mail desta filial — confira antes de continuar</title>
            <style>
                body { font-family: -apple-system, Segoe UI, Arial, sans-serif; margin: 0; height: 100vh;
                       display: flex; align-items: center; justify-content: center; background: #1b1b1b; color: #fff; }
                .box { text-align: center; padding: 40px; max-width: 640px; }
                .email { font-size: 30px; font-weight: bold; color: #4ade80; margin: 20px 0; word-break: break-all; }
                .aviso { font-size: 15px; color: #ccc; margin-bottom: 30px; }
                button { font-size: 18px; padding: 14px 28px; cursor: pointer; border: 0; border-radius: 8px;
                         background: #4ade80; color: #111; font-weight: bold; }
                button:hover { background: #22c55e; }
            </style></head>
            <body><div class="box">
                <div>E-mail cadastrado pra esta filial:</div>
                <div class="email">${emailEsperado}</div>
                <div class="aviso">Confira que é este e-mail antes de digitar a senha na próxima tela — o campo NÃO vem preenchido sozinho, é você quem digita.</div>
                <button id="btnContinuar" onclick="window.__ulissesLocalConfirmado = true;">Ir para a tela de login →</button>
            </div></body></html>
        `);
        // Espera o CLIQUE DE VERDADE do usuário (não um clique disparado pelo
        // próprio script) — só assim a mensagem é garantidamente vista antes
        // de seguir pra tela de login.
        // Bug real corrigido (2026-09-14): `waitForFunction(pageFunction,
        // options)` com só 2 argumentos faz o Playwright tratar o objeto
        // `{timeout: ...}` como o 2º parâmetro de verdade (`arg`, dado
        // passado pra função da página), não como `options` — o timeout
        // configurado (5 min) nunca era aplicado, caía sempre no padrão
        // de 30s do Playwright. Confirmado em produção: usuário levou
        // mais que 30s pra clicar "Ir para a tela de login" (tinha
        // acabado de repetir o fluxo 2x por engano de filial) e a espera
        // expirou achando que ele nunca ia clicar. Precisa do 3º
        // argumento explícito pra `options` valer de verdade.
        await page.waitForFunction('window.__ulissesLocalConfirmado === true', null, { timeout: TIMEOUT_LOGIN_MANUAL_MS });
    }
    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
    console.log('   Aguardando você concluir o login nessa janela (até 5 minutos)...');
    await page.getByText('Exportar CSV', { exact: false }).waitFor({ timeout: TIMEOUT_LOGIN_MANUAL_MS });
}

// Tira "Goiânia - " do começo e "/MT" do fim, deixando só a parte que
// distingue uma filial da outra (ex: "SETOR OESTE", "GARAVELO", "JARDIM
// AMERICA", "BARRA DO GARCAS") — usado pra checar, por TEXTO da própria
// tela do Ulisses, se a sessão logada é realmente da filial esperada.
function normalizarTextoFilial(s) {
    // Tira acento filtrando por code point (0x300-0x36f = marcas de
    // combinação Unicode) em vez de um range num regex literal — evita
    // depender de escape \u dentro de um /[...]/ (frágil de digitar/
    // salvar corretamente em edição de texto).
    const semAcento = Array.from((s || '').normalize('NFD'))
        .filter(ch => { const c = ch.codePointAt(0); return c < 0x300 || c > 0x36f; })
        .join('');
    return semAcento.toUpperCase().replace(/\s+/g, ' ').trim();
}
function tokenDistintivoFilial(nomeFilial) {
    return normalizarTextoFilial(nomeFilial).replace(/^GOIANIA\s*-\s*/, '').replace(/\/MT$/, '').trim();
}

// Confirma, por um sinal da PRÓPRIA tela do Ulisses, que a sessão logada
// nesta janela é de fato da filial esperada — bug real achado pelo
// usuário (2026-09-10): eventos genuinamente exclusivos do Garavelo
// ("Bushido, o código de honra dos samurais"/"Workshop de Oratória",
// confirmados ausentes do site público de Setor Oeste/Jardim América)
// apareceram cadastrados sob "Goiânia - Setor Oeste" no CRM. Não é bug
// de lógica do scraper (ver CLAUDE.md, correção do diagnóstico anterior)
// — a explicação mais provável é confusão humana no login manual: digitar
// a senha (ou aceitar uma senha salva no gerenciador do navegador) de UMA
// filial na janela que o script abriu pensando ser de OUTRA — o script
// então roda achando que está exportando/gravando dados de "Setor Oeste",
// mas na verdade está autenticado como Garavelo.
//
// Reescrito com HTML real (2026-09-11, print do usuário) — bem mais
// simples do que a versão anterior (que clicava no link "Filial" do menu
// e lia a PÁGINA INTEIRA por substring, nunca confirmado contra HTML
// real): o nome da filial logada já fica sempre visível, sem precisar
// clicar em nada — <a class="ng-binding"> dentro de <ul class="nav
// navbar-nav navbar-right">, bem ao lado de "[SAIR]". Confirmado pelo
// usuário que cada filial mostra um texto DIFERENTE ali — só que o de
// Jardim América é o caso "base", sem sufixo nenhum ("Nova Acrópole -
// Goiás - Goiânia"); as outras 3 (Setor Oeste/Garavelo/Barra do Garças)
// presumivelmente têm um sufixo próprio, ainda NÃO confirmado
// individualmente (se aparecer um falso-alarme/`ok: null` para alguma
// delas, mandar o texto exato que aparece ali resolve de vez). Nunca
// bloqueia por uma leitura inconclusiva — só aborta quando o texto bate
// claramente com OUTRA filial conhecida.
const TEXTO_BASE_GOIANIA = 'NOVA ACROPOLE - GOIAS - GOIANIA';
async function verificarFilialLogada(page, filialEsperada, todasFiliaisNomes) {
    // Bug real confirmado pelo usuário (2026-09-14): esse texto pode
    // demorar mais que o normal pra carregar (servidor do Ulisses lento
    // num dia específico) — lendo cedo demais, `textoBruto` vinha VAZIO
    // (nada renderizado ainda), e um texto vazio normaliza pra um
    // "sufixo vazio" — exatamente o mesmo sinal do caso genuíno de
    // Jardim América ("Nova Acrópole - Goiás - Goiânia", que também não
    // tem sufixo). Sem distinguir "ainda carregando" de "é Jardim
    // América de verdade", 3 tentativas reais de Garavelo foram
    // erradamente abortadas como se fossem Jardim América. Corrigido com
    // espera ATIVA por um texto BRUTO não-vazio (até 10s, mesmo padrão já
    // usado em exportarComparecimento()/exportarCatalogoEventos() pra
    // esperar o Angular render de verdade) — só depois disso o "sufixo
    // vazio" pode ser tratado como o caso genuíno de Jardim América.
    let textoBruto = '';
    try {
        const locator = page.locator('ul.navbar-right a.ng-binding').first();
        for (let tentativa = 0; tentativa < 20 && !textoBruto.trim(); tentativa++) {
            textoBruto = await locator.innerText({ timeout: 1000 }).catch(() => '');
            if (!textoBruto.trim()) await page.waitForTimeout(500);
        }
    } catch (e) {
        return { ok: null, motivo: `Não consegui ler o nome da filial logada pra confirmar (${e.message}) — seguindo mesmo assim.` };
    }
    if (!textoBruto.trim()) {
        return { ok: null, motivo: 'O nome da filial logada não carregou a tempo (10s) — seguindo mesmo assim, confira manualmente se os dados exportados fazem sentido.' };
    }

    const texto = normalizarTextoFilial(textoBruto);
    const sufixo = texto.startsWith(TEXTO_BASE_GOIANIA) ? texto.slice(TEXTO_BASE_GOIANIA.length).trim() : texto;
    const ehJardimAmerica = tokenDistintivoFilial(filialEsperada) === 'JARDIM AMERICA';

    if (ehJardimAmerica && !sufixo) return { ok: true }; // caso "base" confirmado
    const tokenEsperado = tokenDistintivoFilial(filialEsperada);
    if (!ehJardimAmerica && tokenEsperado && sufixo.includes(tokenEsperado)) return { ok: true };

    const pareceJardimAmerica = !sufixo;
    const outraBatendo = pareceJardimAmerica
        ? todasFiliaisNomes.find(f => tokenDistintivoFilial(f) === 'JARDIM AMERICA' && f !== filialEsperada)
        : todasFiliaisNomes.find(f => f !== filialEsperada && sufixo.includes(tokenDistintivoFilial(f)));
    if (outraBatendo) {
        return { ok: false, motivo: `A tela mostra "${textoBruto}" (parece ser de "${outraBatendo}"), não "${filialEsperada}" — a sessão logada nesta janela parece ser de outra filial (senha da conta errada?).` };
    }
    return { ok: null, motivo: `Não consegui confirmar automaticamente a filial logada (texto mostrado: "${textoBruto}") — seguindo mesmo assim, confira manualmente se os dados exportados fazem sentido. Se este texto for realmente de "${filialEsperada}", me avise pra eu gravar esse mapeamento e não depender mais de "ok: null" aqui.` };
}

async function processarFilialLocal(browser, filial, todasFiliaisNomes, pageCrm, filiaisUlissesApi) {
    console.log(`\n[ulisses-local] Filial: ${filial}`);

    let usuario = null;
    try {
        usuario = (await lerCredencial('ulisses', filial)).usuario;
    } catch {
        // Sem credencial salva no cofre ainda não impede o modo assistido
        // (você pode digitar o e-mail de cabeça) — só não dá pra mostrar
        // a dica abaixo.
    }
    if (usuario) {
        console.log(`   >>> E-mail desta filial: ${usuario} <<<`);
        console.log('   (confira que é este e-mail antes de digitar a senha — também vai aparecer na própria janela do navegador.)');
    } else {
        console.log('   Nenhuma credencial salva pra essa filial ainda — digite o e-mail de cabeça.');
    }

    const page = await browser.newPage();
    try {
        await aguardarLoginManual(page, usuario);
        console.log('   Login detectado — confirmando filial...');
    } catch (e) {
        console.error(`   Não detectei login concluído a tempo: ${e.message}`);
        await salvarScreenshotErro(page, filial, 'login-manual');
        await registrarStatusSincronizacao('ulisses', filial, false, `Login manual não concluído a tempo: ${e.message}`);
        await page.close();
        return;
    }

    const verificacao = await verificarFilialLogada(page, filial, todasFiliaisNomes);
    if (verificacao.ok === false) {
        console.error(`   🛑 ${verificacao.motivo}`);
        await salvarScreenshotErro(page, filial, 'verificacao-filial');
        await registrarStatusSincronizacao('ulisses', filial, false, verificacao.motivo + ' Nada foi exportado nem gravado nesta rodada, pra não misturar dados entre filiais.');
        await page.close();
        return;
    }
    if (verificacao.ok === null) console.warn(`   ⚠️  ${verificacao.motivo}`);
    else console.log('   Filial confirmada — exportando...');

    // BUG REAL GRAVÍSSIMO, achado pelo usuário (2026-09-14): a tela de
    // Recepção do Ulisses mostrava 6 pré-inscritos num evento, mas a
    // Agenda do CRM só linkava 1 — a CAUSA não era o casamento de
    // sincronizarComparecimentoNoCrm() (esse já funciona certo), era que
    // `exportarCsvInscricoes()` só EXPORTA o CSV pra disco, nunca o
    // importa de verdade em `leads_inscricoes` — diferente do Mercúrio
    // (scraper/mercurio.js chama importarNoCrm() sozinho todo dia), o
    // lado do Ulisses nunca teve esse encadeamento. Resultado: a MAIORIA
    // de quem se pré-inscreve pela primeira vez (nunca apareceu em
    // Ativos/Inativos/Complementar/Aniversariantes do Mercúrio) simplesmente
    // NÃO EXISTIA como lead ainda quando sincronizarComparecimentoNoCrm()
    // tentava casar por telefone/e-mail — só quem por coincidência já
    // era lead de outra fonte (ex: já Ativo) conseguia ser vinculado. Isso
    // explica a estatística "341 sem lead achado" já vista numa rodada
    // real. Corrigido: importa o CSV de Inscrições de verdade no CRM
    // (mesmo caminho que o Mercúrio já usa, importarNoCrm() pilotando a
    // tela de Importar publicada) ANTES de tentar sincronizar
    // comparecimento — assim os leads existem a tempo de serem casados.
    let caminhoCsvInscricoes = null;
    const etapas = [
        // Eventos/Inscrições via API oficial — PRIMEIRO: não depende do
        // login manual no Ulisses (já feito nesta função, mas esta etapa
        // não usa aquela sessão, só `pageCrm` + o token OAuth2), e cria/
        // atualiza os leads/eventos mais recentes ANTES do catálogo/
        // comparecimento via Playwright (mesma ordem de sempre — evita
        // casar contra dado desatualizado).
        { nome: 'sincronizar-inscricoes-via-api', executar: () => {
            const filialIdUlisses = filiaisUlissesApi ? resolverFilialIdUlisses(filial, filiaisUlissesApi) : null;
            if (!filialIdUlisses) return Promise.resolve('sem correspondência no sistema do Ulisses (ou API indisponível nesta rodada) — pulando');
            return sincronizarInscricoesFilialViaApi(pageCrm, filial, filialIdUlisses);
        } },
        { nome: 'exportar-csv-inscricoes', executar: async () => { caminhoCsvInscricoes = await exportarCsvInscricoes(page, filial); return caminhoCsvInscricoes; } },
        { nome: 'importar-inscricoes-no-crm', executar: () => importarNoCrm(pageCrm, filial, { caminhoAtivos: null, caminhoInativos: null, caminhoInscricoes: caminhoCsvInscricoes }) },
        { nome: 'catalogo-eventos', executar: () => exportarCatalogoEventos(page, filial) },
        { nome: 'sincronizar-eventos-crm', executar: () => sincronizarCatalogoEventosNoCrm(filial) },
        { nome: 'comparecimento', executar: () => exportarComparecimento(page, filial) },
        { nome: 'sincronizar-comparecimento-crm', executar: () => sincronizarComparecimentoNoCrm(filial) },
        // Pedido do usuário (2026-09-17): quem foi removido do CRM a
        // pedido do lead (ver abrirRemoverLeadLgpd(), js/app.js) fica
        // enfileirado aqui — já estamos logados nesta filial, então
        // aproveita pra desativar no Ulisses também, sem precisar de uma
        // rodada/janela separada.
        { nome: 'fila-desativacao-ulisses', executar: () => processarFilaDesativacaoUlisses(page, filial) },
    ];
    let algumaFalha = false;
    for (const etapa of etapas) {
        try {
            const caminho = await etapa.executar();
            console.log(`   ${etapa.nome} OK: ${caminho}`);
        } catch (e) {
            algumaFalha = true;
            console.error(`   Falha em ${etapa.nome}:`, e.message);
            // "importar-inscricoes-no-crm" acontece na aba do CRM
            // (pageCrm), não na do Ulisses — screenshot da página certa.
            await salvarScreenshotErro(etapa.nome === 'importar-inscricoes-no-crm' ? pageCrm : page, filial, etapa.nome);
        }
    }

    await registrarStatusSincronizacao('ulisses', filial, !algumaFalha, algumaFalha
        ? 'Login manual (modo assistido) OK, mas 1+ exportação falhou — ver logs e prints locais (pasta debug/).'
        : 'Login manual (modo assistido) + Inscrições via API + exportação de Inscrições/catálogo de eventos/comparecimento via Playwright OK.');
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

    // Catálogo de eventos via API oficial — 1x, ANTES do loop (mesmo
    // motivo de sempre: Setor Universitário abastece várias filiais de
    // uma vez, precisa existir antes da sincronização de Inscrições de
    // cada uma). Best-effort — se a API estiver fora do ar por outro
    // motivo (não Cloudflare, já que rodamos localmente), cada filial só
    // pula essa etapa (ver `sincronizar-inscricoes-via-api` acima).
    let filiaisUlissesApi = null;
    try {
        filiaisUlissesApi = await filiaisAtivasUlissesApi();
        const resumo = await sincronizarEventosUlissesApi();
        console.log('[ulisses-api] Catálogo de eventos sincronizado:', resumo);
    } catch (e) {
        console.error('[ulisses-api] Falha ao sincronizar catálogo de eventos via API (não impede o resto da rodada):', e.message);
    }

    const todasFiliaisNomes = (filiaisTodas || []).map(f => f.nome);
    const browser = await chromium.launch({ headless: false });
    // Aba/contexto SEPARADO pro CRM publicado (mesmo padrão de `pageCrm`
    // em scraper/mercurio.js) — reaproveitado entre as filiais, já que
    // importarNoCrm()/abrirCrmComAcesso() é idempotente (só loga de novo
    // se o localStorage daquele contexto ainda não tiver a sessão).
    const pageCrm = await (await browser.newContext()).newPage();
    for (const f of filiais) {
        await processarFilialLocal(browser, f.nome, todasFiliaisNomes, pageCrm, filiaisUlissesApi);
    }
    await browser.close();
    console.log('\nConcluído. Arquivos em scraper/exports/.');

    await verificarEventosPublicosDeTodasAsFiliais().catch(e =>
        console.warn('[ulisses-local] Falha na auditoria contra os sites públicos (não bloqueia nada, é só um alerta):', e.message)
    );
}

main().catch(e => { console.error('[ulisses-local] Erro fatal:', e); process.exit(1); });

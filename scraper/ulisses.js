// Scraper do Ulisses (acropolebrasil.com.br) — MARCO 2: login + exportar
// (a) o CSV de Inscrições, (b) o catálogo de eventos (título/imagem/
// descrição, tela "Links") e (c) comparecimento por evento (tela
// "Pré-inscrições" > "Recepção") — por filial. Arquivos salvos em
// scraper/exports/ (o workflow sobe como artifact) — ainda NÃO alimenta o
// CRM sozinho (marco 3, pendente da mesma peça do lado do Mercúrio).
//
// (a) e (b) foram escritos só com PRINTS de tela, sem o HTML real — login
// é a única parte confirmada de verdade contra o site real; (a) já
// precisou de 1 rodada de correção depois do 1º teste (o clique em
// "Exportar CSV" não baixa nada direto, só navega pra uma tela com um
// 2º botão — ver exportarCsvInscricoes()), e (b) ainda usa heurísticas de
// leitura "cegas" (regex em cima do texto visível) pros campos do
// catálogo de eventos, com boa chance de precisar de mais ajuste. (c) já
// foi reescrita com o HTML real da tela de Recepção (mandado pelo
// usuário depois de um bug real em produção — ver comentário dentro de
// exportarComparecimento()), usando seletores por atributo Angular
// (`ng-repeat`/`ng-show`), bem mais confiáveis que heurística de texto.
// Se algo mais falhar, o jeito mais rápido de corrigir é o usuário abrir
// a tela no DevTools (botão direito > Inspecionar no elemento certo >
// Copy > Copy outerHTML) e mandar o HTML de verdade, em vez de mais um
// print.
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

// Mais de um tipo de aviso em modal pode aparecer por cima da tela logo
// após o login, dependendo da filial — confirmado por 2 testes reais
// diferentes: aviso de cookies/LGPD (botão "Aceitar") e, só nas filiais
// com a integração de pagamento quebrada, um alerta "Integração com o
// PagSeguro parou de funcionar. Você está perdendo inscrições..." (botão
// "OK") — esse só aparece pra ALGUMAS filiais, não todas. Qualquer um
// desses barra clique em elementos atrás dele mesmo que pareçam
// "visíveis" pro Playwright (é o que causava os erros "element is not
// enabled"/timeout esperando download). Cada filial abre numa aba
// isolada (contexto novo, sem cookie de "já vi isso"), então pode
// acontecer de novo em toda filial — tenta fechar cada um dos avisos
// conhecidos, ignorando silenciosamente o que não aparecer.
export async function fecharAvisosBloqueantes(page) {
    const botoes = [/aceitar/i, /^ok$/i];
    for (const nome of botoes) {
        await page.getByRole('button', { name: nome }).click({ timeout: 3000 }).catch(() => {});
    }
}

// DOIS cliques, não um — confirmado por teste manual real (print do
// usuário): "Exportar CSV" no menu só NAVEGA pra uma tela separada
// (#/exportar) com 2 botões verdes ("Baixar CSV de Contatos padrão
// FACEBOOK" e, o que queremos, "Baixar CSV de Inscrições" — na seção
// "Dados das inscrições"); é só o SEGUNDO clique que de fato dispara o
// download. A versão anterior deste código assumia 1 clique só e nunca
// via o evento de download (documentado como "testado e confirmado" no
// passado, mas essa confirmação era só do 1º clique/navegação, não do
// fluxo completo).
export async function exportarCsvInscricoes(page, filial) {
    await fecharAvisosBloqueantes(page);
    await page.getByText('Exportar CSV', { exact: false }).click();
    await page.waitForURL(/#\/exportar/i, { timeout: 15000 }).catch(() => {});
    await fecharAvisosBloqueantes(page);

    // getByText (não getByRole('button')) — o botão pode não ser uma tag
    // <button> de verdade (comum ser um <a> estilizado de verde, que pro
    // Playwright tem "papel" de link, não de botão); buscar por TEXTO
    // funciona independente da tag por baixo. Escuta no CONTEXTO
    // (page.context()), não só nesta página — se o botão abrir o download
    // numa aba nova (target="_blank"), o evento nasce nessa aba nova, não
    // na original.
    const [download] = await Promise.all([
        page.context().waitForEvent('download', { timeout: 30000 }),
        page.getByText(/baixar csv de inscri[çc][õo]es/i).click(),
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
    await fecharAvisosBloqueantes(page);
    if (!page.url().includes('#/evento')) {
        // 'networkidle' trava pra sempre nesse site (ver comentário em
        // loginUlisses()) — usa 'domcontentloaded' + espera o próprio
        // elemento que precisamos, mais abaixo.
        await page.goto('https://www.acropolebrasil.com.br/#/evento', { waitUntil: 'domcontentloaded' });
    }
    await page.getByRole('button', { name: /^ativo$/i }).click({ timeout: 5000 }).catch(() => {});

    const cards = page.locator('text=/\\d{2}\\/\\d{2}\\/\\d{4}/').locator('..');
    // Espera pelo menos 1 card aparecer antes de contar — se o goto()
    // acima aconteceu (troca só de hash, sem requisição de rede de
    // verdade), 'domcontentloaded' dispara quase na hora, antes da SPA
    // ter tido tempo de buscar/renderizar a lista de eventos (confirmado
    // por teste real: "0 cards" logo depois de vir da tela de exportar).
    await cards.first().waitFor({ timeout: 10000 }).catch(() => {});
    const total = await cards.count();
    if (total === 0) throw new Error('Nenhum card de evento encontrado na lista (seletor pode estar errado — ver comentário no topo do arquivo).');

    // Timeout curto (não o padrão de 30s do Playwright) — confirmado por
    // teste real que ALGUNS cards da lista pertencem a OUTRAS filiais (têm
    // uma etiqueta colorida com o nome da filial embaixo, visível na
    // tela); clicar neles nunca abre o painel de detalhes (sem acesso), e
    // com o timeout padrão isso travava por ~3 minutos por card (6 campos
    // x 30s). Aqui, 4s é o suficiente pra um campo que já carregou.
    const ler = async (rotulo) => {
        try { return (await page.getByLabel(new RegExp(rotulo, 'i')).first().inputValue({ timeout: 4000 })).trim() || null; }
        catch { return null; }
    };

    // O painel de detalhes tem 2 abas: "Link" (Título/Imagem/Descrição
    // etc., já lidos acima por getByLabel) e "Eventos" — uma tabela com 1
    // linha por filial do Ulisses, cada uma com Data/Hora e Qtd. Vagas
    // PRÓPRIAS (esse formulário é literalmente o equivalente, do lado do
    // Ulisses, do nosso conceito de evento multi-filial — grupo_evento_id
    // em `eventos`). Sem isso, `hora`/`capacidade` nunca eram preenchidos
    // na sincronização. Só a(s) linha(s) da(s) filial(is) que essa conta
    // efetivamente usa vem(êm) com o checkbox marcado — as demais linhas
    // (outros municípios) ficam sem preencher. Escrito só com PRINT de
    // tela (ver topo do arquivo) — sem o HTML real não dá pra ter certeza
    // do nome/role exato das abas nem da ordem exata das colunas, por
    // isso os vários fallbacks e o comentário de "layout observado"
    // abaixo; se quebrar, mandar o HTML real da aba "Eventos" resolve
    // rápido.
    const clicarAba = async (nomeExato) => {
        const candidatos = [
            page.getByRole('tab', { name: nomeExato, exact: true }),
            page.getByRole('link', { name: nomeExato, exact: true }),
            page.getByText(nomeExato, { exact: true }),
        ];
        for (const loc of candidatos) {
            try {
                const alvo = loc.first();
                if (await alvo.count() && await alvo.isVisible().catch(() => false)) {
                    await alvo.click({ timeout: 2000 });
                    return true;
                }
            } catch { /* tenta o próximo candidato */ }
        }
        return false;
    };

    // Lê Data/Hora + Qtd. Vagas da 1ª linha marcada (checkbox) da aba
    // "Eventos" — layout observado no print: colunas [Descrição do
    // evento, Data (DD/MM/AAAA HH:MM), Qtd. Vagas], nessa ordem, como
    // <input> de texto dentro da linha (<tr>) do checkbox marcado.
    const lerDataHoraEVagas = async () => {
        try {
            const abriuAba = await clicarAba('Eventos');
            if (!abriuAba) return { hora: null, capacidade: null };
            const marcados = page.locator('input[type="checkbox"]:checked');
            await marcados.first().waitFor({ timeout: 3000 }).catch(() => {});
            const total = await marcados.count();
            for (let j = 0; j < total; j++) {
                const linha = marcados.nth(j).locator('xpath=ancestor::tr[1]');
                const inputsTexto = linha.locator('input:not([type="checkbox"])');
                const n = await inputsTexto.count();
                const valores = [];
                for (let k = 0; k < n; k++) {
                    valores.push((await inputsTexto.nth(k).inputValue().catch(() => '') || '').trim());
                }
                const dataHora = valores.find(v => /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(v));
                if (!dataHora) continue;
                const hora = (dataHora.match(/(\d{2}:\d{2})/) || [])[1] || null;
                const vagasTexto = valores.find(v => v !== dataHora && /^\d+$/.test(v));
                const capacidade = vagasTexto ? parseInt(vagasTexto, 10) : null;
                return { hora, capacidade };
            }
            return { hora: null, capacidade: null };
        } catch {
            return { hora: null, capacidade: null };
        } finally {
            await clicarAba('Link'); // volta pro estado esperado pelo próximo card do loop
        }
    };

    // Só vale a pena ler os detalhes completos (imagem/descrição/etc.) de
    // eventos FUTUROS — decisão do usuário: pra evento passado, o que
    // importa é só quem compareceu (ver exportarComparecimento), não mais
    // os detalhes de divulgação. Isso também evita a grande maioria dos
    // cards de outra filial na prática (são quase todos antigos).
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const eventos = [];
    for (let i = 0; i < total; i++) {
        try {
            const textoCard = await cards.nth(i).innerText().catch(() => '');
            const match = textoCard.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const dataEvento = match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : null;
            if (dataEvento && dataEvento < hoje) continue; // passado — não abre o painel, nem gasta tempo

            // O aviso do PagSeguro (ver fecharAvisosBloqueantes) confirmado
            // reaparecendo ao voltar pra essa tela — tenta fechar de novo a
            // cada card, não só uma vez no início da função.
            await fecharAvisosBloqueantes(page);
            await cards.nth(i).click();

            // Espera o campo "Título" de verdade aparecer, em vez de um
            // sleep fixo — mas isso só detecta "o painel abriu" (útil pra
            // pular card de outra filial, que nunca abre painel nenhum).
            // NÃO detecta "os campos já atualizaram pro card novo": quando
            // 2 cards seguidos têm títulos DIFERENTES (confirmado por teste
            // real em produção — 2 eventos ficaram salvos no CRM com o
            // MESMO nome "Workshop de Oratória", um deles errado: o 2º
            // card era na verdade "Bushido, o código de hora dos
            // samurais"), esperar o Título "aparecer" não serve de sinal
            // nenhum, porque o input já existia com o valor do card
            // ANTERIOR antes mesmo do clique. Uma espera fixa de 600ms
            // também não bastou: o dado real mostrou Título/Imagem/
            // Subtítulo ainda com o valor do card anterior nesse instante,
            // enquanto a Descrição já tinha atualizado — ou seja, o
            // palpite anterior (Descrição/Informação são as mais lentas)
            // estava ERRADO; é Título/Imagem/Subtítulo que atualizam mais
            // devagar. Por isso agora espera ativamente até o campo
            // Título bater com o texto do PRÓPRIO card (fonte confiável,
            // já visível na lista antes de clicar) em vez de confiar em
            // tempo fixo algum.
            const abriu = await page.getByLabel(/t[íi]tulo/i).first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
            if (!abriu) {
                console.warn(`[ulisses] Evento ${i} não abriu painel de detalhes a tempo (provavelmente de outra filial) — pulando (${filial}).`);
                continue;
            }

            const normalizar = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
            const textoCardNormalizado = normalizar(textoCard);
            let tituloLido = null;
            let bateuComCard = false;
            for (let tentativa = 0; tentativa < 20 && !bateuComCard; tentativa++) {
                tituloLido = await ler('t[íi]tulo');
                bateuComCard = !!tituloLido && textoCardNormalizado.includes(normalizar(tituloLido));
                if (!bateuComCard) await page.waitForTimeout(300);
            }
            if (!bateuComCard) {
                console.warn(`[ulisses] Título do painel ("${tituloLido}") não bateu com o texto do card ${i} depois de 6s de espera — pode ter ficado com dado do card anterior; salvando mesmo assim (${filial}).`);
            }
            // Mais uma folga curta pros campos que costumam atualizar
            // JUNTO com o Título (Imagem/Subtítulo, pelo caso real acima).
            await page.waitForTimeout(300);

            const camposLink = {
                tipo_link: await ler('tipo link'),
                imagem_url: await ler('imagem'),
                subtitulo: await ler('subt[íi]tulo'),
                informacao: await ler('informa[çc][ãa]o'),
                descricao: await ler('descri[çc][ãa]o'),
            };
            const { hora, capacidade } = await lerDataHoraEVagas();

            eventos.push({
                data: match ? `${match[3]}-${match[2]}-${match[1]}` : null,
                titulo: tituloLido,
                hora,
                capacidade,
                ...camposLink,
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

// Comparecimento por evento (tela "Recepção") — a recepção marca
// manualmente no dia, então NÃO é 100% confiável (a pessoa marcada "não
// compareceu" pode ter ido mesmo assim).
export async function exportarComparecimento(page, filial) {
    await fecharAvisosBloqueantes(page);
    // O clique em "Pré-inscrições" > "Recepção" (menu do topo) nunca
    // chegava a essa tela de verdade — confirmado por teste real, o
    // resultado anterior lia "Links" (item do menu da HOME), sinal de que
    // a navegação nunca saiu do lugar (esse menu provavelmente só abre a
    // aparece o submenu com HOVER, não clique). Vai direto pela URL —
    // vista no print real: #/recepcao.
    if (!page.url().includes('#/recepcao')) {
        await page.goto('https://www.acropolebrasil.com.br/#/recepcao', { waitUntil: 'domcontentloaded' });
    }
    await fecharAvisosBloqueantes(page);

    // Confirmado por print real: é um <select> HTML normal, sem
    // formulário/seletor extra no meio. Cada opção vem no formato
    // "[ATUAL]/[DESAT] ___ DD/MM/AAAA HH:MM ___ Nome do evento" (as duas
    // primeiras partes vêm vazias — "___ ___ Nome" — quando o evento não
    // tem data marcada, ex: "Chat Whatsapp Landing Page"). A lista INCLUI
    // eventos de outras filiais também — não filtra por filial, serve pra
    // já ter a base do evento no CRM (nome + data), mesmo sem os detalhes
    // completos (esses só vêm de exportarCatalogoEventos, só p/ eventos
    // futuros da própria filial).
    const combobox = page.locator('select').first();
    await combobox.waitFor({ timeout: 10000 });
    const opcoes = (await combobox.locator('option').allTextContents())
        .map(t => t.trim())
        .filter(t => t && !t.toLowerCase().startsWith('- selecione'));
    if (opcoes.length === 0) throw new Error('Nenhum evento encontrado no seletor da tela de Recepção.');

    // Filtra pros últimos 3 anos — o seletor lista TODO o histórico do
    // Ulisses (confirmado por teste real: 522 eventos numa única filial),
    // e a esmagadora maioria é passado antigo demais pra ainda importar
    // pro CRM; sem esse corte o JSON final fica enorme (6439 linhas só
    // de Garavelo) pra pouquíssimo ganho. Evento SEM data no texto da
    // opção (raro, ex: "Chat Whatsapp Landing Page") não dá pra avaliar
    // idade nenhuma — mantido, já que são poucos casos.
    const TRES_ANOS_ATRAS = new Date();
    TRES_ANOS_ATRAS.setFullYear(TRES_ANOS_ATRAS.getFullYear() - 3);
    const opcoesRecentes = opcoes.filter(opcaoTexto => {
        const dataHora = opcaoTexto.split('___')[1]?.trim();
        const m = dataHora && dataHora.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!m) return true;
        const dataEvento = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        return dataEvento >= TRES_ANOS_ATRAS;
    });
    console.log(`[ulisses] Comparecimento: ${opcoesRecentes.length} de ${opcoes.length} evento(s) dentro dos últimos 3 anos (${filial}).`);

    const registros = [];
    for (const opcaoTexto of opcoesRecentes) {
        try {
            await combobox.selectOption({ label: opcaoTexto });
            // Sem indicador de carregamento claro na tela — a lista de
            // pré-inscritos costuma ser pequena, um wait curto e fixo
            // aqui é aceitável (diferente do catálogo de eventos, aqui
            // não tem risco de travar 30s num campo que nunca aparece).
            await page.waitForTimeout(700);

            const [status, dataHora, nomeEvento] = opcaoTexto.split('___').map(s => s.trim());

            // Estrutura confirmada por HTML real (Angular, mandado pelo
            // usuário): 1 <tr ng-repeat="contato in emails"> por
            // participante, com 2 <td>: o 1º tem nome/e-mail/telefone
            // (célula com class="ng-binding"), o 2º tem 1
            // <div ng-repeat="emailEvento in contato.emailEventos"> POR
            // EVENTO que esse contato já participou, cada um com seu
            // próprio checkbox "Compareceu" — só o do evento SELECIONADO
            // agora fica visível (ng-show="emailEvento.evento.id ==
            // evento.id"), os outros continuam no DOM, só escondidos.
            //
            // O código antigo lia TODOS os checkboxes da página (visíveis
            // ou não) e subia pelo ancestral mais próximo que contivesse
            // "@" pra achar "a linha" — isso quebrava de 2 formas
            // confirmadas: (1) contava checkbox de contato/evento ERRADO
            // (escondido, de outro evento que a pessoa participou antes),
            // misturando presença de um evento com o registro de outro; e
            // (2) quando o contato não tinha e-mail cadastrado, a subida
            // ia longe demais (a linha dele não tem "@" nenhum) e pegava
            // texto de uma seção qualquer da página, inclusive o próprio
            // <select> de eventos — daí o "- Selecione um evento -"
            // aparecendo como nome. Agora usa os seletores estruturais
            // reais (por atributo ng-repeat/ng-show do Angular), não mais
            // heurística de texto.
            const linhas = page.locator('tr[ng-repeat="contato in emails"]');
            await linhas.first().waitFor({ timeout: 5000 }).catch(() => {});
            const totalLinhas = await linhas.count();
            for (let i = 0; i < totalLinhas; i++) {
                const linha = linhas.nth(i);
                const checkboxVisivel = linha.locator('input[type="checkbox"]:visible');
                if (await checkboxVisivel.count() === 0) continue; // esse contato não tem inscrição pra ESTE evento (só pra outro, escondido)
                const compareceu = await checkboxVisivel.first().isChecked().catch(() => null);

                const celulaContato = linha.locator('td.ng-binding').first();
                const nome = (await celulaContato.evaluate(el => el.childNodes[0]?.textContent || '').catch(() => '')).trim() || null;

                const emailSpan = linha.locator('span[ng-show="contato.email"]');
                const email = (await emailSpan.isVisible().catch(() => false))
                    ? (await emailSpan.innerText().catch(() => '')).trim() || null
                    : null;

                const telefoneSpan = linha.locator('span[ng-show="contato.telefone"]');
                let telefone = null;
                if (await telefoneSpan.isVisible().catch(() => false)) {
                    const partes = await telefoneSpan.locator('> span').allTextContents().catch(() => []);
                    telefone = partes.map(p => p.trim()).filter(Boolean).join(' ') || null;
                }

                registros.push({
                    eventoNome: nomeEvento || opcaoTexto,
                    eventoData: dataHora || null,
                    eventoStatus: status || null, // "[ATUAL]" ou "[DESAT]"
                    filial, nome, email, telefone, compareceu,
                });
            }
        } catch (e) {
            console.warn(`[ulisses] Falha ao ler comparecimento do evento "${opcaoTexto}" (${filial}):`, e.message);
        }
    }

    fs.mkdirSync(PASTA_EXPORTS, { recursive: true });
    const caminho = `${PASTA_EXPORTS}/comparecimento-${filial.replace(/[^a-z0-9]/gi, '_')}.json`;
    fs.writeFileSync(caminho, JSON.stringify(registros, null, 2), 'utf-8');
    return caminho;
}

// Depois de exportar o comparecimento (função acima), vincula cada
// participante que já é um LEAD conhecido do CRM ao evento correspondente
// em `evento_leads` — é o que faz a tela "Participantes" da Agenda (ver
// abrirParticipantesEvento() em js/eventos.js) já vir preenchida com quem
// se inscreveu no Ulisses, sem precisar buscar e vincular 1 por 1 na mão.
// Casamento por telefone (normalizado, ignorando o 9º dígito — mesma
// lógica de normalizarTelefoneParaChave() em js/importador.js,
// reproduzida aqui pro lado do Node) e, se não achar, por e-mail exato;
// quem não bate com nenhum lead existente fica de fora (não inventa lead
// novo — a importação de planilha continua sendo o jeito de cadastrar
// gente nova no CRM).
export async function sincronizarComparecimentoNoCrm(filial) {
    const caminhoJson = `${PASTA_EXPORTS}/comparecimento-${filial.replace(/[^a-z0-9]/gi, '_')}.json`;
    if (!fs.existsSync(caminhoJson)) throw new Error('comparecimento.json não encontrado — a etapa "comparecimento" precisa rodar antes desta.');

    const registros = JSON.parse(fs.readFileSync(caminhoJson, 'utf-8'));
    if (registros.length === 0) return '0 registros de comparecimento — nada a sincronizar.';

    const normalizarTelefone = (ddd, numero) => {
        const d = String(ddd || '').replace(/\D/g, '');
        let n = String(numero || '').replace(/\D/g, '');
        if (!d || !n) return null;
        if (n.length === 9 && n.startsWith('9')) n = n.slice(1);
        if (n.length !== 8) return null;
        return d + n;
    };

    // Carrega TODOS os leads da filial pra casar por telefone/e-mail —
    // paginado porque o PostgREST limita a 1000 linhas por página mesmo
    // pedindo mais (mesma lição documentada em detectarLeadsATratar(),
    // js/leads-a-tratar.js).
    const porTelefone = new Map();
    const porEmail = new Map();
    const TAMANHO_PAGINA = 1000;
    for (let de = 0; ; de += TAMANHO_PAGINA) {
        const { data: pagina, error } = await supabaseAdmin
            .from('leads_inscricoes')
            .select('pessoaIdentificador, pessoaTelefoneDDD, pessoaTelefoneNumero, pessoaEmail')
            .eq('filial', filial)
            .order('pessoaIdentificador', { ascending: true })
            .range(de, de + TAMANHO_PAGINA - 1);
        if (error) throw new Error('Erro ao buscar leads da filial: ' + error.message);
        for (const lead of pagina || []) {
            const chaveTel = normalizarTelefone(lead.pessoaTelefoneDDD, lead.pessoaTelefoneNumero);
            if (chaveTel && !porTelefone.has(chaveTel)) porTelefone.set(chaveTel, lead.pessoaIdentificador);
            const email = (lead.pessoaEmail || '').trim().toLowerCase();
            if (email && !porEmail.has(email)) porEmail.set(email, lead.pessoaIdentificador);
        }
        if (!pagina || pagina.length < TAMANHO_PAGINA) break;
    }

    // Garante 1 linha em `eventos` por (nome, data) visto no comparecimento
    // — sem sobrescrever nada de quem já existe (só exportarCatalogoEventos/
    // sincronizarCatalogoEventosNoCrm mexem nos detalhes completos; aqui é
    // só a base mínima, já que eventos PASSADOS nunca passam pelo
    // catálogo — ele só lê detalhes de eventos futuros).
    const paraISO = (dataHora) => {
        const m = (dataHora || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
    };
    const eventosUnicos = new Map();
    for (const r of registros) {
        const dataISO = paraISO(r.eventoData);
        if (!r.eventoNome || !dataISO) continue;
        eventosUnicos.set(`${r.eventoNome}|||${dataISO}`, { nome: r.eventoNome, data: dataISO });
    }

    const idPorEvento = new Map();
    for (const { nome, data } of eventosUnicos.values()) {
        const { data: existente } = await supabaseAdmin
            .from('eventos').select('id')
            .eq('filial', filial).eq('nome', nome).eq('data', data)
            .maybeSingle();
        if (existente) {
            idPorEvento.set(`${nome}|||${data}`, existente.id);
            continue;
        }
        const { data: criado, error } = await supabaseAdmin
            .from('eventos').insert({ filial, nome, data }).select('id').single();
        if (error) {
            console.warn(`[ulisses] Não consegui criar evento base "${nome}" (${data}, ${filial}):`, error.message);
            continue;
        }
        idPorEvento.set(`${nome}|||${data}`, criado.id);
    }

    // Casa cada registro com um lead (telefone > e-mail) e monta a lista
    // de vínculos candidatos.
    const vinculos = [];
    let semEvento = 0, semLead = 0;
    for (const r of registros) {
        const dataISO = paraISO(r.eventoData);
        const eventoId = dataISO ? idPorEvento.get(`${r.eventoNome}|||${dataISO}`) : null;
        if (!eventoId) { semEvento++; continue; }

        let pessoaIdentificador = null;
        if (r.telefone) {
            const [ddd, ...resto] = r.telefone.split(' ');
            pessoaIdentificador = porTelefone.get(normalizarTelefone(ddd, resto.join(''))) || null;
        }
        if (!pessoaIdentificador && r.email) {
            pessoaIdentificador = porEmail.get(r.email.trim().toLowerCase()) || null;
        }
        if (!pessoaIdentificador) { semLead++; continue; }

        vinculos.push({
            evento_id: eventoId,
            pessoaIdentificador,
            compareceu: typeof r.compareceu === 'boolean' ? r.compareceu : null,
        });
    }

    if (vinculos.length === 0) {
        return `0 de ${registros.length} registro(s) casado(s) com um lead (${semEvento} sem evento correspondente, ${semLead} sem lead achado por telefone/e-mail) — nada a gravar.`;
    }

    // Não sobrescreve `resposta_convite`/`nota` de um vínculo que já
    // existe (pode ter sido ajustado à mão na tela de Participantes) — só
    // cria com resposta_convite='confirmado' (esteve na lista de
    // pré-inscritos = confirmou interesse) quando o vínculo ainda não
    // existe, e sempre atualiza `compareceu` (é o dado que muda com o
    // tempo: falso/nulo antes do evento, o real depois que aconteceu).
    const eventoIds = [...new Set(vinculos.map(v => v.evento_id))];
    const { data: existentes } = await supabaseAdmin
        .from('evento_leads')
        .select('evento_id, pessoaIdentificador')
        .in('evento_id', eventoIds);
    const jaExiste = new Set((existentes || []).map(e => `${e.evento_id}|||${e.pessoaIdentificador}`));

    const novos = vinculos
        .filter(v => !jaExiste.has(`${v.evento_id}|||${v.pessoaIdentificador}`))
        .map(v => ({ evento_id: v.evento_id, pessoaIdentificador: v.pessoaIdentificador, resposta_convite: 'confirmado', compareceu: v.compareceu }));
    const paraAtualizar = vinculos.filter(v => jaExiste.has(`${v.evento_id}|||${v.pessoaIdentificador}`));

    if (novos.length > 0) {
        const { error } = await supabaseAdmin.from('evento_leads').insert(novos);
        if (error) console.warn('[ulisses] Falha ao inserir novos vínculos evento_leads:', error.message);
    }
    await Promise.all(paraAtualizar.map(v =>
        supabaseAdmin.from('evento_leads')
            .update({ compareceu: v.compareceu })
            .eq('evento_id', v.evento_id).eq('pessoaIdentificador', v.pessoaIdentificador)
    ));

    return `${novos.length} vínculo(s) novo(s), ${paraAtualizar.length} atualizado(s) (compareceu), de ${registros.length} registro(s) (${semEvento} sem evento correspondente, ${semLead} sem lead achado por telefone/e-mail).`;
}

// Depois de exportar o catálogo de eventos (função acima), grava cada
// evento FUTURO direto na tabela `eventos` do CRM — sem passo manual: o
// scraper já tem acesso de service_role ao Supabase (mesmo cliente usado
// pras credenciais/status de sincronização), então não faz sentido exigir
// que alguém abra o JSON e cadastre na mão. Casa por (filial, nome, data)
// — reexecutar o scraper atualiza imagem/descrição de um evento já
// importado em vez de duplicar. Tipo é classificado pela MESMA tabela
// `tipos_evento`/`palavras_chave` que a Agenda usa em "Gerenciar Tipos"
// (pequena duplicação deliberada da lógica de classificarTipoEvento() em
// js/importador.js — aqui é só um lookup de palavra-chave, baixo risco de
// divergir, e evitar duplicar seria só possível fazendo o Playwright
// pilotar a UI do CRM publicado, que é a decisão maior do marco 3, ainda
// pendente). `hora`/`capacidade` vêm da aba "Eventos" do painel de
// detalhes (ver lerDataHoraEVagas() em exportarCatalogoEventos) — campo
// próprio, por filial, não o texto livre de Subtítulo/Informação.
export async function sincronizarCatalogoEventosNoCrm(filial) {
    const caminhoJson = `${PASTA_EXPORTS}/catalogo-eventos-${filial.replace(/[^a-z0-9]/gi, '_')}.json`;
    if (!fs.existsSync(caminhoJson)) throw new Error('catalogo-eventos.json não encontrado — a etapa "catalogo-eventos" precisa rodar (e ter achado 1+ evento) antes desta.');

    const eventos = JSON.parse(fs.readFileSync(caminhoJson, 'utf-8'));
    if (eventos.length === 0) return '0 eventos no catálogo — nada a sincronizar.';

    const { data: tiposEvento } = await supabaseAdmin.from('tipos_evento').select('nome, ordem, palavras_chave').order('ordem', { ascending: true });
    const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const classificarTipo = (nomeEvento) => {
        for (const t of tiposEvento || []) {
            const chaves = String(t.palavras_chave || '').split(',').map(p => p.trim()).filter(Boolean);
            if (chaves.some(p => new RegExp(escaparRegex(p), 'i').test(nomeEvento))) return t.nome;
        }
        return null; // sem palavra-chave batendo — fica em branco, o usuário classifica na Agenda
    };

    let criados = 0, atualizados = 0, ignorados = 0;
    for (const ev of eventos) {
        if (!ev.data || !ev.titulo) { ignorados++; continue; } // sem data/título não dá pra casar nem cadastrar

        const { data: existente } = await supabaseAdmin
            .from('eventos')
            .select('id')
            .eq('filial', filial).eq('nome', ev.titulo).eq('data', ev.data)
            .maybeSingle();

        const payload = {
            filial, nome: ev.titulo, data: ev.data,
            hora: ev.hora || null,
            capacidade: ev.capacidade || null,
            tipo: classificarTipo(ev.titulo),
            imagem_url: ev.imagem_url || null,
            descricao: [ev.subtitulo, ev.informacao, ev.descricao].filter(Boolean).join('\n\n') || null,
        };

        if (existente) {
            await supabaseAdmin.from('eventos').update(payload).eq('id', existente.id);
            atualizados++;
        } else {
            await supabaseAdmin.from('eventos').insert(payload);
            criados++;
        }
    }
    return `${criados} evento(s) criado(s), ${atualizados} atualizado(s)${ignorados ? `, ${ignorados} ignorado(s) sem data/título` : ''}.`;
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
        { nome: 'sincronizar-eventos-crm', executar: () => sincronizarCatalogoEventosNoCrm(filial) },
        { nome: 'comparecimento', executar: () => exportarComparecimento(page, filial) },
        { nome: 'sincronizar-comparecimento-crm', executar: () => sincronizarComparecimentoNoCrm(filial) },
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

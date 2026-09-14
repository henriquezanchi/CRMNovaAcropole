// Captura detalhes RICOS (imagem/descrição/vagas/hora) de eventos
// "Abertura de Turma" criados CENTRALIZADAMENTE por outra conta (ex:
// "Setor Universitário", que cria pra toda a região de Goiânia) — ver
// CLAUDE.md, seção "eventos centralizados". A conta da própria filial
// nunca vê esse evento na aba "Links" (não foi ela quem criou), então
// isso roda separado, com a credencial de QUEM criou.
//
// NÃO cria filial nova nenhuma nem lead nenhum — só ATUALIZA (nunca cria)
// as linhas de `eventos` que já existem pras nossas 4 filiais reais
// (criadas pela sincronização normal de Comparecimento, via a própria
// Recepção de cada filial — essa já cobre nome/data/hora/quem se inscreveu/
// quem compareceu). Este script só complementa o que SÓ existe no painel
// de quem criou: imagem, descrição completa, vagas por filial.
//
// Como usar: node capturar-eventos-centralizados.js
// Login manual (a mesma conta que cria "Abertura de Turma", ex:
// Setor Universitário) — sem credencial salva no cofre pra essa conta,
// login 100% manual, sem dica de e-mail.
import { chromium } from 'playwright';
import { supabaseAdmin } from './lib/supabaseAdmin.js';
import { fecharAvisosBloqueantes } from './ulisses.js';

const URL_LOGIN = 'https://www.acropolebrasil.com.br/login.html';

function normalizarTexto(s) {
    const semAcento = Array.from((s || '').normalize('NFD'))
        .filter(ch => { const c = ch.codePointAt(0); return c < 0x300 || c > 0x36f; })
        .join('');
    return semAcento.toUpperCase().replace(/\s+/g, ' ').trim();
}
// Mesma técnica já usada em ulisses-local.js (tokenDistintivoFilial) —
// tira "Goiânia - " do começo e "/MT" do fim, sobra só o núcleo que
// distingue uma filial NOSSA da outra.
function nucleoFilialCrm(nomeFilial) {
    return normalizarTexto(nomeFilial).replace(/^GOIANIA\s*-\s*/, '').replace(/\/MT$/, '').trim();
}

async function aguardarLoginManual(page) {
    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
    console.log('\n>>> Faça o login manualmente (a conta que CRIA "Abertura de Turma", ex: Setor Universitário). Aguardando até 10 minutos...\n');
    await page.getByText('Exportar CSV', { exact: false }).waitFor({ timeout: 10 * 60 * 1000 });
    console.log('Login detectado.\n');
}

// Mesmo padrão de leitura por rótulo já usado em exportarCatalogoEventos()
// (ulisses.js) — pequena duplicação deliberada, não exportado de lá.
function criarLeitor(page) {
    return async (rotulo) => {
        try { return (await page.getByLabel(new RegExp(rotulo, 'i')).first().inputValue({ timeout: 4000 })).trim() || null; }
        catch { return null; }
    };
}

async function clicarAba(page, nomeExato) {
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
        } catch { /* tenta o próximo */ }
    }
    return false;
}

// Diferente de lerDataHoraEVagas() (ulisses.js), que só lê a 1ª linha
// marcada (suficiente pra conta de 1 filial só) — aqui a conta CRIADORA
// pode ter VÁRIAS filiais marcadas ao mesmo tempo (é ela quem organiza o
// evento pra região toda), então lê TODAS as linhas com checkbox marcado.
async function lerTodasFiliaisMarcadas(page) {
    const abriu = await clicarAba(page, 'Eventos');
    if (!abriu) return [];
    const marcados = page.locator('input[type="checkbox"]:checked');
    await marcados.first().waitFor({ timeout: 3000 }).catch(() => {});
    const total = await marcados.count();
    const linhas = [];
    for (let j = 0; j < total; j++) {
        try {
            const linha = marcados.nth(j).locator('xpath=ancestor::tr[1]');
            const textoLinha = (await linha.innerText().catch(() => '')).trim();
            const inputsTexto = linha.locator('input:not([type="checkbox"])');
            const n = await inputsTexto.count();
            const valores = [];
            for (let k = 0; k < n; k++) valores.push((await inputsTexto.nth(k).inputValue().catch(() => '') || '').trim());
            const dataHoraStr = valores.find(v => /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(v)) || null;
            const hora = dataHoraStr ? (dataHoraStr.match(/(\d{2}:\d{2})/) || [])[1] || null : null;
            const vagasStr = valores.find(v => v !== dataHoraStr && /^\d+$/.test(v));
            const capacidade = vagasStr ? parseInt(vagasStr, 10) : null;
            // Nome da filial: 1ª parte do texto da linha, antes do 1º
            // valor de input (ex: "GO - Ap. de Goiânia - Garavelo\nPalestra Cultural\n...").
            const nomeFilialUlisses = textoLinha.split('\n')[0]?.trim() || '';
            if (nomeFilialUlisses) linhas.push({ nomeFilialUlisses, hora, capacidade });
        } catch { /* pula essa linha */ }
    }
    await clicarAba(page, 'Link'); // volta pro estado esperado
    return linhas;
}

async function main() {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    await aguardarLoginManual(page);
    await fecharAvisosBloqueantes(page);

    if (!page.url().includes('#/evento')) {
        await page.goto('https://www.acropolebrasil.com.br/#/evento', { waitUntil: 'domcontentloaded' });
    }
    await page.getByRole('button', { name: /^ativo$/i }).click({ timeout: 5000 }).catch(() => {});

    const { data: filiaisCrm } = await supabaseAdmin.from('filiais').select('nome').eq('ativo', true);
    const nucleosFiliaisCrm = (filiaisCrm || []).map(f => ({ nome: f.nome, nucleo: nucleoFilialCrm(f.nome) }));

    const cards = page.locator('text=/\\d{2}\\/\\d{2}\\/\\d{4}/').locator('..');
    await cards.first().waitFor({ timeout: 10000 }).catch(() => {});
    const total = await cards.count();
    console.log(`${total} card(s) encontrado(s) na lista "Ativo" desta conta.\n`);

    const ler = criarLeitor(page);
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

    let atualizados = 0, semMatchNenhum = 0;
    for (let i = 0; i < total; i++) {
        try {
            const textoCard = await cards.nth(i).innerText().catch(() => '');
            const m = textoCard.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            const dataEvento = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
            if (dataEvento && dataEvento < hoje) continue; // só futuro, mesmo critério de sempre

            await fecharAvisosBloqueantes(page);
            await cards.nth(i).click();
            const abriu = await page.getByLabel(/t[íi]tulo/i).first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
            if (!abriu) continue;

            const titulo = await ler('t[íi]tulo');
            if (!titulo) continue;
            const descricaoNova = [await ler('subt[íi]tulo'), await ler('informa[çc][ãa]o'), await ler('descri[çc][ãa]o')].filter(Boolean).join('\n\n') || null;
            const imagem_url = await ler('imagem');
            const dataISO = m ? `${m[3]}-${m[2]}-${m[1]}` : null;

            console.log(`Evento: "${titulo}" (${dataISO})`);
            const filiaisMarcadas = await lerTodasFiliaisMarcadas(page);
            if (filiaisMarcadas.length === 0) { console.log('   (nenhuma filial marcada na aba "Eventos" — pulando)\n'); continue; }

            for (const { nomeFilialUlisses, hora, capacidade } of filiaisMarcadas) {
                const textoNorm = normalizarTexto(nomeFilialUlisses);
                const filialCrm = nucleosFiliaisCrm.find(f => f.nucleo && textoNorm.includes(f.nucleo));
                if (!filialCrm) { console.log(`   "${nomeFilialUlisses}" não bate com nenhuma das nossas 4 filiais — ignorando essa linha.`); continue; }

                const { data: existente } = await supabaseAdmin
                    .from('eventos').select('id, imagem_url, descricao, capacidade, hora')
                    .eq('filial', filialCrm.nome).eq('nome', titulo).eq('data', dataISO)
                    .maybeSingle();
                if (!existente) {
                    console.log(`   ${filialCrm.nome}: evento ainda não existe no CRM (rode a sincronização da Recepção dessa filial primeiro) — pulando.`);
                    semMatchNenhum++;
                    continue;
                }
                const payload = {
                    ...(!existente.imagem_url && imagem_url ? { imagem_url } : {}),
                    ...(!existente.descricao && descricaoNova ? { descricao: descricaoNova } : {}),
                    ...(!existente.capacidade && capacidade ? { capacidade } : {}),
                    ...(!existente.hora && hora ? { hora } : {}),
                };
                if (Object.keys(payload).length === 0) { console.log(`   ${filialCrm.nome}: já estava completo, nada a atualizar.`); continue; }
                const { error } = await supabaseAdmin.from('eventos').update(payload).eq('id', existente.id);
                if (error) { console.warn(`   ${filialCrm.nome}: falha ao atualizar —`, error.message); continue; }
                console.log(`   ${filialCrm.nome}: atualizado (${Object.keys(payload).join(', ')}).`);
                atualizados++;
            }
            console.log('');
        } catch (e) {
            console.warn(`Falha processando card ${i}:`, e.message);
        }
    }

    console.log(`\nConcluído: ${atualizados} linha(s) de evento atualizada(s), ${semMatchNenhum} filial(is) marcada(s) sem evento base ainda no CRM.`);
    console.log('A janela do navegador continua aberta — feche manualmente quando quiser.');
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });

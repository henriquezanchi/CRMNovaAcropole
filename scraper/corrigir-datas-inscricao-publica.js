// Corrige a data/hora de "Abertura de Turma" por filial usando a página
// PÚBLICA de inscrição (inscricao.acropolebrasil.com.br/?eventoId=...) —
// pedido do usuário (2026-09-15), depois de confirmarmos um bug real:
// a tela de Recepção do Ulisses, pra uma filial que NÃO criou o evento,
// mostra as datas de todo o ciclo já "juntadas" (ex: "Abertura de turma
// de 25/09 a 01/10"), e nossa sincronização normal
// (sincronizarComparecimentoNoCrm(), ulisses.js) acaba sempre gravando a
// ÚLTIMA data desse intervalo pra QUALQUER filial não-criadora — errado
// pra quem tem uma data diferente da última (confirmado ao vivo:
// Garavelo tinha 28/09 de verdade, mas ficou gravado 01/10 igual
// Jardim América/Setor Oeste).
//
// Esta página pública, por outro lado, já mostra a data CERTA de cada
// unidade (rádio "Selecione a unidade de interesse") — sem precisar de
// login nenhum, nem no Ulisses da filial nem na conta centralizadora.
// O usuário confirmou que o mesmo link aparece no site institucional de
// cada filial (é só entrar lá, copiar o link e baixar a imagem).
//
// Uso: node corrigir-datas-inscricao-publica.js "<link da página de inscrição>" "<nome EXATO do evento em eventos.nome>"
// Exemplo: node corrigir-datas-inscricao-publica.js "https://inscricao.acropolebrasil.com.br/?eventoId=24343" "Aula Experimental do Curso de Filosofia para Viver"
//
// SEMPRE CORRIGE (não só preenche em branco) — diferente de
// capturar-eventos-centralizados.js, que só completa campo vazio; aqui a
// página pública é a fonte de verdade pra ESTE dado específico (data/hora),
// então uma data errada já gravada deve ser sobrescrita. Só atualiza a
// linha de `eventos` que já existe (filial + nome exato + já é a
// ocorrência futura mais próxima) — nunca cria linha nova.
import { chromium } from 'playwright';
import { supabaseAdmin } from './lib/supabaseAdmin.js';

const [, , URL_INSCRICAO, NOME_EVENTO] = process.argv;

if (!URL_INSCRICAO || !NOME_EVENTO) {
    console.error('Uso: node corrigir-datas-inscricao-publica.js "<link da página de inscrição>" "<nome EXATO do evento em eventos.nome>"');
    process.exit(1);
}

function normalizarTexto(s) {
    const semAcento = Array.from((s || '').normalize('NFD'))
        .filter(ch => { const c = ch.codePointAt(0); return c < 0x300 || c > 0x36f; })
        .join('');
    return semAcento.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Mesma técnica de nucleoFilialCrm() (capturar-eventos-centralizados.js) —
// tira ruído comum ("GOIANIA", "AP DE", "/MT") e sobra só o núcleo que
// distingue uma filial NOSSA da outra, pra comparar por "inclui".
function nucleoFilialCrm(nomeFilial) {
    return normalizarTexto(nomeFilial)
        .replace(/^GOIANIA\s*-?\s*/, '')
        .replace(/\/?MT$/, '')
        .trim();
}

const NOMES_DIA_SEMANA = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];

// Lê a lista "Selecione a unidade de interesse" pelo TEXTO da página, não
// por seletor CSS (não temos o HTML real confirmado, só um print) — mesmo
// princípio já usado em exportarCatalogoEventos()/lerTodasFiliaisMarcadas()
// (achar pelo padrão de texto, não por classe adivinhada). O padrão visual
// confirmado: 1 linha com o nome da unidade, seguida de 1 linha
// "DiaDaSemana | DD/MM/AAAA | HHh".
async function lerUnidadesDaPagina(page) {
    const RE_LINHA_HORARIO = /^([A-Za-zÀ-ÿ]+)\s*\|\s*(\d{2})\/(\d{2})\/(\d{4})\s*\|\s*(\d{1,2})h$/;

    // Espera ativa (poll) até a lista de verdade carregar — é uma SPA
    // (Nuxt), o HTML inicial vem vazio até o JS rodar e chamar a API.
    let linhas = [];
    for (let tentativa = 0; tentativa < 30; tentativa++) {
        const textoBruto = await page.locator('body').innerText().catch(() => '');
        linhas = textoBruto.split('\n').map(l => l.trim()).filter(Boolean);
        if (linhas.some(l => RE_LINHA_HORARIO.test(normalizarTexto(l).replace(/\s+/g, ' ')))) break;
        await page.waitForTimeout(500);
    }

    const unidades = [];
    for (let i = 1; i < linhas.length; i++) {
        const m = linhas[i].match(RE_LINHA_HORARIO);
        if (!m) continue;
        const [, , dia, mes, ano, hora] = m;
        unidades.push({
            nomeUnidade: linhas[i - 1],
            dataISO: `${ano}-${mes}-${dia}`,
            hora: `${String(hora).padStart(2, '0')}:00:00`,
        });
    }
    return unidades;
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(URL_INSCRICAO, { waitUntil: 'networkidle' });

    const unidades = await lerUnidadesDaPagina(page);
    await browser.close();

    if (unidades.length === 0) {
        console.error('Não consegui ler nenhuma unidade nessa página — confira se o link está certo e se ainda está no ar (evento pode ter expirado).');
        process.exit(1);
    }
    console.log(`${unidades.length} unidade(s) encontrada(s) na página pública:\n`);
    unidades.forEach(u => console.log(`   ${u.nomeUnidade} — ${u.dataISO} ${u.hora}`));
    console.log('');

    const { data: filiaisCrm } = await supabaseAdmin.from('filiais').select('nome').eq('ativo', true);
    const nucleosFiliaisCrm = (filiaisCrm || []).map(f => ({ nome: f.nome, nucleo: nucleoFilialCrm(f.nome) }));
    const hojeISO = new Date().toISOString().slice(0, 10);

    let corrigidos = 0, semMatchFilial = 0, semEventoBase = 0;
    for (const u of unidades) {
        const textoNorm = normalizarTexto(u.nomeUnidade);
        const filialCrm = nucleosFiliaisCrm.find(f => f.nucleo && textoNorm.includes(f.nucleo));
        if (!filialCrm) {
            console.log(`"${u.nomeUnidade}" não bate com nenhuma das nossas filiais — ignorando.`);
            semMatchFilial++;
            continue;
        }

        // Pega a ocorrência futura mais próxima já gravada com esse nome
        // exato nesta filial — é ela que representa "o ciclo atual",
        // mesmo que a data gravada esteja errada (é justamente o que
        // estamos corrigindo).
        const { data: existentes } = await supabaseAdmin
            .from('eventos')
            .select('id, data, hora')
            .eq('filial', filialCrm.nome)
            .eq('nome', NOME_EVENTO)
            .gte('data', hojeISO)
            .order('data', { ascending: true })
            .limit(1);

        if (!existentes || existentes.length === 0) {
            console.log(`${filialCrm.nome}: nenhum evento futuro "${NOME_EVENTO}" encontrado no CRM — rode a sincronização de Comparecimento dessa filial primeiro (não crio linha nova aqui).`);
            semEventoBase++;
            continue;
        }

        const existente = existentes[0];
        if (existente.data === u.dataISO && (existente.hora || '').startsWith(u.hora.slice(0, 5))) {
            console.log(`${filialCrm.nome}: já estava certo (${u.dataISO} ${u.hora}).`);
            continue;
        }

        const { error } = await supabaseAdmin
            .from('eventos')
            .update({ data: u.dataISO, hora: u.hora, link_inscricao: URL_INSCRICAO })
            .eq('id', existente.id);
        if (error) {
            console.warn(`${filialCrm.nome}: falha ao corrigir —`, error.message);
            continue;
        }
        console.log(`${filialCrm.nome}: CORRIGIDO de ${existente.data} ${existente.hora || '?'} para ${u.dataISO} ${u.hora}.`);
        corrigidos++;
    }

    console.log(`\nConcluído: ${corrigidos} evento(s) corrigido(s), ${semMatchFilial} unidade(s) sem filial nossa correspondente, ${semEventoBase} filial(is) sem evento base ainda no CRM.`);
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });

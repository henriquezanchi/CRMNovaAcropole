// Checkpoint independente, sugerido pelo usuário depois de achar 2
// eventos exclusivos do Garavelo ("Bushido, o código de honra dos
// samurais"/"Workshop de Oratória") cadastrados por engano sob "Goiânia
// - Setor Oeste" no CRM (ver CLAUDE.md, seção "Ulisses", bug real
// 2026-09-10): cada filial tem um site público próprio
// (acropole.org.br/<slug>) que anuncia os eventos futuros dela — depois
// de importar, comparamos o que ficou em `eventos` (futuro, ativo) contra
// o que o SITE PÚBLICO da mesma filial realmente anuncia. Se um evento
// aparece no CRM sob a filial X mas o site público de X nunca fala dele,
// é sinal forte de que a sessão do Ulisses estava logada na filial
// ERRADA quando aquele evento foi capturado (ver `verificarFilialLogada()`
// em ulisses-local.js — a defesa PREVENTIVA; esta função aqui é a
// auditoria DEPOIS do fato, útil mesmo pra pegar dado que entrou antes
// dessa defesa existir).
//
// Puramente informativo — nunca apaga nem corrige nada sozinho, só avisa
// no terminal pra revisão manual. Só audita filial com `slug_site_publico`
// preenchido (`migracao_filial_slug_site_publico.sql`) — sem slug
// configurado, a filial é pulada (nunca inventamos a URL do site).
import { chromium } from 'playwright';
import { supabaseAdmin } from './lib/supabaseAdmin.js';

function normalizarTexto(s) {
    const semAcento = Array.from((s || '').normalize('NFD'))
        .filter(ch => { const c = ch.codePointAt(0); return c < 0x300 || c > 0x36f; })
        .join('');
    return semAcento.toUpperCase().replace(/\s+/g, ' ').trim();
}

// O texto do evento no site público raramente é IDÊNTICO byte a byte ao
// título gravado no CRM (pode ter reticências, emoji, quebra de linha
// diferente) — em vez de exigir o nome inteiro, considera "encontrado" se
// as 3 primeiras palavras "significativas" (>=4 letras, corta artigo/
// preposição) aparecerem em sequência no texto da página.
function trechoSignificativo(nomeEvento) {
    const palavras = normalizarTexto(nomeEvento).split(' ').filter(p => p.length >= 4);
    return palavras.slice(0, 3).join(' ');
}

export async function verificarEventosPublicos(browser, filial, slug) {
    const hojeISO = new Date().toISOString().slice(0, 10);
    const { data: eventos, error } = await supabaseAdmin
        .from('eventos')
        .select('id, nome, data')
        .eq('filial', filial)
        .eq('ativo', true)
        .gte('data', hojeISO);
    if (error) throw new Error(`Erro buscando eventos de "${filial}": ${error.message}`);
    if (!eventos || eventos.length === 0) return { filial, semEventos: true, naoConfirmados: [] };

    const page = await browser.newPage();
    let textoSite = '';
    try {
        await page.goto(`https://acropole.org.br/${slug}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        textoSite = normalizarTexto(await page.locator('body').innerText());
    } finally {
        await page.close();
    }

    const naoConfirmados = eventos.filter(ev => {
        const trecho = trechoSignificativo(ev.nome);
        return trecho && !textoSite.includes(trecho);
    });
    return { filial, semEventos: false, naoConfirmados, totalEventos: eventos.length };
}

export async function verificarEventosPublicosDeTodasAsFiliais() {
    const { data: filiais, error } = await supabaseAdmin
        .from('filiais').select('nome, slug_site_publico').eq('ativo', true);
    if (error) throw new Error('Erro buscando filiais: ' + error.message);
    const comSlug = (filiais || []).filter(f => f.slug_site_publico);
    if (comSlug.length === 0) {
        console.log('\n[verificar-eventos-publicos] Nenhuma filial com slug_site_publico configurado — pulando checkpoint (rode migracao_filial_slug_site_publico.sql).');
        return;
    }

    console.log(`\n[verificar-eventos-publicos] Conferindo eventos futuros contra o site público de ${comSlug.length} filial(is)...`);
    const browser = await chromium.launch({ headless: true });
    let algumProblema = false;
    try {
        for (const f of comSlug) {
            try {
                const r = await verificarEventosPublicos(browser, f.nome, f.slug_site_publico);
                if (r.semEventos) {
                    console.log(`   ${f.nome}: sem eventos futuros ativos no CRM, nada a conferir.`);
                } else if (r.naoConfirmados.length === 0) {
                    console.log(`   ${f.nome}: OK — ${r.totalEventos} evento(s) futuro(s), todos confirmados no site público.`);
                } else {
                    algumProblema = true;
                    console.warn(`   ⚠️  ${f.nome}: ${r.naoConfirmados.length}/${r.totalEventos} evento(s) NÃO encontrados no site público (acropole.org.br/${f.slug_site_publico}/) — possível evento capturado sob a filial errada:`);
                    r.naoConfirmados.forEach(ev => console.warn(`        - [id=${ev.id}] "${ev.nome}" (${ev.data})`));
                }
            } catch (e) {
                console.warn(`   ${f.nome}: não consegui conferir (${e.message}) — pulando essa filial.`);
            }
        }
    } finally {
        await browser.close();
    }
    if (algumProblema) {
        console.warn('\n[verificar-eventos-publicos] Revise manualmente os eventos listados acima (tela Agenda do CRM) — isto é só um alerta, nada foi apagado/alterado automaticamente.');
    } else {
        console.log('[verificar-eventos-publicos] Nenhum problema encontrado.');
    }
}

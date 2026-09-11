// Indicador de progresso do scraper do Mercúrio no topbar — pedido do
// usuário: "algum sinal visível no alto da tela" enquanto uma rodada está
// em andamento, com % em tempo real ou previsão de conclusão. Lê a linha
// única de `scraper_progresso` (migracao_scraper_progresso.sql), gravada
// pelo próprio scraper (scraper/mercurio.js, via atualizarProgresso() em
// scraper/lib/supabaseAdmin.js) em cada etapa/turma processada.
//
// Depende de: window.supabaseClient (index.html).
const INTERVALO_POLL_PROGRESSO_MS = 5000;
// Se a última atualização for mais velha que isso, trata como travado/
// morto (ex: processo derrubado à força, sem passar pelo handler de
// cancelamento) e esconde o indicador — nunca fica "rodando" pra sempre.
const LIMITE_PROGRESSO_TRAVADO_MS = 5 * 60 * 1000;

function formatarEtaRestante(iniciadoEm, passoAtual, passoTotal) {
    if (!iniciadoEm || !passoAtual || !passoTotal || passoAtual <= 0 || passoTotal <= passoAtual) return '';
    const decorridoMs = Date.now() - new Date(iniciadoEm).getTime();
    if (decorridoMs <= 0) return '';
    const restanteMs = (decorridoMs / passoAtual) * (passoTotal - passoAtual);
    const restanteMin = Math.round(restanteMs / 60000);
    if (restanteMin <= 0) return ' — menos de 1min restante';
    if (restanteMin === 1) return ' — ~1min restante';
    if (restanteMin < 60) return ` — ~${restanteMin}min restantes`;
    const horas = Math.floor(restanteMin / 60);
    const minRestante = restanteMin % 60;
    return ` — ~${horas}h${minRestante > 0 ? minRestante + 'min' : ''} restantes`;
}

async function verificarProgressoScraperMercurio() {
    const el = document.getElementById('scraperProgressoIndicador');
    const textoEl = document.getElementById('scraperProgressoTexto');
    if (!el || !textoEl) return;

    const { data, error } = await window.supabaseClient
        .from('scraper_progresso')
        .select('*')
        .eq('id', 'mercurio')
        .maybeSingle();

    if (error || !data) { el.style.display = 'none'; return; }

    const travado = data.atualizado_em && (Date.now() - new Date(data.atualizado_em).getTime()) > LIMITE_PROGRESSO_TRAVADO_MS;
    if (data.concluido || travado) { el.style.display = 'none'; return; }

    const pct = (data.passo_total && data.passo_atual != null) ? Math.round((data.passo_atual / data.passo_total) * 100) : null;
    const eta = formatarEtaRestante(data.iniciado_em, data.passo_atual, data.passo_total);
    const partes = [data.filial, data.etapa].filter(Boolean);
    const rotulo = partes.join(' — ') || 'Rodando...';
    textoEl.innerText = `${rotulo}${pct != null ? ` (${pct}%)` : ''}${eta}`;
    el.title = `Scraper do Mercúrio em andamento: ${rotulo}${eta}`;
    el.style.display = 'flex';
}

document.addEventListener('DOMContentLoaded', () => {
    verificarProgressoScraperMercurio();
    setInterval(verificarProgressoScraperMercurio, INTERVALO_POLL_PROGRESSO_MS);
});

// Pedido do usuário (2026-10-01, logo depois de criar o cron de 6h pra
// "semana do evento"): "aperte o ulisses pra 2-3h na reta final (um dia
// antes do evento, e no dia do evento)" — um 3º nível de cadência, mais
// apertado que `ulisses-api-se-evento-proximo.mjs` (6h, janela de 7
// dias), só pros 2 últimos dias.
//
// MESMO padrão do script de 6h (não dá pro Windows Task Scheduler decidir
// dinamicamente "estamos na reta final?" sozinho — quem decide é este
// script, a cada disparo, consultando o banco): agendamento FIXO (a cada
// 3h, o ano inteiro) + um GATE que só deixa passar quando há evento
// ativo (qualquer filial) com data HOJE ou AMANHÃ. Fora disso, é um
// no-op quase instantâneo — mesmo raciocínio de custo zero fora da
// janela já usado no script de 6h.
//
// As 2 Tarefas Agendadas (6h + esta) convivem sem conflito: nos dias
// comuns (evento a 3-7 dias), só a de 6h dispara de verdade; nos 2 dias
// finais, as duas podem disparar de verdade na mesma janela de tempo —
// aceitável (o pior caso é 1 sincronização "a mais" rodando perto de
// outra), mas ver a seção "Lição" abaixo sobre o risco de sobreposição
// se um ciclo atrasar.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.chdir(path.dirname(fileURLToPath(import.meta.url)));

const { default: dotenv } = await import('dotenv');
dotenv.config();

// 1 = hoje ou amanhã (inclusive) — "véspera e dia do evento".
const JANELA_DIAS_RETA_FINAL = 1;

const { supabaseAdmin } = await import('./lib/supabaseAdmin.js');

async function buscarEventoNaRetaFinal() {
    const hoje = new Date();
    const limite = new Date(hoje);
    limite.setDate(limite.getDate() + JANELA_DIAS_RETA_FINAL);
    const hojeISO = hoje.toISOString().slice(0, 10);
    const limiteISO = limite.toISOString().slice(0, 10);

    const { data, error } = await supabaseAdmin
        .from('eventos')
        .select('filial, nome, data')
        .eq('ativo', true)
        .gte('data', hojeISO)
        .lte('data', limiteISO)
        .order('data', { ascending: true })
        .limit(1);
    if (error) {
        console.error('[ulisses-api-reta-final] Erro consultando eventos — pulando esta rodada por segurança:', error.message);
        return null;
    }
    return (data && data.length > 0) ? data[0] : null;
}

const evento = await buscarEventoNaRetaFinal();
if (!evento) {
    console.log('[ulisses-api-reta-final] Nenhum evento acontecendo hoje/amanhã — pulando (sem gasto de API).');
    process.exit(0);
}

console.log(`[ulisses-api-reta-final] Evento na reta final ("${evento.nome}", ${evento.filial}, ${evento.data}) — rodando sincronização completa via API do Ulisses.`);
const { executarSomenteUlissesApi } = await import('./mercurio.js');
executarSomenteUlissesApi().catch((e) => {
    console.error('[ulisses-api-reta-final] Erro fatal:', e);
    process.exit(1);
});

// Pedido do usuário (2026-10-01): "um cron pra rodar diariamente (acho
// que já temos isso) e outro para rodar a cada 6 horas na semana do
// evento, sem [precisar ir pra] a cada hora nos dois dias que antecedem
// o evento. Isso ajuda a manter o SDR acompanhando o resultado do
// trabalho em tempo real".
//
// IMPORTANTE, corrigindo uma suposição do pedido: o cron DIÁRIO que já
// existe (pg_cron 05h, ver migracao_agendamento_mercurio_pgcron.sql) só
// cobre o MERCÚRIO (Ativos/Inativos) — a sincronização de Inscrições via
// API do Ulisses foi DESLIGADA de dentro do GitHub Actions (ver
// CORREÇÃO GRAVE 2026-09-21 no CLAUDE.md: api.acropolebrasil.com.br
// também é bloqueada por Cloudflare a partir de IP de datacenter) e só
// funciona rodando desta máquina de confiança. Ou seja: hoje, "diário"
// pro Ulisses só acontece se alguém clicar manualmente (botão no CRM,
// .bat, ou `npm run ulisses-api-local`) — não era automático ainda.
// Ver o SETUP.md (ou o próprio texto do commit) pra como registrar as 2
// Tarefas Agendadas do Windows que resolvem os 2 pedidos de uma vez.
//
// Em vez de tentar fazer o Windows Task Scheduler decidir dinamicamente
// "estamos perto de um evento?" (ele não sabe nada do nosso banco), o
// AGENDAMENTO em si fica fixo e simples — uma Tarefa Agendada rodando
// ESTE script a cada 6h, o ano inteiro — e é o PRÓPRIO SCRIPT que decide
// a cada disparo se vale a pena sincronizar de verdade: só roda a
// sincronização completa (mesma de sincronizar-ulisses-api-local.mjs) se
// houver algum evento ATIVO, de QUALQUER filial, com data dentro da
// janela abaixo. Fora da janela, é um no-op quase instantâneo (1
// consulta leve ao banco) — rodar a cada 6h o ano inteiro não tem custo
// relevante nenhum.
//
// JANELA_DIAS_ANTES = 7 cobre "a semana do evento" inteira, INCLUINDO os
// 2 dias que antecedem — que continuam em 6h, nunca escalando pra hora
// em hora (pedido explícito do usuário: "sem a cada hora nos dois dias
// que antecedem o evento").
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.chdir(path.dirname(fileURLToPath(import.meta.url)));

const { default: dotenv } = await import('dotenv');
dotenv.config();

const JANELA_DIAS_ANTES = 7;

const { supabaseAdmin } = await import('./lib/supabaseAdmin.js');

// Qualquer evento ativo (não só "Abertura de Turma") — o pedido é sobre
// acompanhar CAPTAÇÃO em geral na semana que antecede qualquer atividade
// que a filial esteja divulgando, não só um tipo específico.
async function buscarEventoNaJanela() {
    const hoje = new Date();
    const limite = new Date(hoje);
    limite.setDate(limite.getDate() + JANELA_DIAS_ANTES);
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
        // Erro de consulta não deve FORÇAR uma sincronização completa à
        // toa (custaria ~3-5 min) nem silenciar o problema — loga e sai
        // sem rodar, a próxima tentativa (6h depois) tenta de novo.
        console.error('[ulisses-api-se-evento-proximo] Erro consultando eventos — pulando esta rodada por segurança:', error.message);
        return null;
    }
    return (data && data.length > 0) ? data[0] : null;
}

const evento = await buscarEventoNaJanela();
if (!evento) {
    console.log(`[ulisses-api-se-evento-proximo] Nenhum evento ativo nos próximos ${JANELA_DIAS_ANTES} dias — pulando (sem gasto de API nem tempo de sincronização).`);
    process.exit(0);
}

console.log(`[ulisses-api-se-evento-proximo] Evento próximo encontrado ("${evento.nome}", ${evento.filial}, ${evento.data}) — rodando sincronização completa via API do Ulisses.`);
const { executarSomenteUlissesApi } = await import('./mercurio.js');
executarSomenteUlissesApi().catch((e) => {
    console.error('[ulisses-api-se-evento-proximo] Erro fatal:', e);
    process.exit(1);
});

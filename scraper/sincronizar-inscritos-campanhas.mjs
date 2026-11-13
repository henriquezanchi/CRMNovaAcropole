// Rodada leve do Ulisses: só a lista de inscritos dos eventos das campanhas ativas (pedido do usuário
// em 13/11/2026: o painel dos diretores precisa do Ulisses a cada 10 minutos).
//
// A rodada completa (modo ulisses_api) importa o CSV de todas as filiais pela tela do CRM e leva 10 a 17
// minutos. Aqui só se chama filtrarEmails() da API para os eventos que ainda não passaram e que têm
// campanha ativa, e grava em ulisses_inscricoes_evento (lido pelo painel) e evento_leads. Não abre
// navegador.
//
// Disparado pelo pg_cron `ulisses-inscritos-campanhas` (migracao_ulisses_inscritos_10min.sql), via
// scraper-disparar com modo=ulisses_inscritos.
import { supabaseAdmin } from './lib/supabaseAdmin.js';
import { filiaisAtivas } from './ulisses-api.js';
import { sincronizarComparecimentoViaApi, resolverFilialIdUlisses } from './importar-ulisses-api.js';

const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

async function main() {
    const inicio = Date.now();
    const { data: campanhas, error: erroCamp } = await supabaseAdmin
        .from('campanhas_whatsapp').select('slug, eventos!inner(evento_id_ulisses, data)').eq('ativa', true);
    if (erroCamp) throw new Error('Erro ao ler as campanhas: ' + erroCamp.message);
    const idsEvento = [...new Set((campanhas || [])
        .filter(c => c.eventos?.evento_id_ulisses && c.eventos.data >= hoje)
        .map(c => c.eventos.evento_id_ulisses))];
    if (idsEvento.length === 0) { console.log('[inscritos] Nenhuma campanha ativa com evento por vir.'); return; }

    // O mesmo evento do Ulisses pode estar cadastrado em várias escolas (ex.: aula experimental conjunta);
    // cada escola tem a sua lista de inscritos no Ulisses.
    const { data: linhas, error: erroEv } = await supabaseAdmin
        .from('eventos').select('filial, evento_id_ulisses').eq('ativo', true).in('evento_id_ulisses', idsEvento);
    if (erroEv) throw new Error('Erro ao ler os eventos: ' + erroEv.message);
    const porFilial = new Map();
    for (const l of linhas || []) {
        if (!porFilial.has(l.filial)) porFilial.set(l.filial, new Set());
        porFilial.get(l.filial).add(l.evento_id_ulisses);
    }

    const filiaisUlisses = await filiaisAtivas();
    let falhas = 0;
    for (const [filial, ids] of porFilial) {
        const filialId = resolverFilialIdUlisses(filial, filiaisUlisses);
        if (!filialId) { falhas++; console.warn(`[inscritos] "${filial}" sem correspondência no Ulisses.`); continue; }
        try {
            const log = await sincronizarComparecimentoViaApi(filial, filialId, { eventoIdsUlisses: [...ids] });
            console.log(`[inscritos] ${filial}: ${log}`);
        } catch (e) {
            falhas++;
            console.error(`[inscritos] Falha em "${filial}":`, e.message);
        }
    }
    console.log(`[inscritos] ${porFilial.size} escola(s), ${idsEvento.length} evento(s), ${Math.round((Date.now() - inicio) / 1000)}s.`);
    if (falhas) process.exitCode = 1;
}

main().catch(e => { console.error('[inscritos] Erro:', e.message); process.exit(1); });

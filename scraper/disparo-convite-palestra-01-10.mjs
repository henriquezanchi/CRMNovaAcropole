// Script DESCARTÁVEL, de uso único — disparo em massa do convite
// "convite_palestra" pra todos os leads não-Ativos das 3 filiais com
// evento hoje (01/10/2026, 20h: Setor Oeste, Jardim América, Goiânia II),
// espalhado em ondas ao longo do dia (pedido do usuário: "enviar em
// lotes menores ao longo do dia" em vez de tudo de uma vez — o número
// já foi suspenso uma vez por "atividade incomum", um pico de ~12 mil
// mensagens simultâneas seria um risco real de repetir isso).
//
// Roda DESTACADO do processo que o lançou (Start-Process -WindowStyle
// Hidden), sobrevive ao fim desta sessão. Progresso em
// scraper/disparo-log-01-10.jsonl (1 linha JSON por evento: onda
// iniciada, resultado por lead, onda concluída, ou abortado).
//
// Circuito de segurança: se uma onda tiver mais de 40% de falha, ou se
// aparecer qualquer erro de nível de CONTA (ex: "API access blocked",
// code 0/200 OAuthException — o mesmo que já suspendeu o número antes),
// o script para IMEDIATAMENTE as ondas seguintes e grava um aviso bem
// visível no log, em vez de continuar queimando o resto da lista contra
// uma conta possivelmente bloqueada de novo.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, 'disparo-log-01-10.jsonl');
const STOP_PATH = path.join(__dirname, 'disparo-PARAR.txt'); // criar esse arquivo manualmente cancela as próximas ondas

const SUPABASE_URL = 'https://eovgljcowblwoxmobeno.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hB8cP0_-9K9lt-18AKUsMw_xVDM7rea';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TEMPLATE_NOME = 'convite_palestra';
const TEMPLATE_IDIOMA = 'pt_BR';
const TEMPLATE_CORPO = 'Olá, {{1}}!\n\nAqui quem fala é {{2}}, da Nova Acrópole {{3}}. Tudo bem?\n\nEstou entrando em contato para te convidar para {{4}} que deve acontecer no próximo dia {{5}}.\n\nPosso enviar mais detalhes sobre isso?';
const ATENDENTE = 'a equipe'; // mensagem de campanha, não 1:1 — genérico de propósito
const EVENTO_DESCRICAO = 'a Aula Experimental do Curso de Filosofia para Viver';
// Pedido do usuário (2026-10-01, depois de ver "no próximo dia hoje,
// 01/10" saindo estranho nas mensagens reais de hoje cedo): o corpo do
// template já tem "no próximo dia {{5}}" fixo, então {{5}} só precisa
// completar a frase — "01/10, HOJE, às 20h" -> "no próximo dia 01/10,
// HOJE, às 20h".
const DATA_DESCRICAO = '01/10, HOJE, às 20h';

const ALVOS = [
    { filial: 'Goiânia - Setor Oeste', eventoId: 418, filialComPreposicao: 'do Setor Oeste' },
    { filial: 'Goiânia - Jardim América', eventoId: 500, filialComPreposicao: 'do Jardim América' },
    { filial: 'Goiânia II', eventoId: 657, filialComPreposicao: 'do Goiânia II' },
];

const TAMANHO_LOTE = 5;
const PAUSA_ENTRE_LOTES_MS = 500;
const TAMANHO_ONDA = 700; // ~700 mensagens por onda
const PAUSA_ENTRE_ONDAS_MS = 70 * 60 * 1000; // 70 min entre ondas
const LIMIAR_FALHA_CIRCUITO = 0.4; // 40% de falha numa onda = algo está errado

function log(obj) {
    const linha = JSON.stringify({ ts: new Date().toISOString(), ...obj });
    fs.appendFileSync(LOG_PATH, linha + '\n');
    console.log(linha);
}

function pausar(ms) { return new Promise((r) => setTimeout(r, ms)); }

function primeiroNomeFormatado(nomeCompleto) {
    const primeiro = String(nomeCompleto || '').trim().split(/\s+/)[0] || 'tudo bem';
    return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

function montarPreview(params) {
    let texto = TEMPLATE_CORPO;
    params.forEach((p, i) => { texto = texto.replaceAll(`{{${i + 1}}}`, p); });
    return texto;
}

async function buscarTodosElegiveis(filial, eventoId) {
    const todos = [];
    let offset = 0;
    const LIMITE_PAGINA = 1000;
    for (;;) {
        const { data, error } = await supabase.rpc('leads_excluindo_tags_filial', {
            p_filial: filial,
            p_tags_excluir: ['Ativo', 'Aluno Ativo'],
            p_evento_id: eventoId,
            p_limite: LIMITE_PAGINA,
            p_offset: offset,
        });
        if (error) throw new Error(`Erro buscando leads de ${filial}: ${error.message}`);
        todos.push(...data);
        if (data.length < LIMITE_PAGINA) break;
        offset += LIMITE_PAGINA;
    }
    return todos;
}

async function enviarUm(lead, filialComPreposicao) {
    const params = [
        primeiroNomeFormatado(lead.pessoaNome),
        ATENDENTE,
        filialComPreposicao,
        EVENTO_DESCRICAO,
        DATA_DESCRICAO,
    ];
    try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
            method: 'POST',
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'content-type': 'application/json' },
            body: JSON.stringify({
                pessoaIdentificador: lead.pessoaIdentificador,
                tipo: 'template',
                templateNome: TEMPLATE_NOME,
                templateIdioma: TEMPLATE_IDIOMA,
                templateParams: params,
                templatePreview: montarPreview(params),
                atendenteNome: ATENDENTE,
            }),
        });
        const dados = await resp.json();
        if (!resp.ok || dados.ok === false) {
            return { ok: false, erro: (dados.detalhe && dados.detalhe.message) || dados.erro || `http_${resp.status}`, codigo: dados.detalhe && dados.detalhe.code };
        }
        return { ok: true, waMessageId: dados.wa_message_id };
    } catch (e) {
        return { ok: false, erro: e.message || String(e) };
    }
}

// Bug real (2026-10-01, achado ao vivo): `.insert({...}).catch(fn)`
// derrubou o script inteiro ("...catch is not a function") — o builder
// do supabase-js v2 é thenable mas não expõe `.catch` encadeável desse
// jeito. Corrigido com try/catch de verdade em volta das 2 escritas —
// nenhuma delas pode travar a onda inteira se falhar.
async function vincularEventoLeadsELog(filial, eventoId, sucesso) {
    if (sucesso.length === 0) return;
    try {
        const vinculos = sucesso.map((r) => ({ evento_id: eventoId, pessoaIdentificador: r.pessoaIdentificador, origem: 'crm' }));
        const { error: erroVinculo } = await supabase.from('evento_leads').upsert(vinculos, { onConflict: 'evento_id,pessoaIdentificador', ignoreDuplicates: true });
        if (erroVinculo) log({ evento: 'aviso_evento_leads_falhou', filial, erro: erroVinculo.message });
    } catch (e) {
        log({ evento: 'aviso_evento_leads_falhou', filial, erro: e.message || String(e) });
    }

    try {
        const { error: erroLog } = await supabase.from('log_atividade').insert({
            filial,
            acao: 'convite_whatsapp_api_lote',
            autor: 'Henrique (disparo automático 01/10)',
            pessoa_ids: sucesso.map((r) => r.pessoaIdentificador),
            detalhes: { template: 'Convite para evento', evento: EVENTO_DESCRICAO, enviados: sucesso.length, script: 'disparo-convite-palestra-01-10' },
        });
        if (erroLog) log({ evento: 'aviso_log_atividade_falhou', filial, erro: erroLog.message });
    } catch (e) {
        log({ evento: 'aviso_log_atividade_falhou', filial, erro: e.message || String(e) });
    }
}

async function moverParaAbordagem(filial, pessoaIds) {
    if (pessoaIds.length === 0) return;
    try {
        // Mesma convenção já confirmada em produção: 1ª coluna "Frios" -> "Abordagem".
        const { error } = await supabase
            .from('leads_inscricoes')
            .update({ funil_agencia: 'Abordagem', funil_agencia_atualizado_em: new Date().toISOString() })
            .in('pessoaIdentificador', pessoaIds)
            .eq('funil_agencia', 'Frios');
        if (error) log({ evento: 'aviso_mover_abordagem_falhou', filial, erro: error.message });
    } catch (e) {
        log({ evento: 'aviso_mover_abordagem_falhou', filial, erro: e.message || String(e) });
    }
}

function circuitoDeveParar(resultadosOnda) {
    if (resultadosOnda.length === 0) return false;
    const falhas = resultadosOnda.filter((r) => !r.ok);
    const erroDeContaToda = falhas.some((r) => /API access blocked/i.test(r.erro || '') || r.codigo === 0 || r.codigo === 200);
    if (erroDeContaToda) return true;
    return falhas.length / resultadosOnda.length > LIMIAR_FALHA_CIRCUITO;
}

async function processarOnda(filial, eventoId, filialComPreposicao, lote) {
    const resultados = [];
    for (let i = 0; i < lote.length; i += TAMANHO_LOTE) {
        if (fs.existsSync(STOP_PATH)) {
            log({ evento: 'parado_manualmente', filial, motivo: 'arquivo disparo-PARAR.txt encontrado' });
            return { resultados, parado: true };
        }
        const miniLote = lote.slice(i, i + TAMANHO_LOTE);
        const respostas = await Promise.all(miniLote.map(async (lead) => {
            const r = await enviarUm(lead, filialComPreposicao);
            return { pessoaIdentificador: lead.pessoaIdentificador, nome: lead.pessoaNome, ...r };
        }));
        resultados.push(...respostas);
        if (i + TAMANHO_LOTE < lote.length) await pausar(PAUSA_ENTRE_LOTES_MS);
    }
    return { resultados, parado: false };
}

async function main() {
    log({ evento: 'inicio_script' });

    for (const { filial, eventoId, filialComPreposicao } of ALVOS) {
        if (fs.existsSync(STOP_PATH)) { log({ evento: 'parado_antes_da_filial', filial }); break; }

        log({ evento: 'buscando_elegiveis', filial });
        const elegiveis = await buscarTodosElegiveis(filial, eventoId);
        log({ evento: 'elegiveis_encontrados', filial, total: elegiveis.length });

        let processados = 0;
        for (let i = 0; i < elegiveis.length; i += TAMANHO_ONDA) {
            if (fs.existsSync(STOP_PATH)) { log({ evento: 'parado_entre_ondas', filial }); break; }

            const onda = elegiveis.slice(i, i + TAMANHO_ONDA);
            const numeroOnda = Math.floor(i / TAMANHO_ONDA) + 1;
            const totalOndas = Math.ceil(elegiveis.length / TAMANHO_ONDA);
            log({ evento: 'onda_iniciada', filial, numeroOnda, totalOndas, tamanho: onda.length });

            const { resultados, parado } = await processarOnda(filial, eventoId, filialComPreposicao, onda);
            const sucesso = resultados.filter((r) => r.ok);
            const falha = resultados.filter((r) => !r.ok);
            processados += resultados.length;

            await vincularEventoLeadsELog(filial, eventoId, sucesso);
            await moverParaAbordagem(filial, sucesso.map((r) => r.pessoaIdentificador));

            log({
                evento: 'onda_concluida', filial, numeroOnda, totalOndas,
                enviados: sucesso.length, falhas: falha.length,
                amostraErros: falha.slice(0, 5).map((f) => f.erro),
                progressoFilial: `${processados}/${elegiveis.length}`,
            });

            if (parado) break;

            if (circuitoDeveParar(resultados)) {
                log({ evento: 'CIRCUITO_ACIONADO_PARANDO_TUDO', filial, numeroOnda, motivo: 'taxa de falha alta ou erro de nível de conta — ver amostraErros da onda_concluida acima' });
                log({ evento: 'fim_script_por_circuito' });
                return;
            }

            const ultimaOnda = i + TAMANHO_ONDA >= elegiveis.length;
            const ultimaFilial = ALVOS[ALVOS.length - 1].filial === filial;
            if (!(ultimaOnda && ultimaFilial)) {
                log({ evento: 'pausa_entre_ondas', minutos: PAUSA_ENTRE_ONDAS_MS / 60000 });
                await pausar(PAUSA_ENTRE_ONDAS_MS);
            }
        }
    }

    log({ evento: 'fim_script_completo' });
}

main().catch((e) => log({ evento: 'erro_fatal', erro: e.message || String(e) }));

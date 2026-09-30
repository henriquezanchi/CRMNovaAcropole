// Importação do Ulisses via API OFICIAL (scraper/ulisses-api.js) — pedido
// do usuário (2026-09-18): incluir o Ulisses na importação automática
// diária junto com o Mercúrio (5h da manhã), e também puxar os eventos do
// Setor Universitário (quem cria "Abertura de Turma"/"Aula Experimental"
// centralizadamente pra toda a região de Goiânia — ver CLAUDE.md).
//
// Por que via API e não Playwright (scraper/ulisses.js/ulisses-local.js):
// é bem mais simples/confiável que pilotar a tela do Ulisses (sem
// depender de seletor/HTML frágil), e cobre Inscrições+catálogo de
// eventos sem precisar de login manual nenhum.
//
// CORREÇÃO GRAVE (2026-09-21): a premissa original aqui era "a API é só
// uma chamada HTTPS autenticada, sem navegador, então não passa pelo
// Cloudflare que bloqueia IP de datacenter" — **isso estava ERRADO**,
// confirmado por 2 disparos reais via GitHub Actions, 2 bloqueios
// idênticos (`GET /facade/filiaisAtivas -> 403 ... "Just a moment..."`,
// a mesma página de desafio do Cloudflare, mesmo com Bearer token
// válido). `api.acropolebrasil.com.br` também bloqueia por reputação de
// IP/ASN (datacenter/cloud), não só por detectar navegação sem JS. Por
// isso este módulo (embora continue funcionando perfeitamente bem)
// NUNCA deve ser chamado de dentro do GitHub Actions — só da máquina de
// confiança, via `scraper/ulisses-local.js` (de carona, junto com o
// comparecimento) ou `scraper/sincronizar-ulisses-api-local.mjs`
// (dedicado, headless, sem login nenhum). Ver CLAUDE.md, seção
// "CORREÇÃO GRAVE... a API do Ulisses TAMBÉM é bloqueada".
//
// LIMITAÇÃO REAL, confirmada testando ao vivo (2026-09-18) — RESOLVIDA em
// 2026-09-30: o endpoint que traria comparecimento de verdade
// (`GET /facade/emails/{eventoId}`) quebra pra token M2M com erro 500 do
// lado deles ("Cannot invoke Claim.asString() because emailClaim is
// null"). O Célio sugeriu "algo como filtrarEmails" como alternativa —
// achado no Swagger e TESTADO AO VIVO contra produção
// (`POST /facade/filtrarEmails`, ver ulisses-api.js/filtrarEmails() e
// sincronizarComparecimentoViaApi() abaixo): funciona perfeitamente via
// M2M. Comparecimento via API já não depende mais de `ulisses-local.js`
// pra quem já tem `evento_id_ulisses` salvo (ver migracao_evento_id_ulisses.sql)
// — ainda assim, mantido como alternativa (Playwright continua existindo,
// nunca foi removido) pra eventos antigos sem esse id ainda gravado.
//
// LIMITAÇÃO REAL #2: `filialId=132` (Goiânia - Setor Oeste) devolve 403
// em qualquer endpoint protegido — as outras filiais funcionam. Isolado
// por filial (não trava a rodada inteira), com aviso claro no log.
import fs from 'node:fs';
import { supabaseAdmin } from './lib/supabaseAdmin.js';
import { importarNoCrm } from './importar-no-crm.js';
import {
    normalizarNomeUlisses,
    distanciaLevenshteinUlisses,
    carregarTiposEventoUlisses,
    classificarTipoEventoUlisses,
    primeiroNomeParecidoUlisses,
} from './ulisses.js';
import * as ulissesApi from './ulisses-api.js';

const PASTA_EXPORTS = 'exports';
// Setor Universitário NÃO é uma filial nossa no CRM (não tem lead/
// matrícula própria) — é só quem cria "Abertura de Turma"/"Aula
// Experimental" centralizadamente pra região. Fixo de propósito (mesmo
// padrão de outras constantes hardcoded do projeto, ex: BASE_ID_*) — é 1
// filial só, com ID estável no sistema deles, achado consultando
// `filiaisAtivas()` (ver CLAUDE.md).
const FILIAL_ID_SETOR_UNIVERSITARIO = 16;
// Janela de "relevante" pro catálogo de eventos — mesmo espírito de
// `exportarComparecimento()` (Ulisses via Playwright) filtrar só os
// últimos 3 anos: aqui usamos uma janela bem mais curta (90 dias pra
// trás + qualquer coisa no futuro) porque cada evento "relevante" custa
// 1 chamada de API extra (`evento(id)`) — sem esse filtro, filiais com
// muito histórico (800+ eventos) tornariam a rodada diária lenta à toa
// processando evento de anos atrás que não muda mais.
const JANELA_PASSADO_MS = 90 * 24 * 60 * 60 * 1000;

function normalizarTextoFilialApi(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
// Mesmo princípio de `nucleoDistintivoFilial()` (mercurio.js) — tira
// acento e palavra genérica antes de comparar, pra "Goiânia - Jardim
// América" (nome no nosso `filiais`) bater com "Goiânia - Jardim
// América" (labelBotaoLandingPage do Ulisses) mesmo com pequenas
// diferenças de formatação/hífen.
function nucleoDistintivoFilialApi(nome) {
    return normalizarTextoFilialApi(nome).replace(/\b(GOIANIA|GOIAS|NOVA ACROPOLE|MT|GO)\b/g, '').replace(/\s+/g, ' ').trim();
}

// Correspondências CONHECIDAS que a comparação por núcleo distintivo
// (abaixo) nunca resolve sozinha — descoberto 2026-09-21 (usuário
// perguntou por que "Goiânia II" nunca sincroniza via API): o núcleo do
// nosso lado sobra "II" (numeral romano), o do lado do Ulisses sobra "2"
// (numeral arábico — `labelBotaoLandingPage` = "Goiânia - Goiania 2"),
// e "II"/"2" nunca batem por igualdade nem substring. Confirmado contra
// a API na hora: `filialId=65` é o ÚNICO candidato existente pra essa
// filial, sem ambiguidade nenhuma — só não seria achado pelo algoritmo
// genérico. Checado pelo NOME EXATO da nossa filial (não normalizado),
// ANTES do algoritmo — só resolve este caso pontual já confirmado,
// nunca "adivinha" uma correspondência nova.
const MAPEAMENTO_FILIAL_ID_CONHECIDO = {
    'Goiânia II': 65,
};

// Acha o filialId do Ulisses pra 1 filial nossa, comparando o núcleo
// distintivo do nome contra `labelBotaoLandingPage` de TODAS as filiais
// do sistema deles (`filiaisAtivas()`, 140+ filiais nacionais). Não
// escolhe se houver ambiguidade (0 ou 2+ candidatos) — melhor não
// sincronizar do que sincronizar a filial errada.
function resolverFilialIdUlisses(nomeFilialCrm, filiaisUlisses) {
    if (Object.prototype.hasOwnProperty.call(MAPEAMENTO_FILIAL_ID_CONHECIDO, nomeFilialCrm)) {
        return MAPEAMENTO_FILIAL_ID_CONHECIDO[nomeFilialCrm];
    }
    const alvo = nucleoDistintivoFilialApi(nomeFilialCrm);
    if (!alvo) return null;
    const candidatos = filiaisUlisses.filter(f => {
        const rotulo = nucleoDistintivoFilialApi(f.labelBotaoLandingPage || f.nome || '');
        return rotulo === alvo || rotulo.includes(alvo) || alvo.includes(rotulo);
    });
    if (candidatos.length !== 1) return null;
    return candidatos[0].id;
}

// Converte epoch ms pra "AAAA-MM-DD"/"HH:MM" no fuso de Brasília — mesma
// técnica de `hojeBrasil()` (mercurio.js).
function dataBrasilia(epochMs) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(epochMs));
}
function horaBrasilia(epochMs) {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(epochMs));
}

// ============================================================
// Sincroniza o CATÁLOGO de eventos (não comparecimento — ver limitação
// no topo do arquivo) das nossas filiais + Setor Universitário, direto
// via API. Roda 1 vez por rodada (não é por filial) porque um evento do
// Setor Universitário pode "abastecer" várias das nossas filiais de uma
// vez (o caso de "Abertura de Turma" pra toda a região) — processar cada
// evento uma única vez (por eventoId) e, a partir do `filiaisEventos` que
// a própria API devolve, criar/atualizar a linha certa em `eventos` pra
// CADA filial nossa que participa, com a data/vagas EXATAS daquela
// filial (resolve de vez o bug antigo de "data errada pra quem não criou
// o evento", que antes dependia de raspar a página pública de inscrição
// — ver `corrigir-datas-inscricao-publica.js`/CLAUDE.md).
// ============================================================
export async function sincronizarEventosUlissesApi() {
    const { data: filiaisCrm, error: erroFiliais } = await supabaseAdmin.from('filiais').select('nome').eq('ativo', true);
    if (erroFiliais) throw new Error('Erro ao buscar filiais do CRM: ' + erroFiliais.message);

    const filiaisUlisses = await ulissesApi.filiaisAtivas();
    // Map filialIdUlisses -> nome da filial no CRM, só das que deram
    // match único — usado depois pra saber, dentro de `filiaisEventos`,
    // quais entradas são "nossas".
    const nomePorFilialIdUlisses = new Map();
    const semMatch = [];
    for (const f of filiaisCrm || []) {
        const id = resolverFilialIdUlisses(f.nome, filiaisUlisses);
        if (id) nomePorFilialIdUlisses.set(id, f.nome);
        else semMatch.push(f.nome);
    }
    if (nomePorFilialIdUlisses.size === 0) {
        return '0 filial(is) do CRM encontrada(s) no sistema do Ulisses — nada a sincronizar.' + (semMatch.length ? ` Sem match: ${semMatch.join(', ')}.` : '');
    }

    // IDs de onde vamos LISTAR eventos: nossas filiais matched + Setor
    // Universitário (mesmo sem ser filial nossa — é só fonte de eventos
    // que PODEM pertencer a uma das nossas).
    const idsParaListar = [...new Set([...nomePorFilialIdUlisses.keys(), FILIAL_ID_SETOR_UNIVERSITARIO])];

    const agora = Date.now();
    const eventoIdsRelevantes = new Set();
    const avisosListagem = [];
    for (const filialId of idsParaListar) {
        try {
            const eventos = await ulissesApi.listarTodosEventos(filialId);
            for (const ev of eventos) {
                // Sem `maiorDataProduto`, inclui por segurança (evento sem
                // "produto" com preço, comum em evento gratuito — melhor
                // processar 1 evento a mais do que perder um relevante).
                if (!ev.maiorDataProduto || ev.maiorDataProduto >= agora - JANELA_PASSADO_MS) {
                    eventoIdsRelevantes.add(ev.id);
                }
            }
        } catch (e) {
            avisosListagem.push(`filialId=${filialId}: ${e.message}`);
            console.warn(`[ulisses-api] Não consegui listar eventos de filialId=${filialId} — pulando essa fonte (não trava o resto):`, e.message);
        }
    }

    const tiposEvento = await carregarTiposEventoUlisses();
    let criados = 0, atualizados = 0, semDataParaFilial = 0;
    for (const eventoId of eventoIdsRelevantes) {
        let ev;
        try {
            ev = await ulissesApi.evento(eventoId);
        } catch (e) {
            console.warn(`[ulisses-api] Falha ao buscar detalhe do evento ${eventoId} — pulando:`, e.message);
            continue;
        }
        const nome = (ev.nome || '').trim();
        if (!nome) continue;

        const descricao = [ev.dadoPequeno, ev.dadoMedio, ev.dadoGrande, ev.dadoFinal]
            .map(t => (t || '').trim()).filter(Boolean).join('\n\n') || null;
        // Bug real achado testando o botão "Nova Turma" (2026-09-19): o
        // catálogo `tipos_evento` só reconhece "Abertura de Turma" pela
        // palavra-chave literal "ABERTURA DE TURMA" — mas o NOME real da
        // campanha atual é "Novas turmas do Curso de Filosofia para
        // Viver", que não bate com nenhuma palavra-chave, então `tipo`
        // ficava `null` (afeta TUDO que depende dele: tag "Inscrito:
        // Abertura de Turma", trilha/Jornada, destaque no calendário da
        // Agenda do Dia, e o próprio botão novo). A API do Ulisses já
        // classifica isso com muito mais confiança
        // (`ev.tipoEvento === 'ABERTURA_DE_TURMA'`, um enum de verdade,
        // não palavra-chave) — usado aqui como FALLBACK só quando nosso
        // catálogo não reconhece nada, nunca sobrescrevendo uma
        // classificação manual já feita em "Gerenciar Tipos".
        const tipo = classificarTipoEventoUlisses(nome, tiposEvento)
            || (ev.tipoEvento === 'ABERTURA_DE_TURMA' ? 'Abertura de Turma' : null);

        for (const fe of ev.filiaisEventos || []) {
            const filialCrmNome = fe.filial && nomePorFilialIdUlisses.get(fe.filial.id);
            if (!filialCrmNome) continue; // não é uma filial nossa — ignora
            if (fe.ativo === false) continue;
            const produto = (fe.produtos || [])[0];
            if (!produto || !produto.dataEvento) { semDataParaFilial++; continue; }

            const data = dataBrasilia(produto.dataEvento);
            const hora = horaBrasilia(produto.dataEvento);
            const capacidade = produto.numeroVagas ?? null;
            const imagemUrl = ev.imagem || null;
            // `linkFinal` é o link público de inscrição pra ESTE evento
            // (ex: "https://inscricao.acropolebrasil.com.br/?eventoId=...")
            // — mesmo link pra todas as filiais que compartilham o
            // evento (o eventoId é o mesmo), grava em `link_inscricao`
            // (já usado pelo placeholder {linkInscricao} nos modelos de
            // WhatsApp, ver CLAUDE.md "Convites em massa via wa.me").
            const linkInscricao = ev.linkFinal || null;

            let { data: existente } = await supabaseAdmin
                .from('eventos').select('id, hora, capacidade, imagem_url, ingresso, descricao, tipo, link_inscricao, evento_id_ulisses')
                .eq('filial', filialCrmNome).eq('nome', nome).eq('data', data)
                .maybeSingle();

            // Fallback por nome PARECIDO na mesma data/filial — mesma
            // rede de segurança já usada em sincronizarComparecimentoNoCrm()
            // (ulisses.js), pra reaproveitar uma linha já criada pelo
            // scraper Playwright antigo com um nome ligeiramente diferente
            // (espaço a mais, capitalização, etc.) em vez de duplicar.
            let corrigirData = false;
            if (!existente) {
                const { data: candidatosMesmaData } = await supabaseAdmin
                    .from('eventos').select('id, hora, capacidade, imagem_url, ingresso, descricao, tipo, link_inscricao, nome')
                    .eq('filial', filialCrmNome).eq('data', data);
                const normNome = normalizarNomeUlisses(nome);
                existente = (candidatosMesmaData || []).find(c => {
                    const d = distanciaLevenshteinUlisses(normalizarNomeUlisses(c.nome), normNome);
                    return d <= Math.max(4, Math.round(normNome.length * 0.15));
                }) || null;
            }

            // 2º fallback: mesmo nome, FILIAL, mas DATA DIFERENTE, sem
            // nenhum candidato na data certa — pensado pra corrigir uma
            // linha antiga já com data ERRADA (bug histórico "data
            // juntada do ciclo inteiro", ver corrigir-datas-inscricao-
            // publica.js/CLAUDE.md), em vez de criar uma linha duplicada
            // com a data certa e deixar a errada órfã com convites/
            // inscrições já vinculados. Restrito a candidatos AINDA NÃO
            // PASSADOS (data >= hoje) — eventos passados são
            // legitimamente múltiplos (cada ciclo antigo é uma linha
            // própria, ex: "Aula Experimental" repete todo mês), então
            // corrigir a data de um passado destruiria histórico real.
            // Só resolve com EXATAMENTE 1 candidato (mesma cautela de
            // sempre contra ambiguidade) — achado em produção (2026-09-21,
            // Goiânia II): "Novas turmas..." tinha uma linha futura com
            // data errada (14/10) e nunca foi corrigida, só duplicada
            // (08/10), fragmentando os convites já vinculados na linha
            // antiga.
            if (!existente) {
                const hojeISO = dataBrasilia(agora);
                const { data: candidatosMesmoNome } = await supabaseAdmin
                    .from('eventos').select('id, hora, capacidade, imagem_url, ingresso, descricao, tipo, link_inscricao, nome, data')
                    .eq('filial', filialCrmNome).gte('data', hojeISO);
                const normNome = normalizarNomeUlisses(nome);
                const candidatosBatendo = (candidatosMesmoNome || []).filter(c => {
                    const d = distanciaLevenshteinUlisses(normalizarNomeUlisses(c.nome), normNome);
                    return d <= Math.max(4, Math.round(normNome.length * 0.15));
                });
                if (candidatosBatendo.length === 1) {
                    existente = candidatosBatendo[0];
                    corrigirData = existente.data !== data;
                }
            }

            if (existente) {
                // Nunca sobrescreve com null um campo que já tinha valor —
                // mesmo princípio de sincronizarCatalogoEventosNoCrm().
                // `data`/`hora` SÓ entram no payload quando vieram do
                // 2º fallback (`corrigirData`) — a API é autoridade sobre
                // esse dado quando encontramos a linha errada de propósito;
                // no caminho normal (match exato ou fuzzy na mesma data),
                // a data já bate, então nunca precisa ser tocada.
                const patch = {
                    hora: hora || existente.hora,
                    capacidade: capacidade ?? existente.capacidade,
                    imagem_url: imagemUrl || existente.imagem_url,
                    descricao: descricao || existente.descricao,
                    link_inscricao: linkInscricao || existente.link_inscricao,
                    tipo: existente.tipo || tipo,
                    ativo: true,
                    // Sempre grava — estamos DENTRO do loop por `eventoId`
                    // real, então isto nunca é um chute; alimenta
                    // sincronizarComparecimentoViaApi() (não precisa mais
                    // redescobrir o eventoId escaneando de novo).
                    evento_id_ulisses: eventoId,
                };
                if (corrigirData) {
                    patch.data = data;
                    console.log(`[ulisses-api] Corrigindo data de "${nome}" (${filialCrmNome}, evento id ${existente.id}): ${existente.data} -> ${data}.`);
                }
                await supabaseAdmin.from('eventos').update(patch).eq('id', existente.id);
                atualizados++;
            } else {
                await supabaseAdmin.from('eventos').insert({
                    filial: filialCrmNome, nome, data, hora, capacidade,
                    imagem_url: imagemUrl, descricao, link_inscricao: linkInscricao, tipo, ativo: true,
                    evento_id_ulisses: eventoId,
                });
                criados++;
            }
        }
    }

    return `${criados} evento(s) criado(s), ${atualizados} atualizado(s), de ${eventoIdsRelevantes.size} evento(s) únicos verificados`
        + (semDataParaFilial ? `, ${semDataParaFilial} ignorado(s) por filial sem data` : '')
        + (semMatch.length ? `. Filial(is) do CRM sem correspondência no Ulisses: ${semMatch.join(', ')}` : '')
        + (avisosListagem.length ? `. Aviso(s): ${avisosListagem.join(' | ')}` : '') + '.';
}

// ============================================================
// Inscrições — CSV via API (mesmo formato exato que o importador do CRM
// já espera, confirmado ao vivo: pessoaStatus,pessoaIdentificador,
// pessoaNome,pessoaTelefoneDDD,pessoaTelefoneNumero,pessoaEmail,
// eventoIdentificador,eventoNome,eventoData,telemarketingStatus — zero
// transformação necessária). Escreve num arquivo temporário e reaproveita
// 100% o `importarNoCrm()` já existente (mesma automação que o Mercúrio
// usa pra pilotar a tela de Importar do CRM publicado) — evita duplicar
// a lógica de cruzamento/tags/Lead Forte, que já vive só em
// js/importador.js.
// ============================================================
export async function sincronizarInscricoesFilialViaApi(pageCrm, filialCrm, filialIdUlisses) {
    const csv = await ulissesApi.csvInscricoes(filialIdUlisses);
    fs.mkdirSync(PASTA_EXPORTS, { recursive: true });
    const caminho = `${PASTA_EXPORTS}/inscricoes-api-${filialCrm.replace(/[^a-z0-9]/gi, '_')}.csv`;
    // UTF-8 — a API já devolve `Content-Type: text/csv;charset=utf-8`
    // (confirmado no Swagger), mesmo encoding que o importador já espera
    // pro CSV de Inscrições vindo do Ulisses (ver CLAUDE.md, seção do
    // Importador — "Inscrições vem em UTF-8").
    fs.writeFileSync(caminho, csv, 'utf-8');
    return importarNoCrm(pageCrm, filialCrm, { caminhoAtivos: null, caminhoInativos: null, caminhoInscricoes: caminho });
}

// ============================================================
// Comparecimento — RESOLVIDO via API (2026-09-30). A limitação documentada
// no topo do arquivo ("comparecimento continua exigindo ulisses-local.js")
// NÃO é mais verdade pra quem já tem evento_id_ulisses salvo: o Célio
// sugeriu "algo como filtrarEmails" como alternativa ao endpoint quebrado
// — achado no Swagger (`POST /facade/filtrarEmails`) e TESTADO AO VIVO
// contra produção (ver comentário completo em ulisses-api.js). Usa a MESMA
// lógica de casamento (telefone > e-mail, checagem de sanidade por
// primeiro-nome, "evento futuro nunca confirma sozinho") já validada em
// `sincronizarComparecimentoNoCrm()` (ulisses.js) — só a FONTE dos dados
// muda (API em vez de Playwright+JSON exportado), e fica bem mais simples
// porque já sabemos o `eventoId` exato (nunca precisa reconstruir
// identidade de evento por nome+data como a versão Playwright precisava).
// ============================================================
export async function sincronizarComparecimentoViaApi(filialCrm, filialIdUlisses) {
    // Só eventos com o eventoId do Ulisses já conhecido (gravado por
    // sincronizarEventosUlissesApi()) — e dentro de uma janela razoável
    // (mesmo espírito de JANELA_PASSADO_MS: não vale a pena gastar 1
    // chamada de API por dia pra um evento de anos atrás que não muda
    // mais; eventos futuros entram sempre, sem limite).
    const hojeISOFiltro = dataBrasilia(Date.now());
    const desdeISO = dataBrasilia(Date.now() - JANELA_PASSADO_MS);
    const { data: eventosFilial, error: erroEventos } = await supabaseAdmin
        .from('eventos')
        .select('id, nome, data, evento_id_ulisses')
        .eq('filial', filialCrm)
        .not('evento_id_ulisses', 'is', null)
        .or(`data.gte.${desdeISO},data.gte.${hojeISOFiltro}`);
    if (erroEventos) throw new Error('Erro ao buscar eventos da filial: ' + erroEventos.message);
    if (!eventosFilial || eventosFilial.length === 0) {
        return '0 evento(s) com eventoId do Ulisses conhecido (dentro da janela) nesta filial — rode a sincronização de eventos primeiro, ou não há evento recente/futuro.';
    }

    const normalizarTelefone = (ddd, numero) => {
        const d = String(ddd || '').replace(/\D/g, '');
        let n = String(numero || '').replace(/\D/g, '');
        if (!d || !n) return null;
        if (n.length === 9 && n.startsWith('9')) n = n.slice(1);
        if (n.length !== 8) return null;
        return d + n;
    };

    // Mesma técnica paginada de sincronizarComparecimentoNoCrm() (ulisses.js).
    const porTelefone = new Map();
    const porEmail = new Map();
    const TAMANHO_PAGINA = 1000;
    for (let de = 0; ; de += TAMANHO_PAGINA) {
        const { data: pagina, error } = await supabaseAdmin
            .from('leads_inscricoes')
            .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero, pessoaEmail')
            .eq('filial', filialCrm)
            .order('pessoaIdentificador', { ascending: true })
            .range(de, de + TAMANHO_PAGINA - 1);
        if (error) throw new Error('Erro ao buscar leads da filial: ' + error.message);
        for (const lead of pagina || []) {
            const chaveTel = normalizarTelefone(lead.pessoaTelefoneDDD, lead.pessoaTelefoneNumero);
            if (chaveTel && !porTelefone.has(chaveTel)) porTelefone.set(chaveTel, { id: lead.pessoaIdentificador, nome: lead.pessoaNome });
            const email = (lead.pessoaEmail || '').trim().toLowerCase();
            if (email && !porEmail.has(email)) porEmail.set(email, { id: lead.pessoaIdentificador, nome: lead.pessoaNome });
        }
        if (!pagina || pagina.length < TAMANHO_PAGINA) break;
    }

    const vinculos = [];
    let semLead = 0, nomeDivergente = 0, eventosComErro = 0;
    for (const evento of eventosFilial) {
        let pessoas;
        try {
            pessoas = await ulissesApi.filtrarEmails(evento.evento_id_ulisses, filialIdUlisses);
        } catch (e) {
            eventosComErro++;
            console.warn(`[ulisses-api] Falha ao buscar comparecimento do evento "${evento.nome}" (id=${evento.id}, eventoIdUlisses=${evento.evento_id_ulisses}):`, e.message);
            continue;
        }
        const eventoFuturo = evento.data >= hojeISOFiltro;
        for (const pessoa of pessoas || []) {
            const inscricoesDesteEvento = (pessoa.emailEventos || []).filter(ee => ee.evento?.id === evento.evento_id_ulisses);
            if (inscricoesDesteEvento.length === 0) continue;

            let leadCandidato = normalizarTelefone(pessoa.ddd, pessoa.telefone) ? porTelefone.get(normalizarTelefone(pessoa.ddd, pessoa.telefone)) : null;
            if (!leadCandidato && pessoa.email) leadCandidato = porEmail.get(pessoa.email.trim().toLowerCase()) || null;
            if (!leadCandidato) { semLead++; continue; }

            if (!primeiroNomeParecidoUlisses(pessoa.nome, leadCandidato.nome)) {
                nomeDivergente++;
                console.warn(`[ulisses-api] Vínculo IGNORADO (${filialCrm}) — telefone/e-mail bateu, mas o nome não: API disse "${pessoa.nome}", lead casado é "${leadCandidato.nome}" (id=${leadCandidato.id}). Evento "${evento.nome}".`);
                continue;
            }

            // Mesma regra de sempre: evento futuro nunca confirma
            // presença sozinho (ver sincronizarComparecimentoNoCrm()).
            const compareceuReal = inscricoesDesteEvento.some(ee => ee.compareceu === true);
            vinculos.push({
                evento_id: evento.id,
                pessoaIdentificador: leadCandidato.id,
                compareceu: eventoFuturo && !compareceuReal ? null : compareceuReal,
                futuro: eventoFuturo,
            });
        }
    }

    if (vinculos.length === 0) {
        return `0 vínculo(s) — ${eventosFilial.length} evento(s) verificado(s) (${semLead} sem lead achado por telefone/e-mail${nomeDivergente ? `, ${nomeDivergente} descartado(s) por nome divergente` : ''}${eventosComErro ? `, ${eventosComErro} evento(s) com erro na API` : ''}).`;
    }

    // Dedup (mesma pessoa pode aparecer 2x pro mesmo evento — prioriza
    // compareceu=true) + nunca sobrescreve resposta_convite/nota de um
    // vínculo já existente (mesma lógica de sincronizarComparecimentoNoCrm()).
    const vinculosPorChave = new Map();
    for (const v of vinculos) {
        const chave = `${v.evento_id}|||${v.pessoaIdentificador}`;
        const atual = vinculosPorChave.get(chave);
        if (!atual || (v.compareceu === true && atual.compareceu !== true)) vinculosPorChave.set(chave, v);
    }
    const vinculosUnicos = [...vinculosPorChave.values()];

    const eventoIds = [...new Set(vinculosUnicos.map(v => v.evento_id))];
    const { data: existentes } = await supabaseAdmin.from('evento_leads').select('evento_id, pessoaIdentificador').in('evento_id', eventoIds);
    const jaExiste = new Set((existentes || []).map(e => `${e.evento_id}|||${e.pessoaIdentificador}`));

    const novos = vinculosUnicos
        .filter(v => !jaExiste.has(`${v.evento_id}|||${v.pessoaIdentificador}`))
        .map(v => ({ evento_id: v.evento_id, pessoaIdentificador: v.pessoaIdentificador, resposta_convite: v.futuro ? 'pendente' : 'confirmado', compareceu: v.compareceu, origem: 'ulisses' }));
    const paraAtualizar = vinculosUnicos.filter(v => jaExiste.has(`${v.evento_id}|||${v.pessoaIdentificador}`));

    let novosGravados = 0;
    if (novos.length > 0) {
        const { error } = await supabaseAdmin.from('evento_leads').insert(novos);
        if (error) console.warn('[ulisses-api] Falha ao inserir novos vínculos evento_leads:', error.message);
        else novosGravados = novos.length;
    }
    const resultadosAtualizacao = await Promise.all(paraAtualizar.map(v =>
        supabaseAdmin.from('evento_leads').update({ compareceu: v.compareceu }).eq('evento_id', v.evento_id).eq('pessoaIdentificador', v.pessoaIdentificador)
    ));
    const atualizadosGravados = resultadosAtualizacao.filter(r => !r.error).length;

    return `${novosGravados} vínculo(s) novo(s), ${atualizadosGravados} atualizado(s) (compareceu), de ${eventosFilial.length} evento(s) verificado(s) (${semLead} sem lead achado, ${nomeDivergente} nome divergente${eventosComErro ? `, ${eventosComErro} evento(s) com erro na API` : ''}).`;
}

export { resolverFilialIdUlisses };

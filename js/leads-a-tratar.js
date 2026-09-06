// ==========================================================
// LEADS A TRATAR — telefone (1º) + e-mail (2º) + nome parecido com
// pontuação (3º) + sem telefone (4º)
// ==========================================================
// Antes era só "Possíveis Duplicados"; passou a incluir também leads sem
// telefone, substituindo a antiga coluna "Sem Whatsapp" do Kanban como
// destino deles (ver COLUNA_SEM_WHATSAPP em js/app.js — mantida só como
// coluna LEGADA, pra quem já tinha leads lá antes dessa mudança).
//
// A varredura roda automaticamente ao final de cada importação
// (confirmarEnviarImportacao(), js/importador.js) e também sob demanda
// pelo botão "Verificar Agora" da aba. Cada varredura APAGA e recria do
// zero os grupos daquela filial — é sempre um retrato fresco, não um
// histórico acumulado. "Ignorar" um grupo, no entanto, É PERSISTENTE:
// fica guardado em leads_a_tratar_ignorados (migracao_leads_a_tratar_ignorados.sql)
// e a varredura filtra esses grupos ANTES de salvar, então eles não voltam
// a aparecer sozinhos — só reaparecem se alguém "reconsiderar" (seção
// "Grupos Ignorados" no fim da aba).
//
// Depende de variáveis/funções já definidas em app.js (NOME_TABELA,
// filialAtual, escapeHTML(), abrirResultadoBuscaGlobal(),
// distanciaLevenshtein(), cardsSelecionados, limparSelecao()) e em
// importador.js (normalizarTelefoneParaChave()), ambos carregados ANTES
// deste arquivo.

const NOME_TABELA_LEADS_A_TRATAR = 'leads_a_tratar';
const NOME_TABELA_LEADS_A_TRATAR_IGNORADOS = 'leads_a_tratar_ignorados';

let gruposLeadsATratarAtuais = []; // [{ grupo, criterio, pontuacao?, membros: [{pessoa_id, pessoa_nome, pessoa_telefone, pessoa_email}] }]

// ==========================================
// DETECÇÃO (varredura completa do banco pra 1 filial)
// ==========================================
function normalizarNomeLeadsATratar(nome) {
    return String(nome || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// Preposições não carregam nenhum sinal de identidade — sem isso, "DA"
// em "LUCAS NUNES DA SILVA" contava como "palavra em comum" com qualquer
// outro nome que também tivesse "DA", inflando o match à toa.
const STOPWORDS_NOME_LEADS_A_TRATAR = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E']);
function tokensSignificativosNome(nome) {
    return normalizarNomeLeadsATratar(nome).split(' ').filter(t => t && !STOPWORDS_NOME_LEADS_A_TRATAR.has(t));
}

// --- Pontuação de "nome parecido" ---
// A ideia central: em vez de contar palavras em comum igualzinho pra
// qualquer palavra (o que faz "SILVA"/"SOUSA"/"NUNES" — sobrenomes
// baratíssimos no Brasil — pesarem o mesmo que um sobrenome raro tipo
// "NEGRETTO"), a pontuação principal é a COBERTURA do nome mais curto
// (quantas das palavras dele aparecem no outro, ponderado por abreviação)
// — isso já separa bem "LEANDRA NEGRETTO" (100% coberto por "LEANDRA
// VALÉRIA SILVA NEGRETTO") de "LUCAS NUNES DA SILVA" vs "LUCAS NUNES LIMA"
// (só 2 de 3 palavras batem — SILVA≠LIMA). Raridade da palavra entra como
// BÔNUS por cima (recompensa sobrenome raro em comum), não como peso da
// cobertura em si — testado à mão contra os exemplos reais que motivaram
// essa mudança: usar raridade como peso da cobertura fazia o oposto do
// esperado (sobrenomes comuns como SILVA/LIMA "pesavam pouco" nos dois
// lados e paradoxalmente inflavam o % de gente que NÃO é duplicada).
const LIMIAR_SCORE_NOME = 75;   // % mínimo de cobertura+bônus pra virar grupo — subido de 55 pra 75 depois de observar volume alto de grupos sem relação real nenhuma (ex: "Lucas Nunes ..." com sobrenomes diferentes, que fica em ~67%)
const LIMIAR_FREQ_RARA = 3;     // palavra em até N leads da filial = "rara"
const BONUS_PALAVRA_RARA = 12;  // bônus por ter pelo menos 1 palavra rara em comum
const PESO_ABREVIACAO = 0.6;    // "L" batendo com "LIMA" vale 60% de uma palavra inteira batendo

// Compara token a token (nomes já sem stopword) permitindo abreviação:
// uma letra sozinha ("L") bate com qualquer palavra do outro nome que
// comece com ela ("LIMA"), com peso reduzido. Cada palavra só pode ser
// usada 1 vez (não deixa "L" bater com 2 palavras diferentes).
function cobrirTokens(tokensA, tokensB, frequenciaPalavra) {
    const usadosB = new Set();
    let acertos = 0;
    let temPalavraRara = false;
    tokensA.forEach(ta => {
        let melhorIdx = -1, melhorValor = 0, melhorRara = false;
        tokensB.forEach((tb, idx) => {
            if (usadosB.has(idx)) return;
            let valor = 0, rara = false;
            if (ta === tb) {
                valor = 1;
                rara = (frequenciaPalavra.get(ta) || 0) <= LIMIAR_FREQ_RARA;
            } else if (ta.length === 1 && tb.length > 1 && tb.startsWith(ta)) {
                valor = PESO_ABREVIACAO;
            } else if (tb.length === 1 && ta.length > 1 && ta.startsWith(tb)) {
                valor = PESO_ABREVIACAO;
            }
            if (valor > melhorValor) { melhorValor = valor; melhorIdx = idx; melhorRara = rara; }
        });
        if (melhorIdx >= 0) {
            usadosB.add(melhorIdx);
            acertos += melhorValor;
            if (melhorRara) temPalavraRara = true;
        }
    });
    return { acertos, temPalavraRara };
}

// Bônus por telefone/e-mail PARECIDOS (não idênticos — idênticos já viram
// grupo próprio, telefone/email, antes de chegar na etapa de nome, então
// nunca coexistem com esse bônus). Cobre o caso de erro de digitação de
// 1-2 caracteres num dos dois cadastros.
function bonusTelefoneParecido(a, b) {
    if (typeof normalizarTelefoneParaChave !== 'function') return 0;
    const chaveA = normalizarTelefoneParaChave(a.pessoaTelefoneDDD, a.pessoaTelefoneNumero);
    const chaveB = normalizarTelefoneParaChave(b.pessoaTelefoneDDD, b.pessoaTelefoneNumero);
    if (!chaveA || !chaveB || chaveA === chaveB) return 0;
    const dist = distanciaLevenshtein(chaveA, chaveB);
    return dist <= 2 ? (15 - dist * 5) : 0; // 1 caractere de diferença = +10, 2 = +5
}
function bonusEmailParecido(a, b) {
    const ea = (a.pessoaEmail || '').trim().toLowerCase();
    const eb = (b.pessoaEmail || '').trim().toLowerCase();
    if (!ea || !eb || ea === eb) return 0;
    const dist = distanciaLevenshtein(ea, eb);
    return dist <= 2 ? (15 - dist * 5) : 0;
}

// Pontuação final (0-100) de um par candidato — cobertura do nome mais
// curto, com bônus de palavra rara + telefone/e-mail parecidos.
function pontuarSimilaridadeNomes(leadA, leadB, tokensPorLead, frequenciaPalavra) {
    const tokensA = tokensPorLead.get(String(leadA.pessoaIdentificador)) || [];
    const tokensB = tokensPorLead.get(String(leadB.pessoaIdentificador)) || [];
    if (tokensA.length === 0 || tokensB.length === 0) return 0;

    const { acertos, temPalavraRara } = cobrirTokens(tokensA, tokensB, frequenciaPalavra);
    const cobertura = acertos / Math.min(tokensA.length, tokensB.length);

    let pontuacao = cobertura * 100;
    if (temPalavraRara) pontuacao += BONUS_PALAVRA_RARA;
    pontuacao += bonusTelefoneParecido(leadA, leadB);
    pontuacao += bonusEmailParecido(leadA, leadB);

    return Math.max(0, Math.min(100, Math.round(pontuacao)));
}

async function detectarLeadsATratar(filial, logFn) {
    const log = logFn || (() => {});
    if (!filial) return;
    log(`Verificando leads a tratar em "${filial}" (duplicados + sem telefone)...`);

    // 1) Busca TODOS os leads da filial (paginado — o PostgREST limita a
    //    1000 linhas por página, independente do "limit" pedido).
    const leads = [];
    let offset = 0;
    const passo = 1000;
    while (true) {
        const { data, error } = await window.supabaseClient
            .from(NOME_TABELA)
            .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero, pessoaEmail')
            .eq('filial', filial)
            .order('pessoaIdentificador', { ascending: true })
            .range(offset, offset + passo - 1);
        if (error) { log('Erro ao verificar leads a tratar: ' + error.message, 'err'); return; }
        leads.push(...data);
        if (data.length < passo) break;
        offset += passo;
    }

    const grupos = [];
    const idsJaAgrupados = new Set();

    // 2) Critério 1 — TELEFONE (chave normalizada, ignora o 9º dígito —
    //    mesma função que o importador usa pra casar Inativos/Inscrições)
    const temNormalizarTelefone = typeof normalizarTelefoneParaChave === 'function';
    const porTelefone = new Map();
    leads.forEach(l => {
        const chave = temNormalizarTelefone ? normalizarTelefoneParaChave(l.pessoaTelefoneDDD, l.pessoaTelefoneNumero) : null;
        if (!chave) return;
        if (!porTelefone.has(chave)) porTelefone.set(chave, []);
        porTelefone.get(chave).push(l);
    });
    porTelefone.forEach((membros, chave) => {
        if (membros.length < 2) return;
        grupos.push({ grupo: 'tel:' + chave, criterio: 'telefone', membros });
        membros.forEach(m => idsJaAgrupados.add(String(m.pessoaIdentificador)));
    });

    // 3) Critério 2 — E-MAIL idêntico (mesmo peso de confiança que
    //    telefone — duas pessoas raramente compartilham o mesmo e-mail).
    //    Só considera quem não caiu no critério 1, pra não repetir o
    //    mesmo lead em dois grupos.
    const porEmail = new Map();
    leads.forEach(l => {
        if (idsJaAgrupados.has(String(l.pessoaIdentificador))) return;
        const email = (l.pessoaEmail || '').trim().toLowerCase();
        if (!email) return;
        if (!porEmail.has(email)) porEmail.set(email, []);
        porEmail.get(email).push(l);
    });
    porEmail.forEach((membros, email) => {
        if (membros.length < 2) return;
        grupos.push({ grupo: 'email:' + email, criterio: 'email', membros });
        membros.forEach(m => idsJaAgrupados.add(String(m.pessoaIdentificador)));
    });

    // 4) Critério 3 — NOME parecido, com pontuação (só entre quem não
    //    caiu nos critérios 1/2). Agrupa primeiro por PRIMEIRO NOME
    //    (bucket, pra não comparar todo mundo com todo mundo — inviável
    //    em bases com milhares de leads); dentro do bucket, pontua cada
    //    par (ver pontuarSimilaridadeNomes()) e só forma grupo acima de
    //    LIMIAR_SCORE_NOME.
    const restantes = leads.filter(l => !idsJaAgrupados.has(String(l.pessoaIdentificador)) && l.pessoaNome);

    const tokensPorLead = new Map();
    const frequenciaPalavra = new Map();
    restantes.forEach(l => {
        const tokens = tokensSignificativosNome(l.pessoaNome);
        tokensPorLead.set(String(l.pessoaIdentificador), tokens);
        new Set(tokens).forEach(t => frequenciaPalavra.set(t, (frequenciaPalavra.get(t) || 0) + 1));
    });

    const porPrimeiroNome = new Map();
    restantes.forEach(l => {
        const tokens = tokensPorLead.get(String(l.pessoaIdentificador));
        if (!tokens || tokens.length === 0) return;
        const primeiro = tokens[0];
        if (!porPrimeiroNome.has(primeiro)) porPrimeiroNome.set(primeiro, []);
        porPrimeiroNome.get(primeiro).push(l);
    });

    porPrimeiroNome.forEach((candidatos, primeiro) => {
        if (candidatos.length < 2) return;
        const usados = new Set();
        for (let i = 0; i < candidatos.length; i++) {
            if (usados.has(i)) continue;
            const membrosGrupo = [candidatos[i]];
            const pontuacoes = [];
            for (let j = i + 1; j < candidatos.length; j++) {
                if (usados.has(j)) continue;
                const pontuacao = pontuarSimilaridadeNomes(candidatos[i], candidatos[j], tokensPorLead, frequenciaPalavra);
                if (pontuacao >= LIMIAR_SCORE_NOME) {
                    membrosGrupo.push(candidatos[j]);
                    pontuacoes.push(pontuacao);
                    usados.add(j);
                }
            }
            if (membrosGrupo.length >= 2) {
                usados.add(i);
                const pontuacaoGrupo = Math.round(pontuacoes.reduce((a, b) => a + b, 0) / pontuacoes.length);
                // Chave por IDs ordenados (não pelo índice "i" do loop) —
                // precisa ser ESTÁVEL entre varreduras pro "Ignorar"
                // persistente (leads_a_tratar_ignorados) conseguir
                // reconhecer o mesmo grupo depois. Um índice de loop muda
                // conforme a ordem/composição da base entre uma varredura
                // e outra, mesmo que o grupo em si seja "o mesmo".
                const idsOrdenados = membrosGrupo.map(m => String(m.pessoaIdentificador)).sort().join(',');
                grupos.push({
                    grupo: `nome:${primeiro}:${idsOrdenados}`,
                    criterio: 'nome',
                    pontuacao: pontuacaoGrupo,
                    membros: membrosGrupo
                });
            }
        }
    });

    // 5) Critério 4 — SEM TELEFONE. Independente dos outros (um lead pode
    //    aparecer aqui e também num grupo de nome, são preocupações
    //    diferentes) — substitui a antiga coluna "Sem Whatsapp" do Kanban
    //    como o lugar onde esses leads ficam visíveis pro time tratar.
    leads.forEach(l => {
        const semTelefone = !l.pessoaTelefoneNumero || String(l.pessoaTelefoneNumero).trim() === '';
        if (!semTelefone) return;
        grupos.push({ grupo: 'semtel:' + l.pessoaIdentificador, criterio: 'sem_telefone', membros: [l] });
    });

    // 6) Filtra os grupos marcados como "Ignorar" (persistente — ver
    //    ignorarGrupoLeadsATratar() — sobrevive a esta varredura "fresca").
    const { data: ignorados, error: erroIgnorados } = await window.supabaseClient
        .from(NOME_TABELA_LEADS_A_TRATAR_IGNORADOS)
        .select('grupo')
        .eq('filial', filial);
    if (erroIgnorados) console.warn('Não foi possível carregar grupos ignorados (rode migracao_leads_a_tratar_ignorados.sql se ainda não rodou) — nenhum grupo será filtrado desta vez.', erroIgnorados);
    const gruposIgnorados = new Set((ignorados || []).map(i => i.grupo));
    const gruposParaSalvar = grupos.filter(g => !gruposIgnorados.has(g.grupo));

    // 7) Substitui o que já estava salvo pra essa filial — varredura
    //    sempre "fresca", sem acumular histórico nem duplicar grupo antigo
    //    (os ignorados, filtrados acima, simplesmente não voltam a entrar).
    await window.supabaseClient.from(NOME_TABELA_LEADS_A_TRATAR).delete().eq('filial', filial);

    if (gruposParaSalvar.length === 0) {
        log(grupos.length > 0 ? `Nenhum lead a tratar encontrado (${grupos.length} grupo(s) estavam ignorados).` : 'Nenhum lead a tratar encontrado.', 'ok');
        return;
    }

    const linhas = [];
    gruposParaSalvar.forEach(g => {
        g.membros.forEach(m => {
            linhas.push({
                filial,
                grupo: g.grupo,
                criterio: g.criterio,
                pontuacao: g.pontuacao ?? null,
                pessoa_id: String(m.pessoaIdentificador),
                pessoa_nome: m.pessoaNome || '',
                pessoa_telefone: [m.pessoaTelefoneDDD, m.pessoaTelefoneNumero].filter(Boolean).join(' '),
                pessoa_email: m.pessoaEmail || ''
            });
        });
    });

    for (let i = 0; i < linhas.length; i += 500) {
        const lote = linhas.slice(i, i + 500);
        const { error } = await window.supabaseClient.from(NOME_TABELA_LEADS_A_TRATAR).insert(lote);
        if (error) { log('Erro ao salvar leads a tratar: ' + error.message, 'err'); return; }
    }

    const contarCriterio = c => gruposParaSalvar.filter(g => g.criterio === c).length;
    const complementoIgnorados = gruposIgnorados.size > 0 ? ` (${gruposIgnorados.size} grupo(s) ignorado(s) não entraram nessa contagem)` : '';
    log(`${gruposParaSalvar.length} grupo(s)/lead(s) a tratar (${contarCriterio('telefone')} por telefone, ${contarCriterio('email')} por e-mail, ${contarCriterio('nome')} por nome parecido, ${contarCriterio('sem_telefone')} sem telefone)${complementoIgnorados}.`, 'ok');
}

// ==========================================
// ABA — carregamento e renderização
// ==========================================
async function carregarLeadsATratar() {
    const container = document.getElementById('leadsATratarLista');
    if (!container || !filialAtual) return;
    container.innerHTML = '<div class="agenda-vazio"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando...</div>';

    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA_LEADS_A_TRATAR)
        .select('*')
        .eq('filial', filialAtual)
        .order('criterio', { ascending: true });

    if (error) {
        console.warn('Não foi possível carregar "leads_a_tratar" (rode migracao_leads_a_tratar.sql se ainda não rodou).', error);
        container.innerHTML = '<div class="agenda-vazio">Indisponível — rode migracao_leads_a_tratar.sql no Supabase.</div>';
        return;
    }

    const porGrupo = new Map();
    (data || []).forEach(row => {
        if (!porGrupo.has(row.grupo)) porGrupo.set(row.grupo, { grupo: row.grupo, criterio: row.criterio, pontuacao: row.pontuacao ?? null, membros: [] });
        porGrupo.get(row.grupo).membros.push(row);
    });
    gruposLeadsATratarAtuais = Array.from(porGrupo.values());

    await carregarIgnoradosLeadsATratar();
    renderizarListaLeadsATratar();
}

const CRITERIOS_LEADS_A_TRATAR = {
    telefone: { label: 'Mesmo telefone', classe: 'tag-error', icone: 'fa-phone', ordem: 0 },
    email: { label: 'Mesmo e-mail', classe: 'tag-error', icone: 'fa-envelope', ordem: 1 },
    nome: { label: 'Nome parecido — revisar com atenção', classe: 'tag-warning', icone: 'fa-signature', ordem: 2 },
    sem_telefone: { label: 'Sem telefone cadastrado', classe: 'tag-info', icone: 'fa-phone-slash', ordem: 3 },
};

// Rótulo do card de um grupo específico — igual ao da gaveta (cabeçalho
// da seção), exceto "nome", que mostra a pontuação daquele grupo em
// particular (cada grupo de nome tem uma % diferente).
function rotuloGrupoLeadsATratar(g) {
    if (g.criterio === 'nome' && g.pontuacao != null) return `Nome parecido — ${g.pontuacao}% de compatibilidade`;
    return (CRITERIOS_LEADS_A_TRATAR[g.criterio] || {}).label || g.criterio;
}

// Gavetas colapsáveis, uma por critério (telefone/nome/sem_telefone) — só
// controla exibição (não recarrega nada), estado não persiste entre
// sessões de propósito (é só uma forma de reduzir poluição visual
// enquanto revisa, não uma preferência duradoura).
let secoesRecolhidasLeadsATratar = new Set();

function toggleSecaoLeadsATratar(criterio) {
    if (secoesRecolhidasLeadsATratar.has(criterio)) secoesRecolhidasLeadsATratar.delete(criterio);
    else secoesRecolhidasLeadsATratar.add(criterio);
    renderizarListaLeadsATratar();
}

function renderizarCardGrupoLeadsATratar(g) {
    const info = CRITERIOS_LEADS_A_TRATAR[g.criterio] || { classe: 'tag-info', icone: 'fa-circle-question' };
    const rotulo = rotuloGrupoLeadsATratar(g);
    const grupoEscapado = g.grupo.replace(/'/g, "\\'");
    // "Mesclar" só faz sentido pra grupos de fato duplicados (telefone/e-mail/nome)
    // — "sem telefone" é sempre 1 lead sozinho, não um cluster.
    const ehGrupoDuplicata = g.criterio === 'telefone' || g.criterio === 'email' || g.criterio === 'nome';
    // Exclusão individual só aparece com 3+ membros (com só 2, excluir 1
    // deixaria o outro sozinho — nesse caso "Ignorar" o grupo já resolve).
    const permiteExclusaoIndividual = ehGrupoDuplicata && g.membros.length > 2;
    return `
        <div class="duplicado-grupo-card">
            <div class="duplicado-grupo-header">
                <span class="tag ${info.classe}"><i class="fa-solid ${info.icone}"></i> ${escapeHTML(rotulo)}</span>
                <div style="display:flex; gap:6px;">
                    ${ehGrupoDuplicata ? `<button class="btn-mini btn-primary-mini" onclick="abrirModalMesclar('${grupoEscapado}')"><i class="fa-solid fa-code-merge"></i> Mesclar</button>` : ''}
                    <button class="btn-mini btn-secondary-mini" onclick="ignorarGrupoLeadsATratar('${grupoEscapado}')"><i class="fa-solid fa-xmark"></i> Ignorar</button>
                </div>
            </div>
            <div class="duplicado-grupo-membros">
                ${g.membros.map(m => `
                    <div class="duplicado-membro">
                        <div class="duplicado-membro-clicavel" onclick="abrirResultadoBuscaGlobal('${m.pessoa_id}')">
                            <span class="duplicado-membro-nome">${escapeHTML(m.pessoa_nome || 'Sem nome')}</span>
                            <span class="duplicado-membro-tel">
                                <i class="fa-solid fa-phone"></i> ${escapeHTML(m.pessoa_telefone || 'Sem telefone')}
                                ${m.pessoa_email ? ` · <i class="fa-solid fa-envelope"></i> ${escapeHTML(m.pessoa_email)}` : ''}
                            </span>
                        </div>
                        ${permiteExclusaoIndividual ? `<button class="icon-btn danger" title="Este não é duplicado — remover só ele deste grupo" onclick="removerMembroDoGrupo('${grupoEscapado}', '${m.pessoa_id}')"><i class="fa-solid fa-user-xmark"></i></button>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderizarSecaoIgnoradosLeadsATratar() {
    if (ignoradosLeadsATratarAtuais.length === 0) return '';
    const aberta = secaoIgnoradosLeadsATratarAberta;
    return `
        <div class="tratar-gaveta">
            <button type="button" class="tratar-gaveta-header" onclick="toggleSecaoIgnoradosLeadsATratar()">
                <span class="tratar-gaveta-titulo">
                    <i class="fa-solid ${aberta ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
                    <i class="fa-solid fa-eye-slash"></i> Grupos Ignorados
                </span>
                <span class="tratar-gaveta-badge">${ignoradosLeadsATratarAtuais.length}</span>
            </button>
            ${aberta ? `<div class="tratar-gaveta-body">${ignoradosLeadsATratarAtuais.map(ig => `
                <div class="duplicado-grupo-card" style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                    <div>
                        <strong>${escapeHTML(ig.descricao || ig.grupo)}</strong>
                        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${escapeHTML(CRITERIOS_LEADS_A_TRATAR[ig.criterio]?.label || ig.criterio || '')}</div>
                    </div>
                    <button class="btn-mini btn-secondary-mini" onclick="reconsiderarGrupoIgnorado(${ig.id})"><i class="fa-solid fa-rotate-left"></i> Reconsiderar</button>
                </div>
            `).join('')}</div>` : ''}
        </div>
    `;
}

function renderizarListaLeadsATratar() {
    const container = document.getElementById('leadsATratarLista');
    if (!container) return;

    const secaoIgnorados = renderizarSecaoIgnoradosLeadsATratar();

    if (gruposLeadsATratarAtuais.length === 0) {
        container.innerHTML = '<div class="agenda-vazio">Nada a tratar nesta filial. Clique em "Verificar Agora" pra rodar uma varredura.</div>' + secaoIgnorados;
        return;
    }

    // Uma gaveta por critério, com o total de OCORRÊNCIAS (leads
    // envolvidos, não nº de grupos — em "sem telefone" cada grupo já é 1
    // lead só, então dá no mesmo; em telefone/nome, soma todo mundo
    // dentro de cada cluster).
    const porCriterio = new Map();
    gruposLeadsATratarAtuais.forEach(g => {
        if (!porCriterio.has(g.criterio)) porCriterio.set(g.criterio, []);
        porCriterio.get(g.criterio).push(g);
    });

    const ordemCriterios = Object.keys(CRITERIOS_LEADS_A_TRATAR)
        .sort((a, b) => CRITERIOS_LEADS_A_TRATAR[a].ordem - CRITERIOS_LEADS_A_TRATAR[b].ordem)
        .filter(c => porCriterio.has(c));

    container.innerHTML = ordemCriterios.map(criterio => {
        const grupos = porCriterio.get(criterio);
        // "Nome parecido" é o único critério com pontuação — ordena do
        // mais provável pro menos provável, pra revisar os casos fortes
        // primeiro (pedido explícito: "ordenar pelo percentual de compatibilidade").
        if (criterio === 'nome') grupos.sort((a, b) => (b.pontuacao ?? 0) - (a.pontuacao ?? 0));
        const info = CRITERIOS_LEADS_A_TRATAR[criterio];
        const totalOcorrencias = grupos.reduce((soma, g) => soma + g.membros.length, 0);
        const recolhida = secoesRecolhidasLeadsATratar.has(criterio);
        return `
            <div class="tratar-gaveta">
                <button type="button" class="tratar-gaveta-header" onclick="toggleSecaoLeadsATratar('${criterio}')">
                    <span class="tratar-gaveta-titulo">
                        <i class="fa-solid ${recolhida ? 'fa-chevron-right' : 'fa-chevron-down'}"></i>
                        <i class="fa-solid ${info.icone}"></i> ${escapeHTML(info.label)}
                    </span>
                    <span class="tratar-gaveta-badge">${totalOcorrencias}</span>
                </button>
                ${recolhida ? '' : `<div class="tratar-gaveta-body">${grupos.map(renderizarCardGrupoLeadsATratar).join('')}</div>`}
            </div>
        `;
    }).join('') + secaoIgnorados;
}

async function verificarLeadsATratarAgora() {
    const btn = document.getElementById('btnVerificarLeadsATratar');
    const container = document.getElementById('leadsATratarLista');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando...'; }
    if (container) container.innerHTML = '<div class="agenda-vazio"><i class="fa-solid fa-circle-notch fa-spin"></i> Verificando toda a base desta filial, pode levar alguns segundos...</div>';

    await detectarLeadsATratar(filialAtual, (msg) => console.log('[leads-a-tratar]', msg));
    await carregarLeadsATratar();

    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Verificar Agora'; }
}

async function ignorarGrupoLeadsATratar(grupo) {
    const g = gruposLeadsATratarAtuais.find(x => x.grupo === grupo);

    const { error } = await window.supabaseClient.from(NOME_TABELA_LEADS_A_TRATAR).delete().eq('filial', filialAtual).eq('grupo', grupo);
    if (error) { alert('Erro ao ignorar: ' + error.message); return; }

    // Guarda a decisão de ignorar PERMANENTEMENTE (sobrevive à próxima
    // varredura, que apaga e recria leads_a_tratar do zero) — ver
    // detectarLeadsATratar(), que filtra por essa tabela antes de salvar.
    const descricao = g ? g.membros.map(m => m.pessoa_nome).filter(Boolean).join(' / ') : null;
    const { error: erroIgnorar } = await window.supabaseClient
        .from(NOME_TABELA_LEADS_A_TRATAR_IGNORADOS)
        .upsert({ filial: filialAtual, grupo, criterio: g ? g.criterio : null, descricao }, { onConflict: 'filial,grupo' });
    if (erroIgnorar) console.warn('Não foi possível salvar o "ignorar" permanentemente (rode migracao_leads_a_tratar_ignorados.sql se ainda não rodou) — esse grupo pode voltar a aparecer na próxima verificação.', erroIgnorar);

    gruposLeadsATratarAtuais = gruposLeadsATratarAtuais.filter(g => g.grupo !== grupo);
    await carregarIgnoradosLeadsATratar();
    renderizarListaLeadsATratar();
}

// ==========================================
// GRUPOS IGNORADOS — visualizar/reconsiderar (ver ignorarGrupoLeadsATratar())
// ==========================================
let ignoradosLeadsATratarAtuais = [];
let secaoIgnoradosLeadsATratarAberta = false;

async function carregarIgnoradosLeadsATratar() {
    if (!filialAtual) return;
    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA_LEADS_A_TRATAR_IGNORADOS)
        .select('*')
        .eq('filial', filialAtual)
        .order('ignorado_em', { ascending: false });
    if (error) { ignoradosLeadsATratarAtuais = []; return; }
    ignoradosLeadsATratarAtuais = data || [];
}

function toggleSecaoIgnoradosLeadsATratar() {
    secaoIgnoradosLeadsATratarAberta = !secaoIgnoradosLeadsATratarAberta;
    renderizarListaLeadsATratar();
}

// "Reconsiderar" só remove a supressão — o grupo só volta a aparecer de
// fato na PRÓXIMA verificação (automática ou "Verificar Agora"), e só se
// ainda for uma correspondência válida (a base pode ter mudado desde então).
async function reconsiderarGrupoIgnorado(id) {
    const { error } = await window.supabaseClient.from(NOME_TABELA_LEADS_A_TRATAR_IGNORADOS).delete().eq('id', id);
    if (error) { alert('Erro ao reconsiderar: ' + error.message); return; }
    ignoradosLeadsATratarAtuais = ignoradosLeadsATratarAtuais.filter(g => g.id !== id);
    renderizarListaLeadsATratar();
}

// Tira só ESSE lead do grupo (ele não é duplicado dos outros) — diferente
// de "Ignorar", que descarta o grupo inteiro. Se sobrar só 1 membro depois
// de tirar, o grupo inteiro some da lista (não é mais uma dupla suspeita).
async function removerMembroDoGrupo(grupo, pessoaId) {
    const { error } = await window.supabaseClient
        .from(NOME_TABELA_LEADS_A_TRATAR)
        .delete()
        .eq('filial', filialAtual)
        .eq('grupo', grupo)
        .eq('pessoa_id', pessoaId);
    if (error) { alert('Erro ao remover do grupo: ' + error.message); return; }

    const g = gruposLeadsATratarAtuais.find(x => x.grupo === grupo);
    if (!g) return;
    g.membros = g.membros.filter(m => m.pessoa_id !== pessoaId);

    if (g.membros.length <= 1) {
        // Sobrou 0 ou 1 — o que restar não representa mais um grupo de
        // possíveis duplicados, então limpa também a última linha (se houver).
        if (g.membros.length === 1) {
            await window.supabaseClient.from(NOME_TABELA_LEADS_A_TRATAR).delete().eq('filial', filialAtual).eq('grupo', grupo);
        }
        gruposLeadsATratarAtuais = gruposLeadsATratarAtuais.filter(x => x.grupo !== grupo);
    }
    renderizarListaLeadsATratar();
}

// ==========================================
// MESCLAR LEADS DUPLICADOS
// ==========================================
// Une os leads de um grupo (telefone ou nome) num só, incorporando o que
// só existe em quem vai ser apagado — não é "escolher 1 e descartar o
// resto":
// - Tags e histórico de eventos: união de todos os membros, sem duplicar
//   (mesma lógica de "fusão de duplicatas" já usada na importação — ver
//   processarPlanilhas() em js/importador.js). Isso é automático, sem
//   pedir escolha (não existe conflito real em juntar duas listas).
// - Telefone e e-mail: se só existir num membro, incorpora direto. Se
//   EXISTIREM VALORES DIFERENTES entre os membros, mostra um seletor pra
//   escolher qual dos dois manter (não dá pra guardar os dois ao mesmo
//   tempo — o cadastro só tem 1 campo de cada).
// - Resumo de IA: concatena o de todos que tiverem algo escrito (não
//   descarta nenhuma anotação manual).
// Os leads não escolhidos como sobrevivente são APAGADOS de
// leads_inscricoes — ação irreversível, por isso pede confirmação
// explícita (confirm() nativo, listando quantos serão apagados) antes de
// executar.
let grupoEmMesclagem = null;
let membrosEmMesclagem = [];

async function abrirModalMesclar(grupo) {
    const g = gruposLeadsATratarAtuais.find(x => x.grupo === grupo);
    if (!g) return;
    grupoEmMesclagem = grupo;

    const container = document.getElementById('mesclarOpcoes');
    const conflitos = document.getElementById('mesclarConflitos');
    const info = document.getElementById('mesclarInfoCriterio');
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Carregando...</p>';
    if (conflitos) conflitos.innerHTML = '';
    if (info) info.innerText = rotuloGrupoLeadsATratar(g);

    document.getElementById('modalMesclar').classList.add('open');
    document.getElementById('overlayModalMesclar').classList.add('active');

    const ids = g.membros.map(m => m.pessoa_id);
    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero, pessoaEmail, tags, historico_eventos, resumo_ia')
        .in('pessoaIdentificador', ids);

    if (error) { container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro ao carregar leads: ${escapeHTML(error.message)}</p>`; return; }
    membrosEmMesclagem = data || [];
    renderizarOpcoesPrincipalMesclagem();
}

// Ponto de entrada pra mesclar por INICIATIVA PRÓPRIA — quando o time
// identifica 2+ leads duplicados que o sistema não sugeriu sozinho (não
// bateram nenhum dos critérios automáticos, ex: nomes bem diferentes mas
// que a pessoa sabe ser a mesma pessoa). Chamada a partir da seleção em
// massa do Kanban (checkbox nos cards + botão "Mesclar" na barra de ações,
// js/app.js) — reaproveita TODO o resto do fluxo de mesclagem já existente
// (conflitos de telefone/e-mail, incorporação de tags/eventos etc.), só
// não tem um "grupo" detectado pelo sistema pra limpar de leads_a_tratar
// depois (grupoEmMesclagem fica null, e confirmarMesclagem() já lida bem
// com isso — só não encontra nada pra apagar).
async function abrirModalMesclarManual(pessoaIds) {
    if (!pessoaIds || pessoaIds.length < 2) { alert('Selecione pelo menos 2 leads (marque o checkbox de cada card) pra mesclar.'); return; }
    grupoEmMesclagem = null;

    const container = document.getElementById('mesclarOpcoes');
    const conflitos = document.getElementById('mesclarConflitos');
    const info = document.getElementById('mesclarInfoCriterio');
    container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">Carregando...</p>';
    if (conflitos) conflitos.innerHTML = '';
    if (info) info.innerText = 'Seleção manual (não veio de uma sugestão do sistema)';

    document.getElementById('modalMesclar').classList.add('open');
    document.getElementById('overlayModalMesclar').classList.add('active');

    const { data, error } = await window.supabaseClient
        .from(NOME_TABELA)
        .select('pessoaIdentificador, pessoaNome, pessoaTelefoneDDD, pessoaTelefoneNumero, pessoaEmail, tags, historico_eventos, resumo_ia')
        .in('pessoaIdentificador', pessoaIds);

    if (error) { container.innerHTML = `<p style="font-size:12px; color:#dc2626;">Erro ao carregar leads: ${escapeHTML(error.message)}</p>`; return; }
    membrosEmMesclagem = data || [];
    renderizarOpcoesPrincipalMesclagem();
}

// Chamada pelo botão "Mesclar" da barra de seleção em massa do Kanban
// (index.html/js/app.js) — usa a mesma seleção (cardsSelecionados) já
// existente pra mover/marcar tags em lote.
function iniciarMesclagemManual() {
    if (typeof cardsSelecionados === 'undefined' || cardsSelecionados.size < 2) {
        alert('Selecione pelo menos 2 leads (marque o checkbox de cada card, em qualquer coluna) pra mesclar.');
        return;
    }
    abrirModalMesclarManual(Array.from(cardsSelecionados));
}

function renderizarOpcoesPrincipalMesclagem() {
    const container = document.getElementById('mesclarOpcoes');
    container.innerHTML = membrosEmMesclagem.map((m, i) => {
        const tel = [m.pessoaTelefoneDDD, m.pessoaTelefoneNumero].filter(Boolean).join(' ') || 'Sem telefone';
        const nTags = parseTags(m.tags).filter(t => t.trim()).length;
        const nEventos = Array.isArray(m.historico_eventos) ? m.historico_eventos.length : 0;
        return `
            <label class="mesclar-opcao">
                <input type="radio" name="mesclarPrincipal" value="${m.pessoaIdentificador}" ${i === 0 ? 'checked' : ''} onchange="atualizarConflitosMesclagem()">
                <div>
                    <strong>${escapeHTML(m.pessoaNome || 'Sem nome')}</strong>
                    <div class="mesclar-opcao-meta">
                        <i class="fa-solid fa-phone"></i> ${escapeHTML(tel)} ·
                        <i class="fa-solid fa-envelope"></i> ${escapeHTML(m.pessoaEmail || 'Sem e-mail')} ·
                        ${nTags} tag(s) · ${nEventos} evento(s)
                    </div>
                </div>
            </label>
        `;
    }).join('');
    atualizarConflitosMesclagem();
}

// Recalcula, a partir de quem está marcado como sobrevivente agora, se
// telefone/e-mail têm valores DIFERENTES entre os membros (precisa
// escolher) e monta um preview de quantas tags/eventos serão incorporados
// automaticamente (isso nunca é conflito, é sempre união).
function atualizarConflitosMesclagem() {
    const container = document.getElementById('mesclarConflitos');
    const radioSelecionado = document.querySelector('input[name="mesclarPrincipal"]:checked');
    if (!container || !radioSelecionado) return;

    const principal = membrosEmMesclagem.find(m => String(m.pessoaIdentificador) === String(radioSelecionado.value));
    const outros = membrosEmMesclagem.filter(m => String(m.pessoaIdentificador) !== String(radioSelecionado.value));
    if (!principal) return;

    let html = '';

    // Telefone — só pergunta se houver 2+ valores DIFERENTES entre os membros
    const telefones = new Map(); // "DDD NUMERO" -> {ddd, numero, origem}
    const registrarTel = (m, origem) => {
        const valor = [m.pessoaTelefoneDDD, m.pessoaTelefoneNumero].filter(Boolean).join(' ');
        if (valor && !telefones.has(valor)) telefones.set(valor, { ddd: m.pessoaTelefoneDDD, numero: m.pessoaTelefoneNumero, origem });
    };
    registrarTel(principal, `${principal.pessoaNome} — sobrevivente`);
    outros.forEach(o => registrarTel(o, o.pessoaNome));
    if (telefones.size > 1) {
        html += `<div class="mesclar-conflito">
            <div class="mesclar-conflito-titulo"><i class="fa-solid fa-triangle-exclamation"></i> Telefones diferentes — qual manter?</div>
            ${Array.from(telefones.entries()).map(([valor, info]) => `
                <label class="mesclar-conflito-opcao">
                    <input type="radio" name="mesclarTelefone" value="${escapeHTML(valor)}" data-ddd="${escapeHTML(info.ddd || '')}" data-numero="${escapeHTML(info.numero || '')}">
                    ${escapeHTML(valor)} <span class="mesclar-conflito-origem">(${escapeHTML(info.origem)})</span>
                </label>
            `).join('')}
            <label class="mesclar-conflito-opcao">
                <input type="radio" name="mesclarTelefone" value="__ambos__" checked>
                Manter os dois — nem sempre dá pra saber qual é o certo <span class="mesclar-conflito-origem">(um vira o telefone principal, o(s) outro(s) ficam anotados no resumo)</span>
            </label>
        </div>`;
    }

    // E-mail — mesma ideia
    const emails = new Map();
    if (principal.pessoaEmail) emails.set(principal.pessoaEmail, `${principal.pessoaNome} — sobrevivente`);
    outros.forEach(o => { if (o.pessoaEmail && !emails.has(o.pessoaEmail)) emails.set(o.pessoaEmail, o.pessoaNome); });
    if (emails.size > 1) {
        html += `<div class="mesclar-conflito">
            <div class="mesclar-conflito-titulo"><i class="fa-solid fa-triangle-exclamation"></i> E-mails diferentes — qual manter?</div>
            ${Array.from(emails.entries()).map(([valor, origem]) => `
                <label class="mesclar-conflito-opcao">
                    <input type="radio" name="mesclarEmail" value="${escapeHTML(valor)}">
                    ${escapeHTML(valor)} <span class="mesclar-conflito-origem">(${escapeHTML(origem)})</span>
                </label>
            `).join('')}
            <label class="mesclar-conflito-opcao">
                <input type="radio" name="mesclarEmail" value="__ambos__" checked>
                Manter os dois <span class="mesclar-conflito-origem">(um vira o e-mail principal, o(s) outro(s) ficam anotados no resumo)</span>
            </label>
        </div>`;
    }

    // Preview de tags/eventos/resumo que serão incorporados automaticamente (sem pedir escolha)
    const tagsPrincipal = new Set(parseTags(principal.tags).map(t => t.trim()).filter(Boolean));
    let tagsNovas = 0;
    outros.forEach(o => parseTags(o.tags).map(t => t.trim()).filter(Boolean).forEach(t => { if (!tagsPrincipal.has(t)) { tagsPrincipal.add(t); tagsNovas++; } }));

    const chaveEvento = e => `${e.evento}|${e.data}`;
    const eventosPrincipal = new Set((Array.isArray(principal.historico_eventos) ? principal.historico_eventos : []).map(chaveEvento));
    let eventosNovos = 0;
    outros.forEach(o => (Array.isArray(o.historico_eventos) ? o.historico_eventos : []).forEach(e => { const k = chaveEvento(e); if (!eventosPrincipal.has(k)) { eventosPrincipal.add(k); eventosNovos++; } }));

    const temResumoExtra = outros.some(o => o.resumo_ia && o.resumo_ia.trim());

    if (tagsNovas > 0 || eventosNovos > 0 || temResumoExtra) {
        const partes = [];
        if (tagsNovas > 0) partes.push(`${tagsNovas} tag(s)`);
        if (eventosNovos > 0) partes.push(`${eventosNovos} evento(s)`);
        if (temResumoExtra) partes.push('resumo de IA');
        html += `<div class="mesclar-conflito mesclar-conflito-info"><i class="fa-solid fa-circle-info"></i> Serão incorporados automaticamente ao sobrevivente: ${partes.join(', ')} — nada é descartado.</div>`;
    }

    container.innerHTML = html;
}

function fecharModalMesclar() {
    grupoEmMesclagem = null;
    membrosEmMesclagem = [];
    document.getElementById('modalMesclar').classList.remove('open');
    document.getElementById('overlayModalMesclar').classList.remove('active');
}

async function confirmarMesclagem() {
    const radioSelecionado = document.querySelector('input[name="mesclarPrincipal"]:checked');
    if (!radioSelecionado || membrosEmMesclagem.length === 0) return;
    const idPrincipal = radioSelecionado.value;

    const principal = membrosEmMesclagem.find(m => String(m.pessoaIdentificador) === String(idPrincipal));
    const outros = membrosEmMesclagem.filter(m => String(m.pessoaIdentificador) !== String(idPrincipal));
    if (!principal || outros.length === 0) return;

    if (!confirm(`Mesclar ${outros.length + 1} leads em "${principal.pessoaNome}"? Os outros ${outros.length} lead(s) serão APAGADOS permanentemente (dados relevantes deles já são incorporados ao sobrevivente antes disso). Essa ação não pode ser desfeita.`)) return;

    // Tags: união, sem duplicar
    let tagsFinais = parseTags(principal.tags).map(t => t.trim()).filter(Boolean);
    outros.forEach(o => {
        parseTags(o.tags).map(t => t.trim()).filter(Boolean).forEach(t => {
            if (!tagsFinais.includes(t)) tagsFinais.push(t);
        });
    });

    // Histórico de eventos: união, sem duplicar evento+data repetido
    let eventosFinais = Array.isArray(principal.historico_eventos) ? [...principal.historico_eventos] : [];
    const chaveEvento = e => `${e.evento}|${e.data}`;
    const eventosExistentes = new Set(eventosFinais.map(chaveEvento));
    outros.forEach(o => {
        (Array.isArray(o.historico_eventos) ? o.historico_eventos : []).forEach(e => {
            const chave = chaveEvento(e);
            if (!eventosExistentes.has(chave)) { eventosFinais.push(e); eventosExistentes.add(chave); }
        });
    });

    // Anotações extras pra quando a pessoa escolhe "Manter os dois" — o
    // valor não escolhido como principal não pode ser perdido (o cadastro
    // só tem 1 campo de telefone/e-mail), então vai pro resumo_ia como nota,
    // pra ficar visível mesmo sem virar o dado "oficial" do lead.
    const notasContatoAlternativo = [];

    // Telefone: se a pessoa escolheu entre valores diferentes, usa a
    // escolha; "__ambos__" mantém o do sobrevivente (ou o 1º disponível) e
    // anota os demais; sem conflito, usa o único valor existente entre todos.
    let telDDD, telNumero;
    const radioTel = document.querySelector('input[name="mesclarTelefone"]:checked');
    if (radioTel && radioTel.value === '__ambos__') {
        telDDD = principal.pessoaTelefoneDDD;
        telNumero = principal.pessoaTelefoneNumero;
        const candidatos = [principal, ...outros].filter(m => m.pessoaTelefoneNumero && String(m.pessoaTelefoneNumero).trim() !== '');
        if (!telNumero && candidatos.length > 0) { telDDD = candidatos[0].pessoaTelefoneDDD; telNumero = candidatos[0].pessoaTelefoneNumero; }
        const telefonePrincipalFinal = [telDDD, telNumero].filter(Boolean).join(' ');
        candidatos.forEach(m => {
            const valor = [m.pessoaTelefoneDDD, m.pessoaTelefoneNumero].filter(Boolean).join(' ');
            if (valor && valor !== telefonePrincipalFinal) notasContatoAlternativo.push(`Telefone alternativo (de ${m.pessoaNome}): ${valor}`);
        });
    } else if (radioTel) {
        telDDD = radioTel.dataset.ddd;
        telNumero = radioTel.dataset.numero;
    } else {
        telDDD = principal.pessoaTelefoneDDD;
        telNumero = principal.pessoaTelefoneNumero;
        if (!telNumero || String(telNumero).trim() === '') {
            const comTel = outros.find(o => o.pessoaTelefoneNumero && String(o.pessoaTelefoneNumero).trim() !== '');
            if (comTel) { telDDD = comTel.pessoaTelefoneDDD; telNumero = comTel.pessoaTelefoneNumero; }
        }
    }

    // E-mail: mesma ideia
    let email;
    const radioEmail = document.querySelector('input[name="mesclarEmail"]:checked');
    if (radioEmail && radioEmail.value === '__ambos__') {
        email = principal.pessoaEmail;
        const candidatos = [principal, ...outros].filter(m => m.pessoaEmail && String(m.pessoaEmail).trim() !== '');
        if (!email && candidatos.length > 0) email = candidatos[0].pessoaEmail;
        candidatos.forEach(m => { if (m.pessoaEmail && m.pessoaEmail !== email) notasContatoAlternativo.push(`E-mail alternativo (de ${m.pessoaNome}): ${m.pessoaEmail}`); });
    } else if (radioEmail) {
        email = radioEmail.value;
    } else {
        email = principal.pessoaEmail;
        if (!email || String(email).trim() === '') {
            const comEmail = outros.find(o => o.pessoaEmail && String(o.pessoaEmail).trim() !== '');
            if (comEmail) email = comEmail.pessoaEmail;
        }
    }

    // Resumo de IA: concatena o de todos que tiverem algo escrito (não
    // descarta nenhuma anotação manual) + as notas de contato alternativo acima
    const resumos = [principal.resumo_ia, ...outros.map(o => o.resumo_ia)].map(r => (r || '').trim()).filter(Boolean);
    if (notasContatoAlternativo.length > 0) resumos.push(notasContatoAlternativo.join('\n'));
    const resumoFinal = resumos.length > 0 ? Array.from(new Set(resumos)).join('\n---\n') : null;

    if (telNumero) tagsFinais = tagsFinais.filter(t => t !== 'Sem Telefone');
    if (email) tagsFinais = tagsFinais.filter(t => t !== 'Sem E-mail');

    const { error: erroUpdate } = await window.supabaseClient
        .from(NOME_TABELA)
        .update({
            tags: JSON.stringify(tagsFinais),
            historico_eventos: eventosFinais,
            eventoNome: eventosFinais.map(e => e.evento).join(' | '),
            eventoData: eventosFinais.map(e => e.data).join(' | '),
            pessoaTelefoneDDD: telDDD || '',
            pessoaTelefoneNumero: telNumero || '',
            pessoaEmail: email || '',
            resumo_ia: resumoFinal
        })
        .eq('pessoaIdentificador', idPrincipal);

    if (erroUpdate) { alert('Erro ao atualizar o lead principal: ' + erroUpdate.message); return; }

    const idsOutros = outros.map(o => String(o.pessoaIdentificador));
    const { error: erroDelete } = await window.supabaseClient.from(NOME_TABELA).delete().in('pessoaIdentificador', idsOutros);
    if (erroDelete) { alert('O lead principal foi atualizado, mas houve erro ao apagar os duplicados: ' + erroDelete.message); return; }

    // grupoEmMesclagem é null pra mesclagem manual (iniciarMesclagemManual())
    // — não veio de um grupo detectado pelo sistema, então não há linha em
    // leads_a_tratar pra limpar.
    if (grupoEmMesclagem) {
        await window.supabaseClient.from(NOME_TABELA_LEADS_A_TRATAR).delete().eq('filial', filialAtual).eq('grupo', grupoEmMesclagem);
        gruposLeadsATratarAtuais = gruposLeadsATratarAtuais.filter(g => g.grupo !== grupoEmMesclagem);
    }

    fecharModalMesclar();
    renderizarListaLeadsATratar();

    if (typeof carregarLeads === 'function' && filialAtual) carregarLeads(filialAtual, true);
}

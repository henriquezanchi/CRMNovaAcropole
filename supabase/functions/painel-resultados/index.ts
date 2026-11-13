// Edge Function: painel-resultados — dados do painel para dirigentes
// (resultados.html). Acesso por link com chave aleatória de 256 bits no
// fragmento da URL; aqui só o hash é comparado. O escopo (escolas e campanhas)
// vem do registro do link, nunca do visitante.
//
// Dois níveis (05/11/2026): só com o link, nomes e telefones chegam BORRADOS
// (abreviados aqui, no servidor). Com o PIN da escola (acao "pin"), o diretor
// recebe uma sessão de 12 h: vê os dados completos e pode agir (acoes
// "resumo", "nao_contatar", "observacao", "data_limite"). Toda ação fica no
// log_atividade com autor "Diretor — <escola>".
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { hashChaveEscola } from "../_shared/painel-escola.ts";
import { alterarTags } from "../_shared/tags.ts";

const ORIGENS = ["https://crm-nova-acropole.vercel.app", "https://crm-nova-acropole-5dv3.vercel.app", "http://127.0.0.1:5500", "http://localhost:8766"];
const HORAS_SESSAO = 12;
const MAX_TENTATIVAS_PIN = 5;
const MINUTOS_BLOQUEIO_PIN = 15;

function cabecalhos(origem: string | null) {
    return {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": origem && ORIGENS.includes(origem) ? origem : ORIGENS[0],
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
        Vary: "Origin",
    };
}

function hojeBrasilia() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// "MARIA LUIZA SIQUEIRA MARTINS" -> "Maria L."; telefone "(62) 99805-8484" -> "(62) 9••••-•484".
function borrarNome(n: unknown): string {
    const partes = String(n || "").trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return "";
    const cap = (p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    return partes.length === 1 ? cap(partes[0]) : `${cap(partes[0])} ${partes[partes.length - 1].charAt(0).toUpperCase()}.`;
}
function borrarTelefone(t: unknown): string {
    const s = String(t || "");
    if (!s) return "";
    const dig = s.replace(/\D/g, "");
    if (dig.length < 6) return "•••";
    const ddd = dig.length >= 10 ? `(${dig.slice(0, 2)}) ` : "";
    const local = dig.length >= 10 ? dig.slice(2) : dig;
    return `${ddd}${local.charAt(0)}${"•".repeat(Math.max(0, local.length - 4))}${local.slice(-3)}`;
}
function borrarLista(lista: any[]): any[] {
    return (lista || []).map((x) => {
        const { pid: _pid, uid: _uid, ...resto } = x;
        const sugestao = x.sugestao ? { ...x.sugestao, nome: undefined } : x.sugestao;
        return { ...resto, sugestao, nome: borrarNome(x.nome), telefone: borrarTelefone(x.telefone), borrado: true };
    });
}

async function sha256(texto: string) {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function tokenAleatorio() {
    return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function registrarLog(filial: string, acao: string, autor: string, pessoaIds: string[], detalhes: Record<string, unknown>) {
    const { error } = await supabaseAdmin.from("log_atividade").insert({ filial, acao, autor, pessoa_ids: pessoaIds, detalhes });
    if (error) console.warn("log_atividade:", error.message);
}

// Texto legível de uma mensagem para o diretor (11/11/2026): antes, tudo que
// não era texto digitado aparecia só como "[template]"/"[imagem]".
function textoMensagemPainel(m: any): string {
    const corpo = String(m.corpo_texto || "").trim();
    const util = corpo && !/^\[(template|mensagem tipo|imagem|áudio|audio|v[íi]deo|documento|figurinha)/i.test(corpo) ? corpo : "";
    switch (m.tipo) {
        case "texto": return corpo;
        case "template": return util ? `Mensagem automática da campanha:
${util}` : "Mensagem automática da campanha.";
        case "imagem": return util ? `📷 Foto: ${util}` : "📷 Foto";
        case "audio": return "🎤 Áudio";
        case "video": return util ? `🎬 Vídeo: ${util}` : "🎬 Vídeo";
        case "documento": return util ? `📄 Documento: ${util}` : "📄 Documento";
        case "sticker": return "Figurinha";
        default: return util || "Mensagem sem texto";
    }
}

Deno.serve(async (req) => {
    const origem = req.headers.get("Origin");
    const h = cabecalhos(origem);
    const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: h });
    if (origem && !ORIGENS.includes(origem)) return responder({ erro: "Origem não permitida." }, 403);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (req.method !== "POST") return responder({ erro: "Use o link de acompanhamento." }, 405);
    const texto = await req.text();
    if (texto.length > 4096) return responder({ erro: "Consulta muito longa." }, 413);
    let corpo: any;
    try { corpo = JSON.parse(texto); } catch { return responder({ erro: "Consulta inválida." }, 400); }
    if (typeof corpo?.chave !== "string" || !/^[a-f0-9]{64}$/.test(corpo.chave)) return responder({ erro: "Link inválido." }, 400);
    const dias = [7, 30, 90, 0].includes(Number(corpo.dias)) ? Number(corpo.dias) : 30;

    const hash = await hashChaveEscola(corpo.chave);
    const { data: link } = await supabaseAdmin.from("painel_resultados_links")
        .select("id, rotulo, filiais, campanhas, somente_campanhas, expira_em, revogado_em, pin_hash, pin_tentativas, pin_bloqueado_ate").eq("chave_hash", hash).maybeSingle();
    if (!link || link.revogado_em || new Date(link.expira_em) < new Date()) {
        return responder({ erro: "Este link expirou, foi revogado ou não é válido. Peça um novo acesso à equipe." }, 401);
    }
    const escolaUnica = Array.isArray(link.filiais) && link.filiais.length === 1;
    const filial: string | null = escolaUnica ? link.filiais[0] : null;
    const autorDiretor = escolaUnica ? `Diretor — ${filial}` : `Painel — ${link.rotulo}`;
    const filialLog = filial || "GLOBAL"; // link de várias escolas (ex.: DMF Goiânia) também pode ter PIN (12/11)
    const acao = typeof corpo.acao === "string" ? corpo.acao : "dados";

    // ---- Sessão do diretor (token de 12 h, só o hash fica no banco) ----
    let diretor = false;
    if (typeof corpo.sessao === "string" && /^[a-f0-9]{64}$/.test(corpo.sessao)) {
        const { data: s } = await supabaseAdmin.from("painel_sessoes").select("id, expira_em")
            .eq("token_hash", await sha256(corpo.sessao)).eq("link_id", link.id).maybeSingle();
        diretor = !!s && new Date(s.expira_em) > new Date();
    }

    // ---- Entrar com o PIN ----
    if (acao === "pin") {
        if (!link.pin_hash) return responder({ ok: false, erro: "Este painel ainda não tem PIN. Peça ao administrador para definir um." }, 400);
        if (link.pin_bloqueado_ate && new Date(link.pin_bloqueado_ate) > new Date()) {
            const min = Math.ceil((new Date(link.pin_bloqueado_ate).getTime() - Date.now()) / 60000);
            return responder({ ok: false, erro: `PIN bloqueado por ${min} min após várias tentativas erradas.` }, 429);
        }
        const pin = String(corpo.pin || "").replace(/\D/g, "");
        const confere = pin.length === 6 && (await sha256(`${link.id}:${pin}`)) === link.pin_hash;
        if (!confere) {
            const tentativas = (link.pin_tentativas || 0) + 1;
            const bloquear = tentativas >= MAX_TENTATIVAS_PIN;
            await supabaseAdmin.from("painel_resultados_links").update({
                pin_tentativas: bloquear ? 0 : tentativas,
                pin_bloqueado_ate: bloquear ? new Date(Date.now() + MINUTOS_BLOQUEIO_PIN * 60000).toISOString() : null,
            }).eq("id", link.id);
            if (bloquear) await registrarLog(filialLog, "painel_pin_bloqueado", autorDiretor, [], { tentativas, minutos: MINUTOS_BLOQUEIO_PIN });
            return responder({ ok: false, erro: bloquear ? `PIN errado ${MAX_TENTATIVAS_PIN} vezes: bloqueado por ${MINUTOS_BLOQUEIO_PIN} min.` : `PIN incorreto. ${MAX_TENTATIVAS_PIN - tentativas} tentativa(s) restante(s).` }, 401);
        }
        const token = tokenAleatorio();
        const expira = new Date(Date.now() + HORAS_SESSAO * 3600000).toISOString();
        const { error } = await supabaseAdmin.from("painel_sessoes").insert({ link_id: link.id, token_hash: await sha256(token), expira_em: expira });
        if (error) return responder({ ok: false, erro: "Não foi possível abrir a sessão agora." }, 503);
        await supabaseAdmin.from("painel_resultados_links").update({ pin_tentativas: 0 }).eq("id", link.id);
        await supabaseAdmin.from("painel_sessoes").delete().lt("expira_em", new Date().toISOString()); // limpeza
        await registrarLog(filialLog, "painel_diretor_entrou", autorDiretor, [], {});
        return responder({ ok: true, sessao: token, expira_em: expira });
    }
    if (acao === "sair") {
        if (typeof corpo.sessao === "string") await supabaseAdmin.from("painel_sessoes").delete().eq("token_hash", await sha256(corpo.sessao));
        return responder({ ok: true });
    }

    // ---- Confirmar "é aluno" / "não é aluno" de um inscrito do Ulisses (12/11/2026) ----
    if (acao === "marcar_aluno") {
        if (!diretor) return responder({ ok: false, erro: "Entre com o PIN para isso.", precisa_pin: true }, 401);
        const uid = String(corpo.uid || "");
        if (!/^\d{1,15}$/.test(uid)) return responder({ ok: false, erro: "Inscrito inválido." }, 400);
        const { data: insc } = await supabaseAdmin.from("ulisses_inscricoes_evento").select("nome").eq("pessoa_id_ulisses", uid).limit(1).maybeSingle();
        if (!insc) return responder({ ok: false, erro: "Inscrito não encontrado." }, 404);
        if (corpo.limpar === true) {
            await supabaseAdmin.from("painel_aluno_confirmado").delete().eq("pessoa_id_ulisses", uid);
        } else {
            const ehAluno = corpo.eh_aluno === true;
            let escola: string | null = null;
            if (ehAluno) {
                const { data: f } = await supabaseAdmin.from("filiais").select("nome").eq("nome", String(corpo.escola || "")).eq("ativo", true).maybeSingle();
                if (!f) return responder({ ok: false, erro: "Escolha a escola do aluno." }, 400);
                escola = f.nome;
            }
            const { error } = await supabaseAdmin.from("painel_aluno_confirmado").upsert({ pessoa_id_ulisses: uid, eh_aluno: ehAluno, escola, autor: autorDiretor, link_id: link.id, atualizado_em: new Date().toISOString() });
            if (error) return responder({ ok: false, erro: "Não foi possível salvar agora." }, 503);
        }
        await registrarLog(filialLog, "painel_aluno_confirmado", autorDiretor, [], { inscrito: insc.nome, eh_aluno: corpo.limpar === true ? null : corpo.eh_aluno === true, escola: corpo.escola || null });
        await supabaseAdmin.from("painel_resultados_cache").update({ gerado_em: null }).like("chave", "campanha:%"); // recalcula na próxima rodada
        return responder({ ok: true });
    }

    // ---- Ações do diretor (exigem sessão) ----
    if (["resumo", "nao_contatar", "observacao", "configurar_turma"].includes(acao)) {
        if (!diretor) return responder({ ok: false, erro: "Entre com o PIN da escola para isso.", precisa_pin: true }, 401);
        if (!escolaUnica) return responder({ ok: false, erro: "Ações só no painel de uma escola." }, 400);

        if (acao === "configurar_turma") {
            const eventoId = Number(corpo.evento_id);
            const data = corpo.data_limite == null || corpo.data_limite === "" ? null : String(corpo.data_limite);
            const vagas = corpo.vagas_por_turma == null || corpo.vagas_por_turma === "" ? null : Number(corpo.vagas_por_turma);
            const turmas = Math.max(1, Number(corpo.qtd_turmas) || 1);
            if (!eventoId || (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) || (vagas != null && !(vagas >= 0 && vagas <= 999))) return responder({ ok: false, erro: "Dados inválidos." }, 400);
            const { data: ev } = await supabaseAdmin.from("eventos").select("id, nome, data, data_limite_inscricao, filial").eq("id", eventoId).eq("filial", filial!).maybeSingle();
            if (!ev) return responder({ ok: false, erro: "Atividade não encontrada nesta escola." }, 404);
            if (data && data < String(ev.data)) return responder({ ok: false, erro: "A data limite não pode ser antes da data da abertura." }, 400);
            const { error } = await supabaseAdmin.from("eventos").update({ data_limite_inscricao: data }).eq("id", ev.id);
            if (error) return responder({ ok: false, erro: error.message }, 500);
            const { error: e2 } = await supabaseAdmin.from("painel_turma_config").upsert({ evento_id: ev.id, vagas_por_turma: vagas, qtd_turmas: turmas, atualizado_por: autorDiretor, atualizado_em: new Date().toISOString() });
            if (e2) return responder({ ok: false, erro: e2.message }, 500);
            await registrarLog(filial!, "painel_diretor_configurou_turma", autorDiretor, [], { evento_id: ev.id, evento: ev.nome, data_limite_de: ev.data_limite_inscricao, data_limite_para: data, vagas_por_turma: vagas, qtd_turmas: turmas });
            await supabaseAdmin.from("painel_resultados_cache").update({ gerado_em: null }).like("chave", "escolas:%"); // recalcula na próxima rodada
            return responder({ ok: true });
        }

        const pid = String(corpo.pid || "");
        if (!pid) return responder({ ok: false, erro: "Pessoa não informada." }, 400);
        const { data: lead } = await supabaseAdmin.from("leads_inscricoes")
            .select('"pessoaIdentificador", "pessoaNome", filial, tags, resumo_ia, ultimo_contato_em, lembrete_em, lembrete_nota')
            .eq("pessoaIdentificador", pid).eq("filial", filial!).maybeSingle();
        if (!lead) return responder({ ok: false, erro: "Pessoa não encontrada nesta escola." }, 404);
        const nomeLead = String(lead.pessoaNome || "");
        const dataBR = hojeBrasilia().split("-").reverse().join("/");

        if (acao === "resumo") {
            let tags: string[] = [];
            try { let v: unknown = lead.tags; for (let i = 0; i < 3 && typeof v === "string"; i++) v = JSON.parse(v); if (Array.isArray(v)) tags = v.map(String); } catch { /* */ }
            const { data: mem } = await supabaseAdmin.from("crm_memoria_conversa").select("resumo, proximo_passo, atualizado_em")
                .eq("pessoa", pid).order("atualizado_em", { ascending: false }).limit(1).maybeSingle();
            const { data: msgs } = await supabaseAdmin.from("mensagens_whatsapp").select("direcao, corpo_texto, criado_em, tipo, wa_status")
                .eq("pessoaIdentificador", pid).neq("wa_status", "falhou").order("criado_em", { ascending: false }).limit(6);
            return responder({
                ok: true, nome: nomeLead,
                situacao: tags.filter((t) => /^(Campanha: |Não Contatar|Temperatura: |Convite: |Conversa: )/.test(t)),
                resumo_conversa: mem?.resumo || null, proximo_passo: mem?.proximo_passo || null,
                anotacoes: lead.resumo_ia || null, ultimo_contato: lead.ultimo_contato_em,
                ultimas_mensagens: (msgs || []).reverse().map((m: any) => ({ de: m.direcao === "entrada" ? "pessoa" : "escola", texto: textoMensagemPainel(m), em: m.criado_em,
                    situacao: m.direcao === "saida" ? ({ enviado: "enviada", entregue: "entregue", lido: "lida" } as Record<string, string>)[m.wa_status] || null : null })),
            });
        }
        if (acao === "nao_contatar") {
            const desfazer = corpo.desfazer === true;
            const motivo = String(corpo.motivo || "").trim().slice(0, 300);
            const tagsFinais = await alterarTags(pid, desfazer ? { remover: ["Não Contatar"] } : { adicionar: ["Não Contatar"] });
            const nota = desfazer ? `Diretor liberou contato (${dataBR}).` : `Diretor pediu para não contatar (${dataBR})${motivo ? `: ${motivo}` : "."}`;
            await supabaseAdmin.from("leads_inscricoes").update({ resumo_ia: [lead.resumo_ia, nota].filter(Boolean).join("\n---\n") }).eq("pessoaIdentificador", pid);
            await registrarLog(filial!, desfazer ? "painel_diretor_liberou_contato" : "painel_diretor_nao_contatar", autorDiretor, [pid], { nome: nomeLead, motivo });
            return responder({ ok: true, tags: tagsFinais });
        }
        if (acao === "observacao") {
            const textoObs = String(corpo.texto || "").trim().slice(0, 600);
            if (!textoObs) return responder({ ok: false, erro: "Escreva a observação." }, 400);
            const nota = `Observação do diretor (${dataBR}): ${textoObs}`;
            const { error } = await supabaseAdmin.from("leads_inscricoes").update({
                resumo_ia: [lead.resumo_ia, nota].filter(Boolean).join("\n---\n"),
                // Aparece em "Lembretes de hoje" do CRM, para a equipe ler a observação.
                lembrete_em: hojeBrasilia(), lembrete_nota: `Observação do diretor: ${textoObs.slice(0, 120)}`,
            }).eq("pessoaIdentificador", pid);
            if (error) return responder({ ok: false, erro: error.message }, 500);
            await registrarLog(filial!, "painel_diretor_observacao", autorDiretor, [pid], { nome: nomeLead, texto: textoObs });
            return responder({ ok: true });
        }
    }

    // ---- Dados do painel ----
    await supabaseAdmin.from("painel_resultados_links").update({ ultimo_acesso_em: new Date().toISOString() }).eq("id", link.id);

    // Os números vêm do cache (painel_resultados_cache), recalculado por um job
    // do pg_cron a cada minuto. Nunca calcular aqui: a consulta é pesada e,
    // quando a página desiste, continua rodando no banco (travou o servidor
    // em 04/11/2026). Aqui só se registra o pedido e se lê o último resultado.
    const filiaisOrd = link.filiais ? [...link.filiais].sort() : null;
    const chaveEscolas = `escolas:${filiaisOrd ? filiaisOrd.join("|") : "todas"}:${dias}`;
    // Link só de campanha (ex.: DMF Goiânia para compartilhar, 12/11): sem a aba Escolas.
    const somenteCampanhas = !!link.somente_campanhas;
    const pedidos = [
        ...(somenteCampanhas ? [] : [{ chave: chaveEscolas, tipo: "escolas", filiais: filiaisOrd, dias, slug: null }]),
        ...(link.campanhas || []).map((slug: string) => ({ chave: `campanha:${slug}`, tipo: "campanha", slug, filiais: null, dias: null })),
    ];
    try {
        const agora = new Date().toISOString();
        const { error: errPedido } = await supabaseAdmin.from("painel_resultados_cache")
            .upsert(pedidos.map((p) => ({ ...p, pedido_em: agora })), { onConflict: "chave" });
        if (errPedido) throw errPedido;
        const { data: linhas, error } = await supabaseAdmin.from("painel_resultados_cache")
            .select("chave, dados, gerado_em").in("chave", pedidos.map((p) => p.chave));
        if (error) throw error;
        const porChave = new Map((linhas || []).map((l: any) => [l.chave, l]));
        const escolasLinha: any = porChave.get(chaveEscolas);
        const faltaCampanha = (link.campanhas || []).some((s: string) => !(porChave.get(`campanha:${s}`) as any)?.dados);
        if (somenteCampanhas ? faltaCampanha : !escolasLinha?.dados) {
            return responder({ preparando: true, mensagem: "Os números estão sendo preparados. A página atualiza sozinha em instantes." });
        }
        const campanhas = (link.campanhas || []).map((slug: string) => ({ data: (porChave.get(`campanha:${slug}`) as any)?.dados || null }));
        const geradoEm = [escolasLinha?.gerado_em, ...(link.campanhas || []).map((s: string) => (porChave.get(`campanha:${s}`) as any)?.gerado_em)]
            .filter(Boolean).sort()[0];
        // Última sincronização bem-sucedida das inscrições do Ulisses.
        const { data: ultSync } = await supabaseAdmin.from("status_sincronizacao_automatica").select("executado_em")
            .eq("sistema", "ulisses").eq("sucesso", true).order("executado_em", { ascending: false }).limit(1).maybeSingle();
        // Lista de inscritos dos eventos das campanhas, atualizada a cada 10 min (sincronizar-inscritos-campanhas.mjs).
        const { data: ultLista } = await supabaseAdmin.from("ulisses_inscricoes_evento").select("visto_em")
            .order("visto_em", { ascending: false }).limit(1).maybeSingle();
        const ulissesEm = [ultSync?.executado_em, ultLista?.visto_em].filter(Boolean).sort().pop() ?? null;
        // Link restrito a escolas: a lista da campanha só mostra pessoas dessas
        // escolas. Sem sessão do diretor, nomes e telefones vão borrados.
        const campanhasDados = campanhas.map((r: any) => {
            const d = r.data;
            if (!d) return d;
            const permitida = (e: string) => !link.filiais || link.filiais.includes(e);
            // Contatado já inscrito no Ulisses? Conferido aqui, antes de borrar, pelo cadastro
            // ou pelo telefone (DDD + 8 últimos dígitos), contra TODOS os inscritos do evento.
            const chaveTel = (t: unknown) => { const g = String(t || "").replace(/\D/g, ""); return g.length >= 10 ? g.slice(0, 2) + g.slice(-8) : ""; };
            const inscPid = new Set((d.inscritos || []).map((x: any) => x.pid).filter(Boolean).map(String));
            const inscTel = new Set((d.inscritos || []).map((x: any) => chaveTel(x.telefone)).filter(Boolean));
            let contatados = (d.contatados || []).filter((x: any) => permitida(x.escola)).map((x: any) => ({
                ...x, inscrito: (x.pid != null && inscPid.has(String(x.pid))) || (!!chaveTel(x.telefone) && inscTel.has(chaveTel(x.telefone))),
            }));
            // Inscrito sem cadastro no CRM e que não é aluno: a função do banco o coloca na escola do
            // evento; aqui ele vai para "Sem cadastro no CRM", para não inflar a escola do evento.
            // Link de várias escolas (coordenação, DMF): mostra TODOS os inscritos do evento, mesmo os
            // cadastrados em escola fora do link (ex.: alguém de Barra inscrito no DMF de Goiânia).
            const todasEscolas = !escolaUnica;
            let inscritos = (d.inscritos || []).map((x: any) => (!x.pid && !x.aluno ? { ...x, escola: null, sem_cadastro: true } : x))
                .filter((x: any) => todasEscolas || permitida(x.escola));
            if (!diretor) { contatados = borrarLista(contatados); inscritos = borrarLista(inscritos); }
            return { ...d, contatados, inscritos, por_escola: (d.por_escola || []).filter((x: any) => permitida(x.escola)) };
        });
        // Sigla de 3 letras de cada escola (código da unidade no Mercúrio), para as listas.
        const { data: fs } = await supabaseAdmin.from("filiais").select("nome, mercurio_unidade, ativo");
        const siglas = Object.fromEntries((fs || []).map((f: any) => [f.nome, f.mercurio_unidade || String(f.nome).replace(/^Goiânia - /, "").normalize("NFD").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()]));
        // Aberturas de turma da escola com a configuração do diretor (vagas, turmas, prazo).
        let turmasConfig: any[] = [];
        if (escolaUnica) {
            const { data: evs } = await supabaseAdmin.from("eventos").select("id, nome, data, hora, capacidade, data_limite_inscricao")
                .eq("filial", filial!).eq("ativo", true).eq("tipo", "Abertura de Turma").gte("data", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).order("data");
            const ids = (evs || []).map((e: any) => e.id);
            const { data: cfg } = ids.length ? await supabaseAdmin.from("painel_turma_config").select("*").in("evento_id", ids) : { data: [] as any[] };
            const porEvento = new Map((cfg || []).map((c: any) => [c.evento_id, c]));
            turmasConfig = (evs || []).map((e: any) => ({ evento_id: e.id, nome: e.nome, data: e.data, hora: e.hora, vagas_ulisses: e.capacidade, data_limite: e.data_limite_inscricao,
                vagas_por_turma: porEvento.get(e.id)?.vagas_por_turma ?? null, qtd_turmas: porEvento.get(e.id)?.qtd_turmas ?? 1, atualizado_em: porEvento.get(e.id)?.atualizado_em ?? null }));
        }
        return responder({
            rotulo: link.rotulo, dias, gerado_em: geradoEm, ulisses_em: ulissesEm, turmas_config: turmasConfig, escolas: somenteCampanhas ? null : escolasLinha.dados, campanhas: campanhasDados.filter(Boolean), siglas,
            escola_unica: escolaUnica, diretor, pin_disponivel: !!link.pin_hash,
            escolas_ativas: diretor ? (fs || []).filter((f: any) => f.ativo && f.mercurio_unidade).map((f: any) => f.nome).sort() : [],
        });
    } catch (e) {
        console.error(e);
        return responder({ erro: "Não foi possível consultar agora. Tente de novo em instantes." }, 503);
    }
});

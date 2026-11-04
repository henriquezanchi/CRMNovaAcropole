// Edge Function: campanha-whatsapp — fila automática de convites por modelo
// aprovado (04/11/2026, pedido do usuário, primeiro uso: Dia Mundial da
// Filosofia 2026 para as escolas de Goiânia e Aparecida).
//
// Ações (corpo JSON, sempre com o token interno x-funil-token):
//   {acao:"planejar", forcar?}  monta a fila do dia (convites + 2ª tentativa
//                               para quem não respondeu em 24h), espaçada
//                               por igual até o fim da janela (20h).
//   {acao:"enviar"}             envia o que já venceu na fila (cron a cada minuto).
//   {acao:"modelos"}            lista os modelos aprovados na Meta.
//   {acao:"status"}             números da campanha.
//
// Limite da Meta: conversas iniciadas por nós com no máximo N pessoas
// diferentes em 24h corridas (TIER_250 hoje). O planejamento e cada envio
// conferem a contagem real das últimas 24h antes de mandar.
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") ?? "v21.0";
const FUSO = "America/Sao_Paulo";
const MARGEM_LIMITE = 5;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function hojeBrasilia(d = new Date()): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(d);
}

// "2026-11-04" + "20:00" no fuso de Brasília (UTC-3, sem horário de verão).
function instanteBrasilia(dataISO: string, hora: string): Date {
    return new Date(`${dataISO}T${hora.slice(0, 5)}:00-03:00`);
}

function somarDias(dataISO: string, dias: number): string {
    const d = new Date(`${dataISO}T12:00:00-03:00`);
    d.setUTCDate(d.getUTCDate() + dias);
    return hojeBrasilia(d);
}

function limiteDoTier(tier: string | null): number {
    const t = String(tier || "").toUpperCase();
    if (t.includes("UNLIMITED")) return 100000;
    if (t.includes("100K")) return 100000;
    if (t.includes("10K")) return 10000;
    if (t.includes("1K")) return 1000;
    if (t.includes("2K")) return 2000;
    return 250;
}

async function limiteDiarioMeta(): Promise<number> {
    const { data } = await supabaseAdmin.from("whatsapp_saude_conta")
        .select("messaging_limit_tier").order("verificado_em", { ascending: false }).limit(1).maybeSingle();
    return limiteDoTier(data?.messaging_limit_tier ?? null);
}

// Pessoas diferentes que receberam modelo nosso nas últimas 24h (falha da
// Meta não abre conversa, então não conta).
async function iniciadasUltimas24h(): Promise<number> {
    const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const pessoas = new Set<string>();
    let de = 0;
    for (;;) {
        const { data, error } = await supabaseAdmin.from("mensagens_whatsapp")
            .select('"pessoaIdentificador", telefone_whatsapp, wa_status')
            .eq("direcao", "saida").eq("tipo", "template").gte("criado_em", desde)
            .range(de, de + 999);
        if (error) throw new Error("falha_contar_envios: " + error.message);
        for (const m of data || []) if (m.wa_status !== "falhou") pessoas.add(String(m.pessoaIdentificador || m.telefone_whatsapp));
        if (!data || data.length < 1000) break;
        de += 1000;
    }
    return pessoas.size;
}

function primeiroNome(lead: any): string {
    const base = (lead.como_prefere_ser_chamado || String(lead.pessoaNome || "").trim().split(/\s+/)[0] || "").trim();
    return base ? base.charAt(0).toUpperCase() + base.slice(1).toLowerCase() : "tudo bem";
}

async function campanhasAtivas() {
    const { data, error } = await supabaseAdmin.from("campanhas_whatsapp").select("*").eq("ativa", true);
    if (error) throw new Error(error.message);
    return data || [];
}

async function inscritosNoEvento(eventoId: number): Promise<number> {
    const { count } = await supabaseAdmin.from("evento_leads").select("id", { count: "exact", head: true })
        .eq("evento_id", eventoId).eq("origem", "ulisses");
    return count || 0;
}

async function elegiveisFollowup(c: any, limite: number): Promise<any[]> {
    if (!c.template_followup || limite <= 0) return [];
    const ate = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: enviados } = await supabaseAdmin.from("campanha_fila")
        .select('"pessoaIdentificador", filial, telefone_chave, grupo, prioridade, enviado_em')
        .eq("campanha_id", c.id).eq("tipo", "convite").eq("status", "enviado").lte("enviado_em", ate)
        .order("prioridade", { ascending: false }).limit(3000);
    if (!enviados?.length) return [];
    const { data: jaTem } = await supabaseAdmin.from("campanha_fila").select('"pessoaIdentificador"')
        .eq("campanha_id", c.id).eq("tipo", "followup");
    const comFollowup = new Set((jaTem || []).map((r: any) => r.pessoaIdentificador));
    const saida: any[] = [];
    for (const e of enviados) {
        if (saida.length >= limite) break;
        if (comFollowup.has(e.pessoaIdentificador)) continue;
        const { count } = await supabaseAdmin.from("mensagens_whatsapp").select("id", { count: "exact", head: true })
            .eq("pessoaIdentificador", e.pessoaIdentificador).eq("direcao", "entrada").gte("criado_em", e.enviado_em);
        if (count && count > 0) continue;
        saida.push(e);
    }
    return saida;
}

async function planejar(c: any, forcar: boolean) {
    const hoje = hojeBrasilia();
    const inicioDia = instanteBrasilia(hoje, c.janela_inicio);
    const fimDia = instanteBrasilia(hoje, c.janela_fim);
    const { count: jaPlanejados } = await supabaseAdmin.from("campanha_fila").select("id", { count: "exact", head: true })
        .eq("campanha_id", c.id).gte("agendado_para", inicioDia.toISOString()).lte("agendado_para", fimDia.toISOString())
        .neq("status", "cancelado");
    if ((jaPlanejados || 0) > 0 && !forcar) return { campanha: c.slug, jaPlanejado: jaPlanejados };

    const inicio = new Date(Math.max(Date.now() + 60_000, inicioDia.getTime()));
    if (inicio >= fimDia) return { campanha: c.slug, foraDaJanela: true };

    const limiteMeta = await limiteDiarioMeta();
    const total = Math.max(0, Math.min(c.cota_diaria + (limiteMeta > c.cota_diaria ? limiteMeta - c.cota_diaria : 0), limiteMeta - MARGEM_LIMITE) - (jaPlanejados || 0));

    const podeConvidar = hoje >= c.inicio && hoje <= c.fim_convites;
    const podeFollowup = hoje > c.inicio && hoje <= c.fim_followup;
    const pctFollowup = Number(c.config?.percentual_maximo_followup ?? 0.4);
    // Com limite folgado (1K ou mais), todos os convites do dia + todas as 2ªs tentativas.
    const tetoFollowup = limiteMeta > c.cota_diaria + 50 ? total - Math.min(c.cota_diaria, total) : Math.floor(total * pctFollowup);
    const followups = podeFollowup ? await elegiveisFollowup(c, podeConvidar ? tetoFollowup : total) : [];

    let convitesQtd = podeConvidar ? Math.min(c.cota_diaria, total - followups.length) : 0;
    // Freio pela lotação: inscritos já sincronizados do Ulisses contra as vagas do evento.
    let freio = "";
    if (c.evento_id && convitesQtd > 0) {
        const { data: ev } = await supabaseAdmin.from("eventos").select("capacidade").eq("id", c.evento_id).maybeSingle();
        const vagas = Number(ev?.capacidade || 0);
        if (vagas > 0) {
            const inscritos = await inscritosNoEvento(c.evento_id);
            if (inscritos >= vagas * 0.97) { convitesQtd = 0; freio = `parado: ${inscritos}/${vagas} inscritos`; }
            else if (inscritos >= vagas * 0.9) { convitesQtd = Math.min(convitesQtd, 150); freio = `reduzido: ${inscritos}/${vagas} inscritos`; }
        }
    }
    const { data: candidatos, error } = convitesQtd > 0
        ? await supabaseAdmin.rpc("campanha_candidatos", { p_campanha: c.id, p_limite: convitesQtd })
        : { data: [], error: null };
    if (error) throw new Error("falha_candidatos: " + error.message);

    // Intercala 2ªs tentativas e convites e distribui por igual até o fim da janela.
    const itens: any[] = [];
    const conv = (candidatos || []).map((x: any) => ({ tipo: "convite", pessoa: x.pessoa, filial: x.filial, tel: x.telefone_chave, grupo: x.grupo, prioridade: x.prioridade }));
    const fol = followups.map((x: any) => ({ tipo: "followup", pessoa: x.pessoaIdentificador, filial: x.filial, tel: x.telefone_chave, grupo: x.grupo, prioridade: x.prioridade }));
    const n = conv.length + fol.length;
    let i = 0, j = 0;
    while (i < conv.length || j < fol.length) {
        const proporcao = n ? fol.length / n : 0;
        if (j < fol.length && (i >= conv.length || j < (i + j + 1) * proporcao)) itens.push(fol[j++]); else itens.push(conv[i++]);
    }
    const intervalo = itens.length > 1 ? (fimDia.getTime() - inicio.getTime()) / itens.length : 0;
    const linhas = itens.map((it, k) => ({
        campanha_id: c.id, pessoaIdentificador: it.pessoa, filial: it.filial, telefone_chave: it.tel,
        grupo: it.grupo, prioridade: it.prioridade, tipo: it.tipo, status: "pendente",
        agendado_para: new Date(inicio.getTime() + k * intervalo).toISOString(),
    }));
    for (let k = 0; k < linhas.length; k += 500) {
        const { error: e2 } = await supabaseAdmin.from("campanha_fila").upsert(linhas.slice(k, k + 500), { onConflict: "campanha_id,pessoaIdentificador,tipo", ignoreDuplicates: true });
        if (e2) throw new Error("falha_gravar_fila: " + e2.message);
    }
    await supabaseAdmin.from("log_atividade").insert({
        filial: "GLOBAL", acao: "campanha_planejada", autor: "Campanha automática",
        detalhes: { campanha: c.slug, dia: hoje, convites: conv.length, segunda_tentativa: fol.length, limite_meta: limiteMeta, intervalo_segundos: Math.round(intervalo / 1000), freio },
    });
    // Resumo do banco a convidar, para o painel dos dirigentes (consulta cara, 1x por planejamento).
    const { data: banco } = await supabaseAdmin.rpc("campanha_banco_resumo", { p_campanha: c.id });
    if (banco) await supabaseAdmin.from("campanhas_whatsapp").update({ config: { ...(c.config || {}), banco, banco_em: new Date().toISOString() } }).eq("id", c.id);
    return { campanha: c.slug, convites: conv.length, segundaTentativa: fol.length, intervaloSegundos: Math.round(intervalo / 1000), limiteMeta, freio };
}

async function chamarEnvio(corpo: Record<string, unknown>) {
    const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify(corpo),
    });
    let dados: any = null;
    try { dados = await resp.json(); } catch { /* resposta não-JSON */ }
    return { ok: resp.ok && dados?.ok !== false, dados, status: resp.status };
}

function paramsDoModelo(nome: string, c: any, lead: any, filialPrep: string): string[] {
    const nomeLead = primeiroNome(lead);
    if (nome === "convite_palestra") return [nomeLead, c.atendente, filialPrep, c.evento_com_artigo, c.evento_data_curta];
    if (nome === "contato_inicial") return [nomeLead, c.atendente, filialPrep];
    if (nome === "resgate_lead_evento") return [nomeLead];
    return [nomeLead];
}

async function enviar() {
    const { data: itens, error } = await supabaseAdmin.rpc("campanha_assumir_envios", { p_limite: 3 });
    if (error) throw new Error("falha_assumir: " + error.message);
    const resultados: any[] = [];
    if (!itens?.length) return resultados;
    const limiteMeta = await limiteDiarioMeta();
    let usados = await iniciadasUltimas24h();
    const campanhas = new Map<number, any>();
    for (const it of itens) {
        let c = campanhas.get(it.campanha_id);
        if (!c) {
            const { data } = await supabaseAdmin.from("campanhas_whatsapp").select("*").eq("id", it.campanha_id).single();
            c = data; campanhas.set(it.campanha_id, c);
        }
        const finalizar = async (status: string, extra: Record<string, unknown> = {}) => {
            await supabaseAdmin.from("campanha_fila").update({ status, ...extra }).eq("id", it.id);
            resultados.push({ id: it.id, status, ...extra });
        };
        if (!c?.ativa) { await finalizar("cancelado", { motivo: "campanha pausada" }); continue; }
        if (usados >= limiteMeta - MARGEM_LIMITE) {
            // Sem cota agora: volta para a fila e tenta daqui a 15 min.
            await supabaseAdmin.from("campanha_fila").update({ status: "pendente", agendado_para: new Date(Date.now() + 15 * 60_000).toISOString() }).eq("id", it.id);
            resultados.push({ id: it.id, status: "adiado_limite_meta" });
            continue;
        }
        const { data: lead } = await supabaseAdmin.from("leads_inscricoes")
            .select('pessoaNome, como_prefere_ser_chamado, filial, tags')
            .eq("pessoaIdentificador", it.pessoaIdentificador).maybeSingle();
        if (!lead) { await finalizar("pulado", { motivo: "lead não encontrado" }); continue; }
        // Conferência na hora: respondeu, conversou ou se inscreveu desde que entrou na fila.
        const desde = it.tipo === "followup"
            ? (await supabaseAdmin.from("campanha_fila").select("enviado_em").eq("campanha_id", c.id).eq("pessoaIdentificador", it.pessoaIdentificador).eq("tipo", "convite").maybeSingle()).data?.enviado_em
            : new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const { count: conversa } = await supabaseAdmin.from("mensagens_whatsapp").select("id", { count: "exact", head: true })
            .eq("pessoaIdentificador", it.pessoaIdentificador).gte("criado_em", desde || new Date().toISOString())
            .in("direcao", it.tipo === "followup" ? ["entrada"] : ["entrada", "saida"]);
        if (conversa && conversa > 0) { await finalizar("pulado", { motivo: it.tipo === "followup" ? "respondeu ao convite" : "conversa nos últimos 7 dias" }); continue; }
        if (c.evento_id) {
            const { count: inscrito } = await supabaseAdmin.from("evento_leads").select("id", { count: "exact", head: true })
                .eq("evento_id", c.evento_id).eq("pessoaIdentificador", it.pessoaIdentificador).eq("origem", "ulisses");
            if (inscrito && inscrito > 0) { await finalizar("pulado", { motivo: "já inscrito no evento" }); continue; }
        }
        const { data: filial } = await supabaseAdmin.from("filiais").select("nome_com_preposicao").eq("nome", lead.filial).maybeSingle();
        const filialPrep = filial?.nome_com_preposicao || `de ${lead.filial}`;
        const modelo = it.tipo === "followup" ? c.template_followup : c.template_convite;
        if (!modelo) { await finalizar("pulado", { motivo: "sem modelo aprovado para esta etapa" }); continue; }
        const params = paramsDoModelo(modelo, c, lead, filialPrep);
        const corpo = (c.config?.corpos || {})[modelo] as string | undefined;
        const preview = corpo ? corpo.replace(/\{\{(\d+)\}\}/g, (_: string, n: string) => params[Number(n) - 1] ?? "") : `[Modelo ${modelo}] ${params.join(" | ")}`;
        const envio = await chamarEnvio({
            pessoaIdentificador: it.pessoaIdentificador, tipo: "template", templateNome: modelo,
            templateIdioma: c.template_idioma, templateParams: params, templatePreview: preview,
            atendenteNome: `Campanha ${c.nome}`, origemEnvio: "campanha",
        });
        if (envio.ok) {
            usados++;
            await finalizar("enviado", { enviado_em: new Date().toISOString(), wa_message_id: envio.dados?.wa_message_id ?? null });
            if (c.evento_id && it.tipo === "convite") {
                await supabaseAdmin.from("evento_leads").upsert(
                    { evento_id: c.evento_id, pessoaIdentificador: it.pessoaIdentificador, resposta_convite: "pendente", origem: "crm" },
                    { onConflict: "evento_id,pessoaIdentificador", ignoreDuplicates: true });
            }
        } else {
            const erro = envio.dados?.erro;
            const motivo = String(envio.dados?.detalhe?.message || erro || `status ${envio.status}`).slice(0, 300);
            await finalizar(erro === "preferencia_contato" || erro === "cadastro_em_conferencia" || erro === "lead_sem_telefone" ? "pulado" : "falhou", { motivo });
        }
    }
    return resultados;
}

async function listarModelos() {
    const token = Deno.env.get("WHATSAPP_TOKEN");
    const dbg = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/debug_token?input_token=${token}&access_token=${token}`).then((r) => r.json());
    const wabas = new Set<string>(String(Deno.env.get("WHATSAPP_WABA_ID") || "").split(",").filter(Boolean));
    for (const s of dbg?.data?.granular_scopes || []) {
        if (String(s.scope).startsWith("whatsapp_business")) (s.target_ids || []).forEach((t: string) => wabas.add(t));
    }
    if (!wabas.size) {
        // Token de usuário de sistema: as contas aparecem pelas empresas do portfólio.
        const neg = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/businesses?fields=id,owned_whatsapp_business_accounts{id},client_whatsapp_business_accounts{id}`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then((x) => x.json());
        for (const b of neg?.data || []) {
            for (const w of [...(b.owned_whatsapp_business_accounts?.data || []), ...(b.client_whatsapp_business_accounts?.data || [])]) wabas.add(w.id);
        }
        if (!wabas.size) return [{ diagnostico: { debug: dbg?.data ? Object.keys(dbg.data) : dbg?.error?.message, escopos: (dbg?.data?.scopes || []), negocios: neg?.error?.message || (neg?.data || []).length } }];
    }
    const saida: any[] = [];
    for (const w of wabas) {
        const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${w}/message_templates?limit=100&fields=name,status,category,language,components`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then((x) => x.json());
        if (r?.error) saida.push({ diagnostico: { waba: w, erro: r.error.message } });
        for (const t of r?.data || []) {
            saida.push({ waba: w, nome: t.name, status: t.status, categoria: t.category, idioma: t.language,
                corpo: (t.components || []).find((k: any) => k.type === "BODY")?.text ?? null });
        }
    }
    return saida;
}

async function status() {
    const campanhas = await campanhasAtivas();
    const saida: any[] = [];
    for (const c of campanhas) {
        const { data } = await supabaseAdmin.from("campanha_fila").select("tipo, status").eq("campanha_id", c.id);
        const resumo: Record<string, number> = {};
        for (const r of data || []) resumo[`${r.tipo}:${r.status}`] = (resumo[`${r.tipo}:${r.status}`] || 0) + 1;
        saida.push({ campanha: c.slug, resumo, inscritosEvento: c.evento_id ? await inscritosNoEvento(c.evento_id) : null });
    }
    return { campanhas: saida, limiteMeta: await limiteDiarioMeta(), iniciadas24h: await iniciadasUltimas24h() };
}

Deno.serve(async (req) => {
    const token = Deno.env.get("FUNIL_ANALISE_TOKEN");
    if (!token || req.headers.get("x-funil-token") !== token) return new Response("Não autorizado", { status: 401 });
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);
    let corpo: any = {};
    try { corpo = await req.json(); } catch { /* corpo vazio */ }
    try {
        if (corpo.acao === "planejar") {
            const saida = [];
            for (const c of await campanhasAtivas()) saida.push(await planejar(c, Boolean(corpo.forcar)));
            return json({ ok: true, planejado: saida });
        }
        if (corpo.acao === "enviar") return json({ ok: true, enviados: await enviar() });
        if (corpo.acao === "modelos") return json({ ok: true, modelos: await listarModelos() });
        if (corpo.acao === "status") return json({ ok: true, ...(await status()) });
        return json({ ok: false, erro: "acao_desconhecida" }, 400);
    } catch (e) {
        console.error(e);
        return json({ ok: false, erro: String((e as Error).message || e) }, 500);
    }
});

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
//   {acao:"criar_modelo", waba, modelo} cria um modelo na Meta (fica em análise).
//
// Limite da Meta: conversas iniciadas por nós com no máximo N pessoas
// diferentes em 24h corridas (TIER_250 hoje). O planejamento e cada envio
// conferem a contagem real das últimas 24h antes de mandar.
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { decifrarToken } from "../_shared/whatsapp-numeros.ts";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") ?? "v21.0";
const FUSO = "America/Sao_Paulo";
// Folga para modelos fora das campanhas (aniversário, convites manuais, lembretes) no mesmo limite da Meta.
const MARGEM_LIMITE = 20;

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
    // Campo novo da Meta (whatsapp_business_manager_messaging_limit) pode vir só com o número.
    if (/^\d+$/.test(t)) return Number(t);
    if (t.includes("UNLIMITED")) return 100000;
    if (t.includes("100K")) return 100000;
    if (t.includes("10K")) return 10000;
    if (t.includes("1K")) return 1000;
    if (t.includes("2K")) return 2000;
    return 250;
}

// O limite/qualidade usados pelo agendador são os do número da AGÊNCIA (portfólio da Aletheia). Números das
// escolas (whatsapp_conexoes) também entram em whatsapp_saude_conta, mas têm limite próprio no portfólio delas,
// então não podem ser confundidos com o da agência aqui (27/11/2026).
const PHONE_ID_AGENCIA = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_DEFAULT") || "";

// Número extra das campanhas (28/11/2026): cada número tem limite, qualidade, teto e contagens próprios.
// Linhas antigas sem phone_number_id_meta / phone_number_id são do número da agência.
function doNumero(q: any, phoneId: string, coluna = "phone_number_id_meta") {
    return phoneId === PHONE_ID_AGENCIA ? q.or(`${coluna}.is.null,${coluna}.eq.${phoneId}`) : q.eq(coluna, phoneId);
}

async function limiteDiarioMeta(phoneId = PHONE_ID_AGENCIA): Promise<number> {
    const { data } = await supabaseAdmin.from("whatsapp_saude_conta")
        .select("messaging_limit_tier").eq("phone_number_id", phoneId).order("verificado_em", { ascending: false }).limit(1).maybeSingle();
    return limiteDoTier(data?.messaging_limit_tier ?? null);
}

// ---------------------------------------------------------------------------
// Qualidade da conta (13/11/2026, a conta ficou amarela às 14h30 depois de dias
// com 300-400 mensagens). A Meta calcula a qualidade pelos últimos 7 dias, pelos
// bloqueios, denúncias, silenciamentos e arquivamentos. O agendador agora freia:
//   verde    -> teto normal;
//   amarelo  -> 30% do teto e nenhuma 2ª tentativa;
//   vermelho -> para tudo;
//   5+ retenções da Meta (131049) nas últimas 3h -> para até baixar.
// ---------------------------------------------------------------------------
const FATOR_AMARELO = 0.3;
const RETENCOES_PARA_PARAR = 5;
const HORAS_RETENCOES = 3;
// Mensagem genérica de apresentação para quem não respondeu é o que mais gera bloqueio.
const MODELOS_PROIBIDOS_FOLLOWUP = new Set(["contato_inicial"]);

type Qualidade = { nivel: "verde" | "amarelo" | "vermelho" | "desconhecido"; fator: number; semFollowup: boolean; pausar: boolean; motivo: string; retencoes: number };

async function estadoQualidade(phoneId = PHONE_ID_AGENCIA): Promise<Qualidade> {
    const { data } = await supabaseAdmin.from("whatsapp_saude_conta")
        .select("quality_rating, status").eq("phone_number_id", phoneId).order("verificado_em", { ascending: false }).limit(1).maybeSingle();
    const q = String(data?.quality_rating || "").toUpperCase();
    const desde = new Date(Date.now() - HORAS_RETENCOES * 3600 * 1000).toISOString();
    const { count: retencoes } = await doNumero(supabaseAdmin.from("mensagens_whatsapp").select("id", { count: "exact", head: true })
        .eq("direcao", "saida").eq("wa_status", "falhou").gte("criado_em", desde)
        .filter("wa_status_erro", "cs", JSON.stringify([{ code: 131049 }])), phoneId);
    const r = retencoes || 0;
    const amarelo = q === "YELLOW" || q === "MEDIUM";
    if (data?.status && data.status !== "CONNECTED") return { nivel: "vermelho", fator: 0, semFollowup: true, pausar: true, motivo: `número ${data.status}`, retencoes: r };
    if (q === "RED" || q === "LOW") return { nivel: "vermelho", fator: 0, semFollowup: true, pausar: true, motivo: "qualidade vermelha", retencoes: r };
    if (r >= RETENCOES_PARA_PARAR) return { nivel: amarelo ? "amarelo" : "verde", fator: 0, semFollowup: true, pausar: true, motivo: `${r} retenções da Meta nas últimas ${HORAS_RETENCOES}h`, retencoes: r };
    if (amarelo) return { nivel: "amarelo", fator: FATOR_AMARELO, semFollowup: true, pausar: false, motivo: "qualidade amarela", retencoes: r };
    return { nivel: q ? "verde" : "desconhecido", fator: 1, semFollowup: false, pausar: false, motivo: "", retencoes: r };
}

// Teto diário somando todas as campanhas (campanha_parametros). Rampa: começa em 100; com 3 dias
// seguidos de qualidade verde sobe 25 por dia até o limite da Meta; fora do verde volta a no máximo 100.
// Número extra: mesma rampa, teto guardado em whatsapp_conexoes (teto_campanha/teto_ajustado_em), começando em teto_inicial.
async function tetoDoDia(limiteMeta: number, qualidade: Qualidade, ajustar: boolean, phoneId = PHONE_ID_AGENCIA): Promise<{ teto: number; efetivo: number }> {
    const { data: p } = await supabaseAdmin.from("campanha_parametros").select("*").eq("id", 1).maybeSingle();
    const extra = phoneId !== PHONE_ID_AGENCIA;
    const { data: cx } = extra
        ? await supabaseAdmin.from("whatsapp_conexoes").select("teto_campanha, teto_ajustado_em").eq("phone_number_id", phoneId).maybeSingle()
        : { data: null as any };
    let teto = extra ? Number(cx?.teto_campanha ?? p?.teto_inicial ?? 100) : Number(p?.teto_diario ?? 100);
    const ajustadoEm = extra ? cx?.teto_ajustado_em : p?.teto_ajustado_em;
    const hoje = hojeBrasilia();
    if (ajustar && p && ajustadoEm !== hoje) {
        if (qualidade.nivel === "verde") {
            const dias = Number(p.dias_verde_para_subir || 3);
            const desde = new Date(Date.now() - dias * 24 * 3600 * 1000).toISOString();
            const { data: linhas } = await supabaseAdmin.from("whatsapp_saude_conta").select("quality_rating, verificado_em")
                .eq("phone_number_id", phoneId).gte("verificado_em", desde).order("verificado_em");
            const lista = linhas || [];
            const tudoVerde = lista.length > 0 && lista.every((l: any) => ["GREEN", "HIGH"].includes(String(l.quality_rating || "").toUpperCase()));
            const cobreJanela = lista.length > 0 && new Date(lista[0].verificado_em).getTime() <= new Date(desde).getTime() + 2 * 3600 * 1000;
            if (tudoVerde && cobreJanela) teto = Math.min(teto + Number(p.passo_rampa || 25), limiteMeta - MARGEM_LIMITE);
        } else {
            teto = Math.min(teto, Number(p.teto_inicial || 100));
        }
        if (extra) await supabaseAdmin.from("whatsapp_conexoes").update({ teto_campanha: teto, teto_ajustado_em: hoje }).eq("phone_number_id", phoneId);
        else await supabaseAdmin.from("campanha_parametros").update({ teto_diario: teto, teto_ajustado_em: hoje, atualizado_em: new Date().toISOString() }).eq("id", 1);
    }
    const efetivo = qualidade.pausar ? 0 : Math.floor(Math.min(teto, limiteMeta - MARGEM_LIMITE) * qualidade.fator);
    return { teto, efetivo };
}

function followupPermitido(c: any, qualidade: Qualidade): boolean {
    return !!c.template_followup && !MODELOS_PROIBIDOS_FOLLOWUP.has(c.template_followup) && !qualidade.semFollowup;
}

// ---------------------------------------------------------------------------
// Números que enviam convites (28/11/2026, pedido do usuário: "esse número, para ficar como extra, e termos
// mais 250 mensagens por dia"). Sempre o número da agência; mais cada número extra (whatsapp_conexoes com
// extra_campanhas, conectado e com "usar no CRM" ligado). O limite da Meta é por portfólio, e o extra está em
// outro portfólio, então cada um tem limite, qualidade (freios), teto com rampa e contagens próprios. Um convite
// só sai pelo extra se o modelo estiver APROVADO na conta (WABA) dele; a 2ª tentativa sai pelo mesmo número do
// convite. As respostas seguem a regra de sempre (número em que a pessoa escreveu).
// ---------------------------------------------------------------------------
const MARGEM_EXTRA = 5; // o extra não recebe modelos manuais; só uma folguinha

type NumeroPool = {
    id: string; extra: boolean; nome: string; waba: string | null; token: string | null;
    limite: number; margem: number; qualidade: Qualidade; teto: { teto: number; efetivo: number };
    usados24h: number; enviadosHoje: number; pagamento: { bloqueado: boolean; podeTestar: boolean };
    modelos: Set<string> | null; // nome|idioma aprovados (só extras)
};

const chaveModelo = (nome: string, idioma: string | null | undefined) => `${nome}|${idioma || "pt_BR"}`;

async function modelosAprovados(waba: string, token: string): Promise<Set<string>> {
    const aprovados = new Set<string>();
    let url = `https://graph.facebook.com/${GRAPH_VERSION}/${waba}/message_templates?fields=name,language,status&limit=200`;
    for (let i = 0; url && i < 10; i++) {
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(j?.error?.message || `status ${resp.status}`);
        for (const t of j.data || []) if (t.status === "APPROVED") aprovados.add(chaveModelo(t.name, t.language));
        url = j.paging?.next || "";
    }
    return aprovados;
}

async function numerosDoPool(opts: { ajustar?: boolean; contagens?: boolean } = {}): Promise<NumeroPool[]> {
    const base: { id: string; extra: boolean; nome: string; waba: string | null; token: string | null }[] =
        [{ id: PHONE_ID_AGENCIA, extra: false, nome: "agência", waba: null, token: null }];
    const { data, error } = await supabaseAdmin.from("whatsapp_conexoes")
        .select("filial, phone_number_id, waba_id, numero_exibicao, token_cifrado, estado, usar_no_crm").eq("extra_campanhas", true);
    if (error) console.warn("números extras indisponíveis:", error.message);
    for (const c of data || []) {
        if (c.estado !== "conectado" || !c.usar_no_crm || !c.token_cifrado) continue;
        try {
            base.push({ id: String(c.phone_number_id), extra: true, nome: c.numero_exibicao || String(c.phone_number_id), waba: String(c.waba_id), token: await decifrarToken(c.token_cifrado) });
        } catch (e) { console.error("token do número extra não decifrou:", c.phone_number_id, e); }
    }
    const lista: NumeroPool[] = [];
    for (const b of base) {
        const limite = await limiteDiarioMeta(b.id);
        const qualidade = await estadoQualidade(b.id);
        const teto = await tetoDoDia(limite, qualidade, !!opts.ajustar, b.id);
        let modelos: Set<string> | null = null;
        if (b.extra) {
            try { modelos = await modelosAprovados(b.waba!, b.token!); }
            catch (e) { console.warn("modelos do número extra:", b.nome, e); modelos = new Set(); }
        }
        lista.push({
            ...b, limite, margem: b.extra ? MARGEM_EXTRA : MARGEM_LIMITE, qualidade, teto, modelos,
            usados24h: opts.contagens ? await iniciadasUltimas24h(b.id) : 0,
            enviadosHoje: opts.contagens ? await enviadosHojeCampanhas(b.id) : 0,
            pagamento: opts.contagens ? await estadoPagamento(b.id) : { bloqueado: false, podeTestar: true },
        });
    }
    return lista;
}

function resumoPool(pool: NumeroPool[]) {
    return pool.map((n) => ({ numero: n.nome, extra: n.extra, limite: n.limite, qualidade: n.qualidade.nivel, freio: n.qualidade.motivo || null,
        teto: n.teto.teto, efetivo: n.teto.efetivo, usados24h: n.usados24h, enviadosHoje: n.enviadosHoje,
        pagamentoBloqueado: n.pagamento.bloqueado, modelosAprovados: n.modelos ? n.modelos.size : null }));
}

async function enviadosHojeCampanhas(phoneId: string | null = null): Promise<number> {
    const inicio = instanteBrasilia(hojeBrasilia(), "00:00").toISOString();
    let q = supabaseAdmin.from("campanha_fila").select("id", { count: "exact", head: true })
        .eq("status", "enviado").gte("enviado_em", inicio);
    if (phoneId) q = doNumero(q, phoneId, "phone_number_id");
    const { count } = await q;
    return count || 0;
}

// Pessoas diferentes que receberam modelo nosso nas últimas 24h (falha da
// Meta não abre conversa, então não conta).
async function iniciadasUltimas24h(phoneId = PHONE_ID_AGENCIA): Promise<number> {
    const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const pessoas = new Set<string>();
    let de = 0;
    for (;;) {
        const { data, error } = await doNumero(supabaseAdmin.from("mensagens_whatsapp")
            .select('"pessoaIdentificador", telefone_whatsapp, wa_status')
            .eq("direcao", "saida").eq("tipo", "template").gte("criado_em", desde), phoneId)
            .order("id").range(de, de + 999);
        if (error) throw new Error("falha_contar_envios: " + error.message);
        for (const m of data || []) if (m.wa_status !== "falhou") pessoas.add(String(m.pessoaIdentificador || m.telefone_whatsapp));
        if (!data || data.length < 1000) break;
        de += 1000;
    }
    return pessoas.size;
}

// O PostgREST devolve no máximo 1000 linhas por chamada: busca de 1000 em 1000
// até acabar. A consulta precisa de ordem estável (sempre inclui "id").
async function todasAsLinhas(montar: () => any): Promise<any[]> {
    const saida: any[] = [];
    for (let de = 0; ; de += 1000) {
        const { data, error } = await montar().range(de, de + 999);
        if (error) throw new Error(error.message);
        saida.push(...(data || []));
        if (!data || data.length < 1000) return saida;
    }
}

function primeiroNome(lead: any): string {
    const base = (lead.como_prefere_ser_chamado || String(lead.pessoaNome || "").trim().split(/\s+/)[0] || "").trim();
    return base ? base.charAt(0).toUpperCase() + base.slice(1).toLowerCase() : "tudo bem";
}

async function campanhasAtivas() {
    const { data, error } = await supabaseAdmin.from("campanhas_whatsapp").select("*").eq("ativa", true)
        .order("cota_diaria", { ascending: false }).order("id");
    if (error) throw new Error(error.message);
    return data || [];
}

async function inscritosNoEvento(eventoId: number): Promise<number> {
    // Lista do Ulisses quando já sincronizada (12/11/2026): conta toda inscrição, inclusive de
    // quem não tem cadastro na escola do evento; senão, os vínculos do CRM.
    const { data: ev } = await supabaseAdmin.from("eventos").select("evento_id_ulisses").eq("id", eventoId).maybeSingle();
    if (ev?.evento_id_ulisses) {
        const { count: lista } = await supabaseAdmin.from("ulisses_inscricoes_evento").select("email_evento_id", { count: "exact", head: true })
            .eq("evento_id_ulisses", ev.evento_id_ulisses).is("removido_em", null);
        if (lista && lista > 0) return lista;
    }
    const { count } = await supabaseAdmin.from("evento_leads").select("id", { count: "exact", head: true })
        .eq("evento_id", eventoId).eq("origem", "ulisses");
    return count || 0;
}

// Vagas que ainda restam no evento (null = sem capacidade cadastrada).
async function vagasRestantes(c: any): Promise<{ restantes: number; inscritos: number; vagas: number } | null> {
    if (!c?.evento_id) return null;
    const { data: ev } = await supabaseAdmin.from("eventos").select("capacidade").eq("id", c.evento_id).maybeSingle();
    const vagas = Number(ev?.capacidade || 0);
    if (!vagas) return null;
    const inscritos = await inscritosNoEvento(c.evento_id);
    return { restantes: vagas - inscritos, inscritos, vagas };
}
// config.parar_com_vagas_restantes (ex.: 20, DMF 12/11/2026): nenhum convite novo nem 2ª tentativa
// quando restarem essa quantidade de vagas ou menos.
function pararPorVagas(c: any, v: { restantes: number } | null): boolean {
    const limite = Number(c?.config?.parar_com_vagas_restantes);
    return !!v && Number.isFinite(limite) && limite > 0 && v.restantes <= limite;
}

async function elegiveisFollowup(c: any, limite: number): Promise<any[]> {
    if (!c.template_followup || limite <= 0) return [];
    const ate = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const enviados = await todasAsLinhas(() => supabaseAdmin.from("campanha_fila")
        .select('"pessoaIdentificador", filial, telefone_chave, grupo, prioridade, enviado_em, wa_message_id')
        .eq("campanha_id", c.id).eq("tipo", "convite").eq("status", "enviado").lte("enviado_em", ate)
        .order("prioridade", { ascending: false }).order("id"));
    if (!enviados.length) return [];
    // Lista completa: com mais de 1000 2ªs tentativas, quem ficasse fora receberia outra.
    const jaTem = await todasAsLinhas(() => supabaseAdmin.from("campanha_fila").select('"pessoaIdentificador"')
        .eq("campanha_id", c.id).eq("tipo", "followup").neq("status", "cancelado").order("id"));
    const comFollowup = new Set(jaTem.map((r: any) => r.pessoaIdentificador));
    const saida: any[] = [];
    for (const e of enviados) {
        if (saida.length >= limite) break;
        if (comFollowup.has(e.pessoaIdentificador)) continue;
        // Só quem LEU o convite (13/11/2026): insistir com quem nem abriu tende a virar bloqueio.
        if (!e.wa_message_id) continue;
        const { data: msg } = await supabaseAdmin.from("mensagens_whatsapp").select("wa_status")
            .eq("wa_message_id", e.wa_message_id).maybeSingle();
        if (msg?.wa_status !== "lido") continue;
        const { count } = await supabaseAdmin.from("mensagens_whatsapp").select("id", { count: "exact", head: true })
            .eq("pessoaIdentificador", e.pessoaIdentificador).eq("direcao", "entrada").gte("criado_em", antes10min(e.enviado_em));
        if (count && count > 0) continue;
        saida.push(e);
    }
    return saida;
}

// Divide "total" convites entre as escolas: primeiro um mínimo para cada (se houver gente), depois
// o resto proporcional ao tamanho do banco de cada escola (maiores restos). Dentro de cada escola,
// a ordem de prioridade de sempre. "lista" já vem ordenada por prioridade.
function dividirPorEscola(lista: any[], total: number, minimo: number): any[] {
    const grupos = new Map<string, any[]>();
    for (const x of lista) { const k = x.filial || ""; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k)!.push(x); }
    const escolas = [...grupos.keys()];
    if (!escolas.length || total <= 0) return [];
    const cota = new Map<string, number>();
    const minEfetivo = Math.min(minimo, Math.floor(total / escolas.length));
    let resto = total;
    for (const e of escolas) { const v = Math.min(minEfetivo, grupos.get(e)!.length); cota.set(e, v); resto -= v; }
    while (resto > 0) {
        const abertas = escolas.filter((e) => grupos.get(e)!.length > cota.get(e)!);
        if (!abertas.length) break;
        const banco = abertas.reduce((t, e) => t + grupos.get(e)!.length, 0);
        const partes = abertas.map((e) => ({ e, ideal: (resto * grupos.get(e)!.length) / banco }));
        let distribuido = 0;
        for (const p of partes) {
            const add = Math.min(Math.floor(p.ideal), grupos.get(p.e)!.length - cota.get(p.e)!);
            cota.set(p.e, cota.get(p.e)! + add); distribuido += add;
        }
        let sobra = resto - distribuido;
        for (const p of partes.sort((a, b) => (b.ideal % 1) - (a.ideal % 1))) {
            if (sobra <= 0) break;
            if (grupos.get(p.e)!.length > cota.get(p.e)!) { cota.set(p.e, cota.get(p.e)! + 1); sobra--; distribuido++; }
        }
        if (distribuido === 0) break;
        resto -= distribuido;
    }
    const escolhidos: any[] = [];
    for (const e of escolas) escolhidos.push(...grupos.get(e)!.slice(0, cota.get(e)!));
    return escolhidos.sort((a, b) => Number(b.prioridade || 0) - Number(a.prioridade || 0));
}

// Cotas por proximidade (16/11/2026, pedido do usuário). Cada abertura de turma recebe a MESMA
// fatia do total de convites que cabe até a última abertura (teto do dia × dias que faltam, mais o
// que já foi agendado desde config.proximidade_desde). Quem tem a abertura mais cedo precisa
// mandar sua fatia em menos dias, então manda mais por dia; e cada uma reforça a própria reta final.
// Quando uma abertura passa, as vagas dela vão para as que ainda vão abrir. Recalculado todo dia às 08:25.
// Ex. (teto 230; fim 23, 24 e 25/11; hoje 17/11): Universitário/Goiânia II 45→56, Eldorado/Catalão
// 38→76 no último dia, Jardim América/Setor Oeste 32→115 no último dia; ~335-365 convites cada.
function prioridadeCampanha(c: any, ev: any): number {
    if (c.config?.pos_evento) return 6;
    if (!c.evento_id || !ev) return 5;
    const nome = String(ev.nome || ""), tipo = String(ev.tipo || "");
    if (/experimental/i.test(nome) || /aula inaugural/i.test(tipo)) return 1;
    if (/abertura de turma/i.test(tipo) || /turma/i.test(nome)) return 2;
    if (/curso|workshop|oficina/i.test(tipo + " " + nome)) return 3;
    return 4;
}

async function aplicarCotasPorProximidade(campanhas: any[], tetoEfetivo: number) {
    const hoje = hojeBrasilia();
    const dinamicas = campanhas.filter((c) => c.config?.cota_por_proximidade);
    if (!dinamicas.length) return null;
    const fixas = campanhas.filter((c) => !c.config?.cota_por_proximidade && hojeBrasilia() >= c.inicio && hojeBrasilia() <= c.fim_convites)
        .reduce((t, c) => t + Number(c.cota_diaria || 0), 0);
    const disponivel = Math.max(0, tetoEfetivo - fixas);
    const dias = (fim: string) => Math.round((Date.parse(fim + "T12:00:00Z") - Date.parse(hoje + "T12:00:00Z")) / 86400000) + 1;
    const ativas = dinamicas.filter((c) => hoje >= c.inicio && hoje <= c.fim_convites);
    const resumo: Record<string, number> = {};
    const cota = new Map<number, number>();
    if (ativas.length) {
        // Já agendado por cada uma desde o início da divisão (sem contar hoje).
        const feito = new Map<number, number>();
        for (const c of ativas) {
            const desde = String(c.config?.proximidade_desde || hoje);
            const { count } = await supabaseAdmin.from("campanha_fila").select("id", { count: "exact", head: true })
                .eq("campanha_id", c.id).eq("tipo", "convite").neq("status", "cancelado")
                .gte("agendado_para", instanteBrasilia(desde, "00:00").toISOString())
                .lt("agendado_para", instanteBrasilia(hoje, "00:00").toISOString());
            feito.set(c.id, count || 0);
        }
        const fimMax = Math.max(...ativas.map((c) => dias(c.fim_convites)));
        const fatia = (disponivel * fimMax + [...feito.values()].reduce((t, v) => t + v, 0)) / ativas.length;
        // Reforço na reta final (16/11/2026): o saldo de cada escola é espalhado pelos dias que faltam
        // com peso 1/k (k = dias até o fim_convites; o último dia pesa mais), porque convite perto da
        // data rende mais (a pessoa decide e não esquece). Hoje fica a parte do dia de hoje.
        const parteHoje = (D: number) => { let soma = 0; for (let k = 1; k <= D; k++) soma += 1 / k; return (1 / D) / soma; };
        const necessidade = ativas.map((c) => ({ c, v: Math.max(0, fatia - feito.get(c.id)!) * parteHoje(dias(c.fim_convites)) }));
        const somaNec = necessidade.reduce((t, x) => t + x.v, 0);
        const partes = necessidade.map((x) => ({ c: x.c, ideal: somaNec ? disponivel * x.v / somaNec : 0 }));
        for (const p of partes) cota.set(p.c.id, Math.floor(p.ideal));
        let sobra = disponivel - partes.reduce((t, p) => t + cota.get(p.c.id)!, 0);
        for (const p of [...partes].sort((x, y) => (y.ideal % 1) - (x.ideal % 1))) { if (sobra <= 0) break; cota.set(p.c.id, cota.get(p.c.id)! + 1); sobra--; }
    }
    for (const c of dinamicas) {
        const v = cota.get(c.id) ?? 0;
        resumo[c.slug] = v;
        if (Number(c.cota_diaria) !== v) {
            await supabaseAdmin.from("campanhas_whatsapp").update({ cota_diaria: v }).eq("id", c.id);
            c.cota_diaria = v;
        }
    }
    return { disponivel, cotas: resumo };
}

async function planejar(c: any, forcar: boolean, qualidade: Qualidade, teto: { teto: number; efetivo: number }) {
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
    // Várias campanhas dividem o mesmo limite da Meta: cada uma usa só a própria
    // cota e nunca mais do que sobra depois do que as outras já planejaram hoje.
    const { count: outrasHoje } = await supabaseAdmin.from("campanha_fila").select("id", { count: "exact", head: true })
        .neq("campanha_id", c.id).gte("agendado_para", inicioDia.toISOString()).lte("agendado_para", fimDia.toISOString())
        .neq("status", "cancelado");
    // Teto do dia (somando todas as campanhas) já reduzido pela qualidade da conta.
    const total = Math.max(0, Math.min(c.cota_diaria, teto.efetivo - (outrasHoje || 0)) - (jaPlanejados || 0));

    const podeConvidar = hoje >= c.inicio && hoje <= c.fim_convites;
    const podeFollowup = hoje > c.inicio && hoje <= c.fim_followup && followupPermitido(c, qualidade);
    const pctFollowup = Number(c.config?.percentual_maximo_followup ?? 0.4);
    const tetoFollowup = Math.floor(total * pctFollowup);
    // config.excluir_filiais (12/11/2026, DMF: parar o Setor Universitário e focar nas demais escolas).
    const excluir = new Set<string>(Array.isArray(c.config?.excluir_filiais) ? c.config.excluir_filiais : []);
    const followups = podeFollowup
        ? (await elegiveisFollowup(c, (podeConvidar ? tetoFollowup : total) * (excluir.size ? 3 : 1))).filter((x: any) => !excluir.has(x.filial)).slice(0, podeConvidar ? tetoFollowup : total)
        : [];

    let convitesQtd = podeConvidar ? Math.min(c.cota_diaria, total - followups.length) : 0;
    const vagasAgora = await vagasRestantes(c);
    if (pararPorVagas(c, vagasAgora)) {
        return { campanha: c.slug, parado: `restam ${vagasAgora!.restantes} vagas (${vagasAgora!.inscritos}/${vagasAgora!.vagas} inscritos)` };
    }
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
    // config.cota_por_escola (12/11/2026, DMF): divide os convites entre as escolas, proporcional
    // ao banco de cada uma, com um mínimo para cada (config.minimo_por_escola). Sem isso, a lista
    // única por prioridade deixava escolas inteiras sem convite (Garavelo, 12/11).
    const porEscola = !!c.config?.cota_por_escola;
    const limiteBusca = porEscola ? Math.max(convitesQtd * 40, 8000) : (excluir.size ? convitesQtd * 4 : convitesQtd);
    const { data: candidatosBrutos, error } = convitesQtd > 0
        ? await supabaseAdmin.rpc("campanha_candidatos", { p_campanha: c.id, p_limite: limiteBusca })
        : { data: [], error: null };
    if (error) throw new Error("falha_candidatos: " + error.message);
    const disponiveis = (candidatosBrutos || []).filter((x: any) => !excluir.has(x.filial));
    const candidatos = porEscola
        ? dividirPorEscola(disponiveis, convitesQtd, Number(c.config?.minimo_por_escola ?? 10))
        : disponiveis.slice(0, convitesQtd);

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
    // A fila aceita 1 linha por (campanha, pessoa, tipo). Quem tem linha CANCELADA (ex.: freio de 06/11)
    // volta a ser candidato; a linha antiga é reaproveitada (volta a "pendente" com o horário novo),
    // senão o upsert abaixo ignoraria a pessoa em silêncio e a cota do dia se perderia.
    const reaproveitar = new Map<string, number>();
    const pessoas = [...new Set(linhas.map((l) => l.pessoaIdentificador))];
    for (let k = 0; k < pessoas.length; k += 200) {
        const { data: canc, error: e1 } = await supabaseAdmin.from("campanha_fila").select("id, pessoaIdentificador, tipo")
            .eq("campanha_id", c.id).eq("status", "cancelado").in("pessoaIdentificador", pessoas.slice(k, k + 200));
        if (e1) throw new Error("falha_ler_cancelados: " + e1.message);
        for (const r of canc || []) reaproveitar.set(`${r.pessoaIdentificador}|${r.tipo}`, r.id);
    }
    const novas = linhas.filter((l) => !reaproveitar.has(`${l.pessoaIdentificador}|${l.tipo}`));
    const gravados: Record<string, number> = { convite: 0, followup: 0 };
    for (const l of linhas) {
        const id = reaproveitar.get(`${l.pessoaIdentificador}|${l.tipo}`);
        if (!id) continue;
        const { data: up, error: e3 } = await supabaseAdmin.from("campanha_fila")
            .update({ status: "pendente", agendado_para: l.agendado_para, filial: l.filial, telefone_chave: l.telefone_chave,
                grupo: l.grupo, prioridade: l.prioridade, motivo: null, enviado_em: null, wa_message_id: null, phone_number_id: null })
            .eq("id", id).eq("status", "cancelado").select("id");
        if (e3) throw new Error("falha_reaproveitar_fila: " + e3.message);
        if (up && up.length) gravados[l.tipo]++;
    }
    for (let k = 0; k < novas.length; k += 500) {
        const { data: ins, error: e2 } = await supabaseAdmin.from("campanha_fila")
            .upsert(novas.slice(k, k + 500), { onConflict: "campanha_id,pessoaIdentificador,tipo", ignoreDuplicates: true })
            .select("tipo");
        if (e2) throw new Error("falha_gravar_fila: " + e2.message);
        for (const r of ins || []) gravados[r.tipo]++;
    }
    await supabaseAdmin.from("log_atividade").insert({
        filial: "GLOBAL", acao: "campanha_planejada", autor: "Campanha automática",
        detalhes: { campanha: c.slug, dia: hoje, convites: gravados.convite, segunda_tentativa: gravados.followup,
            convites_escolhidos: conv.length, segunda_tentativa_escolhida: fol.length, reaproveitados_cancelados: reaproveitar.size,
            limite_meta: limiteMeta, intervalo_segundos: Math.round(intervalo / 1000), freio,
            qualidade: qualidade.nivel, freio_qualidade: qualidade.motivo || null, teto_dia: teto.teto, teto_efetivo: teto.efetivo },
    });
    // Resumo do banco a convidar, para o painel dos dirigentes (consulta cara, 1x por planejamento).
    const { data: banco } = await supabaseAdmin.rpc("campanha_banco_resumo", { p_campanha: c.id });
    if (banco) await supabaseAdmin.from("campanhas_whatsapp").update({ config: { ...(c.config || {}), banco, banco_em: new Date().toISOString() } }).eq("id", c.id);
    return { campanha: c.slug, convites: gravados.convite, segundaTentativa: gravados.followup, intervaloSegundos: Math.round(intervalo / 1000), limiteMeta, freio };
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

// Último evento em que a pessoa ESTEVE (evento_leads.compareceu = true), para o modelo
// contato_ulisses ("Vi que você participou {{4}} {{5}}"). Até 28/11/2026 usava o último
// evento do histórico (inscrição), e a mensagem dizia "participou" a quem só se inscreveu.
async function eventoPresenteDoLead(pid: string): Promise<{ evento: string; tipo: string | null } | null> {
    const { data } = await supabaseAdmin.from("evento_leads").select("eventos!inner(nome, tipo, data)")
        .eq("pessoaIdentificador", pid).eq("compareceu", true)
        .order("data", { foreignTable: "eventos", ascending: false }).limit(1).maybeSingle();
    const e: any = (data as any)?.eventos;
    return e?.nome ? { evento: e.nome, tipo: e.tipo ?? null } : null;
}
// Último evento já passado em que a pessoa se INSCREVEU no Ulisses e ainda não tem
// presença registrada (28/11/2026): usado pelo modelo de config.template_sem_presenca,
// que pergunta "Você conseguiu ir?" em vez de afirmar que ela participou.
async function eventoInscritoSemPresenca(pid: string, desde: string | null): Promise<{ id: number; evento: string; tipo: string | null } | null> {
    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    let q = supabaseAdmin.from("evento_leads").select("eventos!inner(id, nome, tipo, data)")
        .eq("pessoaIdentificador", pid).eq("origem", "ulisses").is("compareceu", null).lt("eventos.data", hoje);
    if (desde) q = q.gte("eventos.data", desde);
    const { data } = await q.order("data", { foreignTable: "eventos", ascending: false }).limit(1).maybeSingle();
    const e: any = (data as any)?.eventos;
    return e?.nome ? { id: e.id, evento: e.nome, tipo: e.tipo ?? null } : null;
}
function descreverEvento(ev: { evento: string; tipo: string | null } | null): { de: string; nome: string } | null {
    if (!ev?.evento) return null;
    let nomeEv = String(ev.evento).trim();
    if (nomeEv === nomeEv.toUpperCase()) nomeEv = nomeEv.toLowerCase().replace(/(^|[\s(":])(\p{L})/gu, (_: string, a: string, b: string) => a + b.toUpperCase())
        .replace(/ (De|Da|Do|Das|Dos|E|O|A|Os|As|Em|No|Na|Nos|Nas|Para|Com)(?= )/g, (x: string) => x.toLowerCase());
    const tipo = String(ev.tipo || "").toLowerCase();
    const de = /palestra/.test(tipo) ? "da palestra" : /workshop|curso|filosofilme|caf[ée]/.test(tipo) ? `do ${tipo.split("/")[0].trim()}`
        : /oficina|aula|leitura|abertura/.test(tipo) ? `da ${tipo.split("/")[0].trim()}` : "do evento";
    return { de, nome: `"${nomeEv}"` };
}

function paramsDoModelo(nome: string, c: any, lead: any, filialPrep: string, eventoPresente: { evento: string; tipo: string | null } | null = null): string[] {
    const nomeLead = primeiroNome(lead);
    if (nome === "convite_palestra") return [nomeLead, c.atendente, filialPrep, c.evento_com_artigo, c.evento_data_curta];
    if (nome === "contato_inicial") return [nomeLead, c.atendente, filialPrep];
    if (nome === "resgate_lead_evento") return [nomeLead];
    if (/^contato_ulisses/.test(nome) && c.config?.evento_de && c.config?.evento_nome) {
        // Pós-evento (16/11/2026): o evento é o da campanha, não o último do histórico.
        return [nomeLead, c.atendente, filialPrep, c.config.evento_de, c.config.evento_nome];
    }
    if (/^contato_ulisses/.test(nome)) {
        // Campanha de relacionamento (11/11/2026): "Vi que você participou {{4}} {{5}} recentemente."
        // Só com presença confirmada (28/11/2026).
        const ult = descreverEvento(eventoPresente);
        if (!ult) return [];
        return [nomeLead, c.atendente, filialPrep, ult.de, ult.nome];
    }
    return [nomeLead];
}

// Trava de pagamento (12/11/2026): em 11/11 a Meta recusou TODOS os modelos a partir das 13:34
// com o erro 131042 (problema de pagamento da conta) e a campanha seguiu tentando até as 20h.
// Se o último modelo com resultado final falhou com 131042, só sai um envio de teste a cada
// 30 min; o resto volta para a fila. Quando um passar, os envios voltam sozinhos.
const ERRO_PAGAMENTO = "131042";
const MINUTOS_TESTE_PAGAMENTO = 10;
async function estadoPagamento(phoneId = PHONE_ID_AGENCIA): Promise<{ bloqueado: boolean; podeTestar: boolean }> {
    // Último resultado que diz algo sobre a CONTA: entrega, ou falha por pagamento. Falhas de um
    // número só (sem WhatsApp, 131026; ecossistema, 131049) não contam — em 11/11 a última falha foi
    // 131026 e escondeu o 131042 logo antes.
    const { data: recentes } = await doNumero(supabaseAdmin.from("mensagens_whatsapp").select("wa_status, wa_status_erro")
        .eq("direcao", "saida").eq("tipo", "template").in("wa_status", ["entregue", "lido", "falhou"]), phoneId)
        .order("criado_em", { ascending: false }).limit(30);
    const ultimo = (recentes || []).find((m: any) => m.wa_status !== "falhou" || JSON.stringify(m.wa_status_erro || "").includes(ERRO_PAGAMENTO));
    const bloqueado = !!ultimo && ultimo.wa_status === "falhou";
    if (!bloqueado) return { bloqueado: false, podeTestar: true };
    const { count: testesRecentes } = await doNumero(supabaseAdmin.from("mensagens_whatsapp").select("id", { count: "exact", head: true })
        .eq("direcao", "saida").eq("tipo", "template").gte("criado_em", new Date(Date.now() - MINUTOS_TESTE_PAGAMENTO * 60_000).toISOString()), phoneId);
    return { bloqueado: true, podeTestar: !testesRecentes };
}
async function avisarPagamento(bloqueado: boolean) {
    const acao = bloqueado ? "whatsapp_pagamento_bloqueado" : "whatsapp_pagamento_liberado";
    const { data: ult } = await supabaseAdmin.from("log_atividade").select("acao, criado_em")
        .in("acao", ["whatsapp_pagamento_bloqueado", "whatsapp_pagamento_liberado"]).order("criado_em", { ascending: false }).limit(1).maybeSingle();
    if (bloqueado ? (ult?.acao === acao && Date.now() - new Date(ult.criado_em).getTime() < 6 * 3600_000) : ult?.acao !== "whatsapp_pagamento_bloqueado") return;
    await supabaseAdmin.from("log_atividade").insert({ filial: "GLOBAL", acao, autor: "Campanhas WhatsApp", pessoa_ids: [], detalhes: {} });
    const texto = bloqueado
        ? "⚠️ Campanhas do WhatsApp PARADAS: a Meta está recusando os modelos por problema de pagamento da conta (erro 131042). Regularize em business.facebook.com > Cobrança. Vou testar um envio a cada 10 min e retomo sozinho quando passar."
        : "✅ Campanhas do WhatsApp retomadas: os modelos voltaram a ser entregues (problema de pagamento resolvido).";
    try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/lembrete-scraper`, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ texto }),
        });
    } catch (e) { console.warn("aviso de pagamento não enviado:", e); }
}

// Falha temporária na Meta (pagamento 131042, limite 130429/131056) não pode tirar a pessoa da campanha (23/11/2026):
// a Meta aceita o envio e só avisa a falha depois, pelo webhook. Convite nessa situação volta para a fila.
const RE_FALHA_TEMPORARIA = /131042|130429|131056|payment|eligibility|rate limit/i;

async function enviar() {
    const { data: revertidos, error: erroRev } = await supabaseAdmin.rpc("campanha_reverter_falhas_temporarias");
    if (erroRev) console.warn("reverter falhas temporárias:", erroRev.message);
    else if (revertidos) console.log(`${revertidos} convite(s) com falha temporária voltaram para a fila`);
    const { data: itens, error } = await supabaseAdmin.rpc("campanha_assumir_envios", { p_limite: 3 });
    if (error) throw new Error("falha_assumir: " + error.message);
    const resultados: any[] = [];
    if (!itens?.length) return resultados;
    const pool = await numerosDoPool({ contagens: true });
    const agencia = pool[0];
    const qualidade = agencia.qualidade; // 2ª tentativa segue a qualidade do número da agência
    const campanhas = new Map<number, any>();
    const vagasPorCampanha = new Map<number, any>();
    await avisarPagamento(agencia.pagamento.bloqueado);
    // Com pagamento bloqueado num número, só 1 envio de teste por vez sai por ele.
    const testeLiberado = new Map(pool.map((n) => [n.id, n.pagamento.podeTestar]));
    const semVagaTeto = (n: NumeroPool) => n.qualidade.pausar || n.enviadosHoje >= n.teto.efetivo;
    const semVagaLimite = (n: NumeroPool) => semVagaTeto(n) || n.usados24h >= n.limite - n.margem;
    const podeEnviarPor = (n: NumeroPool) => !semVagaLimite(n) && (!n.pagamento.bloqueado || testeLiberado.get(n.id));
    for (const it of itens) {
        if (pool.every((n) => n.pagamento.bloqueado && !testeLiberado.get(n.id))) {
            await supabaseAdmin.from("campanha_fila").update({ status: "pendente", agendado_para: new Date(Date.now() + MINUTOS_TESTE_PAGAMENTO * 60_000).toISOString() }).eq("id", it.id);
            resultados.push({ id: it.id, status: "adiado_pagamento" });
            continue;
        }
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
        // Convite de campanha que já encerrou nunca sai (27/11/2026): sem isto, convites que ficaram na fila durante o
        // bloqueio de pagamento sairiam depois da abertura da turma, convidando para uma aula que já aconteceu.
        if (c.fim_convites && hojeBrasilia() > c.fim_convites) { await finalizar("cancelado", { motivo: "campanha já encerrou os convites" }); continue; }
        if (Array.isArray(c.config?.excluir_filiais) && c.config.excluir_filiais.includes(it.filial)) { await finalizar("cancelado", { motivo: "escola fora desta campanha" }); continue; }
        if (c.config?.parar_com_vagas_restantes) {
            if (!vagasPorCampanha.has(c.id)) vagasPorCampanha.set(c.id, await vagasRestantes(c));
            const v = vagasPorCampanha.get(c.id);
            if (pararPorVagas(c, v)) { await finalizar("cancelado", { motivo: `restam ${v!.restantes} vagas no evento` }); continue; }
        }
        if (pool.every((n) => n.qualidade.pausar)) {
            // Freio da qualidade (em todos os números): volta para a fila e confere de novo em 1 hora.
            await supabaseAdmin.from("campanha_fila").update({ status: "pendente", agendado_para: new Date(Date.now() + 60 * 60_000).toISOString() }).eq("id", it.id);
            resultados.push({ id: it.id, status: "adiado_qualidade", motivo: pool.map((n) => n.qualidade.motivo).filter(Boolean).join("; ") });
            continue;
        }
        if (it.tipo === "followup" && !followupPermitido(c, qualidade)) {
            await finalizar("cancelado", { motivo: qualidade.semFollowup ? `sem 2ª tentativa: ${qualidade.motivo}` : "modelo de 2ª tentativa não permitido" });
            continue;
        }
        const motivoTeto = () => `teto do dia atingido (${pool.map((n) => `${n.nome}: ${n.teto.efetivo}${n.qualidade.motivo ? ", " + n.qualidade.motivo : ""}`).join("; ")})`;
        if (pool.every(semVagaTeto)) {
            // Teto do dia atingido em todos os números (ou reduzido pela qualidade). Cancelado volta a ser candidato amanhã.
            await finalizar("cancelado", { motivo: motivoTeto() });
            continue;
        }
        if (pool.every(semVagaLimite)) {
            // Sem cota agora: volta para a fila e tenta daqui a 15 min.
            await supabaseAdmin.from("campanha_fila").update({ status: "pendente", agendado_para: new Date(Date.now() + 15 * 60_000).toISOString() }).eq("id", it.id);
            resultados.push({ id: it.id, status: "adiado_limite_meta" });
            continue;
        }
        const { data: lead } = await supabaseAdmin.from("leads_inscricoes")
            .select('pessoaNome, como_prefere_ser_chamado, filial, tags, historico_eventos')
            .eq("pessoaIdentificador", it.pessoaIdentificador).maybeSingle();
        if (!lead) { await finalizar("pulado", { motivo: "lead não encontrado" }); continue; }
        // Conferência na hora: respondeu, conversou ou se inscreveu desde que entrou na fila.
        const desde = it.tipo === "followup"
            ? (await supabaseAdmin.from("campanha_fila").select("enviado_em").eq("campanha_id", c.id).eq("pessoaIdentificador", it.pessoaIdentificador).eq("tipo", "convite").maybeSingle()).data?.enviado_em
            : (c.config?.conversa_desde || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
        const { count: conversa } = await supabaseAdmin.from("mensagens_whatsapp").select("id", { count: "exact", head: true })
            .eq("pessoaIdentificador", it.pessoaIdentificador).gte("criado_em", it.tipo === "followup" && desde ? antes10min(desde) : (desde || new Date().toISOString()))
            .in("direcao", it.tipo === "followup" ? ["entrada"] : ["entrada", "saida"])
            .or("wa_status.is.null,wa_status.neq.falhou"); // envio que falhou não é conversa (reenvio de 12/11)
        if (conversa && conversa > 0) { await finalizar("pulado", { motivo: it.tipo === "followup" ? "respondeu ao convite" : "conversa nos últimos 7 dias" }); continue; }
        if (c.evento_id && !c.config?.pos_evento) {
            const { count: inscrito } = await supabaseAdmin.from("evento_leads").select("id", { count: "exact", head: true })
                .eq("evento_id", c.evento_id).eq("pessoaIdentificador", it.pessoaIdentificador).eq("origem", "ulisses");
            if (inscrito && inscrito > 0) { await finalizar("pulado", { motivo: "já inscrito no evento" }); continue; }
        }
        const { data: filial } = await supabaseAdmin.from("filiais").select("nome_com_preposicao").eq("nome", lead.filial).maybeSingle();
        const filialPrep = filial?.nome_com_preposicao || `de ${lead.filial}`;
        let modelo = it.tipo === "followup" ? c.template_followup : c.template_convite;
        if (!modelo) { await finalizar("pulado", { motivo: "sem modelo aprovado para esta etapa" }); continue; }
        const precisaPresenca = /^contato_ulisses/.test(modelo) && !(c.config?.evento_de && c.config?.evento_nome);
        let eventoPresente = precisaPresenca ? await eventoPresenteDoLead(it.pessoaIdentificador) : null;
        let params: string[];
        if (precisaPresenca && !eventoPresente && c.config?.template_sem_presenca && it.tipo === "convite") {
            // Inscrita sem presença registrada: modelo que pergunta "Você conseguiu ir?".
            const insc = await eventoInscritoSemPresenca(it.pessoaIdentificador, c.config?.ultimo_evento_desde || null);
            const desc = descreverEvento(insc);
            modelo = c.config.template_sem_presenca;
            params = desc ? [primeiroNome(lead), c.atendente, filialPrep, desc.de, desc.nome] : [];
        } else {
            params = paramsDoModelo(modelo, c, lead, filialPrep, eventoPresente);
        }
        if (!params.length) { await finalizar("pulado", { motivo: "sem presença confirmada nem inscrição recente para o modelo" }); continue; }
        // Número que envia: o de menor ocupação do teto entre os que têm vaga e o modelo aprovado.
        // 2ª tentativa sai pelo mesmo número do convite (convites antigos, sem número gravado, são da agência).
        const numeroDoConvite = it.tipo === "followup"
            ? ((await supabaseAdmin.from("campanha_fila").select("phone_number_id").eq("campanha_id", c.id).eq("pessoaIdentificador", it.pessoaIdentificador).eq("tipo", "convite").maybeSingle()).data?.phone_number_id || PHONE_ID_AGENCIA)
            : null;
        const comModelo = pool.filter((n) => (!n.extra || n.modelos?.has(chaveModelo(modelo, c.template_idioma))) && (!numeroDoConvite || n.id === numeroDoConvite));
        const opcoes = comModelo.filter(podeEnviarPor)
            .sort((a, b) => a.enviadosHoje / Math.max(1, a.teto.efetivo) - b.enviadosHoje / Math.max(1, b.teto.efetivo));
        const numero = opcoes[0];
        if (!numero) {
            if (comModelo.every(semVagaTeto)) await finalizar("cancelado", { motivo: motivoTeto() });
            else {
                await supabaseAdmin.from("campanha_fila").update({ status: "pendente", agendado_para: new Date(Date.now() + 15 * 60_000).toISOString() }).eq("id", it.id);
                resultados.push({ id: it.id, status: "adiado_sem_numero", motivo: `nenhum número com vaga e o modelo ${modelo} aprovado` });
            }
            continue;
        }
        if (numero.pagamento.bloqueado) testeLiberado.set(numero.id, false); // este é o envio de teste por esse número
        const corpo = (c.config?.corpos || {})[modelo] as string | undefined;
        const preview = corpo ? corpo.replace(/\{\{(\d+)\}\}/g, (_: string, n: string) => params[Number(n) - 1] ?? "") : `[Modelo ${modelo}] ${params.join(" | ")}`;
        // Horário de ANTES da chamada: com o servidor lento a chamada pode levar
        // mais de um minuto, e a pessoa responder antes de ela terminar (04/11).
        const momentoEnvio = new Date().toISOString();
        const envio = await chamarEnvio({
            pessoaIdentificador: it.pessoaIdentificador, tipo: "template", templateNome: modelo,
            templateIdioma: c.template_idioma, templateParams: params, templatePreview: preview,
            atendenteNome: `Campanha ${c.nome}`, origemEnvio: "campanha", phoneNumberIdEnvio: numero.id,
        });
        if (envio.ok) {
            numero.usados24h++;
            numero.enviadosHoje++;
            await finalizar("enviado", { enviado_em: momentoEnvio, wa_message_id: envio.dados?.wa_message_id ?? null, phone_number_id: numero.id });
            if (c.evento_id && it.tipo === "convite" && !c.config?.pos_evento) {
                await supabaseAdmin.from("evento_leads").upsert(
                    { evento_id: c.evento_id, pessoaIdentificador: it.pessoaIdentificador, resposta_convite: "pendente", origem: "crm" },
                    { onConflict: "evento_id,pessoaIdentificador", ignoreDuplicates: true });
            }
        } else {
            const erro = envio.dados?.erro;
            const motivo = String(envio.dados?.detalhe?.message || erro || `status ${envio.status}`).slice(0, 300);
            if (RE_FALHA_TEMPORARIA.test(JSON.stringify(envio.dados?.detalhe || "") + " " + motivo)) {
                await supabaseAdmin.from("campanha_fila").update({ status: "pendente", motivo: "reenvio: " + motivo, agendado_para: new Date(Date.now() + 30 * 60_000).toISOString() }).eq("id", it.id);
                resultados.push({ id: it.id, status: "adiado_falha_temporaria", motivo });
                continue;
            }
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

// Cria um modelo na Meta (09/11/2026: versões dos convites com botão "Parar mensagens").
// Corpo: {acao:"criar_modelo", waba, modelo:{name, language, category, components}}.
async function criarModelo(waba: string, modelo: any) {
    if (!/^\d+$/.test(String(waba || "")) || !modelo?.name) return { erro: "waba_ou_modelo_invalido" };
    // Saída fácil (13/11/2026): quem quer parar responde SAIR em vez de bloquear; o webhook já
    // marca "Não Contatar" sozinho. Todo modelo novo de marketing ganha o rodapé, se não tiver.
    if (Array.isArray(modelo.components) && !modelo.components.some((x: any) => String(x?.type).toUpperCase() === "FOOTER")
        && String(modelo.category || "MARKETING").toUpperCase() === "MARKETING") {
        modelo = { ...modelo, components: [...modelo.components, { type: "FOOTER", text: "Para não receber mais, responda SAIR" }] };
    }
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${waba}/message_templates`, {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
        body: JSON.stringify(modelo),
    }).then((x) => x.json());
    await supabaseAdmin.from("log_atividade").insert({ filial: "GLOBAL", acao: "modelo_whatsapp_criado", autor: "Claude (pedido do usuário)",
        detalhes: { waba, nome: modelo.name, resposta: r } });
    return r;
}

async function status() {
    const campanhas = await campanhasAtivas();
    const saida: any[] = [];
    for (const c of campanhas) {
        const data = await todasAsLinhas(() => supabaseAdmin.from("campanha_fila").select("tipo, status").eq("campanha_id", c.id).order("id"));
        const resumo: Record<string, number> = {};
        for (const r of data) resumo[`${r.tipo}:${r.status}`] = (resumo[`${r.tipo}:${r.status}`] || 0) + 1;
        saida.push({ campanha: c.slug, resumo, inscritosEvento: c.evento_id ? await inscritosNoEvento(c.evento_id) : null });
    }
    const pool = await numerosDoPool({ contagens: true });
    const agencia = pool[0];
    return { campanhas: saida, limiteMeta: agencia.limite, iniciadas24h: agencia.usados24h, qualidade: agencia.qualidade,
        teto: agencia.teto, enviadosHoje: await enviadosHojeCampanhas(), numeros: resumoPool(pool) };
}

// Margem de segurança ao procurar resposta a um envio: o horário gravado pode
// ser um pouco posterior ao envio real.
function antes10min(iso: string) { return new Date(new Date(iso).getTime() - 10 * 60_000).toISOString(); }

Deno.serve(async (req) => {
    const token = Deno.env.get("FUNIL_ANALISE_TOKEN");
    if (!token || req.headers.get("x-funil-token") !== token) return new Response("Não autorizado", { status: 401 });
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);
    let corpo: any = {};
    try { corpo = await req.json(); } catch { /* corpo vazio */ }
    try {
        if (corpo.acao === "planejar") {
            const saida = [];
            const pool = await numerosDoPool({ ajustar: true });
            const qualidade = pool[0].qualidade;
            const campanhas = await campanhasAtivas();
            // O extra só soma capacidade quando tem aprovados TODOS os modelos de convite das campanhas ativas
            // (senão o planejamento contaria vagas que não podem ser usadas).
            const modelosConvite = [...new Set(campanhas.flatMap((c: any) => [c.template_convite, c.config?.template_sem_presenca]
                .filter(Boolean).map((m: string) => chaveModelo(m, c.template_idioma))))];
            const capacidade = (n: NumeroPool) => (n.extra && !modelosConvite.every((m) => n.modelos?.has(m)) ? 0 : n.teto.efetivo);
            const teto = { teto: pool.reduce((t, n) => t + n.teto.teto, 0), efetivo: pool.reduce((t, n) => t + capacidade(n), 0) };
            const numeros = resumoPool(pool).map((r, k) => ({ ...r, capacidadePlanejada: capacidade(pool[k]),
                modelosFaltando: pool[k].extra ? modelosConvite.filter((m) => !pool[k].modelos?.has(m)) : [] }));
            const cotasProximidade = await aplicarCotasPorProximidade(campanhas, teto.efetivo);
            // Prioridade (18/11/2026, pedido do usuário): aula experimental > abertura de turma > curso pago >
            // outro evento > relacionamento > pós-evento. Quem vem antes planeja antes e não perde vaga do teto do dia.
            // Mesma regra de prioridadeCampanha() em js/planejamento-mensagens.js.
            const idsEv = [...new Set(campanhas.map((c: any) => c.evento_id).filter(Boolean))];
            const { data: evs } = idsEv.length ? await supabaseAdmin.from("eventos").select("id, nome, tipo").in("id", idsEv) : { data: [] };
            const evPorId = new Map((evs || []).map((e: any) => [e.id, e]));
            campanhas.sort((x: any, y: any) => prioridadeCampanha(x, evPorId.get(x.evento_id)) - prioridadeCampanha(y, evPorId.get(y.evento_id))
                || Number(y.cota_diaria) - Number(x.cota_diaria) || Number(x.id) - Number(y.id));
            for (const c of campanhas) saida.push(await planejar(c, Boolean(corpo.forcar), qualidade, teto));
            return json({ ok: true, qualidade, teto, numeros, cotasProximidade, planejado: saida });
        }
        if (corpo.acao === "enviar") return json({ ok: true, enviados: await enviar() });
        if (corpo.acao === "modelos") return json({ ok: true, modelos: await listarModelos() });
        if (corpo.acao === "criar_modelo") return json({ ok: true, resposta: await criarModelo(corpo.waba, corpo.modelo) });
        if (corpo.acao === "status") return json({ ok: true, ...(await status()) });
        return json({ ok: false, erro: "acao_desconhecida" }, 400);
    } catch (e) {
        console.error(e);
        return json({ ok: false, erro: String((e as Error).message || e) }, 500);
    }
});

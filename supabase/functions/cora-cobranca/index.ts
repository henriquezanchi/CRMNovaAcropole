// Edge Function: cora-cobranca — cobrança das escolas pela Cora (16/11/2026, pedido do usuário).
//
// Ações (corpo JSON):
//   {acao:"previa", usuario, senha_hash, competencia, de, ate}         → valores e mensagem de cada escola, sem gerar nada
//   {acao:"gerar", usuario, senha_hash, competencia, de, ate, vencimento, ambiente, itens:[{filial, valor_centavos}]}
//        → gera boleto + Pix na Cora para cada escola e monta a mensagem pronta para o diretor
//   {acao:"marcar_enviada"|"cancelar", usuario, senha_hash, id}
//   {acao:"registrar_webhook", usuario, senha_hash, ambiente}           → pede à Cora o aviso de pagamento (cora-webhook)
//   {acao:"consultar"}                                                  → atualiza o status das cobranças em aberto
//   {acao:"rotina"} (cron, x-funil-token)                               → consultar + lembrete 3 dias depois do envio
//
// Gerar/cancelar exige usuário administrador do CRM (mesma conferência de painel_definir_pin).
// O aviso de pagamento (cora-webhook) só serve de gatilho: o status é sempre lido de volta na Cora.
// deno-lint-ignore-file no-explicit-any
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { chamarCora, type AmbienteCora } from "../_shared/cora.ts";

const TARIFA_MEMBRO_CENTAVOS = 496;
const DIAS_LEMBRETE = 3;
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const reais = (c: number) => "R$ " + (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (iso: string) => { const [a, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${a}`; };
const diaMes = (iso: string) => dataBR(iso).slice(0, 5);

async function ehAdmin(usuario: unknown, senhaHash: unknown): Promise<boolean> {
    if (!usuario || !senhaHash) return false;
    const { data } = await supabaseAdmin.from("usuarios_crm").select("id").eq("nome", String(usuario))
        .eq("senha_hash", String(senhaHash)).eq("eh_admin", true).eq("ativo", true).maybeSingle();
    return !!data;
}

// Escolas cobradas: ativas, com Módulo 2 contratado e que não são cobradas junto com outra (ex.: Jataí → Rio Verde).
async function escolasCobradas() {
    const { data: fs } = await supabaseAdmin.from("filiais")
        .select("id, nome, nome_com_preposicao, ativo, modulo2_contratado, filial_cobranca_id, membros, membros_mercurio, valor_fixo_mensal_agencia, cnpj_cobranca, email_cobranca");
    const todas = fs || [];
    return todas.filter((f: any) => f.ativo && f.modulo2_contratado !== false && !f.filial_cobranca_id).map((f: any) => {
        const agrupadas = todas.filter((g: any) => g.filial_cobranca_id === f.id && g.ativo).map((g: any) => g.nome);
        const membros = f.membros != null ? Number(f.membros) : (f.membros_mercurio != null ? Number(f.membros_mercurio) : null);
        const fixo = f.valor_fixo_mensal_agencia != null ? Math.round(Number(f.valor_fixo_mensal_agencia) * 100)
            : (membros != null ? membros * TARIFA_MEMBRO_CENTAVOS : null);
        return { ...f, agrupadas, membros_calc: membros, fixo_centavos: fixo, override: f.valor_fixo_mensal_agencia != null };
    });
}

function rotuloEscola(f: any): string {
    const base = String(f.nome).replace(/^Goiânia - /, "").replace(/\/MT$/, "");
    return f.agrupadas.length ? `${base} e ${f.agrupadas.map((n: string) => n.replace(/^Goiânia - /, "")).join(" e ")}` : base;
}

function mensagemCobranca(f: any, valor: number, rel: any, de: string, ate: string, pag: any): string {
    const linhas = [
        "Olá! Tudo bem?", "",
        `Chegou o período de faturamento do trabalho de contatos da Nova Acrópole ${rotuloEscola(f)}.`, "",
        "*Como é calculado*",
        f.override ? "O valor é o fixo mensal combinado com a escola."
            : "O valor é fixo, de acordo com o número de membros ativos da escola: R$ 4,96 por membro.",
    ];
    if (!f.override && f.membros_calc != null) linhas.push(`• ${f.membros_calc} membros × R$ 4,96`);
    linhas.push(`*Total: ${reais(valor)}*`);
    if (rel && Number(rel.contatados) >= 5) {
        const pct = rel.contatados ? Math.round((rel.responderam / rel.contatados) * 100) : 0;
        linhas.push("", `*Resumo do trabalho (${diaMes(de)} a ${diaMes(ate)})*`,
            `• ${rel.contatados} pessoas contatadas pelo WhatsApp`, `• ${rel.responderam} responderam (${pct}%)`);
        if (Number(rel.inscritos) > 0) linhas.push(`• ${rel.inscritos} se ${rel.inscritos === 1 ? "inscreveu" : "inscreveram"} em atividades da Nova Acrópole depois do contato`);
    }
    linhas.push("", "A cobrança das matrículas novas será enviada separadamente.");
    if (pag) {
        linhas.push("", `*Pagamento* (vencimento ${dataBR(pag.vencimento)})`);
        if (pag.pix_emv) linhas.push("Pix copia e cola:", pag.pix_emv);
        if (pag.boleto_url) linhas.push("", `Boleto: ${pag.boleto_url}`);
    }
    linhas.push("", "Qualquer dúvida, estou à disposição.");
    return linhas.join("\n");
}

function mensagemLembrete(c: any): string {
    const [ano, mes] = String(c.competencia).split("-");
    return [
        "Olá! Tudo bem?", "",
        `Passando para lembrar do pagamento do trabalho de contatos de ${MESES[Number(mes) - 1]}/${ano} (${reais(c.valor_centavos)}), com vencimento em ${dataBR(c.vencimento)}.`,
        "Se já foi pago, por favor desconsidere.", "",
        ...(c.pix_emv ? ["Pix copia e cola:", c.pix_emv, ""] : []),
        ...(c.boleto_url ? [`Boleto: ${c.boleto_url}`, ""] : []),
        "Obrigado!",
    ].join("\n");
}

async function relatorio(f: any, de: string, ate: string) {
    const { data } = await supabaseAdmin.rpc("cobranca_relatorio_contatos", { p_filiais: [f.nome, ...f.agrupadas], p_de: de, p_ate: ate });
    return data || null;
}

async function previa(corpo: any) {
    const escolas = await escolasCobradas();
    const itens = [];
    for (const f of escolas) {
        const rel = await relatorio(f, corpo.de, corpo.ate);
        const { data: ja } = await supabaseAdmin.from("cobrancas_cora").select("id, status, cora_invoice_id")
            .eq("filial", f.nome).eq("competencia", corpo.competencia).eq("tipo", "fixo").eq("ambiente", corpo.ambiente || "producao").maybeSingle();
        itens.push({
            filial: f.nome, rotulo: rotuloEscola(f), membros: f.membros_calc, valor_centavos: f.fixo_centavos, override: f.override,
            cnpj: f.cnpj_cobranca || null, relatorio: rel, ja_gerada: ja || null,
            mensagem: f.fixo_centavos != null ? mensagemCobranca(f, f.fixo_centavos, rel, corpo.de, corpo.ate, null) : null,
        });
    }
    return { itens };
}

const traduzStatus = (s: unknown) => { const t = String(s || "").toUpperCase(); return t === "CANCELED" ? "CANCELLED" : t; };

async function gerar(corpo: any, autor: string) {
    const amb: AmbienteCora = corpo.ambiente === "stage" ? "stage" : "producao";
    const escolas = new Map((await escolasCobradas()).map((f: any) => [f.nome, f]));
    const resultados = [];
    for (const it of corpo.itens || []) {
        const f: any = escolas.get(it.filial);
        const valor = Math.round(Number(it.valor_centavos));
        if (!f) { resultados.push({ filial: it.filial, erro: "Escola fora da cobrança." }); continue; }
        const doc = String(f.cnpj_cobranca || "").replace(/\D/g, "");
        if (doc.length !== 14 && doc.length !== 11) { resultados.push({ filial: f.nome, erro: "CNPJ da escola não cadastrado." }); continue; }
        if (!(valor >= 500)) { resultados.push({ filial: f.nome, erro: "Valor abaixo do mínimo da Cora (R$ 5,00)." }); continue; }
        // Linha antes da chamada: a Idempotency-Key fica guardada e um reenvio nunca duplica o boleto.
        let { data: linha } = await supabaseAdmin.from("cobrancas_cora").select("*")
            .eq("filial", f.nome).eq("competencia", corpo.competencia).eq("tipo", "fixo").eq("ambiente", amb).maybeSingle();
        if (linha?.cora_invoice_id && linha.status !== "CANCELLED") { resultados.push({ filial: f.nome, ja_existia: true, id: linha.id }); continue; }
        if (!linha || linha.status === "CANCELLED") {
            if (linha) await supabaseAdmin.from("cobrancas_cora").delete().eq("id", linha.id);
            const [ano, mes] = String(corpo.competencia).split("-");
            const ins = await supabaseAdmin.from("cobrancas_cora").insert({
                filial: f.nome, competencia: corpo.competencia, tipo: "fixo", ambiente: amb, valor_centavos: valor, vencimento: corpo.vencimento,
                descricao: `Trabalho de contatos - ${MESES[Number(mes) - 1]}/${ano}`, criado_por: autor,
            }).select("*").single();
            if (ins.error) { resultados.push({ filial: f.nome, erro: ins.error.message }); continue; }
            linha = ins.data;
        }
        const r = await chamarCora(amb, "/v2/invoices", {
            method: "POST", idempotencia: linha.idempotency_key,
            corpo: {
                code: `cobranca-${linha.id}`,
                customer: {
                    name: `Organização Nova Acrópole ${rotuloEscola(f)}`.slice(0, 60),
                    ...(f.email_cobranca ? { email: String(f.email_cobranca).slice(0, 60) } : {}),
                    document: { identity: doc, type: doc.length === 14 ? "CNPJ" : "CPF" },
                },
                services: [{ name: "Trabalho de contatos", description: linha.descricao.slice(0, 100), amount: valor }],
                payment_terms: { due_date: corpo.vencimento },
                payment_forms: ["BANK_SLIP", "PIX"],
            },
        });
        if (!r.ok) {
            const msg = typeof r.dados === "string" ? r.dados.slice(0, 300) : JSON.stringify(r.dados).slice(0, 300);
            await supabaseAdmin.from("cobrancas_cora").update({ status: "erro", erro: `${r.status}: ${msg}`, atualizado_em: new Date().toISOString() }).eq("id", linha.id);
            resultados.push({ filial: f.nome, erro: `Cora respondeu ${r.status}: ${msg}` });
            continue;
        }
        const d = r.dados || {};
        const pag = { vencimento: corpo.vencimento, pix_emv: d.pix?.emv || null, boleto_url: d.payment_options?.bank_slip?.url || null };
        const rel = await relatorio(f, corpo.de, corpo.ate);
        const atual = {
            cora_invoice_id: d.id, status: traduzStatus(d.status) || "OPEN", erro: null,
            linha_digitavel: d.payment_options?.bank_slip?.digitable || null, boleto_url: pag.boleto_url, pix_emv: pag.pix_emv,
            mensagem: mensagemCobranca(f, valor, rel, corpo.de, corpo.ate, pag), atualizado_em: new Date().toISOString(),
        };
        await supabaseAdmin.from("cobrancas_cora").update({ ...atual, mensagem_lembrete: mensagemLembrete({ ...linha, ...atual }) }).eq("id", linha.id);
        resultados.push({ filial: f.nome, id: linha.id, invoice: d.id });
    }
    await supabaseAdmin.from("log_atividade").insert({ filial: "GLOBAL", acao: "cobranca_cora_gerada", autor, detalhes: { competencia: corpo.competencia, ambiente: amb, resultados } });
    return { resultados };
}

// Atualiza pela Cora o status das cobranças ainda não pagas (ou só uma, pelo id da fatura).
async function consultar(invoiceId?: string) {
    let q = supabaseAdmin.from("cobrancas_cora").select("*").not("cora_invoice_id", "is", null);
    q = invoiceId ? q.eq("cora_invoice_id", invoiceId) : q.in("status", ["OPEN", "LATE", "IN_PAYMENT", "INITIATED"]);
    const { data: linhas } = await q;
    const mudancas = [];
    for (const c of linhas || []) {
        const r = await chamarCora(c.ambiente, `/v2/invoices/${c.cora_invoice_id}`);
        if (!r.ok) { mudancas.push({ id: c.id, erro: r.status }); continue; }
        const st = traduzStatus(r.dados?.status);
        if (!st || st === c.status) continue;
        const pago = st === "PAID";
        const pagamento = (r.dados?.payments || []).find((p: any) => p.finalized_at) || null;
        await supabaseAdmin.from("cobrancas_cora").update({
            status: st, atualizado_em: new Date().toISOString(),
            ...(pago ? { pago_em: pagamento?.finalized_at || new Date().toISOString(), valor_pago_centavos: Number(r.dados?.total_paid) || c.valor_centavos } : {}),
        }).eq("id", c.id);
        mudancas.push({ id: c.id, filial: c.filial, de: c.status, para: st });
        if (pago) {
            await supabaseAdmin.from("log_atividade").insert({ filial: c.filial, acao: "cobranca_cora_paga", autor: "Cora", detalhes: { id: c.id, competencia: c.competencia, valor: r.dados?.total_paid } });
            await avisarAdmin(`✅ Pagamento recebido pela Cora: ${String(c.filial).replace(/^Goiânia - /, "")} — ${reais(Number(r.dados?.total_paid) || c.valor_centavos)} (${c.competencia}).`);
        }
    }
    return mudancas;
}

async function avisarAdmin(texto: string) {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/lembrete-scraper`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ texto }),
    }).catch(() => {});
}

// Lembrete: 3 dias depois do envio ao diretor (ou da geração, se o envio não foi marcado), ainda sem pagamento.
// O WhatsApp de cada diretor não tem modelo de cobrança aprovado na Meta: o CRM marca o lembrete como
// pendente, deixa o texto pronto na tela e avisa o administrador para enviar.
async function lembretes() {
    const limite = new Date(Date.now() - DIAS_LEMBRETE * 864e5).toISOString();
    const { data } = await supabaseAdmin.from("cobrancas_cora").select("*").eq("ambiente", "producao")
        .in("status", ["OPEN", "LATE"]).is("lembrete_em", null);
    const devidos = (data || []).filter((c: any) => (c.enviada_em || c.criado_em) <= limite);
    if (!devidos.length) return [];
    await supabaseAdmin.from("cobrancas_cora").update({ lembrete_em: new Date().toISOString() }).in("id", devidos.map((c: any) => c.id));
    await avisarAdmin(`🔔 Cobranças sem pagamento há ${DIAS_LEMBRETE} dias:\n` +
        devidos.map((c: any) => `• ${String(c.filial).replace(/^Goiânia - /, "")} — ${reais(c.valor_centavos)}`).join("\n") +
        "\nO lembrete de cada escola está pronto no CRM (Relatórios > Cobranças Cora).");
    return devidos.map((c: any) => c.filial);
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    let corpo: any = {};
    try { corpo = await req.json(); } catch { /* vazio */ }
    try {
        const interno = !!Deno.env.get("FUNIL_ANALISE_TOKEN") && req.headers.get("x-funil-token") === Deno.env.get("FUNIL_ANALISE_TOKEN");
        if (corpo.acao === "rotina") {
            if (!interno) return json({ ok: false, erro: "Não autorizado" }, 401);
            return json({ ok: true, mudancas: await consultar(), lembretes: await lembretes() });
        }
        if (corpo.acao === "consultar") {
            const inv = /^inv_[A-Za-z0-9_-]{4,80}$/.test(String(corpo.invoice_id || "")) ? String(corpo.invoice_id) : undefined;
            return json({ ok: true, mudancas: await consultar(inv) });
        }
        if (!interno && !(await ehAdmin(corpo.usuario, corpo.senha_hash))) return json({ ok: false, erro: "Usuário ou senha incorretos, ou sem permissão de administrador." }, 403);
        const autor = String(corpo.usuario || "Sistema");
        if (corpo.acao === "previa") return json({ ok: true, ...(await previa(corpo)) });
        if (corpo.acao === "gerar") return json({ ok: true, ...(await gerar(corpo, autor)) });
        if (corpo.acao === "marcar_enviada") {
            await supabaseAdmin.from("cobrancas_cora").update({ enviada_em: new Date().toISOString() }).eq("id", corpo.id).is("enviada_em", null);
            return json({ ok: true });
        }
        if (corpo.acao === "cancelar") {
            const { data: c } = await supabaseAdmin.from("cobrancas_cora").select("*").eq("id", corpo.id).maybeSingle();
            if (!c?.cora_invoice_id) return json({ ok: false, erro: "Cobrança não encontrada." }, 404);
            const r = await chamarCora(c.ambiente, `/v2/invoices/${c.cora_invoice_id}`, { method: "DELETE" });
            if (!r.ok) return json({ ok: false, erro: `Cora respondeu ${r.status}` }, 502);
            await supabaseAdmin.from("cobrancas_cora").update({ status: "CANCELLED", atualizado_em: new Date().toISOString() }).eq("id", c.id);
            await supabaseAdmin.from("log_atividade").insert({ filial: c.filial, acao: "cobranca_cora_cancelada", autor, detalhes: { id: c.id } });
            return json({ ok: true });
        }
        if (corpo.acao === "registrar_webhook") {
            const amb: AmbienteCora = corpo.ambiente === "stage" ? "stage" : "producao";
            const r = await chamarCora(amb, "/endpoints/", {
                method: "POST", idempotencia: crypto.randomUUID(),
                corpo: { url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/cora-webhook`, resource: "invoice", trigger: "*" },
            });
            return json({ ok: r.ok, status: r.status, dados: r.dados });
        }
        return json({ ok: false, erro: "Ação desconhecida." }, 400);
    } catch (e) {
        console.error(e);
        return json({ ok: false, erro: String((e as Error).message || e) }, 500);
    }
});

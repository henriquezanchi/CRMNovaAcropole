// Edge Function: Resumo Diário pro WhatsApp do admin — pedido do usuário
// (2026-10-08): "quero que manda uma mensagem para o meu telefone, a
// partir do crm, dando um resumo das mensagens (se o ulisses rodou, se
// o mercúrio rodou, se alguém mandou mensagem, se tem janela fechando,
// etc) um pequeno relatório do que tem pra ser feito no dia, com foco
// no que não pode ser adiado".
//
// 5 sinais, todos lidos direto de tabelas/views já existentes — nenhuma
// RPC/migração de schema nova precisou existir:
//   1. status_sincronizacao_automatica — Mercúrio/Ulisses rodaram hoje?
//   2. mensagens_whatsapp — quantas mensagens novas nas últimas 24h.
//   3. vw_wpp_conversas — mesma lógica de verificarNotificacoesJanelaFechando()
//      (js/notificacoes.js), replicada aqui em SQL/JS server-side.
//   4. sugestoes_resposta_wpp — quantas sugestões da IA aguardam aprovação
//      (contagem GLOBAL, todas as filiais — não existia ainda).
//   5. eventos (data = hoje) + leads_inscricoes.lembrete_em (vencido/hoje)
//      — "o que não pode esperar", cross-filial.
//
// Envio: chama lembrete-scraper servidor-a-servidor (mesmo padrão já
// usado por resumo-semanal-chefe → whatsapp-notificar-chefe-filial) —
// reaproveita 100% a lógica de Graph API/número do admin já existente.
//
// `modoPreview` (mesmo padrão de resumo-semanal-chefe): devolve o texto
// montado sem mandar nada, só pra teste/depuração.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin, NOME_TABELA_LEADS } from "../_shared/supabaseAdmin.ts";

const HORAS_AVISO_JANELA_FECHANDO = 4; // mesmo limiar de js/notificacoes.js
const LIMITE_NOMES_JANELA = 8;
const LIMITE_EVENTOS_HOJE = 10;
const LIMITE_LEMBRETES = 10;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function hojeISOBrasilia(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function horaBrasilia(iso: string | null): string {
    if (!iso) return "?";
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

// Mesma técnica já usada em js/notificacoes.js (verificarNotificacoesSincronizacao):
// busca as últimas N linhas (já ordenadas, mais recente primeiro) e pega
// só a 1ª ocorrência de cada `sistema` — equivalente a um "distinct on"
// sem precisar de SQL cru/RPC nova.
async function buscarStatusSincronizacao(): Promise<{ linhaMercurio: string; linhaUlisses: string }> {
    const { data } = await supabaseAdmin
        .from("status_sincronizacao_automatica")
        .select("sistema, filial, sucesso, mensagem, executado_em")
        .order("executado_em", { ascending: false })
        .limit(50);
    const maisRecentePorSistema = new Map<string, any>();
    (data || []).forEach((row: any) => { if (!maisRecentePorSistema.has(row.sistema)) maisRecentePorSistema.set(row.sistema, row); });
    const hoje = hojeISOBrasilia();

    function montarLinha(nome: string, sistema: string): string {
        const row = maisRecentePorSistema.get(sistema);
        if (!row) return `⚠️ ${nome}: nunca rodou ainda.`;
        const diaRow = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(row.executado_em));
        const rodouHoje = diaRow === hoje;
        if (!rodouHoje) return `⚠️ ${nome}: ainda não rodou hoje (última vez: ${diaRow}).`;
        if (!row.sucesso) return `⚠️ ${nome}: rodou às ${horaBrasilia(row.executado_em)}, mas FALHOU — ${row.mensagem || "sem detalhe"}`;
        return `✅ ${nome}: rodou às ${horaBrasilia(row.executado_em)} (sucesso).`;
    }

    // O scraper antigo ("mercurio") foi desligado: o Mercúrio agora chega pelo
    // banco de consulta (ativos, turmas) e pela API do Mercury (inativos).
    return {
        linhaMercurio: `${montarLinha("Mercúrio (banco)", "mercurio_db")}
Mercury (inativos): pausada desde 29/10`,
        linhaUlisses: montarLinha("Ulisses", "ulisses"),
    };
}

async function contarMensagensNovas(): Promise<number> {
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
        .from("mensagens_whatsapp")
        .select("id", { count: "exact", head: true })
        .eq("direcao", "entrada")
        .gt("criado_em", desde);
    return count || 0;
}

// Mesma lógica EXATA de verificarNotificacoesJanelaFechando() (js/notificacoes.js)
// — só quem ainda está dentro da janela (restante entre 0 e 4h), nunca
// quem já fechou nem quem ainda tem folga de sobra.
async function buscarJanelasFechando(): Promise<{ total: number; nomes: string[] }> {
    const { data } = await supabaseAdmin
        .from("vw_wpp_conversas")
        .select('"pessoaIdentificador", ultima_mensagem_em')
        .eq("ultima_direcao", "entrada");
    const agora = Date.now();
    const fechando = (data || []).filter((c: any) => {
        const horasPassadas = (agora - new Date(c.ultima_mensagem_em).getTime()) / 3600000;
        const restante = 24 - horasPassadas;
        return restante > 0 && restante <= HORAS_AVISO_JANELA_FECHANDO;
    });
    if (fechando.length === 0) return { total: 0, nomes: [] };

    const ids = fechando.slice(0, LIMITE_NOMES_JANELA).map((c: any) => c.pessoaIdentificador);
    const { data: leads } = await supabaseAdmin.from(NOME_TABELA_LEADS).select('"pessoaIdentificador", "pessoaNome"').in('"pessoaIdentificador"', ids);
    const mapaNomes = new Map((leads || []).map((l: any) => [String(l.pessoaIdentificador), l.pessoaNome]));
    const nomes = ids.map((id: string) => mapaNomes.get(String(id)) || `lead #${id}`);
    return { total: fechando.length, nomes };
}

// Situação da conta do WhatsApp na Meta (gravada a cada 30 min por
// whatsapp-saude-conta).
async function buscarSaudeContaWpp(): Promise<string> {
    const { data } = await supabaseAdmin
        .from("whatsapp_saude_conta")
        .select("phone_number_id, numero, nome, ok, problema, quality_rating, verificado_em")
        .order("verificado_em", { ascending: false })
        .limit(20);
    if (!data || data.length === 0) return "❔ Conta do WhatsApp: ainda sem verificação.";
    const maisRecente = new Map<string, any>();
    data.forEach((l: any) => { if (!maisRecente.has(l.phone_number_id)) maisRecente.set(l.phone_number_id, l); });
    const qualidades: Record<string, string> = { GREEN: "alta", YELLOW: "média", RED: "baixa" };
    return [...maisRecente.values()].map((l: any) => {
        const rotulo = l.numero || l.nome || "número";
        if (!l.ok) return `🚨 Conta do WhatsApp ${rotulo}: ${l.problema}`;
        return `✅ Conta do WhatsApp ${rotulo}: conectada, qualidade ${qualidades[l.quality_rating] || "sem avaliação"}`;
    }).join("\n");
}

async function contarSugestoesPendentes(): Promise<number> {
    const { count } = await supabaseAdmin.from("sugestoes_resposta_wpp").select("id", { count: "exact", head: true }).eq("status", "pendente");
    return count || 0;
}

async function buscarNaoPodeEsperarHoje(): Promise<string[]> {
    const hoje = hojeISOBrasilia();
    const linhas: string[] = [];

    const { data: eventos } = await supabaseAdmin
        .from("eventos")
        .select("nome, hora, filial")
        .eq("ativo", true)
        .eq("data", hoje)
        .order("hora", { ascending: true })
        .limit(LIMITE_EVENTOS_HOJE);
    (eventos || []).forEach((e: any) => {
        const horaTxt = e.hora ? ` às ${String(e.hora).slice(0, 5)}` : "";
        linhas.push(`📅 Evento hoje${horaTxt}: "${e.nome}" (${e.filial || "?"})`);
    });

    const { data: lembretes } = await supabaseAdmin
        .from(NOME_TABELA_LEADS)
        .select('"pessoaNome", lembrete_em, lembrete_nota, filial')
        .lte("lembrete_em", hoje)
        .not("lembrete_em", "is", null)
        .order("lembrete_em", { ascending: true })
        .limit(LIMITE_LEMBRETES);
    (lembretes || []).forEach((l: any) => {
        const notaTxt = l.lembrete_nota ? ` — "${l.lembrete_nota}"` : "";
        linhas.push(`⏰ Lembrete${l.lembrete_em < hoje ? " ATRASADO" : ""}: ${l.pessoaNome || "Lead"} (${l.filial || "?"})${notaTxt}`);
    });

    return linhas;
}

function montarTexto(dadosSync: { linhaMercurio: string; linhaUlisses: string }, saudeConta: string, mensagensNovas: number, janelas: { total: number; nomes: string[] }, sugestoesPendentes: number, naoPodeEsperar: string[]): string {
    const dataFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date());

    const linhaJanela = janelas.total === 0
        ? "⏰ Nenhuma conversa com janela fechando agora."
        : `⏰ ${janelas.total} conversa(s) com janela fechando em até ${HORAS_AVISO_JANELA_FECHANDO}h: ${janelas.nomes.join(", ")}${janelas.total > janelas.nomes.length ? "..." : ""}`;

    const blocoNaoPodeEsperar = naoPodeEsperar.length > 0
        ? naoPodeEsperar.join("\n")
        : "Nada marcado pra hoje (eventos/lembretes).";

    const blocoComando = sugestoesPendentes > 0
        ? `\n\nResponda *SIM* pra eu enviar as ${sugestoesPendentes} sugestão(ões) de resposta já pronta(s).`
        : "";

    return `📋 *Resumo do dia — ${dataFmt}*\n\n` +
        `🔄 *Sincronização*\n${dadosSync.linhaMercurio}\n${dadosSync.linhaUlisses}\n\n` +
        `💬 *WhatsApp*\n${saudeConta}\n📩 ${mensagensNovas} mensagem(ns) nova(s) nas últimas 24h\n${linhaJanela}\n🤖 ${sugestoesPendentes} sugestão(ões) de resposta da IA aguardando aprovação\n\n` +
        `📌 *Hoje não pode esperar*\n${blocoNaoPodeEsperar}` +
        blocoComando;
}

async function enviarParaAdmin(texto: string) {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/lembrete-scraper`;
    const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ texto }),
    });
    return resp.json();
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    let corpoReq: { modoPreview?: boolean };
    try {
        corpoReq = await req.json().catch(() => ({}));
    } catch {
        corpoReq = {};
    }

    try {
        const [dadosSync, saudeConta, mensagensNovas, janelas, sugestoesPendentes, naoPodeEsperar] = await Promise.all([
            buscarStatusSincronizacao(),
            buscarSaudeContaWpp(),
            contarMensagensNovas(),
            buscarJanelasFechando(),
            contarSugestoesPendentes(),
            buscarNaoPodeEsperarHoje(),
        ]);
        const texto = montarTexto(dadosSync, saudeConta, mensagensNovas, janelas, sugestoesPendentes, naoPodeEsperar);

        if (corpoReq.modoPreview) {
            return json({ ok: true, texto, dados: { dadosSync, saudeConta, mensagensNovas, janelas, sugestoesPendentes, naoPodeEsperar } });
        }

        const resultadoEnvio = await enviarParaAdmin(texto);
        return json({ ok: true, texto, resultadoEnvio });
    } catch (e) {
        return json({ ok: false, erro: "falha_montar_resumo", detalhe: String(e instanceof Error ? e.message : e) }, 500);
    }
});

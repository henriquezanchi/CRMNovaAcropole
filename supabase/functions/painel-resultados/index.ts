// Edge Function: painel-resultados — dados do painel para dirigentes
// (resultados.html). Acesso por link com chave aleatória de 256 bits no
// fragmento da URL; aqui só o hash é comparado. O escopo (escolas e campanhas)
// vem do registro do link, nunca do visitante.
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { hashChaveEscola } from "../_shared/painel-escola.ts";

const ORIGENS = ["https://crm-nova-acropole.vercel.app", "https://crm-nova-acropole-5dv3.vercel.app", "http://127.0.0.1:5500", "http://localhost:8766"];

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

Deno.serve(async (req) => {
    const origem = req.headers.get("Origin");
    const h = cabecalhos(origem);
    const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: h });
    if (origem && !ORIGENS.includes(origem)) return responder({ erro: "Origem não permitida." }, 403);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (req.method !== "POST") return responder({ erro: "Use o link de acompanhamento." }, 405);
    const texto = await req.text();
    if (texto.length > 2048) return responder({ erro: "Consulta muito longa." }, 413);
    let corpo: any;
    try { corpo = JSON.parse(texto); } catch { return responder({ erro: "Consulta inválida." }, 400); }
    if (typeof corpo?.chave !== "string" || !/^[a-f0-9]{64}$/.test(corpo.chave)) return responder({ erro: "Link inválido." }, 400);
    const dias = [7, 30, 90, 0].includes(Number(corpo.dias)) ? Number(corpo.dias) : 30;

    const hash = await hashChaveEscola(corpo.chave);
    const { data: link } = await supabaseAdmin.from("painel_resultados_links")
        .select("id, rotulo, filiais, campanhas, expira_em, revogado_em").eq("chave_hash", hash).maybeSingle();
    if (!link || link.revogado_em || new Date(link.expira_em) < new Date()) {
        return responder({ erro: "Este link expirou, foi revogado ou não é válido. Peça um novo acesso à equipe." }, 401);
    }
    await supabaseAdmin.from("painel_resultados_links").update({ ultimo_acesso_em: new Date().toISOString() }).eq("id", link.id);

    // Os números vêm do cache (painel_resultados_cache), recalculado por um job
    // do pg_cron a cada minuto. Nunca calcular aqui: a consulta é pesada e,
    // quando a página desiste, continua rodando no banco (travou o servidor
    // em 04/11/2026). Aqui só se registra o pedido e se lê o último resultado.
    const filiaisOrd = link.filiais ? [...link.filiais].sort() : null;
    const chaveEscolas = `escolas:${filiaisOrd ? filiaisOrd.join("|") : "todas"}:${dias}`;
    const pedidos = [
        { chave: chaveEscolas, tipo: "escolas", filiais: filiaisOrd, dias, slug: null },
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
        if (!escolasLinha?.dados) {
            return responder({ preparando: true, mensagem: "Os números estão sendo preparados. A página atualiza sozinha em instantes." });
        }
        const campanhas = (link.campanhas || []).map((slug: string) => ({ data: (porChave.get(`campanha:${slug}`) as any)?.dados || null }));
        const geradoEm = [escolasLinha.gerado_em, ...(link.campanhas || []).map((s: string) => (porChave.get(`campanha:${s}`) as any)?.gerado_em)]
            .filter(Boolean).sort()[0];
        // Link restrito a escolas: a lista da campanha só mostra pessoas dessas escolas.
        const campanhasDados = campanhas.map((r: any) => {
            const d = r.data;
            if (!d || !link.filiais) return d;
            const permitida = (e: string) => link.filiais.includes(e);
            return { ...d, contatados: (d.contatados || []).filter((x: any) => permitida(x.escola)),
                inscritos: (d.inscritos || []).filter((x: any) => permitida(x.escola)),
                por_escola: (d.por_escola || []).filter((x: any) => permitida(x.escola)) };
        });
        return responder({ rotulo: link.rotulo, dias, gerado_em: geradoEm, escolas: escolasLinha.dados, campanhas: campanhasDados.filter(Boolean) });
    } catch (e) {
        console.error(e);
        return responder({ erro: "Não foi possível consultar agora. Tente de novo em instantes." }, 503);
    }
});

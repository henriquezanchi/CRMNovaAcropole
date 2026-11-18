// Desativa contatos no Ulisses ("Não Perturbe") a partir de fila_desativacao_ulisses (18/11/2026).
// Mesma ação do link "Desativar contato" da tela de telemarketing do Ulisses: POST /facade/naoPertube/{emailId}
// (EmailService.naoPertube: desativado = true, motivo = "Não Pertube"). emailId = código do contato no Ulisses,
// o mesmo pessoaIdentificador real do CRM (gravado em fila_desativacao_ulisses.ulisses_email_id).
// Antes a fila só era processada pelo ulisses-local.js (navegador na máquina do usuário) e ficava parada.
// Só o token interno (x-funil-token) aciona. Corpo opcional: { fila_ids: [..] }.
// deno-lint-ignore-file no-explicit-any
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { chamarUlisses } from "../_shared/ulisses.ts";

const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
    const tokenInterno = Deno.env.get("FUNIL_ANALISE_TOKEN");
    if (!tokenInterno || req.headers.get("x-funil-token") !== tokenInterno) return new Response("Não autorizado", { status: 401 });
    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);
    const corpo = await req.json().catch(() => ({}));

    let q = supabaseAdmin.from("fila_desativacao_ulisses").select("id, nome, ulisses_email_id")
        .eq("status", "pendente").not("ulisses_email_id", "is", null).order("id").limit(50);
    if (Array.isArray(corpo.fila_ids) && corpo.fila_ids.length) q = q.in("id", corpo.fila_ids);
    const { data: itens, error } = await q;
    if (error) return json({ ok: false, erro: error.message }, 500);

    const resultados: any[] = [];
    for (const it of itens || []) {
        let status = "concluida", observacao = "Desativado no Ulisses (Não Perturbe) pela API.";
        try {
            await chamarUlisses(supabaseAdmin, `/facade/naoPertube/${Number(it.ulisses_email_id)}`, { method: "POST" });
        } catch (e) {
            status = "falha"; observacao = String((e as Error).message || e).slice(0, 300);
        }
        await supabaseAdmin.from("fila_desativacao_ulisses")
            .update({ status, observacao, processado_em: new Date().toISOString() }).eq("id", it.id);
        resultados.push({ id: it.id, nome: it.nome, status, observacao });
        await new Promise((r) => setTimeout(r, 400));
    }
    return json({ ok: true, processados: resultados.length, resultados });
});

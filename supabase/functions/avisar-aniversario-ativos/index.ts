// Avisa o chefe de cada filial (filiais.whatsapp_chefe_numero) quando um
// ALUNO ATIVO faz aniversário hoje. Antes rodava dentro do scraper antigo do
// Mercúrio (verificarAniversariosAtivosHoje, às 5h); veio pra cá quando o
// scraper foi desligado. Cron às 08:00 Brasília — horário razoável pra uma
// mensagem chegar no celular de alguém.
// "Aluno ativo" = está em mercurio_alunos com ativo=true (banco do Mercúrio).
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    let corpo: any = {};
    try { corpo = await req.json(); } catch { /* vazio */ }

    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const mmdd = hoje.slice(5);
    const { data: aniversariantes, error } = await supabaseAdmin.rpc("aniversariantes_por_mes", { p_mes: Number(hoje.slice(5, 7)) }).range(0, 4999);
    if (error) return json({ ok: false, erro: error.message }, 500);
    const deHoje = (aniversariantes || []).filter((a: any) => String(a.data_nascimento || "").slice(5) === mmdd);
    if (deHoje.length === 0) return json({ ok: true, enviados: 0 });

    const { data: ativos } = await supabaseAdmin.from("mercurio_alunos")
        .select("pessoa_identificador").eq("ativo", true).in("pessoa_identificador", deHoje.map((a: any) => a.pessoaIdentificador));
    const idsAtivos = new Set((ativos || []).map((a: any) => a.pessoa_identificador));
    const alvos = deHoje.filter((a: any) => idsAtivos.has(a.pessoaIdentificador));

    if (corpo.modoPreview) return json({ ok: true, preview: alvos.map((a: any) => `${a.pessoaNome} (${a.filial})`) });

    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-notificar-chefe-filial`;
    let enviados = 0;
    const falhas: string[] = [];
    for (const a of alvos) {
        const texto = `🎂 Hoje é aniversário do(a) aluno(a) *${a.pessoaNome}*! Que tal mandar um parabéns?`;
        try {
            const r = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
                body: JSON.stringify({ filial: a.filial, texto }),
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.ok !== false) enviados++; else falhas.push(`${a.pessoaNome}: ${d.erro || r.status}`);
        } catch (e) { falhas.push(`${a.pessoaNome}: ${(e as Error).message}`); }
        await new Promise((res) => setTimeout(res, 1500)); // nunca em rajada (política da Meta)
    }
    return json({ ok: true, enviados, falhas });
});

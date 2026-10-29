// Parabéns automático no dia do aniversário (pedido do usuário, 2026-10-29:
// "aniversário automático vai pra todo mundo, somente no seu dia"). Manda o
// modelo aprovado `aniversario` pra QUALQUER lead (aluno, ex-aluno ou
// interessado) que faz aniversário hoje, sem perguntar a ninguém. Cron às
// 09:00 Brasília (migracao_agendamento_parabens_aniversario.sql).
//
// Não é campanha: passa origemEnvio "aniversario", e o whatsapp-send só
// bloqueia quem pediu para não ser contatado (não exige preferência de
// contato registrada, como os disparos de convite). Nunca manda 2x pra mesma
// pessoa no mesmo dia (confere o que já saiu hoje) nem 2x pro mesmo telefone
// (cadastro repetido em duas filiais). Envio em série, com pausa.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const ATENDENTE = "a equipe";
const PAUSA_MS = 1500;
// Mesmo texto aprovado na Meta (TEMPLATES_WHATSAPP, js/whatsapp.js) — só
// pra mostrar no histórico do CRM o que a pessoa recebeu.
const CORPO_ANIVERSARIO = 'Olá {{1}}!\nAqui é {{2}} da Nova Acrópole {{3}}, e estou entrando em contato para lhe desejar um feliz aniversário!\n\nDesejo, em nome da nossa escola, que você tenha um dia maravilhoso, repleto de reflexões, em que seja possível recolher os melhores frutos das experiências do ano que passou, e convertê-las em sementes para semear o ano que se inicia, com muita vontade, amor e inteligência.\n\num grande abraço!';

function primeiroNome(nome: string): string {
    const p = String(nome || "").trim().split(/\s+/)[0] || "";
    return p ? p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1).toLocaleLowerCase("pt-BR") : "";
}
function chaveTelefone(ddd: string, numero: string): string {
    const n = String(numero || "").replace(/\D/g, "");
    return `${String(ddd || "").replace(/\D/g, "")}:${n.length === 9 ? n.slice(1) : n}`;
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    let corpo: any = {};
    try { corpo = await req.json(); } catch { /* vazio */ }

    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const mmdd = hoje.slice(5);
    const { data: doMes, error } = await supabaseAdmin.rpc("aniversariantes_por_mes", { p_mes: Number(hoje.slice(5, 7)) }).range(0, 9999);
    if (error) return json({ ok: false, erro: error.message }, 500);
    const ids = (doMes || []).filter((a: any) => String(a.data_nascimento || "").slice(5) === mmdd).map((a: any) => String(a.pessoaIdentificador));
    if (ids.length === 0) return json({ ok: true, enviados: 0, aniversariantes: 0 });

    const [{ data: leads }, { data: filiais }] = await Promise.all([
        supabaseAdmin.from("leads_inscricoes")
            .select('"pessoaIdentificador", "pessoaNome", como_prefere_ser_chamado, filial, "pessoaTelefoneDDD", "pessoaTelefoneNumero", lixeira_em')
            .in("pessoaIdentificador", ids),
        supabaseAdmin.from("filiais").select("nome, nome_com_preposicao").eq("ativo", true),
    ]);
    const preposicao = new Map((filiais || []).map((f: any) => [f.nome, f.nome_com_preposicao || `de ${f.nome}`]));

    // Quem já recebeu parabéns hoje (rodada anterior, ou envio manual pelo botão).
    const inicioDia = new Date(`${hoje}T00:00:00-03:00`).toISOString();
    const { data: jaEnviados } = await supabaseAdmin.from("mensagens_whatsapp")
        .select('"pessoaIdentificador", telefone_whatsapp, wa_status, payload_bruto')
        .eq("direcao", "saida").gte("criado_em", inicioDia).in("pessoaIdentificador", ids);
    const pessoasJa = new Set((jaEnviados || [])
        .filter((m: any) => m.payload_bruto?.template_nome === "aniversario" && m.wa_status !== "falhou")
        .map((m: any) => String(m.pessoaIdentificador)));

    const telefonesUsados = new Set<string>();
    const alvos: any[] = [];
    const pulados: string[] = [];
    for (const l of leads || []) {
        if (l.lixeira_em || !preposicao.has(l.filial)) continue;
        if (!String(l.pessoaTelefoneNumero || "").trim()) { pulados.push(`${l.pessoaNome}: sem telefone`); continue; }
        if (pessoasJa.has(String(l.pessoaIdentificador))) { pulados.push(`${l.pessoaNome}: já recebeu hoje`); continue; }
        const tel = chaveTelefone(l.pessoaTelefoneDDD, l.pessoaTelefoneNumero);
        if (telefonesUsados.has(tel)) { pulados.push(`${l.pessoaNome}: mesmo telefone de outro cadastro`); continue; }
        telefonesUsados.add(tel);
        alvos.push(l);
    }

    const montar = (l: any) => {
        const nome = String(l.como_prefere_ser_chamado || "").trim() || primeiroNome(l.pessoaNome);
        return [nome, ATENDENTE, preposicao.get(l.filial)];
    };
    if (corpo.modoPreview) {
        return json({ ok: true, aniversariantes: ids.length, alvos: alvos.map((l) => ({ nome: l.pessoaNome, filial: l.filial, params: montar(l) })), pulados });
    }

    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`;
    let enviados = 0;
    const falhas: string[] = [];
    for (let i = 0; i < alvos.length; i++) {
        const l = alvos[i];
        const params = montar(l);
        const preview = params.reduce((t, v, j) => t.replaceAll(`{{${j + 1}}}`, String(v)), CORPO_ANIVERSARIO);
        try {
            const r = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
                body: JSON.stringify({
                    pessoaIdentificador: l.pessoaIdentificador, tipo: "template", templateNome: "aniversario", templateIdioma: "pt_BR",
                    templateParams: params, templatePreview: preview, atendenteNome: "Parabéns automático", origemEnvio: "aniversario",
                }),
            });
            const d = await r.json().catch(() => ({}));
            if (d.ok) enviados++;
            else falhas.push(`${l.pessoaNome}: ${d.detalhe?.message || d.erro || r.status}`);
        } catch (e) { falhas.push(`${l.pessoaNome}: ${(e as Error).message}`); }
        if (i < alvos.length - 1) await new Promise((res) => setTimeout(res, PAUSA_MS));
    }

    await supabaseAdmin.from("log_atividade").insert({
        filial: "GLOBAL", acao: "parabens_aniversario_automatico", autor: "Parabéns automático",
        pessoa_ids: alvos.map((l) => String(l.pessoaIdentificador)),
        detalhes: { dia: hoje, aniversariantes: ids.length, enviados, falhas, pulados },
    });
    return json({ ok: true, aniversariantes: ids.length, enviados, falhas, pulados });
});

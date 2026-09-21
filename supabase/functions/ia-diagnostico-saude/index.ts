// Edge Function: "Diagnóstico de Saúde (IA)" — pedido do usuário
// (2026-09-21): avaliar a situação das filiais e detectar erro de
// importação/sincronização ANTES do usuário esbarrar no problema.
//
// Princípio seguido à risca (mesmo do resto do projeto — CLAUDE.md,
// "nunca inventar seletor/dado sem evidência real"): a DETECÇÃO é 100%
// determinística — contagens e limiares fixos calculados aqui em cima
// de dados reais do banco. A Anthropic API só é usada pra ESCREVER, em
// português natural, o resumo + a ação sugerida de cada problema já
// detectado — nunca pra decidir o nível de severidade nem inventar
// número novo. O `nivel`/`filial` que a IA devolver é sempre IGNORADO;
// só o `resumo`/`acao_sugerida` (texto) é aproveitado, e sempre
// re-anexado ao sinal original antes de gravar.
//
// Chamada sob demanda (botão "Analisar Agora", js/visao-geral.js) e
// automaticamente 1x/dia (fim de scraper/mercurio.js `main()`, via
// `supabaseAdmin.functions.invoke(...)`, mesmo padrão já usado pra
// `whatsapp-notificar-chefe-filial`/`lembrete-scraper`).
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODELO = "claude-haiku-4-5-20251001";

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function diasDesde(dataISO: string | null | undefined): number | null {
    if (!dataISO) return null;
    const diff = Date.now() - new Date(dataISO).getTime();
    return Math.floor(diff / 86400000);
}

// -------------------------------------------------------------
// 1. Coleta de sinais brutos (só leitura, sem nenhuma interpretação) —
//    cada função devolve fatos, não opiniões.
// -------------------------------------------------------------

async function coletarSinaisSincronizacao() {
    const sinais: Record<string, unknown> = {};
    for (const sistema of ["mercurio", "ulisses"] as const) {
        const { data: ultima } = await supabaseAdmin
            .from("status_sincronizacao_automatica")
            .select("sucesso, mensagem, executado_em")
            .eq("sistema", sistema)
            .order("executado_em", { ascending: false })
            .limit(1)
            .maybeSingle();
        const { data: ultimaOk } = await supabaseAdmin
            .from("status_sincronizacao_automatica")
            .select("executado_em")
            .eq("sistema", sistema)
            .eq("sucesso", true)
            .order("executado_em", { ascending: false })
            .limit(1)
            .maybeSingle();
        sinais[sistema] = {
            ultima_tentativa_em: ultima?.executado_em ?? null,
            ultima_tentativa_sucesso: ultima?.sucesso ?? null,
            ultima_tentativa_mensagem: ultima?.mensagem ?? null,
            dias_desde_ultima_tentativa: diasDesde(ultima?.executado_em ?? null),
            dias_desde_ultimo_sucesso: diasDesde(ultimaOk?.executado_em ?? null),
        };
    }
    return sinais;
}

async function coletarSinaisPorFilial(filiaisAtivas: string[]) {
    const porFilial: Record<string, any> = {};
    filiaisAtivas.forEach((f) => { porFilial[f] = { filial: f }; });

    // Ativo/Inativo x total de leads — sinal de Mercúrio nunca importado.
    const { data: contagens } = await supabaseAdmin.rpc("contagem_status_mercurio_por_filial");
    (contagens || []).forEach((c: any) => {
        if (porFilial[c.filial]) {
            porFilial[c.filial].total_leads = Number(c.total_leads);
            porFilial[c.filial].total_ativo_inativo = Number(c.total_ativo_inativo);
        }
    });

    // Duplicados pendentes (leads_a_tratar) — pico pode indicar bug de
    // importação criando duplicata em vez de casar com lead existente.
    const { data: aTratar } = await supabaseAdmin.from("leads_a_tratar").select("filial").limit(20000);
    const contAtratar: Record<string, number> = {};
    (aTratar || []).forEach((r: any) => { contAtratar[r.filial] = (contAtratar[r.filial] || 0) + 1; });
    Object.keys(porFilial).forEach((f) => { porFilial[f].grupos_duplicados_pendentes = contAtratar[f] || 0; });

    // Última importação registrada em log_atividade (acao='importacao').
    const { data: logs } = await supabaseAdmin
        .from("log_atividade")
        .select("filial, criado_em, detalhes")
        .eq("acao", "importacao")
        .order("criado_em", { ascending: false })
        .limit(500);
    const ultimaImportacaoPorFilial: Record<string, any> = {};
    (logs || []).forEach((l: any) => {
        if (!ultimaImportacaoPorFilial[l.filial]) ultimaImportacaoPorFilial[l.filial] = l;
    });
    Object.keys(porFilial).forEach((f) => {
        const l = ultimaImportacaoPorFilial[f];
        porFilial[f].ultima_importacao_em = l?.criado_em ?? null;
        porFilial[f].dias_desde_ultima_importacao = diasDesde(l?.criado_em ?? null);
        porFilial[f].ultima_importacao_enviados = l?.detalhes?.enviados ?? null;
    });

    // Eventos próximos (≤10 dias) sem nenhum inscrito via Ulisses.
    const { data: eventosSemInscricao } = await supabaseAdmin.rpc("eventos_proximos_sem_inscricao_ulisses");
    const eventosPorFilial: Record<string, any[]> = {};
    (eventosSemInscricao || []).forEach((e: any) => {
        if (!eventosPorFilial[e.filial]) eventosPorFilial[e.filial] = [];
        eventosPorFilial[e.filial].push({ nome: e.nome, data: e.data });
    });
    Object.keys(porFilial).forEach((f) => { porFilial[f].eventos_proximos_sem_inscricao_ulisses = eventosPorFilial[f] || []; });

    return porFilial;
}

// -------------------------------------------------------------
// 2. Limiares fixos, determinísticos — a "inteligência" de detecção mora
//    aqui, não na IA. Ajustáveis se algum limiar gerar falso-positivo.
// -------------------------------------------------------------

function avaliarSincronizacao(sinaisSync: Record<string, any>) {
    const problemas: any[] = [];
    for (const sistema of ["mercurio", "ulisses"]) {
        const s = sinaisSync[sistema];
        if (s.dias_desde_ultima_tentativa === null) continue; // nunca rodou ainda — sem base pra comparar
        if (s.ultima_tentativa_sucesso === false && s.dias_desde_ultimo_sucesso !== null && s.dias_desde_ultimo_sucesso >= 2) {
            problemas.push({ filial: null, nivel: "urgente", sistema, sinais: s });
        } else if (s.dias_desde_ultima_tentativa >= 3) {
            problemas.push({ filial: null, nivel: "atencao", sistema, sinais: s });
        }
    }
    return problemas;
}

function avaliarFilial(f: any) {
    // Só avalia "Mercúrio nunca importou" se já existe volume razoável de
    // leads na filial (evita falso-positivo numa filial nova/pequena, que
    // legitimamente pode não ter passado pelo Mercúrio ainda).
    if ((f.total_leads || 0) >= 100 && (f.total_ativo_inativo || 0) === 0) {
        return { nivel: "urgente", motivo: "sem_ativo_inativo", sinais: f };
    }
    if ((f.grupos_duplicados_pendentes || 0) >= 150) {
        return { nivel: "atencao", motivo: "duplicados_altos", sinais: f };
    }
    if (f.dias_desde_ultima_importacao !== null && f.dias_desde_ultima_importacao >= 14) {
        return { nivel: "atencao", motivo: "importacao_antiga", sinais: f };
    }
    if ((f.eventos_proximos_sem_inscricao_ulisses || []).length > 0) {
        return { nivel: "atencao", motivo: "evento_sem_inscricao_ulisses", sinais: f };
    }
    return null;
}

// -------------------------------------------------------------
// 3. IA só escreve o texto (resumo + ação sugerida) de cada problema já
//    detectado — nunca decide número/nível.
// -------------------------------------------------------------

function montarPrompt(problemas: any[]): string {
    return `Você ajuda a operação de um CRM de captação de leads de uma escola (Nova Acrópole, várias filiais). Recebe uma lista de PROBLEMAS JÁ DETECTADOS (por regra fixa, não por você) com os dados brutos que os originaram. Sua tarefa é, para CADA item da lista, escrever:
- "resumo": 1-2 frases em português, direto e claro, explicando o problema em linguagem humana (não repita os números crus, interprete-os).
- "acao_sugerida": 1 frase, uma ação CONCRETA que o usuário pode tomar dentro do próprio CRM (ex: "Abra 'Sincronização Automática' na aba Importar e rode o Mercúrio para esta filial", "Confira 'Leads a Tratar' e mescle os duplicados mais antigos primeiro", "Confira se o Ulisses tem permissão de API para esta filial").

Regras importantes:
- NUNCA invente números, nomes ou datas que não estejam nos dados fornecidos.
- NÃO decida nível de severidade — isso já foi decidido, ignore/não repita.
- Responda SOMENTE com um array JSON válido, na MESMA ORDEM da lista recebida, sem texto antes ou depois, no formato: [{"resumo": "...", "acao_sugerida": "..."}, ...]

Problemas detectados (JSON):
${JSON.stringify(problemas.map((p) => p.sinais))}`;
}

function extrairJSONArray(texto: string): any[] {
    const limpo = texto.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(limpo);
    if (!Array.isArray(parsed)) throw new Error("Resposta da IA não é um array JSON.");
    return parsed;
}

async function escreverComIA(problemas: any[]): Promise<Array<{ resumo: string; acao_sugerida: string }>> {
    if (!ANTHROPIC_API_KEY) {
        // Sem a chave configurada, cai num texto genérico best-effort — a
        // detecção (a parte que realmente importa) continua funcionando.
        return problemas.map(() => ({
            resumo: "Anomalia detectada (ANTHROPIC_API_KEY não configurada — resumo automático indisponível, veja os sinais brutos).",
            acao_sugerida: "Configure ANTHROPIC_API_KEY (supabase secrets set) para gerar resumos em linguagem natural.",
        }));
    }
    try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: MODELO,
                max_tokens: 2048,
                messages: [{ role: "user", content: montarPrompt(problemas) }],
            }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(JSON.stringify(data?.error || data));
        const textos = extrairJSONArray(data.content?.[0]?.text ?? "");
        if (textos.length !== problemas.length) throw new Error("Tamanho da resposta da IA não bate com a lista enviada.");
        return textos.map((t: any) => ({
            resumo: String(t?.resumo || "").trim() || "Anomalia detectada — ver sinais brutos.",
            acao_sugerida: String(t?.acao_sugerida || "").trim() || null as any,
        }));
    } catch (e) {
        // Loga o erro completo (ex: crédito da Anthropic esgotado) pra
        // quem tiver acesso aos logs da function — a resposta pro CRM fica
        // só com um aviso curto, sem despejar JSON de erro cru na tela.
        console.error("[ia-diagnostico-saude] Falha ao escrever com IA, usando fallback:", e);
        return problemas.map((p) => ({
            resumo: `Anomalia detectada (${p.motivo || p.sistema}) — resumo automático indisponível (a IA não respondeu, ver console/detalhe abaixo), ver sinais brutos.`,
            acao_sugerida: null as any,
        }));
    }
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;

    try {
        const { data: filiais } = await supabaseAdmin.from("filiais").select("nome").eq("ativo", true);
        const nomesFiliais = (filiais || []).map((f: any) => f.nome);

        const sinaisSync = await coletarSinaisSincronizacao();
        const sinaisPorFilial = await coletarSinaisPorFilial(nomesFiliais);

        const problemasGlobais = avaliarSincronizacao(sinaisSync).map((p) => ({ ...p, sinais: { sistema: p.sistema, ...p.sinais } }));
        const problemasFiliais: any[] = [];
        for (const nome of nomesFiliais) {
            const avaliado = avaliarFilial(sinaisPorFilial[nome]);
            if (avaliado) problemasFiliais.push({ filial: nome, nivel: avaliado.nivel, motivo: avaliado.motivo, sinais: avaliado.sinais });
        }

        const todosProblemas = [...problemasGlobais, ...problemasFiliais];

        let relatorio: any[];
        if (todosProblemas.length === 0) {
            relatorio = [{
                filial: null,
                nivel: "ok",
                resumo: `Nenhuma anomalia detectada em ${nomesFiliais.length} filial(is) ativa(s) — sincronização e importações dentro do esperado.`,
                acao_sugerida: null,
                sinais: { sincronizacao: sinaisSync },
            }];
        } else {
            const textos = await escreverComIA(todosProblemas);
            relatorio = todosProblemas.map((p, i) => ({
                filial: p.filial,
                nivel: p.nivel,
                resumo: textos[i].resumo,
                acao_sugerida: textos[i].acao_sugerida,
                sinais: p.sinais,
            }));
        }

        const { error: erroInsert } = await supabaseAdmin.from("diagnosticos_ia").insert(relatorio);
        if (erroInsert) console.error("[ia-diagnostico-saude] Falha ao gravar diagnosticos_ia:", erroInsert);

        return json({ ok: true, relatorio });
    } catch (e) {
        console.error("[ia-diagnostico-saude] Erro:", e);
        return json({ ok: false, erro: String((e as Error)?.message || e) }, 500);
    }
});

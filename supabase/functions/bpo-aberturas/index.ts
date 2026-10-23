// Ponte privada de leitura BPO/CRM para avaliações explicáveis por abertura.
// A função nunca autentica usuário escolar nem é chamada pelo navegador CRM.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin, NOME_TABELA_LEADS } from "../_shared/supabaseAdmin.ts";

const TIPOS = new Set(["interesse_declarado", "disponibilidade_confirmada", "presenca_palestra", "outra_atividade", "resposta_atendimento", "pedido_matricula", "nao_contatar", "acao_realizada", "resultado_atendimento"]);
const INTERESSES = new Set(["a_confirmar", "conhecer", "participar", "inscrever", "depois", "nao"]);
const RESULTADOS = new Set(["adiou", "sem_interesse", "horario_incompativel", "contato_invalido", "sem_resposta", "matriculou"]);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const texto = (v: unknown) => typeof v === "string" ? v.trim() : "";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const erro = (mensagem: string, status = 400) => json({ ok: false, erro: mensagem }, status);
const dataValida = (v: unknown): v is string => typeof v === "string" && ISO.test(v) && Number.isFinite(Date.parse(v));
const valorSimNao = (v: unknown) => v === true || v === "sim" ? true : v === false || v === "nao" || v === "não" ? false : null;

function papelJwt(req: Request): string {
    try {
        const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
        const parte = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(atob(parte.padEnd(Math.ceil(parte.length / 4) * 4, "="))).role || "";
    } catch { return ""; }
}

function falharSeErro(error: any, contexto: string): void {
    if (error) throw new Error(contexto + ": " + (error.message || "erro de banco"));
}

async function listarTodas<T>(criarConsulta: (de: number, ate: number) => any): Promise<T[]> {
    const linhas: T[] = [];
    for (let de = 0; ; de += 1000) {
        const { data, error } = await criarConsulta(de, de + 999);
        falharSeErro(error, "leitura paginada");
        const lote = (data || []) as T[];
        linhas.push(...lote);
        if (lote.length < 1000) break;
    }
    return linhas;
}

function tagNaoContatar(tags:unknown){
    try{for(let i=0;i<4&&typeof tags==='string';i++)tags=JSON.parse(tags);}catch{return false;}
    return Array.isArray(tags)&&tags.some(t=>String(t).trim().normalize('NFC').toLowerCase()==='não contatar');
}
function normalizarJson(valor: any): any {
    if (Array.isArray(valor)) return valor.map(normalizarJson);
    if (valor && typeof valor === "object") return Object.fromEntries(Object.keys(valor).sort().map(chave => [chave, normalizarJson(valor[chave])]));
    return valor;
}

function canonico(valor: unknown): string { return JSON.stringify(normalizarJson(valor)); }

async function sha256(valor: unknown): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonico(valor)));
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function validarSinal(sinal: any, aberturaId: string, avaliadoEm: string): string | null {
    if (!sinal || typeof sinal !== "object" || Array.isArray(sinal) || !TIPOS.has(sinal.tipo)) return "Tipo de sinal inválido.";
    if (!dataValida(sinal.occurredAt) || Date.parse(sinal.occurredAt) > Date.parse(avaliadoEm)) return "A data do sinal deve ser ISO e não posterior ao snapshot.";
    if (!texto(sinal.origem) || texto(sinal.origem).length > 120) return "O sinal precisa ter uma fonte curta.";
    if (!texto(sinal.responsavel) || texto(sinal.responsavel).length > 160) return "O sinal precisa identificar o responsável.";
    if (!["declarado", "observado", "interpretado"].includes(sinal.natureza)) return "Natureza do sinal inválida.";
    if (texto(sinal.aberturaId) !== aberturaId) return "Cada sinal deve apontar para a mesma abertura do snapshot.";
    if (sinal.tipo === "interesse_declarado" && !INTERESSES.has(texto(sinal.valor))) return "Valor de interesse inválido.";
    if (["disponibilidade_confirmada", "presenca_palestra", "outra_atividade", "pedido_matricula", "nao_contatar"].includes(sinal.tipo) && valorSimNao(sinal.valor) === null) return "O sinal exige valor sim/não explícito.";
    if (sinal.tipo === "nao_contatar" && sinal.natureza !== "declarado") return "Não contato exige declaração explícita.";
    if (sinal.tipo === "resultado_atendimento" && (!RESULTADOS.has(texto(sinal.valor)) || sinal.natureza === "interpretado")) return "Resultado de atendimento inválido ou inferido.";
    if (sinal.tipo === "disponibilidade_confirmada" && sinal.natureza !== "declarado") return "Disponibilidade exige confirmação declarada.";
    if (["resposta_atendimento", "acao_realizada"].includes(sinal.tipo) && (typeof sinal.valor !== "string" || !sinal.valor.trim() || sinal.valor.length > 120)) return "Resposta e ação devem ser códigos curtos, sem texto bruto da conversa.";
    if (sinal.motivo != null && (typeof sinal.motivo !== "string" || sinal.motivo.trim().length > 240)) return "O motivo deve ser um resumo curto de até 240 caracteres.";
    return null;
}

function validarSnapshot(item: any, aberturaId: string): string | null {
    const s = item?.snapshot;
    if (!s || typeof s !== "object" || Array.isArray(s)) return "Snapshot ausente.";
    if (!texto(s.versaoMotor) || !texto(s.versaoRegras)) return "Versão do motor ou das regras ausente.";
    if (!dataValida(s.avaliadoEm) || Date.parse(s.avaliadoEm) > Date.now()) return "Data do snapshot inválida.";
    if (texto(s.abertura?.id) !== aberturaId) return "O snapshot deve manter a abertura original.";
    if (typeof s.preResultado !== "boolean") return "O snapshot precisa indicar se foi avaliado antes do resultado.";
    if (!INTERESSES.has(texto(s.interesse?.estado))) return "Estado de interesse inválido.";
    if (!["a_confirmar", "adequada", "inadequada"].includes(texto(s.adequacaoTurma?.estado))) return "Estado de adequação inválido.";
    if (!s.proximaAcao || typeof s.proximaAcao !== "object" || !Array.isArray(s.fundamentos)) return "A avaliação precisa guardar ação e fundamentos.";
    return null;
}

async function resolverFilial(codigo: string) {
    if (!/^[A-Z0-9]{2,12}$/.test(codigo)) return null;
    const { data, error } = await supabaseAdmin.from("filiais").select("id,nome,mercurio_unidade")
        .eq("mercurio_unidade", codigo).eq("ativo", true).maybeSingle();
    falharSeErro(error, "resolução da filial");
    return data || null;
}

async function getPainel(req: Request) {
    const url = new URL(req.url);
    const codigo = texto(url.searchParams.get("filial"));
    const aberturaFiltro = texto(url.searchParams.get("aberturaId"));
    const filial = await resolverFilial(codigo);
    if (!filial) return erro("Código mercurioUnidade inválido ou não ativo.", 404);

    const leads = await listarTodas<any>((de, ate) => supabaseAdmin.from(NOME_TABELA_LEADS)
        .select("pessoaIdentificador,pessoaNome,filial,matricula_mercurio,acompanhamento,tags")
        .eq("filial", filial.nome).is("lixeira_em", null).order("pessoaIdentificador", { ascending: true }).range(de, ate));
    const alunos = await listarTodas<any>((de, ate) => supabaseAdmin.from("mercurio_alunos")
        .select("matricula,unidade,pessoa_identificador,nome,nivel,turma,ingresso,data_efetiva,programa,ativo")
        .eq("unidade", codigo).order("matricula", { ascending: true }).range(de, ate));
    const privadas = (tabela: string, filtro: boolean) => (de: number, ate: number) => {
        let consulta = supabaseAdmin.from(tabela).select("*").eq("filial_codigo", codigo);
        if (aberturaFiltro && filtro) consulta = consulta.eq("abertura_id", aberturaFiltro);
        return consulta.order("criado_em", { ascending: true }).range(de, ate);
    };
    const [avaliacoes, acontecimentos, acoes, resultados, base, sync] = await Promise.all([
        listarTodas<any>(privadas("propensao_avaliacoes", true)),
        listarTodas<any>(privadas("propensao_acontecimentos", true)),
        listarTodas<any>(privadas("propensao_acoes", true)),
        listarTodas<any>(privadas("propensao_resultados", true)),
        (async () => {
            const { data, error } = await supabaseAdmin.from("relatorio_matriculas_mensais").select("fonte_data")
                .eq("filial_id", filial.id).order("fonte_data", { ascending: false }).limit(1).maybeSingle();
            falharSeErro(error, "data da fonte Mercúrio");
            return data?.fonte_data || null;
        })(),
        (async () => {
            const { data, error } = await supabaseAdmin.from("status_sincronizacao_automatica").select("executado_em")
                .eq("sistema", "mercurio_db").eq("filial", filial.nome).eq("sucesso", true)
                .order("executado_em", { ascending: false }).limit(1).maybeSingle();
            falharSeErro(error, "data de atualização do Mercúrio");
            return data?.executado_em || null;
        })(),
    ]);

    const leadIds = new Set(leads.map(lead => String(lead.pessoaIdentificador)));
    const avaliacaoPorLead = new Map<string, any>();
    for (const row of avaliacoes) {
        const id = String(row.lead_id), anterior = avaliacaoPorLead.get(id);
        if (!anterior || Date.parse(row.avaliado_em) > Date.parse(anterior.avaliado_em)) avaliacaoPorLead.set(id, row);
    }
    const sinaisPorLead = new Map<string, any[]>();
    for (const row of acontecimentos) {
        const id = String(row.lead_id);
        if (!leadIds.has(id)) continue;
        if (!sinaisPorLead.has(id)) sinaisPorLead.set(id, []);
        sinaisPorLead.get(id)!.push({
            tipo: row.tipo, valor: row.payload?.valor ?? row.valor, occurredAt: row.occurred_at,
            origem: row.origem, natureza: row.natureza, responsavel: row.responsavel,
            aberturaId: row.abertura_id, contextoHorario:row.payload?.contextoHorario||null, ...(row.mercurio_id ? { mercurioId: row.mercurio_id } : {}),
        });
    }
    const leadsPainel = leads.map(lead => {
        const avaliacao = avaliacaoPorLead.get(String(lead.pessoaIdentificador));
        return {
            id: String(lead.pessoaIdentificador), nome: lead.pessoaNome || "",
            interesse: avaliacao?.snapshot?.interesse || { estado: "a_confirmar", fonte: null },
            adequacaoTurma: avaliacao?.snapshot?.adequacaoTurma || { estado: "a_confirmar", fonte: null },
            aberturaId: avaliacao?.abertura_id || null,
            naoContatar: lead.acompanhamento?.contato === "nao_contatar"||tagNaoContatar(lead.tags),
            preferenciaContatoEm:lead.acompanhamento?.preferencia_contato_em||lead.acompanhamento?.atualizado_em||null,
            sinais: Array.isArray(avaliacao?.snapshot?.sinais) ? avaliacao.snapshot.sinais :
                (sinaisPorLead.get(String(lead.pessoaIdentificador)) || []).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)),
            avaliadoEm: avaliacao?.avaliado_em || null,
        };
    });
    const aberturaMap = new Map<string, any>();
    for (const row of avaliacoes) {
        const abertura = row.abertura || row.snapshot?.abertura || {};
        if (abertura.id) aberturaMap.set(String(abertura.id), {
            id: String(abertura.id), diaSemana: abertura.diaSemana ?? null,
            inicioMinuto: abertura.inicioMinuto ?? null, primeiraAula: abertura.primeiraAula ?? null,
        });
    }
    const matriculadosBpo = resultados.filter(row => row.resultado === "matriculou" && row.mercurio_id);
    const leadById = new Map(leads.map(lead => [String(lead.pessoaIdentificador), lead]));
    const matriculas = alunos.map(aluno => {
        const mercurioId = String(aluno.matricula);
        const temPessoaIdentificador = aluno.pessoa_identificador != null && String(aluno.pessoa_identificador) !== "";
        const exato = temPessoaIdentificador ? leadById.get(String(aluno.pessoa_identificador)) : null;
        let lead = null;
        if (exato) {
            if (exato.matricula_mercurio == null || String(exato.matricula_mercurio) === mercurioId) lead = exato;
        } else if (!temPessoaIdentificador) {
            lead = leads.find(row => row.matricula_mercurio != null && String(row.matricula_mercurio) === mercurioId) || null;
        }
        const resultado = lead && matriculadosBpo.filter(row => row.lead_id === String(lead.pessoaIdentificador) && String(row.mercurio_id) === mercurioId)
            .sort((a, b) => Date.parse(b.ocorreu_em) - Date.parse(a.ocorreu_em))[0];
        return {
            mercurioId, leadId: lead ? String(lead.pessoaIdentificador) : null,
            data: aluno.data_efetiva || aluno.ingresso || null, turmaId: aluno.turma || null,
            tipo: aluno.programa || aluno.nivel || null, fonte: "mercurio_alunos", ativo: aluno.ativo === true,
            aberturaId: resultado?.abertura_id || null,
        };
    });
    return json({
        versao: "1.0.0", filial: { codigo: filial.mercurio_unidade, nome: filial.nome }, baseAtualizadaEm: base,
        sincronizadoEm: sync,
        leads: leadsPainel, matriculas, aberturas: Array.from(aberturaMap.values()),
        avaliacoes: avaliacoes.map(row => ({
            id: row.id, aberturaId: row.abertura_id, leadId: row.lead_id, versaoMotor: row.versao_motor,
            versaoRegras: row.versao_regras, interesse: row.snapshot?.interesse || { estado: row.interesse_estado, fonte: null },
            adequacaoTurma: row.snapshot?.adequacaoTurma || { estado: row.adequacao_estado, fonte: null },
            proximaAcao: row.proxima_acao, fundamentos: row.fundamentos, sinais: row.sinais,
            avaliadoEm: row.avaliado_em, preResultado: row.pre_resultado,
        })),
        acontecimentos: acontecimentos.map(row => ({
            id: row.id, aberturaId: row.abertura_id, leadId: row.lead_id, tipo: row.tipo,
            valor: row.payload?.valor ?? row.valor, occurredAt: row.occurred_at, origem: row.origem,
            natureza: row.natureza, responsavel: row.responsavel, ...(row.mercurio_id ? { mercurioId: row.mercurio_id } : {}),
        })),
        acoes: acoes.map(row => ({ id: row.id, aberturaId: row.abertura_id, leadId: row.lead_id, tipo: row.tipo, occurredAt: row.ocorreu_em, origem: row.origem, responsavel: row.responsavel })),
        resultados: resultados.map(row => ({ id: row.id, aberturaId: row.abertura_id, leadId: row.lead_id, resultado: row.resultado, motivo: row.motivo, mercurioId: row.mercurio_id, occurredAt: row.ocorreu_em, origem: row.origem, natureza: row.natureza, responsavel: row.responsavel })),
    });
}

async function salvarSnapshots(req: Request) {
    let corpo: any;
    try { corpo = await req.json(); } catch { return erro("JSON inválido."); }
    const codigo = texto(corpo?.filial), aberturaId = texto(corpo?.aberturaId);
    if (!Array.isArray(corpo?.avaliacoes) || corpo.avaliacoes.length === 0 || corpo.avaliacoes.length > 500) return erro("Envie de 1 a 500 avaliações por lote.");
    if (!aberturaId || aberturaId.length > 100 || texto(corpo?.abertura?.id) !== aberturaId) return erro("O id da abertura deve ser uma string de até 100 caracteres e coincidir com abertura.id.");
    if (!Number.isInteger(corpo.abertura.diaSemana) || corpo.abertura.diaSemana < 0 || corpo.abertura.diaSemana > 6 ||
        !Number.isInteger(corpo.abertura.inicioMinuto) || corpo.abertura.inicioMinuto < 0 || corpo.abertura.inicioMinuto > 1439 ||
        (corpo.abertura.primeiraAula != null && !dataValida(corpo.abertura.primeiraAula))) return erro("A abertura precisa de diaSemana, inicioMinuto e primeiraAula ISO (ou null).");
    const filial = await resolverFilial(codigo);
    if (!filial) return erro("Código mercurioUnidade inválido ou não ativo.", 404);
    const ids = [...new Set(corpo.avaliacoes.map((item: any) => texto(item?.leadId)).filter(Boolean))];
    if (!ids.length || corpo.avaliacoes.some((item: any) => !texto(item?.leadId))) return erro("Cada avaliação precisa de leadId explícito.");
    const leads = await listarTodas<any>((de, ate) => supabaseAdmin.from(NOME_TABELA_LEADS)
        .select("pessoaIdentificador,filial,matricula_mercurio").eq("filial", filial.nome)
        .in("pessoaIdentificador", ids).order("pessoaIdentificador", { ascending: true }).range(de, ate));
    const leadPorId = new Map(leads.map(lead => [String(lead.pessoaIdentificador), lead]));
    if (ids.some(id => !leadPorId.has(id))) return erro("Há leadId que não pertence exatamente a esta filial.", 404);

    const linhasSinal: any[] = [], contextoSinal = new Map<string, any>(), linhasAvaliacao: any[] = [];
    const preferenciasContato = new Map<string, { leadId: string; sinal: any }>();
    for (const item of corpo.avaliacoes) {
        const leadId = texto(item.leadId), errSnapshot = validarSnapshot(item, aberturaId);
        if (errSnapshot) return erro(leadId + ": " + errSnapshot);
        if (!Array.isArray(item.sinais)) return erro(leadId + ": sinais deve ser uma lista.");
        const avaliacaoEm = item.snapshot.avaliadoEm, sinais = item.sinais;
        const sinaisCanonicos: any[] = [];
        for (const sinal of sinais) {
            const errSinal = validarSinal(sinal, aberturaId, avaliacaoEm);
            if (errSinal) return erro(leadId + ": " + errSinal);
            const mercurioId = sinal.tipo === "resultado_atendimento" && sinal.valor === "matriculou" ? texto(sinal.mercurioId) : "";
            if (sinal.tipo === "resultado_atendimento" && sinal.valor === "matriculou") {
                if (!/^\d+$/.test(mercurioId) || !Number.isSafeInteger(Number(mercurioId)) || String(Number(mercurioId)) !== mercurioId) return erro("Resultado matriculou exige mercurioId numérico canônico.");
                const { data: mat, error } = await supabaseAdmin.from("mercurio_alunos")
                    .select("matricula,unidade,pessoa_identificador")
                    .eq("unidade", codigo).eq("matricula", Number(mercurioId)).maybeSingle();
                falharSeErro(error, "conferência da matrícula");
                const lead = leadPorId.get(leadId);
                const exato = mat && (String(mat.pessoa_identificador || "") === leadId || String(lead.matricula_mercurio ?? "") === mercurioId);
                if (!exato) return erro("Matrícula não confirmada para este lead e unidade exatos.", 422);
            }
            const payload = {
                tipo: sinal.tipo, valor: sinal.valor, occurredAt: new Date(sinal.occurredAt).toISOString(),
                origem: texto(sinal.origem), natureza: sinal.natureza, responsavel: texto(sinal.responsavel),
                aberturaId,
                ...(sinal.contextoHorario?{contextoHorario:sinal.contextoHorario}:{}),
                ...(mercurioId ? { mercurioId } : {}),
                ...(typeof sinal.motivo === "string" ? { motivo: sinal.motivo.trim().slice(0, 240) || null } : {}),
            };
            const fingerprint = await sha256({ codigo, aberturaId, leadId, sinal: payload });
            sinaisCanonicos.push(payload);
            linhasSinal.push({
                filial_codigo: codigo, filial: filial.nome, abertura_id: aberturaId, lead_id: leadId,
                tipo: sinal.tipo, valor: sinal.valor, occurred_at: new Date(sinal.occurredAt).toISOString(),
                origem: texto(sinal.origem), natureza: sinal.natureza, responsavel: texto(sinal.responsavel),
                mercurio_id: mercurioId || null, payload, fingerprint,
            });
            contextoSinal.set(fingerprint, { leadId, sinal, fingerprint, mercurioId });
            if (sinal.tipo === "nao_contatar" && sinal.natureza === "declarado") {
                preferenciasContato.set(fingerprint, { leadId, sinal });
            }
        }
        const sinaisOrdenados = sinaisCanonicos.sort((a: any, b: any) => canonico(a).localeCompare(canonico(b), "en"));
        const snapshot = item.snapshot;
        const fingerprint = await sha256({ codigo, aberturaId, leadId, sinais: sinaisOrdenados, avaliadoEm: snapshot.avaliadoEm });
        linhasAvaliacao.push({
            filial_codigo: codigo, filial: filial.nome, abertura_id: aberturaId, lead_id: leadId,
            abertura: corpo.abertura, sinais: Array.isArray(snapshot.sinais) ? snapshot.sinais : sinais, snapshot, versao_motor: texto(snapshot.versaoMotor),
            versao_regras: texto(snapshot.versaoRegras), interesse_estado: snapshot.interesse.estado,
            adequacao_estado: snapshot.adequacaoTurma.estado, proxima_acao: snapshot.proximaAcao,
            fundamentos: snapshot.fundamentos, avaliado_em: new Date(snapshot.avaliadoEm).toISOString(),
            pre_resultado: snapshot.preResultado, fingerprint,
        });
    }
    const sinaisUnicos = Array.from(new Map(linhasSinal.map(row => [row.fingerprint, row])).values());

    // O opt-out é aplicado à fonte canônica antes de qualquer append. A RPC
    // preserva as demais chaves do acompanhamento e serializa concorrência.
    let preferenciasAplicadas = 0;
    for (const { leadId, sinal } of preferenciasContato.values()) {
        const { data, error } = await supabaseAdmin.rpc("propensao_atualizar_nao_contatar", {
            p_filial_codigo: codigo,
            p_lead_id: leadId,
            p_valor: valorSimNao(sinal.valor),
            p_ocorreu_em: new Date(sinal.occurredAt).toISOString(),
            p_responsavel: texto(sinal.responsavel),
        });
        falharSeErro(error, "atualização atômica da preferência de contato");
        if (data === true) preferenciasAplicadas++;
    }
    if (sinaisUnicos.length) {
        const { error } = await supabaseAdmin.from("propensao_acontecimentos")
            .upsert(sinaisUnicos, { onConflict: "filial_codigo,abertura_id,lead_id,fingerprint", ignoreDuplicates: true });
        falharSeErro(error, "gravação append-only dos acontecimentos");
    }
    const fingerprints = sinaisUnicos.map(row => row.fingerprint);
    const { data: eventosSalvos, error: erroEventos } = await supabaseAdmin.from("propensao_acontecimentos")
        .select("id,lead_id,tipo,occurred_at,origem,responsavel,valor,mercurio_id,payload,fingerprint")
        .eq("filial_codigo", codigo).eq("abertura_id", aberturaId).in("fingerprint", fingerprints.length ? fingerprints : ["__nenhum__"]);
    falharSeErro(erroEventos, "leitura dos acontecimentos gravados");
    const eventoPorFingerprint = new Map((eventosSalvos || []).map((row: any) => [row.fingerprint, row]));
    const linhasAcao: any[] = [], linhasResultado: any[] = [];
    for (const row of sinaisUnicos) {
        const ctx = contextoSinal.get(row.fingerprint), salvo: any = eventoPorFingerprint.get(row.fingerprint);
        if (!ctx || !salvo) continue;
        const sinal = ctx.sinal;
        if (sinal.tipo === "acao_realizada") linhasAcao.push({
            acontecimento_id: salvo.id, filial_codigo: codigo, filial: filial.nome, abertura_id: aberturaId,
            lead_id: ctx.leadId, tipo: sinal.valor, ocorreu_em: new Date(sinal.occurredAt).toISOString(),
            origem: texto(sinal.origem), responsavel: texto(sinal.responsavel), fingerprint: row.fingerprint,
        });
        if (sinal.tipo === "resultado_atendimento") linhasResultado.push({
            acontecimento_id: salvo.id, filial_codigo: codigo, filial: filial.nome, abertura_id: aberturaId,
            lead_id: ctx.leadId, resultado: sinal.valor,
            motivo: typeof sinal.motivo === "string" ? sinal.motivo.trim().slice(0, 240) || null : null,
            mercurio_id: ctx.mercurioId || null, ocorreu_em: new Date(sinal.occurredAt).toISOString(),
            origem: texto(sinal.origem), natureza: sinal.natureza, responsavel: texto(sinal.responsavel),
            fingerprint: row.fingerprint,
        });
    }
    const acoesUnicas = Array.from(new Map(linhasAcao.map(row => [row.fingerprint, row])).values());
    const resultadosUnicos = Array.from(new Map(linhasResultado.map(row => [row.fingerprint, row])).values());
    if (acoesUnicas.length) {
        const { error } = await supabaseAdmin.from("propensao_acoes").upsert(acoesUnicas, { onConflict: "filial_codigo,abertura_id,lead_id,fingerprint", ignoreDuplicates: true });
        falharSeErro(error, "gravação append-only das ações");
    }
    if (resultadosUnicos.length) {
        const { error } = await supabaseAdmin.from("propensao_resultados").upsert(resultadosUnicos, { onConflict: "filial_codigo,abertura_id,lead_id,fingerprint", ignoreDuplicates: true });
        falharSeErro(error, "gravação append-only dos resultados");
    }
    const { data: novosSnapshots, error: erroSnapshots } = await supabaseAdmin.from("propensao_avaliacoes")
        .upsert(Array.from(new Map(linhasAvaliacao.map(row => [row.fingerprint, row])).values()), { onConflict: "filial_codigo,abertura_id,lead_id,fingerprint", ignoreDuplicates: true }).select("id,lead_id,fingerprint");
    falharSeErro(erroSnapshots, "gravação append-only dos snapshots");
    const { data: todosSnapshots, error: erroTodos } = await supabaseAdmin.from("propensao_avaliacoes")
        .select("id,lead_id,fingerprint").eq("filial_codigo", codigo).eq("abertura_id", aberturaId)
        .in("fingerprint", linhasAvaliacao.map(row => row.fingerprint));
    falharSeErro(erroTodos, "confirmação dos snapshots");
    const porFingerprint = new Map((todosSnapshots || []).map((row: any) => [row.fingerprint, row]));
    return json({
        ok: true,
        preferenciasAplicadas,
        salvos: linhasAvaliacao.map(row => ({
            leadId: row.lead_id, avaliacaoId: porFingerprint.get(row.fingerprint)?.id || null,
            idempotente: !(novosSnapshots || []).some((saved: any) => saved.fingerprint === row.fingerprint),
        })),
    });
}

Deno.serve(async (req) => {
    const preflight = handleCors(req);
    if (preflight) return preflight;
    if (papelJwt(req) !== "service_role") return erro("Consulta restrita ao serviço.", 403);
    try {
        if (req.method === "GET") return await getPainel(req);
        if (req.method === "POST") return await salvarSnapshots(req);
        return erro("Método não permitido.", 405);
    } catch (error) {
        console.error("bpo-aberturas:", error);
        return erro("Não foi possível concluir a solicitação.", 500);
    }
});

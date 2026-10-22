// Cobrança mensal do Módulo 2 (Máquina/SDR), por ciclo de abertura de turma.
// Pedido do usuário (2026-10-18): "a cobrança disparada pelo CRM, consultando
// dados reais, no dia 10 de cada mês (ou próximo dia útil), consultando as
// matrículas realizadas nas turmas do ciclo atendido".
//
// Cron diário 09:00 Brasília (migracao_cobranca_ciclos.sql). Só age no DIA DE
// COBRANÇA; nos outros dias responde "não é hoje". Gera 1 RASCUNHO por filial
// em cobrancas_mensais + cobranca_itens e manda o resumo no WhatsApp do admin
// pra revisão. Quem fecha a cobrança é o usuário, no CRM.
//
// Quem entra na cobrança (só alunos que contam pra remuneração, ver
// calcularCompetencia em mercurio-db-sincronizar):
//   - Programa branco: pela turma de abertura (turma_competencia). Entra quando
//     o CICLO dessa turma (período cadastrado por filial em ciclos_turma) já
//     terminou antes da data da cobrança. Quem matricula numa turma já aberta
//     conta no ciclo da turma; se entrou depois da cobrança, vai pra seguinte.
//   - Complementar/sem turma de abertura: pela data individual, se caiu entre a
//     cobrança anterior e esta (na 1ª cobrança, desde o início do 1º ciclo).
//   - Cada aluno é cobrado UMA vez só (unique em cobranca_itens).
// Fixo: membros_mercurio CONGELADO no momento da geração.
//
// Corpo: { forcar?, data?, filial?, semAviso? }
//   forcar   — gera agora, mesmo fora do dia de cobrança (corte = hoje)
//   data     — data de corte (AAAA-MM-DD), pra testar; implica forcar
//   semAviso — não manda o WhatsApp (usado pelo botão "Gerar prévia" do CRM)
// Rascunho existente do mesmo mês é RECALCULADO (exclusões feitas na revisão
// são mantidas); cobrança FECHADA nunca é tocada.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const PERCENTUAL_COMISSAO = 0.3;
const CENTAVOS_POR_MEMBRO_MODULO2 = 496;
const DIA_COBRANCA = 10;
const URL_CRM = "https://crm-nova-acropole-5dv3.vercel.app/";

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function hojeBrasilia(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
function somarDias(dataIso: string, dias: number): string {
    const d = new Date(dataIso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + dias);
    return iso(d);
}

// Páscoa (algoritmo de Meeus) — base dos feriados móveis.
function pascoa(ano: number): Date {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(ano, mes - 1, dia, 12));
}
function feriadosNacionais(ano: number): Set<string> {
    const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"].map((d) => `${ano}-${d}`);
    const p = pascoa(ano).toISOString().slice(0, 10);
    const moveis = [-48, -47, -2, 60].map((n) => somarDias(p, n)); // Carnaval (seg/ter), Sexta Santa, Corpus Christi
    return new Set([...fixos, ...moveis]);
}
// Dia 10 do mês, ou o próximo dia útil (sem sábado, domingo e feriado nacional).
function diaDeCobranca(ano: number, mes: number): string {
    const feriados = feriadosNacionais(ano);
    let d = `${ano}-${String(mes).padStart(2, "0")}-${String(DIA_COBRANCA).padStart(2, "0")}`;
    for (;;) {
        const sem = new Date(d + "T12:00:00Z").getUTCDay();
        if (sem !== 0 && sem !== 6 && !feriados.has(d)) return d;
        d = somarDias(d, 1);
    }
}

function numeroNaoNegativo(valor: unknown): number | null {
    if (valor == null || (typeof valor === "string" && valor.trim() === "")) return null;
    const numero = Number(valor);
    return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

function quantidadeMembros(valor: unknown): number | null {
    const numero = numeroNaoNegativo(valor);
    return Number.isSafeInteger(numero) ? numero : null;
}

function obterQuantidadeMembrosFilial(f: any): number | null {
    const membrosInformados = f.membros != null ? f.membros : f.membros_mercurio;
    return quantidadeMembros(membrosInformados);
}

function valorFixo(f: any, membros: number | null): { valor: number | null; manual: boolean } {
    if (f.valor_fixo_mensal_agencia != null) {
        return { valor: numeroNaoNegativo(f.valor_fixo_mensal_agencia), manual: true };
    }
    const quantidade = quantidadeMembros(membros);
    if (quantidade == null) return { valor: null, manual: false };
    return { valor: quantidade * CENTAVOS_POR_MEMBRO_MODULO2 / 100, manual: false };
}

function totalCobrar(fixo: number | null, comissao: number | null, contratado: boolean): number | null {
    if (!contratado) return 0;
    if (fixo == null || comissao == null) return null;
    return fixo + comissao;
}

async function lerTudo(montar: (de: number, ate: number) => any): Promise<any[]> {
    const linhas: any[] = [];
    for (let de = 0; ; de += 1000) {
        const { data, error } = await montar(de, de + 999);
        if (error) throw new Error(error.message);
        linhas.push(...(data || []));
        if (!data || data.length < 1000) return linhas;
    }
}

const cicloQueContem = (ciclos: any[], data: string | null) =>
    data ? ciclos.find((c) => data >= c.inicio && data <= c.fim) || null : null;

async function buscarFiliaisAtivasCobranca(corpo: any, banco = supabaseAdmin) {
    let q = banco.from("filiais")
        .select("id, nome, mercurio_unidade, filial_cobranca_id, membros, membros_mercurio, valor_fixo_mensal_agencia, valor_mensalidade, modulo2_contratado")
        .eq("ativo", true).order("ordem");
    if (corpo.filial) q = q.eq("nome", corpo.filial);
    return q;
}

async function lerDadosMercurioFilial(f: any, banco = supabaseAdmin) {
    if (typeof f.mercurio_unidade !== "string" || !f.mercurio_unidade.trim()) {
        // Sem unidade mapeada, não consultar com `.eq("unidade", null)`:
        // isso poderia parecer uma filial sem matrículas e produzir total parcial.
        return { fonteDisponivel: false, turmas: [], alunos: [], investigar: [] };
    }
    const unidade = f.mercurio_unidade.trim();
    const [turmas, alunos, investigar] = await Promise.all([
        lerTudo((de, ate) => banco.from("mercurio_turmas").select("turma, tipo, nivel, inicio").eq("unidade", unidade).order("turma").range(de, ate)),
        lerTudo((de, ate) => banco.from("mercurio_alunos")
            .select("matricula, unidade, pessoa_identificador, nome, nivel, turma, turma_competencia, data_efetiva, programa, recuperado, ativo")
            .eq("filial", f.nome).eq("conta_remuneracao", true).order("matricula").range(de, ate)),
        lerTudo((de, ate) => banco.from("mercurio_alunos")
            .select("matricula, unidade, pessoa_identificador, nome, nivel, turma, data_efetiva, motivo_investigar, ativo")
            .eq("filial", f.nome).not("motivo_investigar", "is", null).order("matricula").range(de, ate)),
    ]);
    return { fonteDisponivel: true, turmas, alunos, investigar };
}

function resultadoFilialAgrupada(f: any) {
    if (f?.filial_cobranca_id == null) return null;
    const grupo = f.nome_filial_cobranca || null;
    return {
        filial: f.nome,
        agrupadaEm: grupo,
        pulada: grupo ? `cobrança consolidada em ${grupo}` : "cobrança consolidada em outra filial",
    };
}

async function gerarFilial(f: any, mes: string, dataCobranca: string) {
    const agrupada = resultadoFilialAgrupada(f);
    if (agrupada) return agrupada;
    const { data: existente } = await supabaseAdmin.from("cobrancas_mensais")
        .select("id, status").eq("mes", mes).eq("filial", f.nome).maybeSingle();
    if (existente?.status === "fechada") return { filial: f.nome, pulada: "cobrança deste mês já fechada" };
    // Só 1 rascunho aberto por filial: uma prévia antiga de outro mês, nunca
    // fechada, é descartada (senão prenderia alunos que pertencem a esta).
    await supabaseAdmin.from("cobrancas_mensais").delete()
        .eq("filial", f.nome).eq("status", "rascunho").neq("mes", mes);

    const [ciclos, dadosMercurio, anterior] = await Promise.all([
        lerTudo((de, ate) => supabaseAdmin.from("ciclos_turma").select("id, nome, inicio, fim").eq("filial", f.nome).order("inicio").range(de, ate)),
        lerDadosMercurioFilial(f),
        supabaseAdmin.from("cobrancas_mensais").select("data_cobranca").eq("filial", f.nome)
            .eq("status", "fechada").lt("data_cobranca", dataCobranca).order("data_cobranca", { ascending: false }).limit(1),
    ]);
    const { fonteDisponivel, turmas, alunos, investigar } = dadosMercurio;
    const jaCobrados = new Set((await lerTudo((de, ate) => {
        let q = supabaseAdmin.from("cobranca_itens").select("matricula, unidade").eq("filial", f.nome);
        if (existente) q = q.neq("cobranca_id", existente.id);
        return q.order("id").range(de, ate);
    })).map((i: any) => `${i.matricula}|${i.unidade}`));

    // Exclusões feitas na revisão sobrevivem a um recálculo do rascunho.
    const excluidosAntes = new Map<string, string | null>();
    if (existente) {
        const { data: velhos } = await supabaseAdmin.from("cobranca_itens").select("matricula, unidade, motivo_exclusao")
            .eq("cobranca_id", existente.id).eq("incluido", false);
        (velhos || []).forEach((v: any) => excluidosAntes.set(`${v.matricula}|${v.unidade}`, v.motivo_exclusao));
    }

    const inicioTurma = new Map(turmas.map((t: any) => [t.turma, t.inicio]));
    const ciclosFechados = ciclos.filter((c: any) => c.fim < dataCobranca);
    const primeiraCobranca = !(anterior.data && anterior.data[0]);
    const janelaInicio = primeiraCobranca ? (ciclos[0]?.inicio || null) : somarDias(anterior.data![0].data_cobranca, 1);

    const itens: any[] = [];
    for (const a of alunos) {
        const chave = `${a.matricula}|${a.unidade}`;
        if (jaCobrados.has(chave) || !a.data_efetiva || a.data_efetiva > dataCobranca) continue;
        const aberturaTurma = a.programa === "branco" && a.turma_competencia ? inicioTurma.get(a.turma_competencia) || null : null;
        let ciclo: any = null, referencia: string;
        if (aberturaTurma) {
            ciclo = cicloQueContem(ciclos, aberturaTurma);
            if (!ciclo || ciclo.fim >= dataCobranca) continue; // turma fora de ciclo, ou ciclo ainda aberto
            referencia = aberturaTurma;
        } else {
            if (!janelaInicio || a.data_efetiva < janelaInicio) continue;
            referencia = a.data_efetiva;
            ciclo = cicloQueContem(ciclos, a.data_efetiva);
        }
        const excluido = excluidosAntes.has(chave);
        itens.push({
            matricula: a.matricula, unidade: a.unidade, filial: f.nome, pessoa_identificador: a.pessoa_identificador,
            nome: a.nome, nivel: a.nivel, turma: a.turma_competencia || a.turma, ciclo_id: ciclo?.id ?? null,
            ciclo_nome: ciclo?.nome ?? null, data_efetiva: a.data_efetiva, data_referencia: referencia,
            programa: a.programa, recuperado: !!a.recuperado, ativo: a.ativo !== false,
            incluido: !excluido, motivo_exclusao: excluido ? excluidosAntes.get(chave) ?? null : null,
        });
    }

    const listaInvestigar = investigar
        .filter((a: any) => !jaCobrados.has(`${a.matricula}|${a.unidade}`))
        .map((a: any) => ({ ...a, ciclo: cicloQueContem(ciclosFechados, inicioTurma.get(a.turma) || null) }))
        .filter((a: any) => a.ciclo)
        .map((a: any) => ({ matricula: a.matricula, nome: a.nome, nivel: a.nivel, turma: a.turma, data_efetiva: a.data_efetiva,
            motivo: a.motivo_investigar, ciclo_nome: a.ciclo.nome, pessoa_identificador: a.pessoa_identificador, ativo: a.ativo !== false }));

    // A contagem manual configurada na filial é autoritativa; só em branco
    // usamos a contagem automática sincronizada do Mercúrio.
    const membrosInformados = f.membros != null ? f.membros : f.membros_mercurio;
    const membros = obterQuantidadeMembrosFilial(f);
    const fixo = valorFixo(f, membros);
    const contratado = f.modulo2_contratado !== false;
    const incluidos = itens.filter((i) => i.incluido).length;
    const mensalidade = numeroNaoNegativo(f.valor_mensalidade);
    const comissao = contratado && !fonteDisponivel
        ? null
        : incluidos === 0 ? 0 : mensalidade == null ? null : Math.round(incluidos * mensalidade * PERCENTUAL_COMISSAO * 100) / 100;
    const pendenciasCalculo: string[] = [];
    if (contratado && !fonteDisponivel) pendenciasCalculo.push("unidade do Mercúrio não configurada; configure o vínculo antes de calcular matrículas e comissão");
    if (contratado && fixo.valor == null) {
        if (fixo.manual) pendenciasCalculo.push("ajuste manual do Fixo ausente ou inválido");
        else if (membrosInformados == null || (typeof membrosInformados === "string" && membrosInformados.trim() === "")) {
            pendenciasCalculo.push("contagem de membros ausente; informe a quantidade ou sincronize o Mercúrio");
        } else pendenciasCalculo.push("contagem de membros inválida; corrija o valor antes de cobrar");
    }
    if (contratado && incluidos > 0 && mensalidade == null) pendenciasCalculo.push("mensalidade ausente ou inválida; não foi possível calcular a comissão de 30%");
    const erroCalculo = pendenciasCalculo.length ? pendenciasCalculo.join("; ") : null;
    const total = totalCobrar(fixo.valor, comissao, contratado);

    const linha = {
        mes, filial: f.nome, data_cobranca: dataCobranca, status: "rascunho",
        membros_congelados: membros, valor_fixo: fixo.valor, fixo_manual: fixo.manual,
        modulo2_contratado: contratado, valor_mensalidade: mensalidade, matriculas: fonteDisponivel ? incluidos : null,
        comissao, total, janela_inicio: janelaInicio,
        ciclos: ciclosFechados.map((c: any) => ({ id: c.id, nome: c.nome, inicio: c.inicio, fim: c.fim })),
        investigar: listaInvestigar, gerado_em: new Date().toISOString(),
    };
    let cobrancaId: number;
    if (existente) {
        // Uma revisão pode fechar o rascunho enquanto os dados são lidos.
        // A condição de status impede reabrir essa linha; confirme a escrita
        // antes de substituir qualquer item da cobrança.
        const { data: atualizada, error } = await supabaseAdmin.from("cobrancas_mensais").update(linha)
            .eq("id", existente.id).eq("status", "rascunho").select("id").maybeSingle();
        if (error) throw new Error(`atualizar cobrança: ${error.message}`);
        if (!atualizada) return { filial: f.nome, pulada: "a cobrança foi fechada durante a geração e não foi recalculada" };
        await supabaseAdmin.from("cobranca_itens").delete().eq("cobranca_id", existente.id);
        cobrancaId = existente.id;
    } else {
        const { data, error } = await supabaseAdmin.from("cobrancas_mensais").insert(linha).select("id").single();
        if (error) throw new Error(`criar cobrança: ${error.message}`);
        cobrancaId = data.id;
    }
    for (let i = 0; i < itens.length; i += 500) {
        const { error } = await supabaseAdmin.from("cobranca_itens").insert(itens.slice(i, i + 500).map((x) => ({ ...x, cobranca_id: cobrancaId })));
        if (error) throw new Error(`gravar itens: ${error.message}`);
    }
    return {
        filial: f.nome, cobrancaId, matriculas: fonteDisponivel ? incluidos : null, excluidos: itens.length - incluidos,
        investigar: listaInvestigar.length, membros, fixo: fixo.valor, comissao, total, contratado, erroCalculo,
        semCiclos: ciclos.length === 0, ciclosCobertos: ciclosFechados.length,
    };
}

const real = (v: number | null) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function montarAviso(mes: string, dataCobranca: string, res: any[]) {
    const [a, m] = mes.split("-");
    const dataBR = dataCobranca.split("-").reverse().join("/");
    const linhas = res.filter((r) => !r.pulada && !r.erro).map((r) => {
        const matriculas = r.matriculas == null ? "matrículas não consultadas" : `${r.matriculas} matrícula(s)`;
        if (!r.contratado) return `• *${r.filial}*: ${matriculas} — não cobrada (Módulo 2 não contratado)`;
        const extra = [r.investigar ? `${r.investigar} pra investigar` : "", r.semCiclos ? "SEM CICLO CADASTRADO" : "", r.erroCalculo ? `CÁLCULO PENDENTE: ${r.erroCalculo}` : ""].filter(Boolean).join(", ");
        const total = r.total == null ? "*PENDENTE*" : `*${real(r.total)}*`;
        return `• *${r.filial}*: ${matriculas}, Fixo ${real(r.fixo)} (${r.membros ?? "?"} membros; R$4,96 por membro/mês) + comissão ${real(r.comissao)} = ${total}${extra ? ` — ${extra}` : ""}`;
    });
    const total = res.some((r) => r.erroCalculo) ? null : res.reduce((s, r) => s + (r.total || 0), 0);
    const agrupadas = res.filter((r) => r.agrupadaEm).map((r) => `• *${r.filial}*: cobrança consolidada em *${r.agrupadaEm}* (sem cobrança ou comissão duplicada)`);
    const problemas = res.filter((r) => r.erro).map((r) => `• ${r.filial}: erro — ${r.erro}`);
    return [
        `🧾 *Cobrança de ${m}/${a} pronta pra revisar* (corte em ${dataBR})`,
        "",
        ...agrupadas,
        ...linhas,
        ...problemas,
        "",
        `*Total: ${real(total)}*`,
        "",
        `Revise e feche em Relatórios → Cobrança Mensal: ${URL_CRM}`,
    ].join("\n");
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    let corpo: any = {};
    try { corpo = await req.json(); } catch { /* vazio */ }

    const dataBase = corpo.data || hojeBrasilia();
    const [ano, mesNum] = dataBase.split("-").map(Number);
    const mes = dataBase.slice(0, 7);
    const diaCobranca = diaDeCobranca(ano, mesNum);
    const forcar = corpo.forcar === true || !!corpo.data;
    if (!forcar && dataBase !== diaCobranca) return json({ ok: true, naoEhDia: true, diaCobranca });
    const dataCobranca = forcar ? dataBase : diaCobranca;

    const { data: filiais, error } = await buscarFiliaisAtivasCobranca(corpo);
    if (error) return json({ ok: false, erro: error.message }, 500);

    const mapaFilial = new Map<string, any>((filiais || []).map((f: any) => [String(f.id), f] as [string, any]));
    const resultados: any[] = [];
    for (const f of filiais || []) {
        let grupo = f.filial_cobranca_id == null ? null : mapaFilial.get(String(f.filial_cobranca_id));
        if (f.filial_cobranca_id != null && !grupo) {
            const { data } = await supabaseAdmin.from("filiais").select("id, nome").eq("id", f.filial_cobranca_id).maybeSingle();
            grupo = data;
        }
        const filialComGrupo = grupo ? { ...f, nome_filial_cobranca: grupo.nome } : f;
        try { resultados.push(await gerarFilial(filialComGrupo, mes, dataCobranca)); }
        catch (e) { resultados.push({ filial: f.nome, erro: (e as Error).message }); }
    }

    const geradas = resultados.filter((r) => !r.pulada && !r.erro);
    let aviso: unknown = null;
    if (geradas.length && !corpo.semAviso) {
        const texto = montarAviso(mes, dataCobranca, resultados);
        const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/lembrete-scraper`, {
            method: "POST",
            headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
            body: JSON.stringify({ texto }),
        }).catch((e) => ({ json: async () => ({ ok: false, erro: String(e) }) }) as any);
        aviso = await resp.json().catch(() => null);
    }
    return json({ ok: resultados.every((r) => !r.erro), mes, dataCobranca, diaCobranca, resultados, aviso });
});

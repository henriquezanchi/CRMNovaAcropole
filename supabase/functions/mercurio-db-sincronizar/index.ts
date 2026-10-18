// Sincroniza o banco de consulta do Mercúrio (oinabview, via phpMyAdmin,
// atualizado toda noite) com o CRM. Roda todo dia 06:30 Brasília (pg_cron,
// migracao_mercurio_db.sql) ou sob demanda ({filial?} no corpo).
//
// O banco só tem alunos ATIVOS. Por filial (filiais.mercurio_unidade):
//   1) mercurio_turmas  — turmas com a data de abertura (tur_inicio).
//   2) mercurio_alunos  — 1 linha por aluno, com a COMPETÊNCIA de cobrança
//      já calculada pela regra combinada com o usuário (ver calcularCompetencia).
//      Quem some do Mercúrio vira ativo=false e mantém a competência antiga.
//   3) leads_inscricoes — data_matricula real, tag Recuperado, tag
//      "Contribuição em Atraso" e contato vazio preenchido (nunca sobrescreve).
//   4) filiais.membros_mercurio — contagem de N2 a N7.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin, NOME_TABELA_LEADS } from "../_shared/supabaseAdmin.ts";
import { abrirSessaoPhpMyAdmin, dataOuNull } from "../_shared/phpmyadmin.ts";

const NIVEIS_MEMBRO = ["N2", "N3", "N4", "N5", "N6", "N7"];
const NIVEIS_COMPLEMENTAR = ["CA", "TA", "CO", "JN"];
const NIVEIS_TURMA_ABERTURA = ["PP", "N1"]; // turma nova de verdade; N2+ é progressão de quem já é aluno
const JANELA_DIAS = 30;
const MESES_JANELA_ATRASO = 6;
const TAG_ATRASO = "Contribuição em Atraso";

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function parseTags(bruto: unknown): string[] {
    if (!bruto) return [];
    if (Array.isArray(bruto)) return bruto as string[];
    try { const p = JSON.parse(String(bruto)); return Array.isArray(p) ? p : []; } catch { return []; }
}

const mesDe = (iso: string) => iso.slice(0, 7);
function somarDias(iso: string, dias: number): string {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}
function hojeBrasilia(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

type Turma = { turma: string; tipo: string; nivel: string; inicio: string | null };

// Regra de competência (pedido do usuário):
// - Programa branco: conta no mês em que a turma ABRIU, mesmo que a matrícula
//   tenha sido feita até 30 dias antes. Matrícula mais de 30 dias antes da
//   abertura = investigar (possível reingresso não registrado) — não conta.
// - Complementar: conta pelo mês da data de ingresso individual.
// - Data usada: reingresso quando o aluno é "recuperado", senão ingresso.
// - Remuneração: PP, N1 e CA contam; N2-N7 só se for reingresso; Janos e
//   Merlin (TA/CO) nunca contam (outro modelo comercial).
function calcularCompetencia(a: any, turmaAtual: Turma | undefined, aberturasUnidade: Turma[]) {
    const nivel = String(a.nivel || "").trim();
    const recuperado = a.recuperado === true;
    const reingresso = a.reingresso as string | null;
    const ingresso = a.ingresso as string | null;
    const usaReingresso = recuperado && reingresso && (!ingresso || reingresso > ingresso);
    const dataEfetiva = (usaReingresso ? reingresso : ingresso) || null;

    const complementar = NIVEIS_COMPLEMENTAR.includes(nivel) || (turmaAtual && turmaAtual.tipo !== "P");
    const programa = complementar ? "complementar" : (["PP", "N1", ...NIVEIS_MEMBRO].includes(nivel) ? "branco" : "outro");
    let contaRemuneracao = ["PP", "N1", "CA"].includes(nivel) || (NIVEIS_MEMBRO.includes(nivel) && !!usaReingresso);

    const r = {
        data_efetiva: dataEfetiva, programa, conta_remuneracao: contaRemuneracao,
        competencia: null as string | null, turma_competencia: null as string | null,
        investigar_competencia: null as string | null, motivo_investigar: null as string | null,
    };
    if (!dataEfetiva) return r;

    if (programa !== "branco") { r.competencia = mesDe(dataEfetiva); return r; }

    const limite = somarDias(dataEfetiva, JANELA_DIAS);
    const turmaAtualEhAbertura = turmaAtual && turmaAtual.tipo === "P" && turmaAtual.inicio && NIVEIS_TURMA_ABERTURA.includes(turmaAtual.nivel);

    if (turmaAtualEhAbertura) {
        const inicio = turmaAtual!.inicio!;
        if (inicio >= dataEfetiva && inicio <= limite) { r.competencia = mesDe(inicio); r.turma_competencia = turmaAtual!.turma; return r; }
        if (inicio < dataEfetiva) { r.competencia = mesDe(dataEfetiva); r.turma_competencia = turmaAtual!.turma; return r; }
        // Matrícula mais de 30 dias antes da abertura da própria turma.
        r.investigar_competencia = mesDe(inicio);
        r.motivo_investigar = `${usaReingresso ? "Reingresso" : "Ingresso"} em ${dataEfetiva}, mais de ${JANELA_DIAS} dias antes da abertura da turma ${turmaAtual!.turma} (${inicio}) — confirme se é reingresso não registrado`;
        r.conta_remuneracao = false;
        return r;
    }

    // Turma atual não é de abertura (ex: já avançou pra N2): procura a turma
    // de abertura da unidade que abriu até 30 dias depois da matrícula.
    const abertura = aberturasUnidade
        .filter((t) => t.inicio && t.inicio >= dataEfetiva && t.inicio <= limite)
        .sort((x, y) => (x.inicio! < y.inicio! ? -1 : 1))[0];
    r.competencia = mesDe(abertura ? abertura.inicio! : dataEfetiva);
    r.turma_competencia = abertura ? abertura.turma : null;
    return r;
}

async function emLotes<T>(itens: T[], tamanho: number, fn: (item: T) => Promise<void>) {
    for (let i = 0; i < itens.length; i += tamanho) await Promise.all(itens.slice(i, i + tamanho).map(fn));
}

async function sincronizarFilial(pma: any, filial: { nome: string; unidade: string }, inicioRodada: string) {
    const U = filial.unidade.replace(/[^A-Z0-9]/gi, "");
    const hoje = hojeBrasilia();
    const [anoHoje, mesHoje] = hoje.split("-").map(Number);
    const fimAtraso = anoHoje * 100 + mesHoje;
    const dIni = new Date(Date.UTC(anoHoje, mesHoje - 1 - (MESES_JANELA_ATRASO - 1), 1));
    const iniAtraso = dIni.getUTCFullYear() * 100 + (dIni.getUTCMonth() + 1);

    // ---------- leitura do Mercúrio ----------
    const turmasBrutas = await pma.consultar(
        `SELECT tur_turma, tur_tipo, tur_nivel, tur_dia, tur_horario, tur_inicio, tur_previsao_formatura FROM turmas WHERE tur_unidade='${U}'`, "turmas");
    const alunosBrutos = await pma.consultar(
        `SELECT cad_matr, cad_nome, cad_nivel, cad_tur_unidade, cad_turma, cad_ingresso, cad_reingresso, cad_recuperado, cad_midia_ingresso, cad_contribuicao, cad_cel_ddd, cad_cel_fone, cad_res_ddd, cad_res_fone, cad_email, cad_nascimento, cad_res_cidade, cad_res_uf FROM cadastro WHERE cad_unidade='${U}'`, "cadastro");
    const fichasBrutas = await pma.consultar(
        `SELECT fic_matr, SUM(fic_status='ATR' AND (fic_ano*100+fic_mes) BETWEEN ${iniAtraso} AND ${fimAtraso}) AS atraso, MAX(fic_datapg) AS ultimo FROM fichas WHERE fic_unidade='${U}' AND fic_ano >= ${dIni.getUTCFullYear()} GROUP BY fic_matr`, "fichas");

    // ---------- turmas ----------
    const turmas: Turma[] = turmasBrutas.map((t: any) => ({
        turma: t.tur_turma, tipo: t.tur_tipo, nivel: t.tur_nivel, inicio: dataOuNull(t.tur_inicio),
    }));
    const turmaPorNome = new Map(turmas.map((t) => [t.turma, t]));
    const aberturas = turmas.filter((t) => t.tipo === "P" && NIVEIS_TURMA_ABERTURA.includes(t.nivel));
    const linhasTurmas = turmasBrutas.map((t: any) => ({
        unidade: U, turma: t.tur_turma, filial: filial.nome, tipo: t.tur_tipo, nivel: t.tur_nivel,
        dia: t.tur_dia, horario: t.tur_horario, inicio: dataOuNull(t.tur_inicio),
        previsao_formatura: dataOuNull(t.tur_previsao_formatura), sincronizado_em: inicioRodada,
    }));
    for (let i = 0; i < linhasTurmas.length; i += 500) {
        const { error } = await supabaseAdmin.from("mercurio_turmas").upsert(linhasTurmas.slice(i, i + 500), { onConflict: "unidade,turma" });
        if (error) throw new Error(`mercurio_turmas: ${error.message}`);
    }

    // ---------- leads já existentes desta filial (vínculo por matrícula) ----------
    const leadPorMatr = new Map<string, any>();
    for (let de = 0; ; de += 1000) {
        const { data, error } = await supabaseAdmin.from(NOME_TABELA_LEADS)
            .select("pessoaIdentificador, matricula_mercurio, tags, data_matricula, pessoaTelefoneDDD, pessoaTelefoneNumero, pessoaEmail, data_nascimento, cidade, uf")
            .eq("filial", filial.nome).not("matricula_mercurio", "is", null)
            .order("pessoaIdentificador", { ascending: true }).range(de, de + 999);
        if (error) throw new Error(`leads: ${error.message}`);
        for (const l of data || []) leadPorMatr.set(String(l.matricula_mercurio), l);
        if (!data || data.length < 1000) break;
    }

    const fichaPorMatr = new Map(fichasBrutas.map((f: any) => [String(f.fic_matr), f]));

    // ---------- alunos ----------
    const linhasAlunos: any[] = [];
    const atualizacoesLeads: { id: string; payload: Record<string, unknown> }[] = [];
    let membros = 0, emAtraso = 0, vinculados = 0;

    for (const b of alunosBrutos) {
        const matr = String(b.cad_matr);
        const nivel = String(b.cad_nivel || "").trim();
        if (NIVEIS_MEMBRO.includes(nivel)) membros++;
        const ficha: any = fichaPorMatr.get(matr);
        const mesesAtraso = ficha ? Number(ficha.atraso || 0) : 0;
        if (mesesAtraso > 0) emAtraso++;

        const base = {
            nivel, recuperado: b.cad_recuperado === "S",
            ingresso: dataOuNull(b.cad_ingresso), reingresso: dataOuNull(b.cad_reingresso),
        };
        const turmaAtual = (b.cad_tur_unidade || U) === U ? turmaPorNome.get(b.cad_turma) : undefined;
        const comp = calcularCompetencia(base, turmaAtual, aberturas);
        const lead = leadPorMatr.get(matr);
        if (lead) vinculados++;

        // TODAS as linhas com as mesmas chaves — o upsert em lote do supabase-js
        // preenche chave ausente com null e sobrescreveria o valor real.
        linhasAlunos.push({
            matricula: Number(matr), unidade: U, filial: filial.nome,
            pessoa_identificador: lead ? lead.pessoaIdentificador : null,
            nome: b.cad_nome, nivel, turma_unidade: b.cad_tur_unidade || null, turma: b.cad_turma || null,
            ingresso: base.ingresso, reingresso: base.reingresso, recuperado: base.recuperado,
            ...comp,
            midia_ingresso: b.cad_midia_ingresso != null ? Number(b.cad_midia_ingresso) : null,
            contribuicao: b.cad_contribuicao != null ? Number(b.cad_contribuicao) : null,
            meses_em_atraso: mesesAtraso, ultimo_pagamento: ficha ? dataOuNull(ficha.ultimo) : null,
            ativo: true, visto_em: inicioRodada, removido_em: null,
        });

        if (!lead) continue;

        // ----- atualização do lead (só o que mudou; nunca sobrescreve contato) -----
        const payload: Record<string, unknown> = {};
        const tagsAntigas = parseTags(lead.tags).map((t) => String(t).trim());
        let tags = [...tagsAntigas];
        if (base.recuperado && !tags.includes("Recuperado")) tags.push("Recuperado");
        if (mesesAtraso > 0 && !tags.includes(TAG_ATRASO)) tags.push(TAG_ATRASO);
        if (mesesAtraso === 0) tags = tags.filter((t) => t !== TAG_ATRASO);

        if (comp.data_efetiva && comp.data_efetiva !== lead.data_matricula) payload.data_matricula = comp.data_efetiva;

        const temTelefone = soDigitos(lead.pessoaTelefoneNumero).length >= 8;
        const celular = soDigitos(b.cad_cel_fone).length >= 8 ? { ddd: b.cad_cel_ddd, fone: b.cad_cel_fone } : (soDigitos(b.cad_res_fone).length >= 8 ? { ddd: b.cad_res_ddd, fone: b.cad_res_fone } : null);
        if (!temTelefone && celular && Number(celular.ddd) > 0) {
            payload.pessoaTelefoneDDD = String(celular.ddd);
            payload.pessoaTelefoneNumero = soDigitos(celular.fone);
            tags = tags.filter((t) => t !== "Sem Telefone");
        }
        const email = String(b.cad_email || "").trim();
        if (!lead.pessoaEmail && email.includes("@")) { payload.pessoaEmail = email.toLowerCase(); tags = tags.filter((t) => t !== "Sem E-mail"); }
        const nasc = dataOuNull(b.cad_nascimento);
        if (!lead.data_nascimento && nasc) payload.data_nascimento = nasc;
        if (!lead.cidade && b.cad_res_cidade) payload.cidade = String(b.cad_res_cidade).trim();
        if (!lead.uf && b.cad_res_uf) payload.uf = String(b.cad_res_uf).trim();

        if (JSON.stringify(tags) !== JSON.stringify(tagsAntigas)) payload.tags = JSON.stringify(tags);
        if (Object.keys(payload).length) atualizacoesLeads.push({ id: lead.pessoaIdentificador, payload });
    }

    for (let i = 0; i < linhasAlunos.length; i += 500) {
        const { error } = await supabaseAdmin.from("mercurio_alunos").upsert(linhasAlunos.slice(i, i + 500), { onConflict: "matricula,unidade" });
        if (error) throw new Error(`mercurio_alunos: ${error.message}`);
    }
    // Quem não apareceu nesta rodada saiu do Mercúrio: guarda a competência antiga.
    const { count: saidos } = await supabaseAdmin.from("mercurio_alunos")
        .update({ ativo: false, removido_em: inicioRodada }, { count: "exact" })
        .eq("unidade", U).eq("ativo", true).lt("visto_em", inicioRodada);

    // Quem saiu do Mercúrio também perde a tag de atraso.
    const { data: saidosComLead } = await supabaseAdmin.from("mercurio_alunos")
        .select("pessoa_identificador").eq("unidade", U).eq("removido_em", inicioRodada).not("pessoa_identificador", "is", null);
    for (const s of saidosComLead || []) {
        const { data: l } = await supabaseAdmin.from(NOME_TABELA_LEADS).select("tags").eq("pessoaIdentificador", s.pessoa_identificador).maybeSingle();
        const tags = parseTags(l?.tags);
        if (tags.includes(TAG_ATRASO)) atualizacoesLeads.push({ id: s.pessoa_identificador, payload: { tags: JSON.stringify(tags.filter((t) => t !== TAG_ATRASO)) } });
    }

    let falhasLeads = 0;
    await emLotes(atualizacoesLeads, 8, async (u) => {
        const { error } = await supabaseAdmin.from(NOME_TABELA_LEADS).update(u.payload).eq("pessoaIdentificador", u.id);
        if (error) { falhasLeads++; console.warn(`[mercurio-db] lead ${u.id}:`, error.message); }
    });

    await supabaseAdmin.from("filiais").update({ membros_mercurio: membros }).eq("nome", filial.nome);

    const mesAtual = hoje.slice(0, 7);
    return {
        filial: filial.nome, unidade: U, turmas: turmas.length, alunos: alunosBrutos.length,
        vinculados_a_lead: vinculados, sem_lead_no_crm: alunosBrutos.length - vinculados,
        leads_atualizados: atualizacoesLeads.length - falhasLeads, falhas_leads: falhasLeads,
        saidos_do_mercurio: saidos ?? 0, membros, em_atraso: emAtraso,
        matriculas_mes_atual: linhasAlunos.filter((l) => l.competencia === mesAtual && l.conta_remuneracao).length,
        investigar_mes_atual: linhasAlunos.filter((l) => l.investigar_competencia === mesAtual).length,
    };
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    const inicioRodada = new Date().toISOString();
    let corpo: any = {};
    try { corpo = await req.json(); } catch { /* corpo vazio = todas as filiais */ }

    try {
        let q = supabaseAdmin.from("filiais").select("nome, mercurio_unidade").eq("ativo", true).not("mercurio_unidade", "is", null);
        if (corpo.filial) q = q.eq("nome", corpo.filial);
        const { data: filiais, error } = await q;
        if (error) throw new Error(error.message);
        if (!filiais?.length) return json({ ok: false, erro: "Nenhuma filial com mercurio_unidade configurado" }, 400);

        const pma = await abrirSessaoPhpMyAdmin();
        const [atualizacao] = await pma.consultar("SELECT data FROM `atualização`", "atualização");

        const resultados: any[] = [];
        for (const f of filiais) {
            try {
                resultados.push(await sincronizarFilial(pma, { nome: f.nome, unidade: f.mercurio_unidade }, inicioRodada));
            } catch (e) {
                resultados.push({ filial: f.nome, erro: (e as Error).message });
            }
        }
        const falhas = resultados.filter((r) => r.erro);
        const resumo = resultados.map((r) => r.erro ? `${r.filial}: ERRO ${r.erro}` : `${r.filial}: ${r.alunos} alunos, ${r.matriculas_mes_atual} matrícula(s) no mês, ${r.em_atraso} em atraso`).join(" | ");
        await supabaseAdmin.from("status_sincronizacao_automatica").insert({
            sistema: "mercurio_db", filial: corpo.filial || "GLOBAL", sucesso: falhas.length === 0,
            mensagem: `Base do Mercúrio de ${atualizacao?.data ?? "?"} — ${resumo}`.slice(0, 1000), executado_em: new Date().toISOString(),
        });
        return json({ ok: falhas.length === 0, base_atualizada_em: atualizacao?.data ?? null, resultados });
    } catch (e) {
        await supabaseAdmin.from("status_sincronizacao_automatica").insert({
            sistema: "mercurio_db", filial: corpo.filial || "GLOBAL", sucesso: false,
            mensagem: (e as Error).message.slice(0, 1000), executado_em: new Date().toISOString(),
        });
        return json({ ok: false, erro: (e as Error).message }, 500);
    }
});

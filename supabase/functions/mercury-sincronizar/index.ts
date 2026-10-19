// Sincroniza leads_inscricoes direto da API externa do Mercury (v2 do
// Mercúrio) — substitui a raspagem Playwright de Ativos/Inativos/Turmas
// (scraper/mercurio.js) por chamadas REST, sem Cloudflare, sem
// <frameset>, sem risco de index drift entre filiais. Validado contra
// produção nesta sessão (ver migracao_mercury_api.sql): matricula_mercurio
// já gravado bate 100% com o registrationNo do Mercury; admissionDate é
// a fonte de verdade nova pra data_matricula (prova real: José Augusto
// Carneiro, matr. 46104 — nosso banco tinha data_matricula=2026-10-02,
// errado; Mercury diz admissionDate=2025-04-30, batendo com o histórico
// de contribuições dele).
//
// 2 fases por filial, nessa ordem:
//   1) /people (sempre, rápido — ~30 páginas no total pras 5 filiais) —
//      atualiza nível/Ativo-Inativo/data_matricula/Recuperado.
//   2) dossiê (telefone/e-mail/cidade/UF/nascimento/motivo de saída) —
//      1 chamada HTTP por pessoa, cara demais pra fazer em todo mundo de
//      uma vez (poderia estourar o tempo de execução da function) — só
//      um LOTE pequeno por rodada (LOTE_DOSSIE_POR_RODADA), priorizando
//      quem nunca foi sincronizado (mercury_dossier_sincronizado_em is
//      null); se espalha sozinho ao longo de vários dias, mesmo padrão
//      já usado em data_matricula_verificada_mercurio_em.
//
// Lacuna conhecida: o campo `reentry` do Mercury vem sempre
// "not_in_domain_model" (confirmado testando) — não dá pra usar como
// sinal de reingresso. "Recuperado" continua sendo derivado por nós:
// se o lead JÁ estava Inativo no nosso banco e o Mercury agora diz
// active=true, aplicamos a tag — mesmo sinal de sempre, só que sem
// precisar raspar a tela HISTÓRICO do Mercúrio antigo.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin, NOME_TABELA_LEADS } from "../_shared/supabaseAdmin.ts";
import {
    paginarMercury, chamarMercury, MAPEAMENTO_FILIAL_MERCURY, filialParaBranchId,
    nivelPorCodigoMercury, normalizarNomeMercury, partirTelefoneMercury, isoParaDataBR,
} from "../_shared/mercury.ts";

const LOTE_DOSSIE_POR_RODADA = 30; // por filial, por rodada — ver comentário acima
const BASE_ID_SINTETICO_MERCURY = 996000000; // faixa própria, nunca colide com 900M/950M/970M/980M/985M/990M já em uso

const TAGS_NIVEL = ["Merlin", "CA", "JN", "PP", "N1", "Membro", "TA"];
const TAGS_STATUS_ATIVO = ["Ativo", "Aluno Ativo"];
const TAGS_STATUS_INATIVO = ["Inativo", "Ex-Aluno (Inativo)"];

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function parseTags(bruto: unknown): string[] {
    if (!bruto) return [];
    if (Array.isArray(bruto)) return bruto as string[];
    try {
        const parsed = JSON.parse(String(bruto));
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

async function registrarStatus(filial: string, sucesso: boolean, mensagem: string) {
    const { error } = await supabaseAdmin.from("status_sincronizacao_automatica").insert({
        sistema: "mercury_api", filial, sucesso, mensagem, executado_em: new Date().toISOString(),
    });
    // BUG REAL já corrigido nesta sessão: a constraint de `sistema` só
    // aceitava 'ulisses'/'mercurio' — todo insert com 'mercury_api' falhava
    // SEM lançar exceção (só `.insert()` sem checar error), silenciosamente
    // perdendo todo o log de auditoria (ver migracao_status_sync_mercury_api.sql).
    // Nunca mais engolir esse erro — loga pelo menos, mesmo sendo best-effort.
    if (error) console.warn(`[mercury-sync] falha ao registrar status (${filial}):`, error.message);
}

async function sincronizarPeopleDaFilial(filial: string, branchId: string) {
    const { data: filialRow } = await supabaseAdmin.from("filiais").select("id").eq("nome", filial).maybeSingle();
    if (!filialRow) throw new Error(`Filial "${filial}" não encontrada em \`filiais\``);
    const offsetFilial = Number(filialRow.id) * 1000000;

    // Carrega todos os leads já existentes desta filial, em 2 mapas —
    // mesma técnica de carregarMapaLeadsPorNome() (scraper/mercurio.js).
    const porMatricula = new Map<string, any>();
    const porNome = new Map<string, any[]>();
    let de = 0;
    for (;;) {
        const { data, error } = await supabaseAdmin
            .from(NOME_TABELA_LEADS)
            .select("pessoaIdentificador, pessoaNome, tags, matricula_mercurio, data_matricula, pessoaTelefoneDDD, pessoaTelefoneNumero")
            .eq("filial", filial)
            .order("pessoaIdentificador", { ascending: true })
            .range(de, de + 999);
        if (error) throw new Error(`Falha lendo leads existentes: ${error.message}`);
        for (const l of data || []) {
            if (l.matricula_mercurio != null) porMatricula.set(String(l.matricula_mercurio), l);
            else {
                const chave = normalizarNomeMercury(l.pessoaNome);
                if (!porNome.has(chave)) porNome.set(chave, []);
                porNome.get(chave)!.push(l);
            }
        }
        if (!data || data.length < 1000) break;
        de += 1000;
    }

    let processados = 0, criados = 0, atualizados = 0, recuperados = 0;
    const linhasParaUpsert: any[] = [];

    for await (const p of paginarMercury<any>("/people", { branchId })) {
        processados++;
        const registrationNo = String(p.registrationNo || "").trim();
        if (!registrationNo) continue;
        const nomeNormalizado = normalizarNomeMercury(p.fullName);

        let leadExistente = porMatricula.get(registrationNo) || null;
        if (!leadExistente) {
            const candidatos = porNome.get(nomeNormalizado) || [];
            if (candidatos.length === 1) leadExistente = candidatos[0]; // só resolve sem ambiguidade — mesma cautela de sempre
        }

        const tagsAntigas = leadExistente ? parseTags(leadExistente.tags) : [];
        const estavaInativo = tagsAntigas.some((t) => TAGS_STATUS_INATIVO.includes(t));
        const novoAtivo = !!p.active;
        const viraRecuperado = estavaInativo && novoAtivo && !tagsAntigas.includes("Recuperado");
        if (viraRecuperado) recuperados++;

        const nivelTag = nivelPorCodigoMercury(p.level ? p.level.code : null);
        let tagsFinais = tagsAntigas.filter((t) =>
            !TAGS_STATUS_ATIVO.includes(t) && !TAGS_STATUS_INATIVO.includes(t) && !TAGS_NIVEL.includes(t)
            && !String(t).startsWith("Lead Forte") && !String(t).startsWith("Jornada:") // mesma regra já corrigida pra Ativo/Inativo não conviver com essas (ver CLAUDE.md)
        );
        tagsFinais.push(novoAtivo ? "Ativo" : "Inativo");
        if (nivelTag) tagsFinais.push(nivelTag);
        if (viraRecuperado) tagsFinais.push("Recuperado");
        else if (tagsAntigas.includes("Recuperado")) tagsFinais.push("Recuperado"); // preserva, é permanente

        const pessoaIdentificador = leadExistente
            ? leadExistente.pessoaIdentificador
            : String(BASE_ID_SINTETICO_MERCURY + offsetFilial + Number(registrationNo));

        // BUG REAL já corrigido nesta sessão, documentado em detalhe no
        // CLAUDE.md (seção "mercury-sincronizar"): o `.upsert()` do
        // supabase-js, quando as linhas de um MESMO lote têm conjuntos de
        // CHAVES diferentes (ex: só o lead novo carrega `pessoaNome`),
        // normaliza o array preenchendo a chave ausente com `null` antes
        // de mandar pro PostgREST — e isso *sobrescreve* o valor real via
        // `ON CONFLICT`, mesmo a intenção sendo só "não mexer nesse
        // campo". Confirmado com um teste isolado contra produção. Por
        // isso TODA linha do lote precisa ter exatamente as MESMAS
        // chaves — nunca omitir condicionalmente, sempre "preservar o
        // valor antigo" explicitamente em vez de "não incluir a chave".
        const linha: any = {
            pessoaIdentificador,
            filial,
            tags: JSON.stringify(tagsFinais),
            matricula_mercurio: Number(registrationNo),
            // admissionDate é autoritativo (decisão do usuário, "ir
            // direto pro tudo") — substitui qualquer data_matricula
            // errada que a raspagem antiga já tenha gravado. Sem
            // admissionDate (raro — só vimos em contas de sistema/seed),
            // preserva o que já existia em vez de arriscar nular.
            // Exceção: em quem é "Recuperado", data_matricula é a data de
            // REINGRESSO, gravada por mercurio-db-sincronizar a partir do banco
            // do Mercúrio (admissionDate é sempre o 1º ingresso, anos atrás).
            data_matricula: (leadExistente && leadExistente.data_matricula && tagsAntigas.includes("Recuperado"))
                ? leadExistente.data_matricula
                : (p.admissionDate || (leadExistente ? leadExistente.data_matricula : null)),
            pessoaNome: leadExistente ? leadExistente.pessoaNome : p.fullName,
        };

        linhasParaUpsert.push(linha);
        if (leadExistente) atualizados++; else criados++;
    }

    // Rede de segurança já conhecida do projeto (ver "Bug real #3" no
    // CLAUDE.md, mesmo sintoma aqui): se 2+ pessoas do Mercury resolverem
    // pro MESMO pessoaIdentificador existente (ex: 2 registrationNo
    // distintos com nome idêntico, cada um casando por nome com o mesmo
    // único candidato), o Postgres recusa o LOTE INTEIRO com "ON CONFLICT
    // DO UPDATE command cannot affect row a second time" — confirmado
    // batendo em Jardim América. Dedup por pessoaIdentificador (fica só a
    // última ocorrência) antes do upsert, nunca deixa 1 colisão travar a
    // filial inteira.
    const porId = new Map<string, any>();
    for (const l of linhasParaUpsert) porId.set(l.pessoaIdentificador, l);
    const linhasDedup = [...porId.values()];
    if (linhasDedup.length !== linhasParaUpsert.length) {
        console.warn(`[mercury-sync] ${linhasParaUpsert.length - linhasDedup.length} colisão(ões) de pessoaIdentificador em ${filial} — deduplicadas (só a última ocorrência foi mantida).`);
    }

    for (let i = 0; i < linhasDedup.length; i += 500) {
        const lote = linhasDedup.slice(i, i + 500);
        const { error } = await supabaseAdmin.from(NOME_TABELA_LEADS).upsert(lote, { onConflict: "pessoaIdentificador" });
        if (error) throw new Error(`Falha no upsert (lote ${i}): ${error.message}`);
    }

    return { processados, criados, atualizados, recuperados };
}

async function sincronizarDossieDaFilial(filial: string) {
    const { data: candidatos, error } = await supabaseAdmin
        .from(NOME_TABELA_LEADS)
        .select("pessoaIdentificador, matricula_mercurio, pessoaTelefoneDDD, pessoaTelefoneNumero, pessoaEmail, cidade, uf, data_nascimento, motivo_saida, data_saida, tags")
        .eq("filial", filial)
        .is("mercury_dossier_sincronizado_em", null)
        .not("matricula_mercurio", "is", null)
        .limit(LOTE_DOSSIE_POR_RODADA);
    if (error) throw new Error(`Falha buscando candidatos a dossiê: ${error.message}`);

    let atualizados = 0, erros = 0;
    for (const lead of candidatos || []) {
        try {
            const dossie = await chamarMercury<any>(`/people/${lead.matricula_mercurio}/dossier`);
            const update: any = { mercury_dossier_sincronizado_em: new Date().toISOString() };

            if (!lead.pessoaTelefoneDDD && !lead.pessoaTelefoneNumero) {
                const tel = partirTelefoneMercury(dossie.phones ? dossie.phones.primary : null);
                if (tel) { update.pessoaTelefoneDDD = tel.ddd; update.pessoaTelefoneNumero = tel.numero; }
            }
            if (!lead.pessoaEmail && dossie.email) update.pessoaEmail = dossie.email;
            if (!lead.cidade && dossie.city) update.cidade = dossie.city;
            if (!lead.uf && dossie.state) update.uf = dossie.state;
            if (!lead.data_nascimento && dossie.birthDate) update.data_nascimento = dossie.birthDate;
            const tagsAtuais = parseTags(lead.tags);
            const ehInativo = tagsAtuais.some((t) => TAGS_STATUS_INATIVO.includes(t));
            if (ehInativo && !lead.motivo_saida && !lead.data_saida && dossie.deactivation) {
                if (dossie.deactivation.reason) update.motivo_saida = dossie.deactivation.reason;
                if (dossie.deactivation.at) update.data_saida = isoParaDataBR(dossie.deactivation.at);
            }

            const { error: updErr } = await supabaseAdmin.from(NOME_TABELA_LEADS).update(update).eq("pessoaIdentificador", lead.pessoaIdentificador);
            if (updErr) { erros++; continue; }
            atualizados++;
        } catch (e) {
            erros++;
            // best-effort — 1 falha de dossiê nunca trava o resto do lote
            console.warn(`[mercury-dossie] falha em matricula=${lead.matricula_mercurio}:`, (e as Error).message);
        }
    }
    return { processados: (candidatos || []).length, atualizados, erros };
}

// Rede de Ativos/Inativos (pessoas_ativas_rede): status do aluno visível em
// QUALQUER filial, casado só por telefone/e-mail (nunca por nome). Antes rodava
// no scraper antigo (scraper/mercurio.js, sincronizarRedeAtivosInativos);
// veio pra cá quando o scraper foi desligado, já que roda logo depois de
// Ativo/Inativo estarem atualizados nesta filial.
function telefoneChaveRede(ddd: unknown, numero: unknown): string | null {
    const d = String(ddd ?? "").replace(/\D/g, "");
    let n = String(numero ?? "").replace(/\D/g, "");
    if (!d || !n) return null;
    if (n.length === 9 && n.startsWith("9")) n = n.slice(1);
    return n.length === 8 ? d + n : null;
}

async function sincronizarRedeAtivosInativos(filial: string) {
    const leads: any[] = [];
    for (let de = 0; ; de += 1000) {
        const { data, error } = await supabaseAdmin.rpc("leads_ativos_inativos_da_filial", { p_filial: filial }).range(de, de + 999);
        if (error) throw new Error(`rede: ${error.message}`);
        leads.push(...(data || []));
        if (!data || data.length < 1000) break;
    }
    const existentes: any[]=[];
    for(let de=0;;de+=1000) {
        const {data,error}=await supabaseAdmin.from("pessoas_ativas_rede").select("id, telefone_normalizado, email_normalizado, nome, status, filial").order("id").range(de,de+999);
        if(error)throw new Error("rede: "+error.message);existentes.push(...(data||[]));if(!data||data.length<1000)break;
    }
    const porTel = new Map<string, any[]>(), porEmail = new Map<string, any[]>();
    for (const r of existentes) {
        for(const [mapa,chave] of [[porTel,r.telefone_normalizado],[porEmail,r.email_normalizado]] as const) {
            if(!chave)continue;if(!mapa.has(chave))mapa.set(chave,[]);mapa.get(chave)!.push(r);
        }
    }
    // Só grava quem mudou (Jardim América tem ~2.700 pessoas: gravar todas,
    // uma a uma, estourava o limite de 150s da Edge Function).
    const escritas: (() => Promise<unknown>)[] = [];
    for (const lead of leads) {
        const tags = parseTags(lead.tags).map((t) => String(t).trim());
        if(tags.includes("Contato em conferência"))continue;
        const status = tags.includes("Ativo") ? "Ativo" : (tags.includes("Inativo") ? "Inativo" : null);
        if (!status) continue;
        const tel = telefoneChaveRede(lead.pessoaTelefoneDDD, lead.pessoaTelefoneNumero);
        const email = String(lead.pessoaEmail || "").trim().toLowerCase() || null;
        if (!tel && !email) continue;
        const candidatos=[...(tel?porTel.get(tel)||[]:[]),...(email?porEmail.get(email)||[]:[])];
        const atual=candidatos.find(r=>normalizarNomeMercury(r.nome)===normalizarNomeMercury(lead.pessoaNome)&&r.filial===filial)||null;
        if (atual && atual.status === status && atual.filial === filial && atual.nome === lead.pessoaNome
            && atual.telefone_normalizado === tel && atual.email_normalizado === email) continue;
        const payload = { telefone_normalizado: tel, email_normalizado: email, nome: lead.pessoaNome, status, filial, atualizado_em: new Date().toISOString() };
        escritas.push(() => atual
            ? supabaseAdmin.from("pessoas_ativas_rede").update(payload).eq("id", atual.id)
            : supabaseAdmin.from("pessoas_ativas_rede").insert(payload));
    }
    let gravados = 0;
    for (let i = 0; i < escritas.length; i += 20) {
        const res = await Promise.all(escritas.slice(i, i + 20).map((f) => f()));
        gravados += res.filter((r: any) => !r.error).length;
    }
    return gravados;
}

Deno.serve(async (req) => {
    const corsResp = handleCors(req);
    if (corsResp) return corsResp;

    let body: any = {};
    try { body = await req.json(); } catch { /* body vazio é válido */ }
    const filialFiltro: string | undefined = body.filial;

    const alvos = filialFiltro
        ? [[filialParaBranchId(filialFiltro), filialFiltro]].filter(([bid]) => bid) as [string, string][]
        : Object.entries(MAPEAMENTO_FILIAL_MERCURY).map(([bid, nome]) => [bid, nome] as [string, string]);

    if (alvos.length === 0) return json({ ok: false, erro: `Filial "${filialFiltro}" não mapeada em MAPEAMENTO_FILIAL_MERCURY` }, 400);

    const resultados: any[] = [];
    for (const [branchId, filial] of alvos) {
        try {
            const people = await sincronizarPeopleDaFilial(filial, branchId);
            const dossie = await sincronizarDossieDaFilial(filial);
            let rede = "";
            try { rede = ` Rede: ${await sincronizarRedeAtivosInativos(filial)} pessoa(s).`; }
            catch (e) { rede = ` Rede: falhou (${(e as Error).message}).`; }
            const msg = `/people: ${people.processados} processado(s), ${people.criados} novo(s), ${people.atualizados} atualizado(s), ${people.recuperados} recuperação(ões). Dossiê: ${dossie.atualizados}/${dossie.processados} (${dossie.erros} erro(s)).${rede}`;
            await registrarStatus(filial, true, msg);
            resultados.push({ filial, ok: true, people, dossie });
        } catch (e) {
            const msg = (e as Error).message;
            await registrarStatus(filial, false, msg);
            resultados.push({ filial, ok: false, erro: msg });
        }
    }

    return json({ ok: true, resultados });
});

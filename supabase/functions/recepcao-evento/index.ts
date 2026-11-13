// Recepção de evento (13/11/2026, Dia Mundial da Filosofia): a equipe da porta marca presença no
// Ulisses e inscreve na hora quem chegou sem inscrição. Página: recepcao.html#<chave>.
//
// Acesso: chave do link (só o hash no banco, recepcao_links) + PIN de 6 dígitos -> sessão de 16 h
// (recepcao_sessoes). Toda ação traz client_id gerado no aparelho: a página guarda as ações numa
// fila quando a internet cai e reenvia depois; o client_id impede gravar duas vezes.
//
// Ulisses: presença = POST /facade/compareceu/{emailEventoId}/{true|false}; inscrição na porta =
// POST /salvarInscricaoV2 (a mesma chamada do formulário público, com pontoConversao "recepcao").
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chamarUlisses, filtrarEmails } from "../_shared/ulisses.ts";

const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const HORAS_SESSAO = 16, MAX_TENTATIVAS_PIN = 5, MINUTOS_BLOQUEIO_PIN = 10;

function responder(corpo: unknown, status = 200) {
    return new Response(JSON.stringify(corpo), { status, headers: { ...cors, "content-type": "application/json" } });
}
async function sha256(t: string) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const uuidOk = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const texto = (s: unknown, max = 160) => (typeof s === "string" ? s.trim().slice(0, max) : "") || null;

function normalizarNome(s: string) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
}
// Nome digitado/falado vira "Maria da Silva" (o Ulisses guarda como a pessoa escreve).
function nomeProprio(s: string) {
    const minusc = new Set(["da", "de", "do", "das", "dos", "e"]);
    return s.trim().replace(/\s+/g, " ").toLowerCase().split(" ")
        .map((p, i) => (i > 0 && minusc.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
}

async function registrar(linha: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin.from("recepcao_registros").insert(linha).select("id").maybeSingle();
    if (error) {
        if (/duplicate key/i.test(error.message)) return null; // mesmo client_id já gravado
        throw new Error(error.message);
    }
    return data?.id ?? null;
}
async function concluir(clientId: string, status: "ok" | "erro", extra: Record<string, unknown> = {}) {
    await supabaseAdmin.from("recepcao_registros").update({ status, atualizado_em: new Date().toISOString(), ...extra }).eq("client_id", clientId);
}

async function marcarNoUlisses(emailEventoId: number, compareceu: boolean) {
    await chamarUlisses(supabaseAdmin, `/facade/compareceu/${emailEventoId}/${compareceu ? "true" : "false"}`, { method: "POST" });
    await supabaseAdmin.from("ulisses_inscricoes_evento").update({ compareceu, visto_em: new Date().toISOString() }).eq("email_evento_id", emailEventoId);
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    let corpo: any = {};
    try { corpo = await req.json(); } catch { return responder({ ok: false, erro: "Pedido inválido." }, 400); }
    const acao = String(corpo.acao || "");
    const chave = String(corpo.chave || "");
    if (!/^[A-Za-z0-9_-]{20,}$/.test(chave)) return responder({ ok: false, erro: "Link inválido." }, 400);

    const { data: link } = await supabaseAdmin.from("recepcao_links").select("*").eq("chave_hash", await sha256(chave)).maybeSingle();
    if (!link || link.revogado_em || new Date(link.expira_em) < new Date()) return responder({ ok: false, erro: "Link inválido ou expirado." }, 403);

    // ---- Entrar com o PIN ----
    if (acao === "pin") {
        if (link.pin_bloqueado_ate && new Date(link.pin_bloqueado_ate) > new Date()) {
            return responder({ ok: false, erro: "PIN bloqueado por alguns minutos após várias tentativas erradas." }, 429);
        }
        const pin = digitos(corpo.pin);
        if (pin.length !== 6 || (await sha256(`${link.id}:${pin}`)) !== link.pin_hash) {
            const t = (link.pin_tentativas || 0) + 1, bloquear = t >= MAX_TENTATIVAS_PIN;
            await supabaseAdmin.from("recepcao_links").update({
                pin_tentativas: bloquear ? 0 : t,
                pin_bloqueado_ate: bloquear ? new Date(Date.now() + MINUTOS_BLOQUEIO_PIN * 60000).toISOString() : null,
            }).eq("id", link.id);
            return responder({ ok: false, erro: bloquear ? `PIN bloqueado por ${MINUTOS_BLOQUEIO_PIN} min.` : "PIN incorreto." }, 401);
        }
        const token = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
        const expira = new Date(Date.now() + HORAS_SESSAO * 3600000).toISOString();
        await supabaseAdmin.from("recepcao_sessoes").insert({ token_hash: await sha256(token), link_id: link.id, apelido: texto(corpo.apelido, 60), expira_em: expira });
        await supabaseAdmin.from("recepcao_links").update({ pin_tentativas: 0 }).eq("id", link.id);
        return responder({ ok: true, sessao: token, expira_em: expira });
    }

    // ---- Daqui em diante, só com sessão ----
    const sessaoTxt = String(corpo.sessao || "");
    const { data: sessao } = /^[a-f0-9]{64}$/.test(sessaoTxt)
        ? await supabaseAdmin.from("recepcao_sessoes").select("link_id, apelido, expira_em").eq("token_hash", await sha256(sessaoTxt)).maybeSingle()
        : { data: null };
    if (!sessao || sessao.link_id !== link.id || new Date(sessao.expira_em) < new Date()) {
        return responder({ ok: false, erro: "Entre com o PIN.", precisa_pin: true }, 401);
    }
    const autor = `Recepção${sessao.apelido ? " — " + sessao.apelido : ""}`;

    try {
        if (acao === "lista") {
            const [{ data: ev }, { data: inscritos, error }, { data: regs }] = await Promise.all([
                supabaseAdmin.from("eventos").select("nome, data, hora").eq("id", link.evento_id).maybeSingle(),
                supabaseAdmin.rpc("recepcao_lista", { p_evento_id_ulisses: link.evento_id_ulisses }),
                supabaseAdmin.from("recepcao_registros").select("client_id, tipo, email_evento_id, nome, status, erro, veio_com, interesse_curso, autor, criado_em")
                    .eq("evento_id_ulisses", link.evento_id_ulisses).order("criado_em", { ascending: false }).limit(400),
            ]);
            if (error) throw new Error(error.message);
            return responder({ ok: true, evento: ev, rotulo: link.rotulo, inscritos, registros: regs || [], agora: new Date().toISOString() });
        }

        if (acao === "presenca") {
            const clientId = corpo.client_id, eeId = Number(corpo.email_evento_id), comp = corpo.compareceu !== false;
            if (!uuidOk(clientId) || !eeId) return responder({ ok: false, erro: "Pedido inválido." }, 400);
            const { data: insc } = await supabaseAdmin.from("ulisses_inscricoes_evento").select("nome, pessoaIdentificador")
                .eq("email_evento_id", eeId).eq("evento_id_ulisses", link.evento_id_ulisses).maybeSingle();
            if (!insc) return responder({ ok: false, erro: "Inscrição não encontrada neste evento.", definitivo: true }, 404);
            const novo = await registrar({
                client_id: clientId, link_id: link.id, evento_id_ulisses: link.evento_id_ulisses, tipo: comp ? "presenca" : "desfazer",
                email_evento_id: eeId, nome: insc.nome, pessoa_identificador: insc.pessoaIdentificador, autor,
                veio_com: texto(corpo.veio_com), interesse_curso: typeof corpo.interesse_curso === "boolean" ? corpo.interesse_curso : null,
                criado_no_aparelho: texto(corpo.criado_no_aparelho, 40),
            });
            if (novo === null) {
                const { data: ja } = await supabaseAdmin.from("recepcao_registros").select("status, erro").eq("client_id", clientId).maybeSingle();
                if (ja?.status === "ok") return responder({ ok: true, repetido: true });
            }
            try { await marcarNoUlisses(eeId, comp); }
            catch (e) { await concluir(clientId, "erro", { erro: (e as Error).message }); return responder({ ok: false, erro: (e as Error).message }, 502); }
            await concluir(clientId, "ok", { erro: null });
            return responder({ ok: true });
        }

        // Só leitura: confere se o caminho até o Ulisses (ponte + acesso) está de pé.
        if (acao === "teste_ulisses") {
            const inicio = Date.now();
            const pessoas = await filtrarEmails(supabaseAdmin, link.evento_id_ulisses, link.filial_id_ulisses);
            return responder({ ok: true, inscritos_no_ulisses: (pessoas || []).length, ms: Date.now() - inicio });
        }

        // Informações coletadas depois de marcar (veio com quem, interesse no curso).
        if (acao === "anotar") {
            const eeId = Number(corpo.email_evento_id);
            if (!eeId) return responder({ ok: false, erro: "Pedido inválido." }, 400);
            const mudar: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
            if ("veio_com" in corpo) mudar.veio_com = texto(corpo.veio_com);
            if (typeof corpo.interesse_curso === "boolean") mudar.interesse_curso = corpo.interesse_curso;
            const { data: alvo } = await supabaseAdmin.from("recepcao_registros").select("id").eq("email_evento_id", eeId)
                .in("tipo", ["presenca", "inscricao"]).order("criado_em", { ascending: false }).limit(1).maybeSingle();
            if (!alvo) return responder({ ok: false, erro: "Marque a presença antes." }, 404);
            await supabaseAdmin.from("recepcao_registros").update(mudar).eq("id", alvo.id);
            return responder({ ok: true });
        }

        // Procura na base do CRM quem chegou sem inscrição, para preencher o cadastro sem digitar.
        if (acao === "buscar_base") {
            const termo = normalizarNome(String(corpo.termo || ""));
            const partes = termo.split(" ").filter((p) => p.length >= 2).slice(0, 4);
            if (!partes.length) return responder({ ok: true, pessoas: [] });
            let q = supabaseAdmin.from("leads_inscricoes").select('"pessoaIdentificador", "pessoaNome", "pessoaTelefoneDDD", "pessoaTelefoneNumero", "pessoaEmail", filial')
                .is("lixeira_em", null).limit(12);
            for (const p of partes) q = q.ilike("pessoaNome", `%${p}%`);
            const { data } = await q;
            return responder({ ok: true, pessoas: (data || []).map((l: any) => ({
                pid: l.pessoaIdentificador, nome: l.pessoaNome, filial: l.filial,
                final_tel: digitos(l.pessoaTelefoneNumero).slice(-4), tem_tel: !!digitos(l.pessoaTelefoneNumero), tem_email: !!l.pessoaEmail,
            })) });
        }

        if (acao === "inscrever") {
            const clientId = corpo.client_id;
            if (!uuidOk(clientId)) return responder({ ok: false, erro: "Pedido inválido." }, 400);
            let nome = texto(corpo.nome, 120) || "", ddd = digitos(corpo.ddd).slice(0, 2), tel = digitos(corpo.telefone).slice(-9);
            let email = (texto(corpo.email, 120) || "").toLowerCase();
            const pid = texto(corpo.pid, 40);
            if (pid) {
                const { data: l } = await supabaseAdmin.from("leads_inscricoes").select('"pessoaNome", "pessoaTelefoneDDD", "pessoaTelefoneNumero", "pessoaEmail"')
                    .eq("pessoaIdentificador", pid).maybeSingle();
                if (l) {
                    nome = nome || l.pessoaNome || "";
                    if (!tel) { ddd = digitos(l.pessoaTelefoneDDD).slice(0, 2); tel = digitos(l.pessoaTelefoneNumero).slice(-9); }
                    if (!email) email = String(l.pessoaEmail || "").trim().toLowerCase();
                }
            }
            if (normalizarNome(nome).split(" ").length < 2) return responder({ ok: false, erro: "Informe nome e sobrenome.", definitivo: true }, 400);
            if (ddd.length !== 2 || tel.length < 8) return responder({ ok: false, erro: "Informe o celular com DDD.", definitivo: true }, 400);
            if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responder({ ok: false, erro: "E-mail inválido.", definitivo: true }, 400);
            nome = nomeProprio(nome);

            const novo = await registrar({
                client_id: clientId, link_id: link.id, evento_id_ulisses: link.evento_id_ulisses, tipo: "inscricao",
                nome, ddd, telefone: tel, email: email || null, pessoa_identificador: pid, autor,
                veio_com: texto(corpo.veio_com), interesse_curso: typeof corpo.interesse_curso === "boolean" ? corpo.interesse_curso : null,
                criado_no_aparelho: texto(corpo.criado_no_aparelho, 40),
            });
            if (novo === null) {
                const { data: ja } = await supabaseAdmin.from("recepcao_registros").select("status, email_evento_id").eq("client_id", clientId).maybeSingle();
                if (ja?.status === "ok") return responder({ ok: true, repetido: true, email_evento_id: ja.email_evento_id });
            }
            try {
                await chamarUlisses(supabaseAdmin, "/salvarInscricaoV2", {
                    method: "POST", autenticar: false,
                    corpo: {
                        nome, ddd, telefone: tel, email: email || null, receberInformativo: true,
                        produtoId: link.produto_id_ulisses, produtosId: [link.produto_id_ulisses],
                        pontoConversao: "recepcao", landingPage: false, atualizar: false,
                        utmSource: "crm-recepcao", utmMedium: "recepcao", utmCampaign: link.campanha_slug || null,
                        pagamento: {}, pagamentoV2: {},
                    },
                });
            } catch (e) {
                await concluir(clientId, "erro", { erro: (e as Error).message });
                return responder({ ok: false, erro: (e as Error).message }, 502);
            }
            // Acha a inscrição recém-criada para marcar a presença.
            let eeId: number | null = null, pessoaAchada: any = null;
            for (let tentativa = 0; tentativa < 3 && !eeId; tentativa++) {
                if (tentativa) await new Promise((r) => setTimeout(r, 2000));
                const pessoas = await filtrarEmails(supabaseAdmin, link.evento_id_ulisses, link.filial_id_ulisses);
                const t8 = tel.slice(-8);
                for (const p of pessoas || []) {
                    const bateTel = digitos(p.telefone).slice(-8) === t8 && digitos(p.ddd).slice(-2) === ddd;
                    const bateEmail = email && String(p.email || "").trim().toLowerCase() === email;
                    if (!bateTel && !bateEmail) continue;
                    for (const ee of p.emailEventos || []) {
                        if (ee?.evento?.id === link.evento_id_ulisses && ee.id != null && (!eeId || ee.id > eeId)) { eeId = ee.id; pessoaAchada = p; }
                    }
                }
            }
            if (!eeId) {
                await concluir(clientId, "erro", { erro: "Inscrito no Ulisses, mas a presença não pôde ser marcada (inscrição não encontrada ainda)." });
                return responder({ ok: false, inscrito: true, erro: "Inscrição feita no Ulisses. A presença não foi marcada: procure o nome na lista em 1 minuto." }, 502);
            }
            await supabaseAdmin.from("ulisses_inscricoes_evento").upsert({
                email_evento_id: eeId, evento_id_ulisses: link.evento_id_ulisses, filial_id_ulisses: link.filial_id_ulisses,
                pessoa_id_ulisses: pessoaAchada?.id != null ? String(pessoaAchada.id) : null, nome: pessoaAchada?.nome || nome,
                email: pessoaAchada?.email || email || null, ddd, telefone: tel, compareceu: null,
                inscrito_em: new Date().toISOString(), visto_em: new Date().toISOString(), removido_em: null,
                bruto: { inscricao: { id: eeId, origem: { pontoConversao: "recepcao", utmSource: "crm-recepcao" } } },
            }, { onConflict: "email_evento_id" });
            try { await marcarNoUlisses(eeId, true); }
            catch (e) {
                await concluir(clientId, "erro", { email_evento_id: eeId, erro: "Inscrito, mas a presença falhou: " + (e as Error).message });
                return responder({ ok: false, inscrito: true, email_evento_id: eeId, erro: "Inscrição feita. A presença falhou: marque de novo pela lista." }, 502);
            }
            await concluir(clientId, "ok", { email_evento_id: eeId, erro: null });
            return responder({ ok: true, email_evento_id: eeId });
        }

        return responder({ ok: false, erro: "Ação desconhecida." }, 400);
    } catch (e) {
        return responder({ ok: false, erro: (e as Error).message || "Erro inesperado." }, 500);
    }
});

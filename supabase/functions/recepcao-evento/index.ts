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
import QRCode from "npm:qrcode@1.5.4";

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
async function concluir(clientId: string, status: "ok" | "erro" | "pendente" | "reservado", extra: Record<string, unknown> = {}) {
    await supabaseAdmin.from("recepcao_registros").update({ status, atualizado_em: new Date().toISOString(), ...extra }).eq("client_id", clientId);
}

async function marcarNoUlisses(emailEventoId: number, compareceu: boolean) {
    await chamarUlisses(supabaseAdmin, `/facade/compareceu/${emailEventoId}/${compareceu ? "true" : "false"}`, { method: "POST" });
    await supabaseAdmin.from("ulisses_inscricoes_evento").update({ compareceu, visto_em: new Date().toISOString() }).eq("email_evento_id", emailEventoId);
}

// ---- A porta nunca espera pelo Ulisses (13/11/2026) ----
// Quem manda na porta é recepcao_registros. A presença é gravada aqui na hora; o Ulisses é avisado em seguida,
// com tempo limite. Se ele estiver lento ou fora do ar, o registro fica "pendente" e é reenviado sozinho depois
// (reconciliarUlisses), sem travar a fila dos aparelhos.
const TEMPO_ULISSES_MS = 7000;
function comTempo<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((ok, erro) => {
        const t = setTimeout(() => erro(new Error("o Ulisses demorou a responder")), ms);
        p.then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); erro(e); });
    });
}
async function marcarOuAdiar(clientId: string, emailEventoId: number, compareceu: boolean, simularFalha = false): Promise<boolean> {
    try {
        if (simularFalha) throw new Error("falha simulada (teste)");
        await comTempo(marcarNoUlisses(emailEventoId, compareceu), TEMPO_ULISSES_MS);
        await concluir(clientId, "ok", { erro: null });
        return true;
    } catch (e) {
        await concluir(clientId, "pendente", { erro: "Falta enviar ao Ulisses: " + (e as Error).message });
        return false;
    }
}

// Lista de inscritos do Ulisses com memória curta (20 s): várias mesas conferindo ao mesmo tempo fazem uma chamada só.
const cacheInscritos: Record<string, { em: number; dados: any[] }> = {};
async function inscritosUlisses(link: any, fresco = false): Promise<any[]> {
    const k = `${link.evento_id_ulisses}:${link.filial_id_ulisses}`, c = cacheInscritos[k];
    if (!fresco && c && Date.now() - c.em < 20000) return c.dados;
    const dados = await filtrarEmails(supabaseAdmin, link.evento_id_ulisses, link.filial_id_ulisses) || [];
    cacheInscritos[k] = { em: Date.now(), dados };
    return dados;
}

// Reenvia ao Ulisses o que ficou pendente. Roda em segundo plano quando um aparelho pede a lista, no máximo
// uma vez a cada 30 s por instância e poucas inscrições por vez (não pesa durante o evento).
let ultimaReconciliacao = 0;
async function reconciliarUlisses(link: any, forcar = false): Promise<{ enviados: number; restam: number }> {
    if (!forcar && Date.now() - ultimaReconciliacao < 30000) return { enviados: 0, restam: -1 };
    ultimaReconciliacao = Date.now();
    const antes = new Date(Date.now() - (forcar ? 0 : 45000)).toISOString();
    const { data: pend } = await supabaseAdmin.from("recepcao_registros")
        .select("id, tipo, email_evento_id, nome, ddd, telefone, email, atualizado_em")
        .eq("evento_id_ulisses", link.evento_id_ulisses).eq("status", "pendente").in("tipo", ["presenca", "desfazer", "inscricao"])
        .lt("atualizado_em", antes).order("criado_em", { ascending: true }).limit(60);
    const linhas = pend || [];
    if (!linhas.length) return { enviados: 0, restam: 0 };
    let enviados = 0;
    try {
        // Inscrição feita no Ulisses mas ainda não localizada: procura na lista ao vivo.
        const semId = linhas.filter((l: any) => l.tipo === "inscricao" && !l.email_evento_id && l.email);
        if (semId.length) {
            const pessoas = await comTempo(inscritosUlisses(link, true), 12000);
            for (const l of semId) {
                const t8 = digitos(l.telefone).slice(-8), email = String(l.email || "").toLowerCase();
                let eeId: number | null = null, achado: any = null;
                for (const p of pessoas) {
                    if (!(t8 && digitos(p.telefone).slice(-8) === t8) && String(p.email || "").trim().toLowerCase() !== email) continue;
                    for (const ee of p.emailEventos || []) if (ee?.evento?.id === link.evento_id_ulisses && ee.id != null && (!eeId || ee.id > eeId)) { eeId = ee.id; achado = p; }
                }
                if (!eeId) continue;
                await supabaseAdmin.from("ulisses_inscricoes_evento").upsert({
                    email_evento_id: eeId, evento_id_ulisses: link.evento_id_ulisses, filial_id_ulisses: link.filial_id_ulisses,
                    pessoa_id_ulisses: achado?.id != null ? String(achado.id) : null, nome: achado?.nome || l.nome, email: achado?.email || l.email,
                    ddd: l.ddd, telefone: l.telefone, inscrito_em: new Date().toISOString(), visto_em: new Date().toISOString(), removido_em: null,
                    bruto: { inscricao: { id: eeId, origem: { pontoConversao: "recepcao" } } },
                }, { onConflict: "email_evento_id", ignoreDuplicates: true });
                await supabaseAdmin.from("recepcao_registros").update({ email_evento_id: eeId }).eq("id", l.id);
                l.email_evento_id = eeId;
            }
        }
        // Por inscrição, vale o último gesto da porta (presença ou desfazer).
        const porInscricao = new Map<number, number[]>();
        for (const l of linhas) if (l.email_evento_id) porInscricao.set(l.email_evento_id, [...(porInscricao.get(l.email_evento_id) || []), l.id]);
        for (const [eeId, ids] of porInscricao) {
            if (enviados >= 8) break;
            const { data: ult } = await supabaseAdmin.from("recepcao_registros").select("tipo").eq("email_evento_id", eeId)
                .in("tipo", ["presenca", "desfazer", "inscricao"]).neq("status", "erro").order("criado_em", { ascending: false }).limit(1).maybeSingle();
            await comTempo(marcarNoUlisses(eeId, ult?.tipo !== "desfazer"), 9000);
            await supabaseAdmin.from("recepcao_registros").update({ status: "ok", erro: null, atualizado_em: new Date().toISOString() }).in("id", ids);
            enviados++;
        }
    } catch (e) {
        // Ulisses ainda fora: adia a próxima tentativa destas linhas e segue a vida.
        await supabaseAdmin.from("recepcao_registros").update({ atualizado_em: new Date().toISOString(), erro: "Falta enviar ao Ulisses: " + (e as Error).message })
            .in("id", linhas.map((l: any) => l.id)).eq("status", "pendente");
    }
    const { count } = await supabaseAdmin.from("recepcao_registros").select("id", { count: "exact", head: true })
        .eq("evento_id_ulisses", link.evento_id_ulisses).eq("status", "pendente").in("tipo", ["presenca", "desfazer", "inscricao"]);
    return { enviados, restam: count || 0 };
}
function emSegundoPlano(p: Promise<unknown>) {
    const rt = (globalThis as any).EdgeRuntime;
    const seguro = p.catch(() => null);
    if (rt?.waitUntil) rt.waitUntil(seguro);
}

// ---- Passe do check-in (13/11/2026) ----
// QR code com nome, telefone e horário, assinado com ECDSA P-256 (chave privada no segredo PASSE_CHAVE_PRIVADA).
// O validador da segurança (validar.html) confere a assinatura com a chave pública, sem internet.
const URL_VALIDAR = "https://crm-nova-acropole.vercel.app/passe#";
let chavePasse: CryptoKey | null = null;
const nomesEvento: Record<string, string> = {};
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function telefoneBonito(ddd: string, tel: string) {
    const t = digitos(tel).slice(-9);
    return (ddd ? `(${ddd}) ` : "") + (t.length === 9 ? `${t.slice(0, 5)}-${t.slice(5)}` : t.length === 8 ? `${t.slice(0, 4)}-${t.slice(4)}` : t);
}
async function emitirPasse(link: any, dados: { nome: string; ddd?: string; telefone?: string; ref: string; em?: string }) {
    const jwk = Deno.env.get("PASSE_CHAVE_PRIVADA");
    if (!jwk) return null; // sem a chave, segue sem passe (o check-in vale do mesmo jeito)
    // Aceita o JWK direto ou em base64 (mais fácil de gravar com `supabase secrets set`).
    if (!chavePasse) chavePasse = await crypto.subtle.importKey("jwk", JSON.parse(jwk.trim().startsWith("{") ? jwk : atob(jwk.trim())),
        { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    if (!nomesEvento[link.evento_id]) {
        const { data: ev } = await supabaseAdmin.from("eventos").select("nome, data").eq("id", link.evento_id).maybeSingle();
        const titulo = nomeProprio(String(ev?.nome || "").split(" - ")[0]).replace(/(Da|De|Do|Das|Dos|E)/g, (m) => m.toLowerCase());
        nomesEvento[link.evento_id] = ev?.data ? `${titulo} · ${String(ev.data).slice(8, 10)}/${String(ev.data).slice(5, 7)}` : titulo;
    }
    const corpo = { v: 1, ev: link.evento_id_ulisses, en: nomesEvento[link.evento_id], d: dados.em || new Date().toISOString(), n: nomeProprio(dados.nome || ""),
        t: telefoneBonito(dados.ddd || "", dados.telefone || ""), r: dados.ref };
    const bytes = new TextEncoder().encode(JSON.stringify(corpo));
    const assinatura = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, chavePasse, bytes));
    const token = `${b64u(bytes)}.${b64u(assinatura)}`;
    const url = URL_VALIDAR + token;
    const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#05433b", light: "#ffffff" } });
    return { token, url, svg, nome: corpo.n, telefone: corpo.t, em: corpo.d };
}

// Confere a assinatura de um passe/cartão e devolve o conteúdo (ou null).
let chavePasseVerif: CryptoKey | null = null;
async function lerTokenAssinado(tokenBruto: unknown): Promise<any | null> {
    const token = String(tokenBruto || "").slice(0, 2000);
    const [a, b] = token.split(".");
    const jwk = Deno.env.get("PASSE_CHAVE_PRIVADA");
    if (!a || !b || !jwk) return null;
    if (!chavePasseVerif) {
        const priv = JSON.parse(jwk.trim().startsWith("{") ? jwk : atob(jwk.trim()));
        chavePasseVerif = await crypto.subtle.importKey("jwk", { kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y },
            { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    }
    const de64 = (t: string) => Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
    try {
        if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, chavePasseVerif, de64(b), de64(a)))) return null;
        return JSON.parse(new TextDecoder().decode(de64(a)));
    } catch { return null; }
}

// Segurança leu um cartão de entrada: devolve quem está com ele e libera o cartão para a recepção usar de novo.
async function cartaoLido(corpo: any) {
    const dados = await lerTokenAssinado(corpo.token);
    const num = dados ? Number(dados.c) : 0;
    if (!num || !dados.ev) return responder({ ok: false, erro: "Cartão inválido." }, 400);
    const { data: ult } = await supabaseAdmin.from("recepcao_registros").select("tipo, nome, link_id, criado_em, criado_no_aparelho, email_evento_id")
        .eq("evento_id_ulisses", dados.ev).eq("cartao_numero", num).order("criado_em", { ascending: false }).limit(1).maybeSingle();
    if (!ult) return responder({ ok: true, numero: num, vinculado: false });
    if (ult.tipo === "cartao_lido") return responder({ ok: true, numero: num, vinculado: false, ja_lido_em: ult.criado_em, nome_anterior: ult.nome });
    await supabaseAdmin.from("recepcao_registros").insert({
        client_id: crypto.randomUUID(), link_id: ult.link_id, evento_id_ulisses: dados.ev, tipo: "cartao_lido", status: "ok",
        cartao_numero: num, nome: ult.nome, email_evento_id: ult.email_evento_id, autor: "Segurança (validador)",
        inicio_em: ult.criado_no_aparelho || ult.criado_em, criado_no_aparelho: dataOk(corpo.lido_em),
    });
    return responder({ ok: true, numero: num, vinculado: true, nome: ult.nome, vinculado_em: ult.criado_em });
}

// Data enviada pelo aparelho (horário da leitura); só aceita se for plausível (até 1 dia antes e 5 min no futuro).
function dataOk(v: unknown) {
    const t = Date.parse(String(v || ""));
    return !isNaN(t) && t > Date.now() - 86400000 && t < Date.now() + 300000 ? new Date(t).toISOString() : null;
}

// Segurança conferiu um QR code de entrada (celular): guarda a leitura para medir a jornada até a entrada.
// Uma linha por QR code (client_id derivado da assinatura): vários celulares lendo o mesmo não duplicam.
async function passeValidado(corpo: any) {
    const token = String(corpo.token || "").slice(0, 2000);
    const dados = await lerTokenAssinado(token);
    if (!dados || !dados.ev || dados.c) return responder({ ok: false, erro: "QR code inválido." }, 400);
    const { data: link } = await supabaseAdmin.from("recepcao_links").select("id").eq("evento_id_ulisses", dados.ev).is("revogado_em", null).limit(1).maybeSingle();
    if (!link) return responder({ ok: false, erro: "Evento não encontrado." }, 404);
    const h = (await sha256(token.split(".")[1] || token)).slice(0, 32);
    const clientId = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    const ref = String(dados.r || "");
    const novo = await registrar({
        client_id: clientId, link_id: link.id, evento_id_ulisses: dados.ev, tipo: "validado", status: "ok",
        nome: dados.n || null, email_evento_id: ref.startsWith("i") ? Number(ref.slice(1)) || null : null,
        inicio_em: dataOk(dados.d) || null, criado_no_aparelho: dataOk(corpo.lido_em), autor: "Segurança (validador)",
    });
    if (novo !== null) return responder({ ok: true });
    // Já existia: devolve quando foi a primeira leitura (o validador avisa se foi em outro aparelho).
    const { data: antes } = await supabaseAdmin.from("recepcao_registros").select("criado_no_aparelho, criado_em").eq("client_id", clientId).maybeSingle();
    return responder({ ok: true, repetido: true, primeira_em: antes?.criado_no_aparelho || antes?.criado_em || null });
}

// Desenha o QR de um passe (a página /passe guarda o desenho no celular da pessoa). Só para passes com assinatura válida.
async function passeQr(corpo: any) {
    const token = String(corpo.token || "").slice(0, 2000);
    const [a, b] = token.split(".");
    const jwk = Deno.env.get("PASSE_CHAVE_PRIVADA");
    if (!a || !b || !jwk) return responder({ ok: false, erro: "Passe inválido." }, 400);
    if (!chavePasseVerif) {
        const priv = JSON.parse(jwk.trim().startsWith("{") ? jwk : atob(jwk.trim()));
        chavePasseVerif = await crypto.subtle.importKey("jwk", { kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y },
            { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    }
    const de64 = (t: string) => Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
    let ok = false;
    try { ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, chavePasseVerif, de64(b), de64(a)); } catch { ok = false; }
    if (!ok) return responder({ ok: false, erro: "Passe inválido." }, 400);
    const svg = await QRCode.toString(URL_VALIDAR + token, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#05433b", light: "#ffffff" } });
    return responder({ ok: true, svg });
}

function primeiroNomeBate(digitado: string, nomeCompleto: string) {
    const a = normalizarNome(digitado).split(" ")[0] || "", b = normalizarNome(nomeCompleto).split(" ")[0] || "";
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
    let dif = 0; // tolera 1 letra trocada/faltando (Thiago/Tiago, Luis/Luiz)
    for (let i = 0, j = 0; i < a.length || j < b.length; ) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++dif > 1) return false;
        if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return true;
}

async function autoCheckin(acao: string, corpo: any) {
    const codigo = String(corpo.publico || "");
    if (!/^[A-Za-z0-9_-]{10,}$/.test(codigo)) return responder({ ok: false, erro: "Link inválido." }, 400);
    const { data: link } = await supabaseAdmin.from("recepcao_links").select("*").eq("codigo_publico_hash", await sha256(codigo)).maybeSingle();
    if (!link || link.revogado_em) return responder({ ok: false, erro: "Link inválido." }, 403);
    const { data: ev } = await supabaseAdmin.from("eventos").select("nome, data, hora, link_inscricao").eq("id", link.evento_id).maybeSingle();
    const agora = new Date();
    const aberto = link.autocheckin_inicio && link.autocheckin_fim && agora >= new Date(link.autocheckin_inicio) && agora <= new Date(link.autocheckin_fim);
    const inscricao = `https://inscricao.acropolebrasil.com.br/?eventoId=${link.evento_id_ulisses}&layout=recepcao&utm_source=autocheckin`;
    if (acao === "auto_info") return responder({ ok: true, evento: ev, aberto, abre_em: link.autocheckin_inicio, inscricao });
    if (!aberto) return responder({ ok: false, erro: "O check-in pelo celular funciona só no dia e no horário do evento.", fechado: true }, 403);

    if (acao === "auto_inscrever") return await autoInscrever(link, corpo);

    const tel = digitos(corpo.celular), t8 = tel.slice(-8), nome = String(corpo.nome || "").slice(0, 60);
    if (t8.length < 8 || !normalizarNome(nome)) return responder({ ok: false, erro: "Informe seu celular com DDD e seu primeiro nome." }, 400);

    // Inscrições do evento com esse celular: primeiro na lista já sincronizada; senão, direto no Ulisses
    // (pega quem acabou de se inscrever pelo QR code do cartaz).
    const { data: locais } = await supabaseAdmin.from("ulisses_inscricoes_evento").select("email_evento_id, nome, telefone, compareceu, pessoaIdentificador")
        .eq("evento_id_ulisses", link.evento_id_ulisses).is("removido_em", null).like("telefone", `%${t8}`);
    let alvo = (locais || []).find((x: any) => primeiroNomeBate(nome, x.nome || ""));
    if (!alvo) {
        const pessoas = await comTempo(inscritosUlisses(link), 9000).catch(() => []);
        for (const p of pessoas || []) {
            if (digitos(p.telefone).slice(-8) !== t8 || !primeiroNomeBate(nome, p.nome || "")) continue;
            const ee = (p.emailEventos || []).filter((x: any) => x?.evento?.id === link.evento_id_ulisses && x.id != null).sort((a: any, b: any) => b.id - a.id)[0];
            if (!ee) continue;
            await supabaseAdmin.from("ulisses_inscricoes_evento").upsert({
                email_evento_id: ee.id, evento_id_ulisses: link.evento_id_ulisses, filial_id_ulisses: link.filial_id_ulisses,
                pessoa_id_ulisses: p.id != null ? String(p.id) : null, nome: String(p.nome || "").trim(), email: p.email || null,
                ddd: p.ddd != null ? String(p.ddd) : null, telefone: p.telefone != null ? String(p.telefone) : null,
                visto_em: new Date().toISOString(), removido_em: null,
            }, { onConflict: "email_evento_id", ignoreDuplicates: true });
            alvo = { email_evento_id: ee.id, nome: String(p.nome || "").trim(), compareceu: ee.compareceu === true, pessoaIdentificador: null };
            break;
        }
    }
    if (!alvo) return responder({ ok: false, nao_encontrado: true, erro: "Não encontramos sua inscrição com esse celular e nome.", inscricao }, 404);
    const primeiro = nomeProprio(String(alvo.nome).split(" ")[0] || "");
    const dddCel = tel.replace(/^55(?=\d{10,11}$)/, "").slice(0, 2);
    const passeDe = () => emitirPasse(link, { nome: alvo.nome, ddd: dddCel, telefone: tel, ref: `i${alvo.email_evento_id}` }).catch(() => null);
    if (alvo.compareceu === true) return responder({ ok: true, ja_feito: true, nome: primeiro, passe: await passeDe() });

    const clientId = crypto.randomUUID();
    await registrar({
        client_id: clientId, link_id: link.id, evento_id_ulisses: link.evento_id_ulisses, tipo: "presenca",
        email_evento_id: alvo.email_evento_id, nome: alvo.nome, pessoa_identificador: alvo.pessoaIdentificador, autor: "Check-in pelo celular (QR)",
    });
    await marcarOuAdiar(clientId, alvo.email_evento_id, true);
    return responder({ ok: true, nome: primeiro, passe: await passeDe() });
}

// Quem se inscreve pelo QR code no local já está no evento: inscrição + presença + passe de uma vez.
// Sem e-mail: vaga reservada no CRM (não vai ao Ulisses), como na recepção.
async function autoInscrever(link: any, corpo: any) {
    let nome = String(corpo.nome || "").trim().slice(0, 120);
    const tel = digitos(corpo.celular).replace(/^55(?=\d{10,11}$)/, ""), email = String(corpo.email || "").trim().toLowerCase();
    if (normalizarNome(nome).split(" ").length < 2) return responder({ ok: false, erro: "Escreva seu nome e sobrenome." }, 400);
    if (tel.length < 10 || tel.length > 11) return responder({ ok: false, erro: "Escreva seu celular com DDD." }, 400);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responder({ ok: false, erro: "Confira o e-mail." }, 400);
    nome = nomeProprio(nome);
    const ddd = tel.slice(0, 2), numero = tel.slice(2), t8 = tel.slice(-8);

    // Já inscrito com esse celular e esse primeiro nome? Faz só o check-in.
    const { data: ja } = await supabaseAdmin.from("ulisses_inscricoes_evento").select("email_evento_id, nome, compareceu")
        .eq("evento_id_ulisses", link.evento_id_ulisses).is("removido_em", null).like("telefone", `%${t8}`);
    const mesmo = (ja || []).find((x: any) => primeiroNomeBate(nome, x.nome || ""));
    if (mesmo) return await autoCheckin("auto_checkin", { publico: corpo.publico, celular: tel, nome });

    const clientId = crypto.randomUUID();
    const autor = "Inscrição pelo celular (QR)";
    if (!email) {
        const [{ data: evCap }, { count: nI }, { count: nR }] = await Promise.all([
            supabaseAdmin.from("eventos").select("capacidade").eq("id", link.evento_id).maybeSingle(),
            supabaseAdmin.from("ulisses_inscricoes_evento").select("email_evento_id", { count: "exact", head: true }).eq("evento_id_ulisses", link.evento_id_ulisses).is("removido_em", null),
            supabaseAdmin.from("recepcao_registros").select("id", { count: "exact", head: true }).eq("evento_id_ulisses", link.evento_id_ulisses).eq("tipo", "inscricao").eq("status", "reservado"),
        ]);
        const cap = Number(evCap?.capacidade) || 0;
        if (cap && (nI || 0) + (nR || 0) >= cap) return responder({ ok: false, erro: "As vagas acabaram. Para entrar, informe seu e-mail ou fale com a recepção." }, 409);
        await registrar({ client_id: clientId, link_id: link.id, evento_id_ulisses: link.evento_id_ulisses, tipo: "inscricao", status: "reservado",
            nome, ddd, telefone: numero, autor, interesse_curso: typeof corpo.interesse_curso === "boolean" ? corpo.interesse_curso : null });
        return responder({ ok: true, nome: nome.split(" ")[0], reservado: true, passe: await emitirPasse(link, { nome, ddd, telefone: numero, ref: `c${clientId.slice(0, 8)}` }).catch(() => null) });
    }

    await registrar({ client_id: clientId, link_id: link.id, evento_id_ulisses: link.evento_id_ulisses, tipo: "inscricao",
        nome, ddd, telefone: numero, email, autor, interesse_curso: typeof corpo.interesse_curso === "boolean" ? corpo.interesse_curso : null });
    try {
        await chamarUlisses(supabaseAdmin, "/salvarInscricaoV2", { method: "POST", autenticar: false, corpo: {
            nome, ddd, telefone: numero, email, receberInformativo: true, produtoId: link.produto_id_ulisses, produtosId: [link.produto_id_ulisses],
            pontoConversao: "recepcao", landingPage: false, atualizar: false, utmSource: "autocheckin", utmMedium: "qr-local",
            utmCampaign: link.campanha_slug || null, pagamento: {}, pagamentoV2: {} } });
    } catch (e) {
        // Ulisses fora do ar: a pessoa entra do mesmo jeito, com a vaga reservada (o e-mail fica guardado para completar depois).
        await concluir(clientId, "reservado", { erro: "Inscrição não enviada ao Ulisses: " + (e as Error).message });
        return responder({ ok: true, nome: nome.split(" ")[0], reservado: true, passe: await emitirPasse(link, { nome, ddd, telefone: numero, ref: `c${clientId.slice(0, 8)}` }).catch(() => null) });
    }
    let eeId: number | null = null, achado: any = null;
    for (let i = 0; i < 2 && !eeId; i++) {
        if (i) await new Promise((r) => setTimeout(r, 2000));
        for (const p of await comTempo(inscritosUlisses(link, true), 9000).catch(() => [])) {
            const bate = digitos(p.telefone).slice(-8) === t8 || String(p.email || "").trim().toLowerCase() === email;
            if (!bate) continue;
            for (const ee of p.emailEventos || []) if (ee?.evento?.id === link.evento_id_ulisses && ee.id != null && (!eeId || ee.id > eeId)) { eeId = ee.id; achado = p; }
        }
    }
    if (eeId) {
        await supabaseAdmin.from("ulisses_inscricoes_evento").upsert({
            email_evento_id: eeId, evento_id_ulisses: link.evento_id_ulisses, filial_id_ulisses: link.filial_id_ulisses,
            pessoa_id_ulisses: achado?.id != null ? String(achado.id) : null, nome: achado?.nome || nome, email: achado?.email || email,
            ddd, telefone: numero, compareceu: null, inscrito_em: new Date().toISOString(), visto_em: new Date().toISOString(), removido_em: null,
            bruto: { inscricao: { id: eeId, origem: { pontoConversao: "recepcao", utmSource: "autocheckin" } } },
        }, { onConflict: "email_evento_id" });
        await supabaseAdmin.from("recepcao_registros").update({ email_evento_id: eeId }).eq("client_id", clientId);
        await marcarOuAdiar(clientId, eeId, true);
    } else {
        // Inscrito no Ulisses, mas a lista ainda não mostrou a inscrição: a presença é marcada depois, sozinha.
        await concluir(clientId, "pendente", { erro: "Inscrito no Ulisses; falta localizar a inscrição para marcar a presença." });
    }
    // A inscrição foi feita; o passe sai mesmo se a presença ficar para a recepção conferir.
    return responder({ ok: true, nome: nome.split(" ")[0], passe: await emitirPasse(link, { nome, ddd, telefone: numero, ref: eeId ? `i${eeId}` : `c${clientId.slice(0, 8)}` }).catch(() => null) });
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    let corpo: any = {};
    try { corpo = await req.json(); } catch { return responder({ ok: false, erro: "Pedido inválido." }, 400); }
    const acao = String(corpo.acao || "");

    // ---- Check-in pelo próprio celular (QR code no local, sem PIN) ----
    // Só funciona na janela do evento. Pede celular + primeiro nome e só marca se os dois baterem com a mesma
    // inscrição; a resposta nunca diz qual dos dois não bateu (não revela quem está inscrito).
    if (acao === "auto_info" || acao === "auto_checkin" || acao === "auto_inscrever") return await autoCheckin(acao, corpo);
    if (acao === "passe_qr") return await passeQr(corpo);
    if (acao === "cartao_lido") return await cartaoLido(corpo);
    if (acao === "passe_validado") return await passeValidado(corpo);
    const chave = String(corpo.chave || "");
    if (!/^[A-Za-z0-9_-]{10,}$/.test(chave)) return responder({ ok: false, erro: "Link inválido." }, 400);

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
    // Quem está atendendo vem em cada ação (a recepção troca de pessoa sem sair da página).
    const atendente = texto(corpo.atendente, 60) || sessao.apelido || "";
    const autor = `Recepção${atendente ? " — " + atendente : ""}`;

    try {
        if (acao === "lista") {
            emSegundoPlano(reconciliarUlisses(link));
            // Versão da lista: se nada mudou desde a última vez deste aparelho, responde só "igual" (poucos bytes).
            const { data: versao } = await supabaseAdmin.rpc("recepcao_versao", { p_evento_id_ulisses: link.evento_id_ulisses });
            if (versao && corpo.versao && corpo.versao === versao) return responder({ ok: true, igual: true, versao, agora: new Date().toISOString() });
            const [{ data: ev }, { data: inscritos, error }, { data: regs }] = await Promise.all([
                supabaseAdmin.from("eventos").select("nome, data, hora, capacidade").eq("id", link.evento_id).maybeSingle(),
                supabaseAdmin.rpc("recepcao_lista", { p_evento_id_ulisses: link.evento_id_ulisses }),
                supabaseAdmin.from("recepcao_registros").select("client_id, nome, autor, criado_em")
                    .eq("evento_id_ulisses", link.evento_id_ulisses).eq("tipo", "inscricao").eq("status", "reservado").order("criado_em", { ascending: false }).limit(400),
            ]);
            if (error) throw new Error(error.message);
            return responder({ ok: true, evento: ev, rotulo: link.rotulo, inscritos, reservas: regs || [], capacidade: ev?.capacidade ?? null, versao: versao || null, agora: new Date().toISOString() });
        }

        // Reenvia agora ao Ulisses o que ficou pendente (botão "Enviar ao Ulisses" / depois do evento).
        if (acao === "reconciliar") {
            const r = await reconciliarUlisses(link, true);
            return responder({ ok: true, ...r });
        }

        // ---- Cartão de entrada entregue a quem não tem celular (número impresso no cartão) ----
        if (acao === "cartao") {
            const clientId = corpo.client_id, num = Math.trunc(Number(corpo.cartao));
            if (!uuidOk(clientId) || !(num >= 1 && num <= 999)) return responder({ ok: false, erro: "Número de cartão inválido.", definitivo: true }, 400);
            const nome = texto(corpo.nome, 120);
            if (!nome) return responder({ ok: false, erro: "Falta o nome de quem recebeu o cartão.", definitivo: true }, 400);
            const { data: ult } = await supabaseAdmin.from("recepcao_registros").select("tipo, nome")
                .eq("evento_id_ulisses", link.evento_id_ulisses).eq("cartao_numero", num).order("criado_em", { ascending: false }).limit(1).maybeSingle();
            const novo = await registrar({
                client_id: clientId, link_id: link.id, evento_id_ulisses: link.evento_id_ulisses, tipo: "cartao", status: "ok",
                cartao_numero: num, nome, email_evento_id: Number(corpo.email_evento_id) || null, autor,
                criado_no_aparelho: texto(corpo.criado_no_aparelho, 40),
            });
            // Aviso (não bloqueia): o cartão ainda estava com outra pessoa que não passou pela segurança.
            const emUso = novo !== null && ult && ult.tipo === "cartao" && ult.nome !== nome ? ult.nome : null;
            return responder({ ok: true, numero: num, em_uso_por: emUso });
        }

        if (acao === "presenca") {
            const clientId = corpo.client_id, eeId = Number(corpo.email_evento_id), comp = corpo.compareceu !== false;
            if (!uuidOk(clientId) || !eeId) return responder({ ok: false, erro: "Pedido inválido." }, 400);
            const { data: insc } = await supabaseAdmin.from("ulisses_inscricoes_evento").select("nome, pessoaIdentificador, ddd, telefone")
                .eq("email_evento_id", eeId).eq("evento_id_ulisses", link.evento_id_ulisses).maybeSingle();
            if (!insc) return responder({ ok: false, erro: "Inscrição não encontrada neste evento.", definitivo: true }, 404);
            const novo = await registrar({
                client_id: clientId, link_id: link.id, evento_id_ulisses: link.evento_id_ulisses, tipo: comp ? "presenca" : "desfazer",
                email_evento_id: eeId, nome: insc.nome, pessoa_identificador: insc.pessoaIdentificador, autor,
                veio_com: texto(corpo.veio_com), interesse_curso: typeof corpo.interesse_curso === "boolean" ? corpo.interesse_curso : null,
                criado_no_aparelho: texto(corpo.criado_no_aparelho, 40),
            });
            // Mesmo pedido chegando de novo (reenvio da fila): já está gravado, não repete.
            if (novo === null) return responder({ ok: true, repetido: true });
            const noUlisses = await marcarOuAdiar(clientId, eeId, comp, corpo.teste_falha_ulisses === true && /^Teste do Sistema/.test(atendente));
            // A mesa entrega cartão (sem_passe); o QR code na tela é só para o autoatendimento.
            const passe = comp && corpo.sem_passe !== true ? await emitirPasse(link, { nome: insc.nome || "", ddd: insc.ddd || "", telefone: insc.telefone || "", ref: `i${eeId}` }).catch(() => null) : null;
            return responder({ ok: true, passe, pendente_ulisses: !noUlisses });
        }

        // Painel de números da recepção (chegadas por horário, canais, perfil, comparecimento).
        if (acao === "numeros") {
            const { data, error } = await supabaseAdmin.rpc("recepcao_numeros", { p_evento_id_ulisses: link.evento_id_ulisses });
            if (error) throw new Error(error.message);
            return responder({ ok: true, numeros: data, agora: new Date().toISOString() });
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
            if (!alvo) return responder({ ok: false, erro: "Marque a presença antes." }, 503);
            await supabaseAdmin.from("recepcao_registros").update(mudar).eq("id", alvo.id);
            return responder({ ok: true });
        }

        // Procura na base do CRM quem chegou sem inscrição, para preencher o cadastro sem digitar.
        if (acao === "buscar_base") {
            const termo = normalizarNome(String(corpo.termo || ""));
            const dig = digitos(corpo.termo);
            const partes = termo.split(" ").filter((p) => p.length >= 2).slice(0, 4);
            let q = supabaseAdmin.from("leads_inscricoes").select('"pessoaIdentificador", "pessoaNome", "pessoaTelefoneDDD", "pessoaTelefoneNumero", "pessoaEmail", filial')
                .is("lixeira_em", null).limit(30);
            if (dig.length >= 8) q = q.ilike("pessoaTelefoneNumero", `%${dig.slice(-8)}`);
            else if (partes.length) for (const p of partes) q = q.ilike("pessoaNome", `%${p}%`);
            else return responder({ ok: true, pessoas: [] });
            const { data } = await q;
            // A mesma pessoa cadastrada em mais de uma escola vira uma opção só (mesmo celular ou e-mail e o
            // mesmo primeiro nome). Fica o cadastro mais completo; as escolas aparecem juntas.
            const grupos = new Map<string, any>();
            for (const l of data || []) {
                const t8 = digitos(l.pessoaTelefoneNumero).slice(-8);
                const email = String(l.pessoaEmail || "").trim().toLowerCase();
                const primeiro = normalizarNome(l.pessoaNome || "").split(" ")[0];
                const chaves = [t8.length === 8 ? `t:${t8}:${primeiro}` : "", email ? `e:${email}:${primeiro}` : ""].filter(Boolean);
                let g = chaves.map((k) => grupos.get(k)).find(Boolean);
                const nota = (t8 ? 2 : 0) + (email ? 1 : 0);
                if (!g) g = { pid: l.pessoaIdentificador, nome: l.pessoaNome, pids: [], final_tel: t8.slice(-4), tem_tel: !!t8, tem_email: !!email, nota };
                else if (nota > g.nota) Object.assign(g, { pid: l.pessoaIdentificador, nome: l.pessoaNome, final_tel: t8.slice(-4), tem_tel: !!t8, tem_email: !!email, nota });
                if (!g.pids.includes(l.pessoaIdentificador)) g.pids.push(l.pessoaIdentificador);
                for (const k of chaves) grupos.set(k, g);
                if (!chaves.length) grupos.set(`p:${l.pessoaIdentificador}`, g);
            }
            // Escola só quando vem do Mercúrio (aluno ou ex-aluno): a escola de um cadastro do CRM/Ulisses não diz nada.
            const unicos = [...new Set(grupos.values())].slice(0, 8);
            const todosPids = unicos.flatMap((g) => g.pids);
            const { data: mp } = todosPids.length
                ? await supabaseAdmin.from("mercurio_pessoas").select("pessoa_identificador, filial, situacao").in("pessoa_identificador", todosPids)
                : { data: [] };
            const pessoas = unicos.map((g) => {
                const fichas = (mp || []).filter((m: any) => g.pids.includes(m.pessoa_identificador));
                const ativa = fichas.find((m: any) => m.situacao === "ATI");
                const escola = ativa ? `aluno(a) de ${ativa.filial}` : fichas[0] ? `ex-aluno(a) de ${fichas[0].filial}` : "";
                return { pid: g.pid, nome: g.nome, filial: escola, final_tel: g.final_tel, tem_tel: g.tem_tel, tem_email: g.tem_email };
            });
            return responder({ ok: true, pessoas });
        }

        // Nome de quem está atendendo: SÓ membros ativos do Mercúrio. Regra do usuário (13/11/2026): ninguém que
        // atende está fora do Mercúrio; não procurar na base do CRM nem nas contas do CRM.
        if (acao === "buscar_equipe") {
            const partes = normalizarNome(String(corpo.termo || "")).split(" ").filter((p) => p.length >= 2).slice(0, 3);
            if (!partes.length) return responder({ ok: true, pessoas: [] });
            let q = supabaseAdmin.from("mercurio_pessoas").select("nome, filial").eq("situacao", "ATI").limit(300);
            for (const p of partes) q = q.ilike("nome", `%${p}%`);
            const { data } = await q;
            // Primeiro quem tem as palavras digitadas no começo do nome (ex.: "Ana" acha Ana Paula antes de Mariana).
            const pontos = (nome: string) => {
                const pal = normalizarNome(nome).split(" ");
                return partes.reduce((t, p) => t + (pal[0] === p ? 4 : pal.includes(p) ? 3 : pal.some((x) => x.startsWith(p)) ? 2 : 1), 0);
            };
            const lista = (data || []).map((m: any) => ({ nome: nomeProprio(m.nome || ""), filial: m.filial })).sort((a, b) => pontos(b.nome) - pontos(a.nome) || a.nome.localeCompare(b.nome)).slice(0, 8);
            return responder({ ok: true, pessoas: lista });
        }

        // Confere direto no Ulisses (lista ao vivo) se quem está sendo cadastrado já está inscrito.
        // Pega também inscrições feitas depois da última sincronização e já deixa a linha pronta para marcar presença.
        if (acao === "verificar") {
            const nome = normalizarNome(String(corpo.nome || ""));
            const t8 = digitos(corpo.telefone).slice(-8);
            const email = String(corpo.email || "").trim().toLowerCase();
            const tokens = nome.split(" ").filter((t) => t.length >= 2 && !["DA", "DE", "DO", "DAS", "DOS"].includes(t));
            if (tokens.length < 2 && t8.length < 8 && !email.includes("@")) return responder({ ok: true, achados: [] });
            const pessoas = await comTempo(inscritosUlisses(link), 10000);
            const achados: any[] = [];
            for (const p of pessoas || []) {
                const ee = (p.emailEventos || []).filter((x: any) => x?.evento?.id === link.evento_id_ulisses && x.id != null).sort((a: any, b: any) => b.id - a.id)[0];
                if (!ee) continue;
                const nomeP = normalizarNome(p.nome || "").split(" ");
                const porTel = t8.length === 8 && digitos(p.telefone).slice(-8) === t8;
                const porEmail = email.includes("@") && String(p.email || "").trim().toLowerCase() === email;
                const porNome = tokens.length >= 2 && tokens.every((t) => nomeP.some((n) => n === t || (t.length >= 5 && n.startsWith(t.slice(0, -1)))));
                if (!porTel && !porEmail && !porNome) continue;
                achados.push({ email_evento_id: ee.id, nome: String(p.nome || "").trim(), final_tel: digitos(p.telefone).slice(-4),
                    compareceu: ee.compareceu === true, motivo: porTel ? "celular" : porEmail ? "e-mail" : "nome", p });
            }
            if (achados.length) {
                await supabaseAdmin.from("ulisses_inscricoes_evento").upsert(achados.map((a) => ({
                    email_evento_id: a.email_evento_id, evento_id_ulisses: link.evento_id_ulisses, filial_id_ulisses: link.filial_id_ulisses,
                    pessoa_id_ulisses: a.p.id != null ? String(a.p.id) : null, nome: a.nome, email: a.p.email || null,
                    ddd: a.p.ddd != null ? String(a.p.ddd) : null, telefone: a.p.telefone != null ? String(a.p.telefone) : null,
                    visto_em: new Date().toISOString(), removido_em: null,
                })), { onConflict: "email_evento_id", ignoreDuplicates: true });
            }
            return responder({ ok: true, achados: achados.slice(0, 5).map(({ p: _p, ...r }) => r) });
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

            // Sem e-mail (13/11/2026): o Ulisses exige e-mail, e pedir na porta leva a e-mails inventados. A pessoa fica
            // reservada no CRM (ocupa vaga, conta como presente) e o e-mail é pedido depois por WhatsApp.
            if (!email) {
                const [{ data: evCap }, { count: nInscritos }, { count: nReservas }] = await Promise.all([
                    supabaseAdmin.from("eventos").select("capacidade").eq("id", link.evento_id).maybeSingle(),
                    supabaseAdmin.from("ulisses_inscricoes_evento").select("email_evento_id", { count: "exact", head: true }).eq("evento_id_ulisses", link.evento_id_ulisses).is("removido_em", null),
                    supabaseAdmin.from("recepcao_registros").select("id", { count: "exact", head: true }).eq("evento_id_ulisses", link.evento_id_ulisses).eq("tipo", "inscricao").eq("status", "reservado"),
                ]);
                const cap = Number(evCap?.capacidade) || 0;
                if (cap && (nInscritos || 0) + (nReservas || 0) >= cap) {
                    return responder({ ok: false, erro: "As vagas acabaram: só dá para entrar com inscrição completa (com e-mail).", definitivo: true }, 409);
                }
                const nova = await registrar({
                    client_id: clientId, link_id: link.id, evento_id_ulisses: link.evento_id_ulisses, tipo: "inscricao", status: "reservado",
                    nome, ddd, telefone: tel, email: null, pessoa_identificador: pid, autor,
                    veio_com: texto(corpo.veio_com), interesse_curso: typeof corpo.interesse_curso === "boolean" ? corpo.interesse_curso : null,
                    criado_no_aparelho: texto(corpo.criado_no_aparelho, 40),
                });
                const passeR = corpo.sem_passe === true ? null : await emitirPasse(link, { nome, ddd, telefone: tel, ref: `c${String(clientId).slice(0, 8)}` }).catch(() => null);
                return responder({ ok: true, reservado: true, repetido: nova === null, passe: passeR });
            }

            const novo = await registrar({
                client_id: clientId, link_id: link.id, evento_id_ulisses: link.evento_id_ulisses, tipo: "inscricao",
                nome, ddd, telefone: tel, email: email || null, pessoa_identificador: pid, autor,
                veio_com: texto(corpo.veio_com), interesse_curso: typeof corpo.interesse_curso === "boolean" ? corpo.interesse_curso : null,
                criado_no_aparelho: texto(corpo.criado_no_aparelho, 40),
            });
            // Mesmo pedido chegando de novo (reenvio da fila): não inscreve duas vezes.
            if (novo === null) {
                const { data: ja } = await supabaseAdmin.from("recepcao_registros").select("status, email_evento_id").eq("client_id", clientId).maybeSingle();
                return responder({ ok: true, repetido: true, reservado: ja?.status === "reservado", email_evento_id: ja?.email_evento_id || null });
            }
            const passeMesa = async (ref: string) => corpo.sem_passe === true ? null : await emitirPasse(link, { nome, ddd, telefone: tel, ref }).catch(() => null);
            try {
                if (corpo.teste_falha_ulisses === true && /^Teste do Sistema/.test(atendente)) throw new Error("falha simulada (teste)");
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
                // Ulisses fora do ar: a pessoa entra do mesmo jeito, com a vaga reservada. O e-mail fica guardado
                // no registro para completar a inscrição depois do evento.
                await concluir(clientId, "reservado", { erro: "Inscrição não enviada ao Ulisses: " + (e as Error).message });
                return responder({ ok: true, reservado: true, ulisses_fora: true, passe: await passeMesa(`c${String(clientId).slice(0, 8)}`) });
            }
            // Acha a inscrição recém-criada para marcar a presença.
            let eeId: number | null = null, pessoaAchada: any = null;
            for (let tentativa = 0; tentativa < 2 && !eeId; tentativa++) {
                if (tentativa) await new Promise((r) => setTimeout(r, 2000));
                const pessoas = await comTempo(inscritosUlisses(link, true), 9000).catch(() => [] as any[]);
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
                // Inscrito no Ulisses, mas a lista ainda não mostrou a inscrição: a presença é marcada depois, sozinha.
                await concluir(clientId, "pendente", { erro: "Inscrito no Ulisses; falta localizar a inscrição para marcar a presença." });
                return responder({ ok: true, pendente_ulisses: true, passe: await passeMesa(`c${String(clientId).slice(0, 8)}`) });
            }
            await supabaseAdmin.from("ulisses_inscricoes_evento").upsert({
                email_evento_id: eeId, evento_id_ulisses: link.evento_id_ulisses, filial_id_ulisses: link.filial_id_ulisses,
                pessoa_id_ulisses: pessoaAchada?.id != null ? String(pessoaAchada.id) : null, nome: pessoaAchada?.nome || nome,
                email: pessoaAchada?.email || email || null, ddd, telefone: tel, compareceu: null,
                inscrito_em: new Date().toISOString(), visto_em: new Date().toISOString(), removido_em: null,
                bruto: { inscricao: { id: eeId, origem: { pontoConversao: "recepcao", utmSource: "crm-recepcao" } } },
            }, { onConflict: "email_evento_id" });
            await supabaseAdmin.from("recepcao_registros").update({ email_evento_id: eeId }).eq("client_id", clientId);
            const marcou = await marcarOuAdiar(clientId, eeId, true);
            return responder({ ok: true, email_evento_id: eeId, pendente_ulisses: !marcou, passe: await passeMesa(`i${eeId}`) });
        }

        return responder({ ok: false, erro: "Ação desconhecida." }, 400);
    } catch (e) {
        return responder({ ok: false, erro: (e as Error).message || "Erro inesperado." }, 500);
    }
});

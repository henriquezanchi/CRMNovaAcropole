// Números de WhatsApp do CRM e o token de cada um.
//
// Até 26/11/2026 havia um número só (o da agência, WHATSAPP_PHONE_NUMBER_ID_DEFAULT, com WHATSAPP_TOKEN). Agora cada
// escola pode conectar o próprio número oficial em coexistência com o app WhatsApp Business (whatsapp_conexoes,
// função whatsapp-conexao). Cada número de escola fica numa conta (WABA) da própria escola e só o token dela tem acesso.
//
// Regra de envio: a conversa é respondida pelo número em que a pessoa escreveu. Número de escola só envia depois que
// alguém ligar "usar no CRM" (whatsapp_conexoes.usar_no_crm); antes disso o envio é recusado, inclusive dos robôs.
import { supabaseAdmin } from "./supabaseAdmin.ts";

export const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") ?? "v21.0";
export const TOKEN_PADRAO = Deno.env.get("WHATSAPP_TOKEN") ?? "";
export const PHONE_ID_PADRAO = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_DEFAULT") ?? "";

/* CIFRA DO TOKEN */

async function chave(): Promise<CryptoKey> {
    const segredo = Deno.env.get("WHATSAPP_CONEXOES_CHAVE") || Deno.env.get("CREDENCIAIS_SCRAPER_CHAVE");
    if (!segredo) throw new Error("Sem chave para cifrar o token (WHATSAPP_CONEXOES_CHAVE).");
    const bruto = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("whatsapp-conexoes:" + segredo));
    return crypto.subtle.importKey("raw", bruto, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const paraBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const deBase64 = (texto: string) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

export async function cifrarToken(token: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chave(), new TextEncoder().encode(token)));
    const tudo = new Uint8Array(iv.length + cifrado.length);
    tudo.set(iv);
    tudo.set(cifrado, iv.length);
    return paraBase64(tudo);
}

export async function decifrarToken(texto: string): Promise<string> {
    const tudo = deBase64(texto);
    const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: tudo.slice(0, 12) }, await chave(), tudo.slice(12));
    return new TextDecoder().decode(claro);
}

/* CONEXÕES DAS ESCOLAS */

export type NumeroEscola = {
    filial: string;
    phoneNumberId: string;
    wabaId: string;
    numeroExibicao: string | null;
    token: string | null;
    estado: string;
    usarNoCrm: boolean;
    /** Número extra das campanhas de todas as escolas (28/11/2026): não é "o número da escola" da filial. */
    extra: boolean;
};

let cache: { em: number; lista: NumeroEscola[] } | null = null;

/** Números das escolas conectados ao CRM (com o token já decifrado). Lido uma vez por minuto. */
export async function numerosDasEscolas(): Promise<NumeroEscola[]> {
    if (cache && Date.now() - cache.em < 60_000) return cache.lista;
    const { data, error } = await supabaseAdmin.from("whatsapp_conexoes")
        .select("filial, phone_number_id, waba_id, numero_exibicao, token_cifrado, estado, usar_no_crm, extra_campanhas");
    if (error) {
        // Sem a tabela (migração ainda não aplicada): tudo segue pelo número da agência.
        console.warn("whatsapp_conexoes indisponível:", error.message);
        return [];
    }
    const lista: NumeroEscola[] = [];
    for (const c of data || []) {
        let token: string | null = null;
        if (c.token_cifrado) {
            try { token = await decifrarToken(c.token_cifrado); } catch (e) { console.error("Token da escola não decifrou:", c.filial, e); }
        }
        lista.push({
            filial: c.filial, phoneNumberId: String(c.phone_number_id), wabaId: String(c.waba_id),
            numeroExibicao: c.numero_exibicao, token, estado: c.estado, usarNoCrm: !!c.usar_no_crm, extra: !!c.extra_campanhas,
        });
    }
    cache = { em: Date.now(), lista };
    return lista;
}

export function esquecerCacheNumeros() {
    cache = null;
}

export async function numeroEscolaPorId(phoneNumberId: string | null | undefined): Promise<NumeroEscola | null> {
    if (!phoneNumberId) return null;
    return (await numerosDasEscolas()).find((n) => n.phoneNumberId === String(phoneNumberId)) ?? null;
}

export async function numeroEscolaDaFilial(filial: string | null | undefined): Promise<NumeroEscola | null> {
    if (!filial) return null;
    return (await numerosDasEscolas()).find((n) => n.filial === filial && !n.extra) ?? null;
}

/** Qualquer número conectado nesta linha da tela (inclusive o extra das campanhas): usado só para modelos/ações da conta. */
export async function conexaoDaFilial(filial: string | null | undefined): Promise<NumeroEscola | null> {
    if (!filial) return null;
    return (await numerosDasEscolas()).find((n) => n.filial === filial) ?? null;
}

/** Token que acessa este número: o da escola, se for número de escola; senão, o da agência. */
export async function tokenDoNumero(phoneNumberId: string | null | undefined): Promise<string> {
    const escola = await numeroEscolaPorId(phoneNumberId);
    return escola?.token || TOKEN_PADRAO;
}

/** Número que a filial usa para mensagens novas (modelos): o da escola, quando liberado; senão o configurado na filial ou o da agência. */
export async function numeroParaNovaMensagem(filial: string | null): Promise<string> {
    const escola = await numeroEscolaDaFilial(filial);
    if (escola && escola.usarNoCrm && escola.estado === "conectado" && escola.token) return escola.phoneNumberId;
    if (filial) {
        const { data } = await supabaseAdmin.from("filiais").select("whatsapp_phone_number_id").eq("nome", filial).maybeSingle();
        if (data?.whatsapp_phone_number_id) return String(data.whatsapp_phone_number_id);
    }
    return PHONE_ID_PADRAO;
}

/** Número que o agendador de campanhas pode escolher (agência ou extra liberado no CRM). */
export async function numeroValidoParaCampanha(phoneNumberId: string): Promise<boolean> {
    if (phoneNumberId === PHONE_ID_PADRAO) return true;
    const n = await numeroEscolaPorId(phoneNumberId);
    return !!n && n.extra && n.usarNoCrm && n.estado === "conectado" && !!n.token;
}

/** Por que este número não pode enviar agora (null = pode). */
export async function bloqueioDoNumero(phoneNumberId: string): Promise<string | null> {
    const escola = await numeroEscolaPorId(phoneNumberId);
    if (!escola) return null;
    if (escola.estado !== "conectado" || !escola.token) return `O WhatsApp de ${escola.filial} está desconectado do CRM.`;
    if (!escola.usarNoCrm && escola.extra) return "O número extra das campanhas ainda não foi liberado no CRM (Usar no CRM).";
    if (!escola.usarNoCrm) return `Esta conversa é do WhatsApp de ${escola.filial}. Para responder pelo CRM, ligue "Usar no CRM" em Gerenciar Filiais.`;
    return null;
}

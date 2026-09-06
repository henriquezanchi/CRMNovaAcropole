// Edge Function: endpoint público chamado pela Meta.
// GET  = handshake de verificação do webhook.
// POST = mensagens recebidas + atualizações de status de mensagens enviadas.
//
// PRECISA ser deployada com verificação de JWT desligada (ver supabase/config.toml
// e `supabase functions deploy whatsapp-webhook --no-verify-jwt`) — a Meta não
// manda Authorization: Bearer, só X-Hub-Signature-256, que é validado abaixo.
import { supabaseAdmin, NOME_TABELA_LEADS, NOME_TABELA_MENSAGENS } from "../_shared/supabaseAdmin.ts";
import { candidatosNumeroBR, separarFromMeta } from "../_shared/telefone.ts";

const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET")!;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN")!;

async function validarAssinatura(rawBody: string, header: string | null): Promise<boolean> {
    if (!header?.startsWith("sha256=")) return false;
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(APP_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const assinatura = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const hex = [...new Uint8Array(assinatura)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const recebido = header.slice(7);
    if (hex.length !== recebido.length) return false;
    // comparação em tempo constante — evita timing attack na validação da assinatura
    let diferenca = 0;
    for (let i = 0; i < hex.length; i++) diferenca |= hex.charCodeAt(i) ^ recebido.charCodeAt(i);
    return diferenca === 0;
}

function mapearTipoMeta(tipo: string): string {
    const tiposConhecidos = ["texto", "imagem", "audio", "documento", "video", "sticker", "localizacao", "botao"];
    const mapa: Record<string, string> = {
        text: "texto", image: "imagem", audio: "audio", document: "documento",
        video: "video", sticker: "sticker", location: "localizacao", button: "botao",
    };
    const mapeado = mapa[tipo];
    return mapeado && tiposConhecidos.includes(mapeado) ? mapeado : "outro";
}

function extrairTexto(msg: any): string {
    if (msg.type === "text") return msg.text?.body ?? "";
    if (msg.type === "button") return msg.button?.text ?? "[Botão]";
    if (msg.type === "interactive") return msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "[Resposta interativa]";
    const rotulos: Record<string, string> = {
        image: "[Imagem recebida]", audio: "[Áudio recebido]", document: "[Documento recebido]",
        video: "[Vídeo recebido]", sticker: "[Figurinha recebida]", location: "[Localização recebida]",
    };
    return rotulos[msg.type] || `[Mensagem tipo ${msg.type}]`;
}

function mapearStatusMeta(status: string): string {
    if (status === "sent") return "enviado";
    if (status === "delivered") return "entregue";
    if (status === "read") return "lido";
    if (status === "failed") return "falhou";
    return "enviado";
}

async function buscarLeadsPorTelefone(ddd: string, candidatos: string[]) {
    if (!ddd || candidatos.length === 0) return [];
    const { data } = await supabaseAdmin
        .from(NOME_TABELA_LEADS)
        .select('pessoaIdentificador, filial, pessoaTelefoneNumero')
        .eq('pessoaTelefoneDDD', ddd);
    if (!data) return [];
    const candidatosSet = new Set(candidatos);
    return data.filter((l: any) => candidatosSet.has(String(l.pessoaTelefoneNumero || "").replace(/\D/g, "")));
}

Deno.serve(async (req) => {
    const url = new URL(req.url);

    if (req.method === "GET") {
        const modo = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        if (modo === "subscribe" && token === VERIFY_TOKEN && challenge) {
            return new Response(challenge, { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
    }

    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const raw = await req.text();
    const assinaturaOk = await validarAssinatura(raw, req.headers.get("x-hub-signature-256"));
    if (!assinaturaOk) return new Response("Invalid signature", { status: 401 });

    let payload: any;
    try {
        payload = JSON.parse(raw);
    } catch {
        return new Response("Invalid JSON", { status: 400 });
    }

    for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
            const value = change.value ?? {};
            const phoneNumberId: string | undefined = value.metadata?.phone_number_id;

            for (const msg of value.messages ?? []) {
                const { ddd, numero } = separarFromMeta(msg.from);
                const candidatos = candidatosNumeroBR(numero);
                const matches = await buscarLeadsPorTelefone(ddd, candidatos);
                const match = matches.length === 1 ? matches[0] : null;

                const { error } = await supabaseAdmin.from(NOME_TABELA_MENSAGENS).upsert({
                    pessoaIdentificador: match?.pessoaIdentificador ?? null,
                    telefone_whatsapp: msg.from,
                    filial: match?.filial ?? null,
                    direcao: "entrada",
                    tipo: mapearTipoMeta(msg.type),
                    corpo_texto: extrairTexto(msg),
                    wa_message_id: msg.id,
                    wa_status: "entregue",
                    phone_number_id_meta: phoneNumberId,
                    payload_bruto: matches.length > 1 ? { ...msg, candidatos_ambiguos: matches } : msg,
                    criado_em: new Date(Number(msg.timestamp) * 1000).toISOString(),
                }, { onConflict: "wa_message_id", ignoreDuplicates: true });

                if (error) console.error("Erro ao gravar mensagem recebida:", error);
            }

            for (const status of value.statuses ?? []) {
                const { error } = await supabaseAdmin
                    .from(NOME_TABELA_MENSAGENS)
                    .update({
                        wa_status: mapearStatusMeta(status.status),
                        wa_status_erro: status.errors ?? null,
                        atualizado_em: new Date().toISOString(),
                    })
                    .eq("wa_message_id", status.id);
                if (error) console.error("Erro ao atualizar status:", error);
            }
        }
    }

    // Meta espera 200 rápido — reenvia o webhook se não receber.
    return new Response("EVENT_RECEIVED", { status: 200 });
});

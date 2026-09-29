// Edge Function: endpoint público chamado pela Meta.
// GET  = handshake de verificação do webhook.
// POST = mensagens recebidas + atualizações de status de mensagens enviadas.
//
// PRECISA ser deployada com verificação de JWT desligada (ver supabase/config.toml
// e `supabase functions deploy whatsapp-webhook --no-verify-jwt`) — a Meta não
// manda Authorization: Bearer, só X-Hub-Signature-256, que é validado abaixo.
import { supabaseAdmin, NOME_TABELA_LEADS, NOME_TABELA_MENSAGENS } from "../_shared/supabaseAdmin.ts";
import { candidatosNumeroBR, separarFromMeta } from "../_shared/telefone.ts";
import { aplicarReacao } from "../_shared/reacoes.ts";
import { baixarEArmazenarMidiaRecebida } from "../_shared/midia.ts";

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
    // Contato compartilhado (vCard) — pedido do usuário (2026-09-29):
    // "recebemos contatos pelo whatsapp, que não conseguimos ler" — antes
    // só gravava o texto genérico "[Mensagem tipo contacts]", mesmo o
    // payload da Meta já trazendo nome + telefone de verdade (guardado em
    // `msg.contacts`, e já preservado por completo em `payload_bruto`
    // desde sempre — só a coluna `corpo_texto`, que é o que aparece no
    // balão, nunca lia esses campos). Sem migração nova: continua
    // gravado com `tipo='outro'` (mensagens_whatsapp.tipo não tem
    // 'contato' no check constraint), só o TEXTO agora é legível.
    // Localização compartilhada — pedido do usuário (2026-09-29,
    // "implemente tudo que for possível"): a Meta manda lat/long direto
    // no payload (sem `id` de mídia pra baixar, diferente de imagem/
    // áudio/vídeo/figurinha) — já preservado por completo em
    // `payload_bruto` (spread de `msg`); só o TEXTO nunca lia isso.
    if (msg.type === "location" && msg.location) {
        const { latitude, longitude, name, address } = msg.location;
        const linkMaps = `https://www.google.com/maps?q=${latitude},${longitude}`;
        const rotulo = [name, address].filter(Boolean).join(" — ");
        return `📍 ${rotulo ? rotulo + " — " : ""}${linkMaps}`;
    }
    if (msg.type === "contacts" && Array.isArray(msg.contacts) && msg.contacts.length > 0) {
        return msg.contacts.map((c: any) => {
            const nome = c.name?.formatted_name || c.name?.first_name || "Contato sem nome";
            const telefones = (c.phones || []).map((p: any) => p.phone || p.wa_id).filter(Boolean).join(", ");
            return `📇 Contato compartilhado: ${nome}${telefones ? ` — ${telefones}` : ""}`;
        }).join("\n");
    }
    const rotulos: Record<string, string> = {
        image: "[Imagem recebida]", audio: "[Áudio recebido]", document: "[Documento recebido]",
        video: "[Vídeo recebido]", sticker: "[Figurinha recebida]", location: "[Localização recebida]",
    };
    return rotulos[msg.type] || `[Mensagem tipo ${msg.type}]`;
}

// Pedido do usuário (2026-09-29): "não consigo ouvir áudio pelo crm e
// preciso disso" — antes, `extrairTexto()` só gravava o texto literal
// "[Áudio recebido]", sem baixar a mídia de verdade em lugar nenhum.
// `baixarEArmazenarMidiaRecebida()` (_shared/midia.ts, compartilhada com
// whatsapp-backfill-midia) baixa da Graph API e re-hospeda no bucket
// público `whatsapp-midia` — best-effort: se falhar em qualquer etapa
// (token, rede, upload), devolve `null` e a mensagem ainda é gravada
// normalmente, só sem a mídia (cai no texto placeholder de
// extrairTexto()), nunca trava o webhook.

function mapearStatusMeta(status: string): string {
    if (status === "sent") return "enviado";
    if (status === "delivered") return "entregue";
    if (status === "read") return "lido";
    if (status === "failed") return "falhou";
    return "enviado";
}

// Bug real relatado pelo usuário (2026-09-28): "testei responder à
// mensagem que recebi do API pelo meu número pessoal, e caiu num lugar
// chamado 'não identificado'" — e "continua jogando as respostas em
// não identificados" numa 2ª rodada, com um caso real (IANNY GRASIELLY
// SILVA, lead 900000012, telefone 62 981255060, respondendo "já sou
// membro há 3 anos e meio"). A causa raiz de verdade, achada consultando
// o banco direto: esta função buscava TODOS os leads com o mesmo DDD
// (sem `.in()`/filtro por número na query) e filtrava os candidatos em
// JAVASCRIPT depois — mas o PostgREST corta em 1000 linhas por padrão
// (mesmo limite silencioso já documentado em vários outros lugares do
// projeto, ver "Aniversariantes"/"Ativos-Inativos" no CLAUDE.md), e só o
// DDD 62 tem quase 13 MIL leads. Sem `.order()`/paginação, a linha certa
// simplesmente podia nunca chegar a ser buscada — o lead da Ianny nunca
// aparecia nos 1000 primeiros devolvidos. Corrigido empurrando o filtro
// por NÚMERO pra dentro da própria query (`.in('pessoaTelefoneNumero',
// candidatos)`) — like isso, o Postgres já devolve só as poucas linhas
// que interessam, nunca esbarra no limite de 1000. A exclusão de leads
// na LIXEIRA (`lixeira_em`, achada numa investigação anterior) continua
// valendo, e nunca flexibiliza a escolha entre 2+ leads ATIVOS ambíguos
// (isso continua exigindo vínculo manual, de propósito).
async function buscarLeadsPorTelefone(ddd: string, candidatos: string[]) {
    if (!ddd || candidatos.length === 0) return [];
    const { data } = await supabaseAdmin
        .from(NOME_TABELA_LEADS)
        .select('pessoaIdentificador, filial, pessoaNome, pessoaTelefoneNumero')
        .eq('pessoaTelefoneDDD', ddd)
        .in('pessoaTelefoneNumero', candidatos)
        .is('lixeira_em', null);
    if (!data) return [];
    const candidatosSet = new Set(candidatos);
    return data.filter((l: any) => candidatosSet.has(String(l.pessoaTelefoneNumero || "").replace(/\D/g, "")));
}

// Bug real relatado pelo usuário (2026-09-29): "várias respostas continuam
// caindo no não identificados" — investigado contra dado real de produção,
// TODOS os casos encontrados eram o MESMO padrão: telefone duplicado entre
// 2+ filiais (mesma pessoa cadastrada 2x, ex: "GIORGIA TOMITÃO MÁRIO" em
// Jardim América E Goiânia II) — `buscarLeadsPorTelefone()` corretamente
// se recusa a escolher entre 2+ leads ATIVOS ambíguos (nunca arrisca
// atribuir a pessoa errada), então a resposta ficava presa sem
// pessoaIdentificador nenhum, mesmo sendo resolvível na prática.
//
// Sinal seguro pra desambiguar, achado consultando o histórico real: toda
// mensagem de SAÍDA (`whatsapp-send`) já sabe EXATAMENTE qual
// pessoaIdentificador estava mandando pra (nunca é ambígua — a chamada
// vem com o id certo desde o CRM), então "qual dos candidatos JÁ recebeu
// alguma mensagem nossa antes" é um sinal confiável de "é esse aqui que
// estamos contatando de verdade", nunca um chute. Testado contra os 4
// casos reais que geraram este bug (Kelly Susan, Nayana, Lorena, Giorgia):
// os 4 resolveriam corretamente com este critério (só 1 candidato de cada
// par/trio tinha histórico de mensagem). Só resolve quando EXATAMENTE 1
// candidato tem histórico — 2+ com histórico, ou nenhum, continua
// ambíguo (mesma cautela de sempre, nunca decide no chute).
async function resolverAmbiguidadePorHistorico(matches: any[]): Promise<any | null> {
    if (matches.length < 2) return null;
    const ids = matches.map((m: any) => String(m.pessoaIdentificador));
    const { data } = await supabaseAdmin
        .from(NOME_TABELA_MENSAGENS)
        .select('pessoaIdentificador')
        .in('pessoaIdentificador', ids)
        .limit(500);
    if (!data || data.length === 0) return null;
    const comHistorico = new Set(data.map((r: any) => String(r.pessoaIdentificador)));
    if (comHistorico.size !== 1) return null;
    const idResolvido = [...comHistorico][0];
    return matches.find((m: any) => String(m.pessoaIdentificador) === idResolvido) ?? null;
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
                // Reação com emoji a uma mensagem já existente (pedido do
                // usuário, 2026-09-28) — NUNCA cria uma linha nova em
                // mensagens_whatsapp; só atualiza `reacoes.lead` na
                // mensagem alvo (casada por wa_message_id). Achado
                // investigando um relato de "não identificado": antes
                // desta função existir, uma reação caía no caminho padrão
                // de mensagem — virava uma linha estranha ("[Mensagem
                // tipo reaction]") e, se o casamento por telefone falhasse
                // por qualquer motivo transitório (ex: durante um redeploy
                // desta própria function), ficava presa como "não
                // identificado" sem nunca ter sido uma conversa de
                // verdade. Sem casar telefone/lead nenhum aqui — a
                // mensagem original já tem o pessoaIdentificador certo.
                if (msg.type === "reaction") {
                    const resultado = await aplicarReacao(
                        supabaseAdmin,
                        NOME_TABELA_MENSAGENS,
                        msg.reaction?.message_id,
                        "lead",
                        msg.reaction?.emoji,
                    );
                    if (!resultado.ok) console.warn("Reação recebida não pôde ser aplicada:", msg.reaction, resultado.erro);
                    continue;
                }

                const { ddd, numero } = separarFromMeta(msg.from);
                const candidatos = candidatosNumeroBR(numero);
                const matches = await buscarLeadsPorTelefone(ddd, candidatos);
                let match = matches.length === 1 ? matches[0] : null;
                let resolvidoPorHistorico = false;
                if (!match && matches.length > 1) {
                    const resolvido = await resolverAmbiguidadePorHistorico(matches);
                    if (resolvido) { match = resolvido; resolvidoPorHistorico = true; }
                }

                // Baixa e re-hospeda a mídia de verdade (áudio/imagem/
                // documento) — mesmas chaves já lidas por htmlMensagemWpp()
                // no frontend (`imagem_url`/`documento_url`+`nome_arquivo`)
                // pra imagem/documento reaproveitarem o mesmo render já
                // usado pro que NÓS enviamos; `audio_url`/`audio_mime` é
                // novo, pro player de áudio.
                let midiaExtra: Record<string, unknown> = {};
                const tipoMapeado = mapearTipoMeta(msg.type);
                if (tipoMapeado === "audio" && msg.audio?.id) {
                    const midia = await baixarEArmazenarMidiaRecebida(supabaseAdmin, msg.audio.id);
                    if (midia) midiaExtra = { audio_url: midia.url, audio_mime: midia.mimeType };
                } else if (tipoMapeado === "imagem" && msg.image?.id) {
                    const midia = await baixarEArmazenarMidiaRecebida(supabaseAdmin, msg.image.id);
                    if (midia) midiaExtra = { imagem_url: midia.url };
                } else if (tipoMapeado === "documento" && msg.document?.id) {
                    const midia = await baixarEArmazenarMidiaRecebida(supabaseAdmin, msg.document.id);
                    if (midia) midiaExtra = { documento_url: midia.url, nome_arquivo: msg.document.filename || "documento" };
                } else if (tipoMapeado === "video" && msg.video?.id) {
                    // Pedido do usuário (2026-09-29, "implemente tudo que for
                    // possível"): vídeo recebido tocando de verdade — mesmo
                    // mecanismo de áudio/imagem, só o `id` muda de campo.
                    const midia = await baixarEArmazenarMidiaRecebida(supabaseAdmin, msg.video.id);
                    if (midia) midiaExtra = { video_url: midia.url, video_mime: midia.mimeType };
                } else if (tipoMapeado === "sticker" && msg.sticker?.id) {
                    const midia = await baixarEArmazenarMidiaRecebida(supabaseAdmin, msg.sticker.id);
                    if (midia) midiaExtra = { sticker_url: midia.url };
                }

                const payloadBase = resolvidoPorHistorico
                    ? { ...msg, resolvido_por_historico: true, candidatos_ambiguos: matches }
                    : (matches.length > 1 ? { ...msg, candidatos_ambiguos: matches } : msg);

                const { error } = await supabaseAdmin.from(NOME_TABELA_MENSAGENS).upsert({
                    pessoaIdentificador: match?.pessoaIdentificador ?? null,
                    telefone_whatsapp: msg.from,
                    filial: match?.filial ?? null,
                    direcao: "entrada",
                    tipo: tipoMapeado,
                    corpo_texto: extrairTexto(msg),
                    wa_message_id: msg.id,
                    wa_status: "entregue",
                    phone_number_id_meta: phoneNumberId,
                    payload_bruto: { ...payloadBase, ...midiaExtra },
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

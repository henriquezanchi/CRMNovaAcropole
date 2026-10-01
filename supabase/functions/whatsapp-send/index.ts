// Edge Function: envia uma mensagem de WhatsApp (texto livre ou template)
// pra um lead, via Meta Cloud API, e grava o resultado em mensagens_whatsapp.
//
// Chamada pelo frontend via `supabaseClient.functions.invoke('whatsapp-send', {...})`.
// Mantém verificação de JWT padrão (o supabase-js já manda a chave publishable
// como Bearer automaticamente) — ver supabase/config.toml.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin, NOME_TABELA_LEADS, NOME_TABELA_MENSAGENS } from "../_shared/supabaseAdmin.ts";
import { montarNumeroE164 } from "../_shared/telefone.ts";
import { aplicarReacao } from "../_shared/reacoes.ts";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") ?? "v21.0";
const TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;
const PHONE_ID_DEFAULT = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_DEFAULT")!;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;

    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    let corpoReq: {
        pessoaIdentificador?: string;
        // Responder um número "não identificado" (mensagem recebida sem
        // nenhum lead casado por telefone, ver whatsapp-webhook) — quando
        // vem preenchido SEM pessoaIdentificador, manda texto livre direto
        // pra esse número, sem lead/filial nenhum resolvido. Não suportado
        // pra template/imagem/documento (não faz sentido sem lead pra
        // resolver as variáveis) — só texto.
        telefoneWhatsapp?: string;
        tipo?: "texto" | "template" | "imagem" | "documento" | "audio" | "reacao";
        texto?: string;
        templateNome?: string;
        templateIdioma?: string;
        templateParams?: string[];
        templatePreview?: string;
        imagemUrl?: string;
        documentoUrl?: string;
        audioUrl?: string;
        nomeArquivo?: string;
        caption?: string;
        atendenteNome?: string;
        mensagemAlvoId?: string;
        emoji?: string;
        // Responder a UMA mensagem específica (pedido do usuário,
        // 2026-09-29: "igual no whatsapp real") — `contextoMessageId` é o
        // wa_message_id da mensagem citada, exigido pela Graph API pra
        // montar o `context` da resposta; `contextoPreview`/`contextoRemetente`
        // são só nossos, guardados em payload_bruto pra renderizar a
        // citação no balão sem precisar resolver de novo depois (ver
        // resolverCitacaoWpp(), js/whatsapp.js).
        contextoMessageId?: string;
        contextoPreview?: string;
        contextoRemetente?: string;
        // Pedido do usuário (2026-10-01): "quando for eu, coloque meu
        // nome, quando for API, coloque API, e mude para o nome do SDR
        // que assumir a conversa" — a fila automática antiga (round-robin
        // entre qualquer usuário com módulo tab-whatsapp, mesmo quem
        // nunca logou — ver bug real da Ediliene) foi substituída por
        // isto: `wpp_atendente_responsavel` passa a refletir quem REALMENTE
        // mandou a última mensagem. 'campanha' = disparo em massa
        // (Convidar API/Janela Aberta) — grava "API", não o nome de quem
        // clicou o botão (não é uma resposta pessoal a ESTA conversa).
        // Omitido/'manual' = resposta de verdade de um atendente (1:1,
        // inclusive sugestão de IA revisada e enviada) — grava o nome
        // real de quem está logado.
        origemEnvio?: "manual" | "campanha";
    };
    try {
        corpoReq = await req.json();
    } catch {
        return json({ ok: false, erro: "json_invalido" }, 400);
    }

    const { pessoaIdentificador, telefoneWhatsapp, tipo, texto, templateNome, templateIdioma, templateParams, templatePreview, imagemUrl, documentoUrl, audioUrl, nomeArquivo, caption, atendenteNome, mensagemAlvoId, emoji, contextoMessageId, contextoPreview, contextoRemetente, origemEnvio } = corpoReq;
    if ((!pessoaIdentificador && !telefoneWhatsapp) || !tipo) return json({ ok: false, erro: "parametros_faltando" }, 400);
    if (!pessoaIdentificador && tipo !== "texto") return json({ ok: false, erro: "tipo_exige_lead" }, 400);
    if (tipo === "texto" && !texto?.trim()) return json({ ok: false, erro: "texto_vazio" }, 400);
    if (tipo === "template" && !templateNome) return json({ ok: false, erro: "template_nome_faltando" }, 400);
    if (tipo === "imagem" && !imagemUrl?.trim()) return json({ ok: false, erro: "imagem_url_faltando" }, 400);
    if (tipo === "documento" && !documentoUrl?.trim()) return json({ ok: false, erro: "documento_url_faltando" }, 400);
    if (tipo === "audio" && !audioUrl?.trim()) return json({ ok: false, erro: "audio_url_faltando" }, 400);
    // "reacao" — emoji vazio é válido (remove uma reação já enviada, mesmo
    // comportamento do WhatsApp real), só o id da mensagem alvo é obrigatório.
    if (tipo === "reacao" && !mensagemAlvoId?.trim()) return json({ ok: false, erro: "mensagem_alvo_faltando" }, 400);

    // Busca telefone/filial do lead no servidor — não confia no que vier do
    // front. Quando não há pessoaIdentificador (respondendo um número
    // "não identificado", ver whatsapp-webhook), usa o telefone bruto
    // direto, sem filial nenhuma resolvida (cai no número padrão).
    let numeroE164: string | null = null;
    let filial: string | null = null;
    if (pessoaIdentificador) {
        const { data: lead, error: erroLead } = await supabaseAdmin
            .from(NOME_TABELA_LEADS)
            .select('pessoaTelefoneDDD, pessoaTelefoneNumero, pessoaNome, filial')
            .eq('pessoaIdentificador', pessoaIdentificador)
            .single();
        if (erroLead || !lead) return json({ ok: false, erro: "lead_nao_encontrado" }, 404);
        numeroE164 = montarNumeroE164(lead.pessoaTelefoneDDD, lead.pessoaTelefoneNumero);
        if (!numeroE164) return json({ ok: false, erro: "lead_sem_telefone" }, 422);
        filial = lead.filial;
    } else {
        numeroE164 = (telefoneWhatsapp || "").replace(/\D/g, "") || null;
        if (!numeroE164) return json({ ok: false, erro: "telefone_invalido" }, 422);
    }

    // Resolve o número da Meta que envia: da filial do lead, com fallback pro padrão.
    let phoneNumberId = PHONE_ID_DEFAULT;
    if (filial) {
        const { data: filialRow } = await supabaseAdmin
            .from("filiais")
            .select("whatsapp_phone_number_id")
            .eq("nome", filial)
            .maybeSingle();
        if (filialRow?.whatsapp_phone_number_id) phoneNumberId = filialRow.whatsapp_phone_number_id;
    }

    const bodyGraph = tipo === "template"
        ? {
            messaging_product: "whatsapp",
            to: numeroE164,
            type: "template",
            template: {
                name: templateNome,
                // Precisa bater EXATO com o idioma registrado na Meta pra
                // esse template (campo "Selecione o idioma" na criação) —
                // template com idioma errado falha o envio na hora. A
                // maioria é pt_BR, mas alguns foram registrados como
                // en_US por engano e ainda não foram reenviados — ver
                // TEMPLATES_WHATSAPP em js/whatsapp.js.
                language: { code: templateIdioma || "pt_BR" },
                components: [{
                    type: "body",
                    parameters: (templateParams || []).map((p) => ({ type: "text", text: p })),
                }],
            },
        }
        : tipo === "imagem"
        ? {
            // "link" (não upload de mídia) — a própria Meta busca a imagem
            // nessa URL pra montar a mensagem; o destinatário recebe a FOTO
            // de verdade (mensagem de mídia real, não um link de texto pra
            // clicar) — pedido explícito do usuário ("não deve ser
            // compartilhado o link da imagem, e sim a imagem propriamente
            // dita"). Pensado pro "Convite Compartilhável": a pessoa recebe
            // a foto do evento já pronta pra repassar no Status/Stories
            // (o próprio WhatsApp já tem um botão de "compartilhar" nativo
            // em qualquer imagem recebida).
            messaging_product: "whatsapp",
            to: numeroE164,
            type: "image",
            image: caption ? { link: imagemUrl, caption } : { link: imagemUrl },
        }
        : tipo === "documento"
        ? {
            // Mesmo raciocínio do tipo "imagem" — "link", não upload de
            // mídia; a própria Meta busca o arquivo nessa URL. Usado pelo
            // anexo livre do compose bar (enviarComAnexo(), js/whatsapp.js),
            // que sobe o arquivo pro Supabase Storage (bucket
            // `whatsapp-midia`, público) antes de chamar esta function.
            messaging_product: "whatsapp",
            to: numeroE164,
            type: "document",
            document: caption
                ? { link: documentoUrl, filename: nomeArquivo, caption }
                : { link: documentoUrl, filename: nomeArquivo },
        }
        : tipo === "audio"
        ? {
            // Mesmo raciocínio de imagem/documento — "link", a própria
            // Meta busca o arquivo. Usado hoje só por "Encaminhar
            // mensagem" (áudio recebido de um lead, re-hospedado no
            // Storage, encaminhado como áudio de verdade pra outro lead
            // — ver confirmarEncaminharWpp(), js/whatsapp.js).
            messaging_product: "whatsapp",
            to: numeroE164,
            type: "audio",
            audio: { link: audioUrl },
        }
        : tipo === "reacao"
        ? {
            // Pedido do usuário (2026-09-28): reagir com emoji igual o
            // WhatsApp real. `emoji: ""` é o jeito da própria Graph API de
            // REMOVER uma reação já enviada — nunca cria uma mensagem nova
            // no chat, só atualiza a reação da mensagem alvo (ver
            // aplicarReacao() em _shared/reacoes.ts, chamado abaixo).
            messaging_product: "whatsapp",
            to: numeroE164,
            type: "reaction",
            reaction: { message_id: mensagemAlvoId, emoji: emoji || "" },
        }
        : {
            messaging_product: "whatsapp",
            to: numeroE164,
            type: "text",
            text: { body: texto },
        };

    // Responder a uma mensagem específica (pedido do usuário, 2026-09-29)
    // — a Graph API aceita `context.message_id` em QUALQUER tipo de
    // mensagem de saída (não só texto), então basta anexar aqui, depois
    // de `bodyGraph` já montado pro tipo certo.
    if (contextoMessageId) (bodyGraph as any).context = { message_id: contextoMessageId };

    const corpoTexto = tipo === "template" ? (templatePreview || `[Template: ${templateNome}]`)
        : tipo === "imagem" ? (caption || "[Imagem]")
        : tipo === "documento" ? (caption || `[Documento: ${nomeArquivo || "arquivo"}]`)
        : tipo === "audio" ? "[Áudio]"
        : texto;
    // Guarda a URL/nome junto do payload bruto — a resposta da Graph API
    // não devolve isso de volta, e o chat precisa pra RENDERIZAR a
    // imagem/o cartão de documento/o player de áudio de verdade (não só
    // a legenda). Ver htmlMensagemWpp() em js/whatsapp.js.
    const payloadExtra = {
        ...(tipo === "imagem" ? { imagem_url: imagemUrl } : {}),
        ...(tipo === "documento" ? { documento_url: documentoUrl, nome_arquivo: nomeArquivo } : {}),
        ...(tipo === "audio" ? { audio_url: audioUrl } : {}),
        // Guarda os parâmetros originais do template — necessário pra um
        // reenvio automático futuro conseguir reconstruir a MESMA chamada
        // (ver whatsapp-reenviar-falhas) — sem isso, só teríamos o texto
        // já renderizado (corpo_texto), que não dá pra mandar de volta
        // como template de verdade pra Graph API.
        ...(tipo === "template" ? { template_nome: templateNome, template_idioma: templateIdioma || "pt_BR", template_params: templateParams || [] } : {}),
        ...(contextoMessageId ? { contexto_preview: contextoPreview || null, contexto_remetente: contextoRemetente || null } : {}),
    };

    let respGraph: Response;
    let respJson: any;
    try {
        respGraph = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(bodyGraph),
        });
        respJson = await respGraph.json();
    } catch (e) {
        return json({ ok: false, erro: "falha_rede_meta", detalhe: String(e) }, 502);
    }

    if (!respGraph.ok) {
        const codigo = respJson?.error?.code;
        const mensagemErro = String(respJson?.error?.message || "");
        // 131047 é o código real da Meta pra "fora da janela de 24h", mas a
        // Meta já mudou detalhes de erro entre versões — checa o texto também.
        const foraDaJanela = codigo === 131047 || /24 hour/i.test(mensagemErro);

        // Reação nunca vira uma linha própria em mensagens_whatsapp — só
        // atualiza a mensagem alvo (e, se a Meta recusou, nem isso).
        if (tipo !== "reacao") {
            await supabaseAdmin.from(NOME_TABELA_MENSAGENS).insert({
                pessoaIdentificador: pessoaIdentificador ?? null,
                telefone_whatsapp: numeroE164,
                filial,
                direcao: "saida",
                tipo,
                corpo_texto: corpoTexto,
                wa_status: "falhou",
                wa_status_erro: respJson?.error ?? { message: "erro desconhecido" },
                phone_number_id_meta: phoneNumberId,
                payload_bruto: { ...respJson, ...payloadExtra },
                atendente_nome: atendenteNome || null,
            });
        }

        return json({ ok: false, erro: foraDaJanela ? "janela_fechada" : "erro_meta", detalhe: respJson?.error }, 200);
    }

    if (tipo === "reacao") {
        const resultado = await aplicarReacao(supabaseAdmin, NOME_TABELA_MENSAGENS, mensagemAlvoId, "atendente", emoji);
        if (!resultado.ok) return json({ ok: false, erro: resultado.erro }, 200);
        return json({ ok: true });
    }

    const waMessageId = respJson.messages?.[0]?.id;
    await supabaseAdmin.from(NOME_TABELA_MENSAGENS).insert({
        pessoaIdentificador: pessoaIdentificador ?? null,
        telefone_whatsapp: numeroE164,
        filial,
        direcao: "saida",
        tipo,
        corpo_texto: corpoTexto,
        wa_message_id: waMessageId,
        wa_status: "enviado",
        phone_number_id_meta: phoneNumberId,
        payload_bruto: { ...respJson, ...payloadExtra },
        atendente_nome: atendenteNome || null,
    });

    // "Último contato" (pedido do usuário, 2026-09-30) — carimbado
    // automaticamente aqui, ÚNICO ponto por onde todo envio real de
    // WhatsApp passa (individual, template, convite em massa, aniversário
    // etc.) — evita duplicar essa lógica em cada chamador do frontend.
    // Best-effort: nunca falha o envio (que já aconteceu de verdade) por
    // causa disso.
    if (pessoaIdentificador) {
        const responsavel = origemEnvio === "campanha" ? "API" : (atendenteNome || null);
        await supabaseAdmin.from(NOME_TABELA_LEADS)
            .update({
                ultimo_contato_em: new Date().toISOString(),
                // Pedido do usuário (2026-10-01) — ver comentário no tipo
                // `origemEnvio` acima. Só atualiza quando há um valor real
                // pra gravar (nunca apaga um responsável já existente só
                // porque este envio específico não trouxe atendenteNome).
                ...(responsavel ? { wpp_atendente_responsavel: responsavel } : {}),
            })
            .eq("pessoaIdentificador", pessoaIdentificador)
            .then(() => {}, () => {});
    }

    return json({ ok: true, wa_message_id: waMessageId });
});

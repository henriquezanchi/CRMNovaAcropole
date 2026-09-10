// Edge Function: importa uma conversa de WhatsApp feita "por fora" do CRM
// (enquanto a API do Meta está bloqueada — ver "Bloqueio da API do
// WhatsApp" no CLAUDE.md). Recebe as mensagens já PARSEADAS no navegador
// (parseTextoConversaWhatsApp(), js/importar-conversa-whatsapp.js) a
// partir do .txt exportado nativamente pelo WhatsApp, e grava em lote em
// mensagens_whatsapp.
//
// Só existe porque mensagens_whatsapp NÃO tem policy de INSERT pro
// público (só Edge Functions com service_role escrevem nela — ver
// migracao_whatsapp.sql) — mesmo padrão de whatsapp-send/whatsapp-webhook.
// Telefone/filial são resolvidos aqui a partir do lead, nunca confiando no
// que vier do navegador (mesmo cuidado de whatsapp-send).
//
// Chamada pelo frontend via supabaseClient.functions.invoke(...). Mantém
// verificação de JWT padrão.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin, NOME_TABELA_LEADS, NOME_TABELA_MENSAGENS } from "../_shared/supabaseAdmin.ts";
import { montarNumeroE164 } from "../_shared/telefone.ts";

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

interface MensagemImportada {
    direcao: "entrada" | "saida";
    texto: string;
    timestamp: string; // ISO — já com um pequeno deslocamento em ms por
                        // índice, calculado no navegador, pra preservar a
                        // ordem original mesmo entre mensagens do mesmo minuto
                        // (o .txt exportado não traz segundos).
}

const LIMITE_MENSAGENS_POR_IMPORTACAO = 3000; // rede de segurança — uma conversa de verdade nunca chega nem perto disso

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;

    if (req.method !== "POST") return json({ ok: false, erro: "method_not_allowed" }, 405);

    let corpoReq: { pessoaIdentificador?: string; mensagens?: MensagemImportada[] };
    try {
        corpoReq = await req.json();
    } catch {
        return json({ ok: false, erro: "json_invalido" }, 400);
    }

    const { pessoaIdentificador, mensagens } = corpoReq;
    if (!pessoaIdentificador || !Array.isArray(mensagens) || mensagens.length === 0) {
        return json({ ok: false, erro: "parametros_faltando" }, 400);
    }
    if (mensagens.length > LIMITE_MENSAGENS_POR_IMPORTACAO) {
        return json({ ok: false, erro: "conversa_grande_demais" }, 400);
    }
    for (const m of mensagens) {
        if (m.direcao !== "entrada" && m.direcao !== "saida") return json({ ok: false, erro: "direcao_invalida" }, 400);
        if (!m.texto || typeof m.texto !== "string") return json({ ok: false, erro: "mensagem_sem_texto" }, 400);
        if (!m.timestamp || Number.isNaN(new Date(m.timestamp).getTime())) return json({ ok: false, erro: "timestamp_invalido" }, 400);
    }

    // Busca telefone/filial do lead no servidor — não confia no que vier do front.
    const { data: lead, error: erroLead } = await supabaseAdmin
        .from(NOME_TABELA_LEADS)
        .select("pessoaTelefoneDDD, pessoaTelefoneNumero, filial")
        .eq("pessoaIdentificador", pessoaIdentificador)
        .single();
    if (erroLead || !lead) return json({ ok: false, erro: "lead_nao_encontrado" }, 404);

    // Sem telefone cadastrado ainda é um estado válido (mensagens_whatsapp
    // exige telefone_whatsapp NOT NULL) — string vazia sinaliza "desconhecido",
    // sem inventar um número que não existe.
    const telefoneWhatsapp = montarNumeroE164(lead.pessoaTelefoneDDD, lead.pessoaTelefoneNumero) || "";

    const linhas = mensagens.map((m) => ({
        pessoaIdentificador,
        telefone_whatsapp: telefoneWhatsapp,
        filial: lead.filial,
        direcao: m.direcao,
        tipo: "texto",
        corpo_texto: m.texto,
        // "entregue"/"enviado" (nunca "lido") — não sabemos de verdade se a
        // pessoa leu; mesma convenção de wa_status usada pelo webhook pra
        // mensagem recebida de fato ("entregue").
        wa_status: m.direcao === "saida" ? "enviado" : "entregue",
        importado_manualmente: true,
        criado_em: m.timestamp,
    }));

    const { error: erroInsert } = await supabaseAdmin.from(NOME_TABELA_MENSAGENS).insert(linhas);
    if (erroInsert) return json({ ok: false, erro: "erro_insercao", detalhe: erroInsert.message }, 500);

    return json({ ok: true, importadas: linhas.length });
});

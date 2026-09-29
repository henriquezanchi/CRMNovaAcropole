// Edge Function de manutenção pontual (não faz parte de nenhum fluxo
// automático): baixa a mídia real de áudios/imagens/documentos RECEBIDOS
// que já estavam gravados em mensagens_whatsapp ANTES de
// baixarEArmazenarMidiaRecebida() existir (ver whatsapp-webhook) — sem
// isso, essas mensagens antigas ficariam pra sempre só com o texto
// placeholder ("[Áudio recebido]" etc.), mesmo depois do recurso já
// funcionar pra mensagens novas. Chamada manualmente 1x (via
// supabaseClient.functions.invoke ou curl), não por cron — é um reparo
// de dado histórico, não uma rotina.
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { supabaseAdmin, NOME_TABELA_MENSAGENS } from "../_shared/supabaseAdmin.ts";
import { baixarEArmazenarMidiaRecebida } from "../_shared/midia.ts";

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;

    const { data: pendentes, error } = await supabaseAdmin
        .from(NOME_TABELA_MENSAGENS)
        .select("id, tipo, payload_bruto")
        .eq("direcao", "entrada")
        .in("tipo", ["audio", "imagem", "documento"])
        .order("criado_em", { ascending: false })
        .limit(200);
    if (error) return json({ ok: false, erro: error.message }, 500);

    const resultados: any[] = [];
    for (const m of pendentes ?? []) {
        const pb = m.payload_bruto || {};
        const jaTem = pb.audio_url || pb.imagem_url || pb.documento_url;
        if (jaTem) continue;

        const mediaId = pb.audio?.id || pb.image?.id || pb.document?.id;
        if (!mediaId) { resultados.push({ id: m.id, ok: false, motivo: "sem media id no payload_bruto" }); continue; }

        const midia = await baixarEArmazenarMidiaRecebida(supabaseAdmin, mediaId);
        if (!midia) { resultados.push({ id: m.id, ok: false, motivo: "download falhou (media id pode ter expirado)" }); continue; }

        const extra = m.tipo === "audio" ? { audio_url: midia.url, audio_mime: midia.mimeType }
            : m.tipo === "imagem" ? { imagem_url: midia.url }
            : { documento_url: midia.url, nome_arquivo: pb.document?.filename || "documento" };

        const { error: erroUpdate } = await supabaseAdmin
            .from(NOME_TABELA_MENSAGENS)
            .update({ payload_bruto: { ...pb, ...extra } })
            .eq("id", m.id);
        resultados.push({ id: m.id, ok: !erroUpdate, motivo: erroUpdate?.message });
    }

    return json({ ok: true, processados: resultados.length, resultados });
});

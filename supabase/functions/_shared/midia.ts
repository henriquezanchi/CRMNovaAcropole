// Baixa uma mídia recebida da Meta (áudio/imagem/documento — só temos o
// `id`, nunca a URL/binário direto no payload do webhook) e re-hospeda no
// bucket público `whatsapp-midia` (mesmo já usado pro envio de anexos,
// ver migracao_storage_whatsapp_midia.sql), devolvendo uma URL pública
// permanente — os links temporários da Graph API expiram rápido e exigem
// Bearer token, o que o <audio>/<img> do navegador não consegue mandar.
// Compartilhado entre whatsapp-webhook (mídia nova, tempo real) e
// whatsapp-backfill-midia (mídia antiga que chegou antes deste recurso
// existir, ver CLAUDE.md).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") ?? "v21.0";
const TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;

export async function baixarEArmazenarMidiaRecebida(
    supabaseAdmin: SupabaseClient,
    mediaId: string,
): Promise<{ url: string; mimeType: string } | null> {
    try {
        const respMeta = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
        if (!respMeta.ok) { console.warn("Erro ao resolver URL da mídia:", await respMeta.text()); return null; }
        const metaJson = await respMeta.json();
        const urlTemporaria: string | undefined = metaJson?.url;
        const mimeType: string = metaJson?.mime_type || "application/octet-stream";
        if (!urlTemporaria) return null;

        const respBin = await fetch(urlTemporaria, { headers: { Authorization: `Bearer ${TOKEN}` } });
        if (!respBin.ok) { console.warn("Erro ao baixar binário da mídia:", respBin.status); return null; }
        const bytes = new Uint8Array(await respBin.arrayBuffer());

        const extensao = mimeType.split("/")[1]?.split(";")[0] || "bin";
        const caminho = `entrada/${mediaId}.${extensao}`;
        const { error: erroUpload } = await supabaseAdmin.storage
            .from("whatsapp-midia")
            .upload(caminho, bytes, { contentType: mimeType, upsert: true });
        if (erroUpload) { console.error("Erro ao subir mídia recebida pro Storage:", erroUpload); return null; }

        const { data: urlData } = supabaseAdmin.storage.from("whatsapp-midia").getPublicUrl(caminho);
        return { url: urlData.publicUrl, mimeType };
    } catch (e) {
        console.error("Erro inesperado baixando mídia recebida:", e);
        return null;
    }
}

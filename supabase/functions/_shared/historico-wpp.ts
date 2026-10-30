// Histórico de WhatsApp em texto para os prompts de IA (sugestão de resposta e
// robô de reengajamento). Bug real, 30/10/2026: o histórico mostrava áudio só
// como "[audio]", mesmo depois de transcrito — o robô respondeu "me conta o que
// você gostaria de saber" a um áudio que ele nunca leu (e a uma mensagem que nem
// era para a escola). Aqui o áudio entra com a transcrição automática, quando já
// existe, e quem chama fica sabendo se a última mensagem do lead ainda é ilegível.
import { supabaseAdmin } from "./supabaseAdmin.ts";

type MensagemHistorico = { id: number; direcao: string; corpo_texto: string | null; tipo: string };

export async function montarHistoricoWpp(msgs: MensagemHistorico[]): Promise<{ texto: string; ultimaDoLeadIlegivel: boolean }> {
    const idsAudio = msgs.filter((m) => m.tipo === "audio").map((m) => m.id);
    const transcricoes = new Map<number, string>();
    if (idsAudio.length > 0) {
        const { data } = await supabaseAdmin
            .from("crm_audio_transcricoes")
            .select("mensagem_id, texto")
            .in("mensagem_id", idsAudio)
            .eq("estado", "concluido");
        (data || []).forEach((t: any) => { if (t.texto) transcricoes.set(Number(t.mensagem_id), String(t.texto)); });
    }

    let ultimaDoLeadIlegivel = false;
    const linhas = msgs.map((m) => {
        const quem = m.direcao === "entrada" ? "Lead" : "Escola";
        const corpo = String(m.corpo_texto || "").trim();
        let conteudo: string;
        let legivel = true;
        if (m.tipo === "texto") {
            conteudo = corpo;
        } else if (m.tipo === "audio") {
            const transcricao = transcricoes.get(Number(m.id));
            legivel = !!transcricao;
            conteudo = transcricao
                ? `[áudio, transcrição automática] "${transcricao}"`
                : "[áudio ainda sem transcrição — conteúdo desconhecido]";
        } else {
            const legenda = corpo && !corpo.startsWith("[") ? ` ${corpo}` : "";
            legivel = !!legenda;
            conteudo = `[${m.tipo}]${legenda}`;
        }
        if (m.direcao === "entrada") ultimaDoLeadIlegivel = !legivel;
        return `${quem}: ${conteudo}`;
    });
    return { texto: linhas.join("\n"), ultimaDoLeadIlegivel };
}

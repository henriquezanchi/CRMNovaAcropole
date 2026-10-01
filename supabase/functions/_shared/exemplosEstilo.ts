// Compartilhado entre sugerir-resposta-whatsapp e classificar-resposta-
// convite — pedido do usuário (2026-10-01): "me ajude a treinar a IA.
// Veja as respostas que recebemos e as respostas que dei lá. Vamos
// aprender a responder com o endereço, com os valores, e quebrar as
// objeções dos leads". Busca exemplos REAIS curados em
// exemplos_resposta_ia (migracao_exemplos_resposta_ia.sql), extraídos de
// verdade do histórico de mensagens_whatsapp — nunca inventados.
import { supabaseAdmin } from "./supabaseAdmin.ts";

export async function buscarExemplosEstilo(): Promise<string> {
    const { data } = await supabaseAdmin.from("exemplos_resposta_ia").select("mensagem_lead, resposta_time").eq("ativo", true).limit(12);
    if (!data || data.length === 0) return "";
    return data.map((e: any) => `Lead: "${e.mensagem_lead}"\nTime: "${e.resposta_time}"`).join("\n\n");
}

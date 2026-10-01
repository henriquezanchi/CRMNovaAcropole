// Compartilhado entre sugerir-resposta-whatsapp e classificar-resposta-
// convite — pedido do usuário (2026-10-01): "cada SDR teria a sua
// persona... podemos estabelecer uma janela de aprendizagem". Versão
// ENXUTA dessa ideia: em vez de um chat aberto de treino (custo/
// complexidade maiores pra controlar, resultado menos previsível), cada
// atendente configura um perfil ESTRUTURADO (tom de voz + observações
// livres, `usuarios_crm.persona_tom`/`persona_notas`,
// migracao_persona_atendente.sql) — igual em espírito ao
// `exemplos_resposta_ia`/`buscarExemplosEstilo()` já existente, só que
// POR PESSOA em vez de compartilhado pelo time inteiro.
//
// Resolvido por `leads_inscricoes.wpp_atendente_responsavel` — quem está
// de fato respondendo aquela conversa (atualizado a cada envio real,
// ver whatsapp-send) — não pela filial nem por quem criou o lead. Sem
// atendente responsável ainda (conversa nunca teve envio manual, ou
// "API") ou sem persona configurada, devolve "" — comportamento de
// sempre, sem persona nenhuma.
import { supabaseAdmin } from "./supabaseAdmin.ts";

const ROTULO_TOM: Record<string, string> = {
    formal: "Tom de voz pedido por este atendente: mais FORMAL e educado (ex: parecido com a linguagem do site institucional da escola) — evite gírias/abreviações informais, trate a pessoa com mais formalidade, mas sem ficar frio ou distante.",
    descontraido: "Tom de voz pedido por este atendente: mais DESCONTRAÍDO e informal (linguagem próxima de uma conversa de WhatsApp pessoal) — pode usar expressões mais soltas, desde que continue respeitosa.",
    neutro: "Tom de voz pedido por este atendente: neutro/equilibrado (nem muito formal, nem muito informal).",
};

export async function buscarPersonaAtendente(nomeAtendente: string | null | undefined): Promise<string> {
    if (!nomeAtendente || nomeAtendente === "API") return "";
    const { data } = await supabaseAdmin
        .from("usuarios_crm")
        .select("persona_tom, persona_notas")
        .eq("nome", nomeAtendente)
        .maybeSingle();
    if (!data) return "";

    const partes: string[] = [];
    if (data.persona_tom && ROTULO_TOM[data.persona_tom]) partes.push(ROTULO_TOM[data.persona_tom]);
    if (data.persona_notas && data.persona_notas.trim()) {
        partes.push(`Observações deste atendente sobre como ele gosta que as respostas sejam escritas (siga, a menos que conflite com uma regra de segurança já dada acima — nunca invente fato novo por causa disto): ${data.persona_notas.trim()}`);
    }
    if (partes.length === 0) return "";

    return `Persona configurada por ${nomeAtendente} (o atendente responsável por esta conversa) pra como a IA deve escrever a sugestão:\n${partes.join("\n")}`;
}

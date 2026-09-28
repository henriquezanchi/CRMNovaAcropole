// Aplica (ou remove) uma reação de emoji numa mensagem já existente,
// casada pelo wa_message_id — compartilhado entre whatsapp-send (quando
// NÓS reagimos a uma mensagem do lead ou a uma mensagem nossa) e
// whatsapp-webhook (quando o LEAD reage a uma mensagem nossa). `chave` é
// 'atendente' ou 'lead'; `emoji` vazio/undefined remove a reação daquele
// lado — mesmo comportamento do WhatsApp real (reagir de novo com o MESMO
// emoji troca por nada, reagir com outro troca o emoji).
export async function aplicarReacao(
    supabaseAdmin: any,
    tabela: string,
    waMessageIdAlvo: string | undefined | null,
    chave: "atendente" | "lead",
    emoji: string | undefined | null,
): Promise<{ ok: boolean; erro?: string }> {
    if (!waMessageIdAlvo) return { ok: false, erro: "mensagem_alvo_faltando" };

    const { data, error: erroBusca } = await supabaseAdmin
        .from(tabela)
        .select("id, reacoes")
        .eq("wa_message_id", waMessageIdAlvo)
        .maybeSingle();
    if (erroBusca || !data) return { ok: false, erro: "mensagem_alvo_nao_encontrada" };

    const reacoes: Record<string, string> = { ...(data.reacoes || {}) };
    if (emoji) reacoes[chave] = emoji;
    else delete reacoes[chave];

    const { error: erroUpdate } = await supabaseAdmin
        .from(tabela)
        .update({ reacoes: Object.keys(reacoes).length ? reacoes : null })
        .eq("id", data.id);
    if (erroUpdate) return { ok: false, erro: "falha_gravar_reacao" };
    return { ok: true };
}

// Janela de 24h do WhatsApp para os envios automáticos de texto livre.
// Bug real, 30/10/2026: o lembrete de evento e a pesquisa de quem não
// compareceu mandavam texto livre para todo mundo da lista, com a janela
// aberta ou não — 9 tentativas numa só manhã voltaram com o erro 131047
// (fora da janela). A Meta só aceita texto livre para quem nos escreveu nas
// últimas 24h; fora disso, só modelo aprovado. Mandar mesmo assim é
// tentativa inútil que a Meta conta contra o número.
import { supabaseAdmin } from "./supabaseAdmin.ts";

// Folga de 1h sobre as 24h: o envio leva alguns minutos e a janela não pode
// fechar no meio do caminho.
const HORAS_JANELA_SEGURA = 23;

export async function leadsComJanelaAberta(ids: string[]): Promise<Set<string>> {
    const abertos = new Set<string>();
    const desde = new Date(Date.now() - HORAS_JANELA_SEGURA * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabaseAdmin
            .from("mensagens_whatsapp")
            .select('"pessoaIdentificador"')
            .in("pessoaIdentificador", ids.slice(i, i + 200))
            .eq("direcao", "entrada")
            .gte("criado_em", desde);
        // Na dúvida, ninguém entra: melhor não mandar do que mandar fora da janela.
        if (error) throw new Error(`falha_ler_janela: ${error.message}`);
        (data || []).forEach((m: any) => abertos.add(String(m.pessoaIdentificador)));
    }
    return abertos;
}

export const PAUSA_ENTRE_ENVIOS_MS = 1500;

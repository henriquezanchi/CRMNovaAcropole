// Alteração atômica de etiquetas (crm_alterar_tags, migracao_alterar_tags_atomico.sql).
// Nunca ler-mexer-regravar a lista inteira aqui no TypeScript: isso apagava
// etiquetas quando a leitura falhava e perdia gravações concorrentes.
import { supabaseAdmin } from "./supabaseAdmin.ts";

export async function alterarTags(
    pessoaIdentificador: string,
    opcoes: { adicionar?: string[]; remover?: string[]; removerPrefixos?: string[] },
): Promise<string[] | null> {
    const { data, error } = await supabaseAdmin.rpc("crm_alterar_tags", {
        p_pessoa: String(pessoaIdentificador),
        p_adicionar: opcoes.adicionar ?? [],
        p_remover: opcoes.remover ?? [],
        p_remover_prefixos: opcoes.removerPrefixos ?? [],
    });
    if (error) {
        console.warn(`[tags] não alterou etiquetas de ${pessoaIdentificador}:`, error.message);
        return null;
    }
    return Array.isArray(data) ? data : null;
}

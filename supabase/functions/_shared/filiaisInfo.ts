// Compartilhado entre sugerir-resposta-whatsapp e classificar-resposta-
// convite — bug real corrigido (2026-10-01, achado pelo usuário): um
// lead da filial Setor Oeste disse "descobri que tem uma perto de casa,
// no Goiânia 2", e a IA respondeu confirmando o endereço do SETOR OESTE
// (a filial de CADASTRO dele), ignorando que ele claramente estava
// falando de OUTRA unidade. A IA só tinha acesso aos dados da filial do
// próprio lead — nunca via as outras, então não tinha como responder
// certo. Agora qualquer prompt pode incluir a lista de TODAS as filiais
// ativas, pra reconhecer quando o lead menciona uma unidade diferente da
// de cadastro dele e responder com os dados REAIS daquela, não inventados
// nem confundidos com a própria.
import { supabaseAdmin } from "./supabaseAdmin.ts";

export async function buscarListaFiliais(filialDoLead: string | null): Promise<string> {
    const { data } = await supabaseAdmin.from("filiais").select("nome, nome_com_preposicao, endereco").eq("ativo", true);
    if (!data || data.length === 0) return "";
    const linhas = data
        .map((f: any) => `- ${f.nome}${f.nome === filialDoLead ? " (filial de CADASTRO deste lead)" : ""}: ${f.nome_com_preposicao ? `fala-se "${f.nome_com_preposicao}"` : ""}${f.endereco ? `, endereço ${f.endereco}` : " (endereço não cadastrado)"}`)
        .join("\n");
    return `Todas as unidades ativas da Nova Acrópole (use isto se o lead mencionar ou perguntar sobre uma unidade DIFERENTE da filial de cadastro dele — responda com os dados REAIS da unidade que ELE mencionou, nunca confunda com a filial de cadastro):\n${linhas}`;
}

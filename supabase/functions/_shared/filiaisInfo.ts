// Compartilhado entre sugerir-resposta-whatsapp e classificar-resposta-
// convite — bug real corrigido (2026-10-01, achado pelo usuário): um
// lead da filial Setor Oeste disse "descobri que tem uma perto de casa,
// no Goiânia 2", e a IA respondeu confirmando o endereço do SETOR OESTE
// (a filial de CADASTRO dele), ignorando que ele claramente estava
// falando de OUTRA unidade. A IA só tinha acesso aos dados da filial do
// próprio lead — nunca via as outras, então não tinha como responder
// certo. Corrigido incluindo a lista de TODAS as filiais ativas no
// prompt, pra reconhecer quando o lead menciona uma unidade diferente da
// de cadastro dele.
//
// 2º bug real, achado testando ao vivo NO MESMO DIA (ao validar outro fix)
// — a lista de TODAS as filiais, sempre presente mesmo quando o lead
// nunca mencionou nenhuma outra unidade, criava RUÍDO/confusão: num
// teste reproduzido 2x, a IA respondeu com dados da ÚLTIMA filial da
// lista ("Goiânia II") pra um lead de "Barra do Garças/MT", sem o lead
// ter dito uma palavra sequer sobre outra unidade — um claro caso de viés
// de recência (o último item listado "vence"). Corrigido: a lista
// completa só entra no prompt quando o texto da conversa de fato MENCIONA
// outra unidade (checado por código, não pela IA) — sem isso, o prompt
// nem chega a ver as outras filiais, eliminando a fonte de confusão pro
// caso comum (>90% das conversas nunca mencionam outra unidade).
import { supabaseAdmin } from "./supabaseAdmin.ts";

// Pedido do usuário (2026-10-01): "quando colocar o endereço, coloque
// sempre o link da localização do google maps" — mesma função usada em
// {link_maps} nas respostas rápidas do WhatsApp Unificado
// (resolverRespostaRapida(), js/whatsapp.js), replicada aqui pro lado
// das Edge Functions (Deno não compartilha módulo com o navegador).
export function linkMapsEndereco(endereco: string | null | undefined): string | null {
    return endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}` : null;
}

// Pedido do usuário (2026-10-01): "podemos pegar o link do maps no
// ulisses" — `filiais.link_maps_ulisses` (sincronizado 1x/dia via
// scraper/importar-ulisses-api.js, GET /facade/filial/{id}) é um link de
// PIN exato (lat/lng reais da API deles), bem mais preciso que o nosso
// `linkMapsEndereco()` (busca por texto) — usado como PRIMEIRA opção
// sempre que existir; o link por texto continua sendo o fallback pra
// filial ainda não sincronizada.
export function linkMapsDaFilial(filial: { link_maps_ulisses?: string | null; endereco?: string | null } | null | undefined): string | null {
    if (!filial) return null;
    return filial.link_maps_ulisses || linkMapsEndereco(filial.endereco);
}

function normalizarTextoDeteccaoFilial(s: string): string {
    return (s || "")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toUpperCase();
}

// Núcleo "distintivo" do nome da filial pra detecção por substring — tira
// palavra genérica ("GOIANIA", sigla de UF) e pontuação, sobra só a parte
// que realmente diferencia uma unidade da outra (mesma ideia já usada no
// scraper pra casar nome de filial do Ulisses, ver CLAUDE.md
// "nucleoDistintivoFilial"/"tokenDistintivoFilial").
function nucleoDistintivoFilial(nome: string): string {
    return normalizarTextoDeteccaoFilial(nome)
        .replace(/\bGOIANIA\b/g, "")
        .replace(/[-/]/g, " ")
        .replace(/\bMT\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// textoParaChecarOutraMencao: histórico/mensagem recente da conversa — se
// informado, a função só monta (e só CUSTA tokens de prompt) a lista
// completa quando detecta, por substring, o núcleo de alguma filial que
// NÃO é a do lead. Omitido (undefined) = sempre inclui, comportamento
// antigo (nenhum chamador usa mais assim, mas mantido por segurança).
export async function buscarListaFiliais(filialDoLead: string | null, textoParaChecarOutraMencao?: string): Promise<string> {
    const { data } = await supabaseAdmin.from("filiais").select("nome, nome_com_preposicao, endereco, link_maps_ulisses").eq("ativo", true);
    if (!data || data.length === 0) return "";

    if (textoParaChecarOutraMencao !== undefined) {
        const textoNorm = normalizarTextoDeteccaoFilial(textoParaChecarOutraMencao);
        const mencionaOutra = data.some((f: any) => {
            if (f.nome === filialDoLead) return false;
            const nucleo = nucleoDistintivoFilial(f.nome);
            if (!nucleo) return false;
            // Variante numeral romano <-> arábico (ex: "Goiânia II" <->
            // "Goiânia 2", exatamente o caso real que motivou este recurso).
            const variantes = new Set([nucleo, nucleo.replace(/\bIII\b/, "3").replace(/\bII\b/, "2"), nucleo.replace(/\b3\b/, "III").replace(/\b2\b/, "II")]);
            return [...variantes].some((v) => v && textoNorm.includes(v));
        });
        if (!mencionaOutra) return "";
    }

    const linhas = data
        .map((f: any) => `- ${f.nome}${f.nome === filialDoLead ? " (filial de CADASTRO deste lead)" : ""}: ${f.nome_com_preposicao ? `fala-se "${f.nome_com_preposicao}"` : ""}${f.endereco ? `, endereço ${f.endereco} (link do mapa: ${linkMapsDaFilial(f)})` : " (endereço não cadastrado)"}`)
        .join("\n");
    return `Todas as unidades ativas da Nova Acrópole (use isto se o lead mencionar ou perguntar sobre uma unidade DIFERENTE da filial de cadastro dele — responda com os dados REAIS da unidade que ELE mencionou, nunca confunda com a filial de cadastro):\n${linhas}`;
}

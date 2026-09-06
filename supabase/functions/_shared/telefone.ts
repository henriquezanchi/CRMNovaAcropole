// Utilitários de telefone BR compartilhados entre whatsapp-send (montar o
// número E.164 pra enviar) e whatsapp-webhook (casar o remetente de uma
// mensagem recebida com um lead). Heurística, não garantia — mesmo espírito
// das heurísticas já assumidas no importador (cruzamento por nome, etc.),
// documentado em CLAUDE.md.

// Monta o número no formato que a Graph API espera pra "to": 55 + DDD(2) + número.
// Números de celular BR têm 9 dígitos (com o 9º dígito); se a planilha só
// tiver 8, assume celular e completa com o 9 na frente.
export function montarNumeroE164(ddd: string | null, numero: string | null): string | null {
    const dddLimpo = (ddd || "").replace(/\D/g, "");
    let numeroLimpo = (numero || "").replace(/\D/g, "");
    if (!dddLimpo || !numeroLimpo) return null;

    if (numeroLimpo.length === 8) numeroLimpo = "9" + numeroLimpo;
    if (numeroLimpo.length > 9) numeroLimpo = numeroLimpo.slice(-9); // corta lixo à esquerda, mantém os 9 últimos dígitos

    return `55${dddLimpo}${numeroLimpo}`;
}

// Separa o "from" que a Meta manda no webhook (ex: "5562999998888") em DDD + número local.
export function separarFromMeta(from: string): { ddd: string; numero: string } {
    const digitos = (from || "").replace(/\D/g, "");
    const semPais = digitos.startsWith("55") && digitos.length >= 12 ? digitos.slice(2) : digitos;
    return { ddd: semPais.slice(0, 2), numero: semPais.slice(2) };
}

// Gera as variantes possíveis de um número local (com/sem o 9º dígito) pra
// casar com o que está salvo em leads_inscricoes, que pode ter vindo de
// qualquer um dos dois formatos.
export function candidatosNumeroBR(numeroLocal: string): string[] {
    const digitos = (numeroLocal || "").replace(/\D/g, "");
    const candidatos = new Set<string>([digitos]);
    if (digitos.length === 9 && digitos.startsWith("9")) candidatos.add(digitos.slice(1));
    if (digitos.length === 8) candidatos.add("9" + digitos);
    return [...candidatos];
}

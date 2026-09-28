// Utilitários de telefone BR compartilhados entre whatsapp-send (montar o
// número E.164 pra enviar) e whatsapp-webhook (casar o remetente de uma
// mensagem recebida com um lead). Heurística, não garantia — mesmo espírito
// das heurísticas já assumidas no importador (cruzamento por nome, etc.),
// documentado em CLAUDE.md.

// Monta o número no formato que a Graph API espera pra "to": 55 + DDD(2) + número.
// Números de celular BR têm 9 dígitos (com o 9º dígito); se a planilha só
// tiver 8, PODE ser celular esquecendo o 9º dígito — mas só se o 1º dígito
// do número local for 6/7/8/9 (prefixo de celular antigo, pré-2012/nona
// digit). Bug real (2026-09-28, achado logo depois do bloqueio geral da API
// cair, quando os erros por número finalmente puderam aparecer): um número
// de 8 dígitos começando com 2/3/4/5 é SEMPRE telefone FIXO no plano de
// numeração da Anatel — nunca foi celular, nunca vai ganhar/precisar do 9º
// dígito, e "completar" ele com um 9 na frente produz um número de celular
// que simplesmente NÃO EXISTE. A Meta aceita a chamada normalmente (não é
// "API access blocked") mas devolve `131026 "Message Undeliverable"` na
// hora de entregar — confirmado em produção contra 2 leads reais (Eduardo
// Menezes Ferreira, Lorranny Cardoso), os dois com número de 8 dígitos
// começando com "3". Levantamento no banco: 755 leads (738 só em Goiânia -
// Jardim América) têm esse padrão — provavelmente nunca tiveram WhatsApp
// via esse número, e por isso NUNCA deveriam ter uma tentativa de envio
// disparada (gasta uma chamada à API pra sempre falhar, e o erro genérico
// da Meta não deixa óbvio que é o número que está errado). Corrigido:
// devolve `null` (mesmo tratamento de "sem telefone") pra esse padrão, em
// vez de adivinhar um celular que não existe.
export function montarNumeroE164(ddd: string | null, numero: string | null): string | null {
    const dddLimpo = (ddd || "").replace(/\D/g, "");
    let numeroLimpo = (numero || "").replace(/\D/g, "");
    if (!dddLimpo || !numeroLimpo) return null;

    if (numeroLimpo.length === 8) {
        if (!/^[6-9]/.test(numeroLimpo)) return null; // fixo (prefixo 2-5) — nunca é WhatsApp
        numeroLimpo = "9" + numeroLimpo;
    }
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

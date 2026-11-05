// Detecção de resposta automática (WhatsApp Business de quem recebe a mensagem).
// Compartilhada entre o robô da campanha e as sugestões de resposta por IA.
// Mensagens automáticas típicas (WhatsApp Business de quem recebe o convite).
export const RE_RESPOSTA_AUTOMATICA = /(mensagem autom[aá]tica|resposta autom[aá]tica|retornarei|retornaremos|retorno (em breve|assim que|logo)|responderei (assim que|logo|em breve)|responderemos (assim que|em breve)|no momento,? n[aã]o (posso|consigo|estou podendo) (atender|responder)|n[aã]o estou dispon[ií]vel|fora do hor[aá]rio de atendimento|nosso hor[aá]rio de atendimento|agradecemos (o|seu|pelo) contato|obrigad[oa] pelo (seu )?contato|(logo|assim) que (eu )?(visualizar|ver a mensagem))/i;

// Saudação automática de WhatsApp Business ("Pet Shop X agradece seu contato.
// Como podemos ajudar?"): vale mesmo com ponto de interrogação.
export const RE_SAUDACAO_EMPRESA = /(agradece|agradecemos) (o |seu |pelo |a sua |sua )?(contato|mensagem)|seja bem[- ]vind[oa] (a|à|ao)|bem[- ]vind[oa] (a|à|ao) [a-z]|como (podemos|posso) (te |lhe )?ajudar|em que (podemos|posso) (te |lhe )?ajudar/i;

// Todas as mensagens dela depois da nossa última são automáticas?
export function ehRespostaAutomatica(msgs: any[]): boolean {
    let i = msgs.length - 1;
    const dela: any[] = [];
    while (i >= 0 && msgs[i].direcao === "entrada") dela.push(msgs[i--]);
    if (!dela.length) return false;
    return dela.every((m) => {
        const t = String(m.corpo_texto || "");
        if (m.tipo !== "texto" || t.length >= 400) return false;
        const saudacao = RE_SAUDACAO_EMPRESA.test(t) && /(agradece|agradecemos|bem[- ]vind)/i.test(t);
        return saudacao || (RE_RESPOSTA_AUTOMATICA.test(t) && !/\?/.test(t));
    });
}


// Uma única mensagem recebida é automática?
export function textoEhRespostaAutomatica(texto: string): boolean {
    return ehRespostaAutomatica([{ direcao: "entrada", tipo: "texto", corpo_texto: texto }]);
}

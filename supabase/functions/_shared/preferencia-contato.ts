// Conferência no servidor imediatamente antes do envio; não depende da lista preparada no navegador.
export function motivoBloqueioContato(valor: unknown, campanha: boolean, agora = Date.now()): string {
    const dado = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : {};
    if (dado.contato === 'nao_contatar') return 'Pedido de não contato registrado.';
    if (!campanha) return '';
    if (['solicitada', 'dados_pendentes', 'aguardando_registro'].includes(String(dado.inscricao))) return 'Inscrição em acompanhamento individual.';
    if (dado.relacao === 'ativo') return 'Aluno ativo: conferir antes de campanha de captação.';
    if (dado.contato !== 'permitido') return 'Confira a preferência de contato antes de incluir em campanha.';
    if (dado.intencao === 'nao' || dado.intencao === 'depois') return 'A intenção declarada não permite campanha neste momento.';
    if (dado.proxima_em && (!Number.isFinite(Date.parse(String(dado.proxima_em))) || Date.parse(String(dado.proxima_em)) > agora)) return 'Aguarde a data combinada ou confira a data inválida.';
    if (dado.proxima_em && Date.parse(String(dado.proxima_em)) <= agora) return 'Existe um compromisso a tratar individualmente.';
    if (!['conhecer', 'participar'].includes(String(dado.intencao)) || dado.proximo === 'responder') return 'Confira o próximo passo individual antes de incluir em campanha.';
    return '';
}

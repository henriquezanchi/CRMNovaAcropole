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

export function motivoIntegridadeContato(valor: unknown): string {
 let tags: unknown = valor;
 try { if(typeof tags==='string') tags=JSON.parse(tags); } catch { return 'Não foi possível conferir a integridade do cadastro.'; }
 return Array.isArray(tags)&&tags.includes('Contato em conferência') ? 'Contato em conferência: o telefone pode pertencer a outra pessoa. Confira a fonte antes de enviar.' : '';
}

export function temTagNaoContatar(valor:unknown):boolean {
 try{for(let i=0;i<4&&typeof valor==='string';i++)valor=JSON.parse(valor);}catch{return true;}
 return Array.isArray(valor)&&valor.some(t=>String(t).trim().normalize('NFC').toLowerCase()==='não contatar');
}

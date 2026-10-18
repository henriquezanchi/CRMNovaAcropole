export function validarConsultaEscola(corpo: unknown) {
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new Error('Consulta inválida.');
    const dado = corpo as Record<string, unknown>;
    if (Object.keys(dado).some(chave => !['chave','busca','categoria','inicio'].includes(chave))) throw new Error('Parâmetros não permitidos.');
    if (typeof dado.chave !== 'string' || !/^[a-f0-9]{64}$/.test(dado.chave)) throw new Error('Link inválido.');
    const busca = dado.busca ?? '';
    const categoria = dado.categoria ?? 'todos';
    const inicio = dado.inicio ?? 0;
    if (typeof busca !== 'string' || busca.length > 100) throw new Error('Busca inválida.');
    if (!['todos','apoio','inscricao','visita'].includes(String(categoria))) throw new Error('Filtro inválido.');
    if (!Number.isSafeInteger(inicio) || Number(inicio) < 0 || Number(inicio) > 1000000) throw new Error('Página inválida.');
    return { chave:dado.chave, busca:busca.trim(), categoria:String(categoria), inicio:Number(inicio) };
}
export async function hashChaveEscola(chave: string) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chave));
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}

// Adaptador do CRM para o modelo compartilhado com o BPO. Não consulta banco
// nem transforma tags, inscrições ou presença em declaração de interesse.
(function (raiz, fabricar) {
    const api = fabricar(raiz?.PropensaoModelo);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (raiz) raiz.PropensaoCRM = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (modelo) {
    'use strict';

    function converterDeclaracaoAcompanhamento(acompanhamento) {
        const dado = acompanhamento && typeof acompanhamento === 'object' && !Array.isArray(acompanhamento)
            ? acompanhamento : {};
        const intencoes = ['conhecer', 'participar', 'inscrever', 'depois', 'nao'];
        const ocorridoEm = dado.intencao_atualizado_em || dado.atualizado_em;
        const responsavel = dado.intencao_atualizado_por || dado.atualizado_por;
        if (!intencoes.includes(dado.intencao) || typeof ocorridoEm !== 'string' || !Number.isFinite(Date.parse(ocorridoEm)) ||
            typeof responsavel !== 'string' || !responsavel.trim()) return [];
        return [{
            tipo: 'interesse_declarado',
            valor: dado.intencao,
            occurredAt: new Date(ocorridoEm).toISOString(),
            origem: 'CRM · acompanhamento registrado',
            natureza: 'declarado',
            responsavel: responsavel.trim(),
        }];
    }

    function tagNaoContatar(tags){
        try{for(let i=0;i<4&&typeof tags==='string';i++)tags=JSON.parse(tags);}catch{return false;}
        return Array.isArray(tags)&&tags.some(t=>String(t).trim().normalize('NFC').toLowerCase()==='não contatar');
    }
    function avaliarLead({ lead = {}, abertura = {}, sinais = [], agora } = {}) {
        if (!modelo || typeof modelo.avaliar !== 'function') {
            throw new Error('Carregue js/propensao-modelo.js antes de js/propensao-crm.js.');
        }
        const sinaisComAcompanhamento = [
            ...converterDeclaracaoAcompanhamento(lead.acompanhamento),
            ...(Array.isArray(sinais) ? sinais : []),
        ];
        return modelo.avaliar({ sinais: sinaisComAcompanhamento, abertura, agora, preferenciaContato:{naoContatar:lead.acompanhamento?.contato==='nao_contatar'||lead.naoContatar===true||tagNaoContatar(lead.tags),atualizadoEm:lead.acompanhamento?.preferencia_contato_em||lead.preferenciaContatoEm||null,responsavel:lead.acompanhamento?.preferencia_contato_por||null} });
    }

    function resumir(avaliacoes = []) {
        const lista = Array.isArray(avaliacoes) ? avaliacoes : [];
        const contar = (ramo, estados, mapa = {}) => {
            const total = Object.fromEntries(estados.map(estado => [estado, 0]));
            lista.forEach(avaliacao => {
                const original = avaliacao?.[ramo]?.estado || 'a_confirmar';
                const estado = mapa[original] || original;
                if (Object.hasOwn(total, estado)) total[estado]++;
            });
            return total;
        };
        return {
            total: lista.length,
            interesse: contar('interesse', ['interessado', 'sem_interesse', 'a_confirmar'], {
                conhecer: 'interessado', participar: 'interessado', inscrever: 'interessado', nao: 'sem_interesse',
            }),
            adequacaoTurma: contar('adequacaoTurma', ['compativel', 'incompativel', 'a_confirmar'], {
                adequada: 'compativel', inadequada: 'incompativel',
            }),
        };
    }

    return Object.freeze({
        avaliarLead,
        resumo: resumir,
        converterDeclaracaoAcompanhamento,
    });
});

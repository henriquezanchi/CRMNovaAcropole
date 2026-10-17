// Ajuda a escola a conferir fatos, sem transformar ausência de registro em falta.
(function (raiz) {
    'use strict';
    function normalizarBusca(texto) { return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
    function filtrar(participantes, filtro = 'todos', busca = '') {
        const termo = normalizarBusca(busca);
        return participantes.filter(pessoa => {
            const texto = normalizarBusca([pessoa._lead?.pessoaNome, pessoa.pessoaIdentificador, pessoa._lead?.pessoaTelefoneDDD, pessoa._lead?.pessoaTelefoneNumero].filter(Boolean).join(' '));
            if (termo && !texto.includes(termo)) return false;
            switch (filtro) {
                case 'confirmados': return pessoa.resposta_convite === 'confirmado';
                case 'talvez': return pessoa.resposta_convite === 'talvez';
                case 'presenca_pendente': return pessoa.compareceu !== true && pessoa.compareceu !== false;
                case 'presentes': return pessoa.compareceu === true;
                case 'faltaram': return pessoa.compareceu === false;
                case 'retorno': return pessoa.compareceu === true && pessoa.matriculado !== true;
                default: return true;
            }
        });
    }
    function resumir(participantes) {
        return {
            total: participantes.length,
            confirmados: participantes.filter(p => p.resposta_convite === 'confirmado').length,
            talvez: participantes.filter(p => p.resposta_convite === 'talvez').length,
            presentes: participantes.filter(p => p.compareceu === true).length,
            faltas: participantes.filter(p => p.compareceu === false).length,
            presencaPendente: participantes.filter(p => p.compareceu !== true && p.compareceu !== false).length,
            retorno: participantes.filter(p => p.compareceu === true && p.matriculado !== true).length,
        };
    }
    raiz.AberturasModelo = Object.freeze({ filtrar, resumir });
})(globalThis);

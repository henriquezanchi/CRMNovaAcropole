/* Modelo explicável da avaliação por abertura. Sem dependências, pontuação ou ranking.
 * O CRM e o BPO devem usar a mesma cópia desta função e manter VERSAO_MOTOR alinhada.
 */
(function (raiz, fabricar) {
    const api = fabricar();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (raiz) raiz.PropensaoModelo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const VERSAO_MOTOR = '1.0.2';
    const TIPOS_SINAL = Object.freeze([
        'interesse_declarado', 'disponibilidade_confirmada', 'presenca_palestra',
        'outra_atividade', 'resposta_atendimento', 'pedido_matricula',
        'nao_contatar', 'acao_realizada', 'resultado_atendimento',
    ]);
    const INTERESSES = Object.freeze(['a_confirmar', 'conhecer', 'participar', 'inscrever', 'depois', 'nao']);
    const RESULTADOS_ATENDIMENTO = Object.freeze([
        'adiou', 'sem_interesse', 'horario_incompativel', 'contato_invalido', 'sem_resposta', 'matriculou',
    ]);

    const texto = valor => typeof valor === 'string' ? valor.trim() : '';
    const dataValida = valor => typeof valor === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(valor) &&
        Number.isFinite(Date.parse(valor));
    const valorBooleano = valor => {
        if (valor === true || valor === 'sim') return true;
        if (valor === false || valor === 'nao' || valor === 'não') return false;
        return null;
    };
    const timestamp = valor => Date.parse(valor);

    function sinalValido(sinal) {
        return !!sinal && typeof sinal === 'object' &&
            TIPOS_SINAL.includes(sinal.tipo) &&
            dataValida(sinal.occurredAt) &&
            !!texto(sinal.origem) &&
            ['declarado', 'observado', 'interpretado'].includes(sinal.natureza) &&
            !!texto(sinal.responsavel);
    }

    function maisRecente(sinais) {
        return [...sinais].sort((a, b) => timestamp(b.occurredAt) - timestamp(a.occurredAt))[0] || null;
    }

    function avaliar({ sinais = [], abertura = {}, agora = new Date().toISOString(), versao = '1', preferenciaContato = {} } = {}) {
        const aberturaId = texto(abertura.id);
        const instanteAvaliacao = dataValida(agora) ? Date.parse(agora) : Date.now();
        const sinaisValidos = (Array.isArray(sinais) ? sinais : []).filter(sinal =>
            sinalValido(sinal) && timestamp(sinal.occurredAt) <= instanteAvaliacao
        );
        const interesseSinais = sinaisValidos.filter(s => s.natureza === 'declarado' && (
            s.tipo === 'interesse_declarado' && INTERESSES.includes(texto(s.valor)) ||
            s.tipo === 'pedido_matricula' && valorBooleano(s.valor) === true
        ));
        const sinalInteresse = maisRecente(interesseSinais);
        const interesse = sinalInteresse
            ? (sinalInteresse.tipo === 'pedido_matricula' ? 'inscrever' : texto(sinalInteresse.valor))
            : 'a_confirmar';

        const horarioConfere = s => s.contextoHorario && s.contextoHorario.diaSemana === abertura.diaSemana && s.contextoHorario.inicioMinuto === abertura.inicioMinuto;
        const disponibilidade = sinaisValidos.filter(s =>
            s.tipo === 'disponibilidade_confirmada' && s.natureza === 'declarado' &&
            aberturaId !== '' && texto(s.aberturaId) === aberturaId && horarioConfere(s) &&
            valorBooleano(s.valor) !== null
        );
        const incompatibilidadeRelatada = sinaisValidos.filter(s =>
            s.tipo === 'resultado_atendimento' &&
            texto(s.valor) === 'horario_incompativel' &&
            aberturaId !== '' && texto(s.aberturaId) === aberturaId && horarioConfere(s) && s.natureza !== 'interpretado'
        );
        const sinalAdequacao = maisRecente([...disponibilidade, ...incompatibilidadeRelatada]);
        let adequacaoTurma = 'a_confirmar';
        if (sinalAdequacao) {
            adequacaoTurma = sinalAdequacao.tipo === 'resultado_atendimento' || valorBooleano(sinalAdequacao.valor) === false
                ? 'inadequada'
                : 'adequada';
        }

        const restricoesContato = sinaisValidos.filter(s =>
            s.tipo === 'nao_contatar' && s.natureza === 'declarado' && valorBooleano(s.valor) !== null
        );
        const restricaoContato = maisRecente(restricoesContato);
        const bloqueioContatoAtivo = restricaoContato && valorBooleano(restricaoContato.valor) === true ? restricaoContato : null;
        const resultadosAbertura = sinaisValidos.filter(s =>
            s.tipo === 'resultado_atendimento' && s.natureza !== 'interpretado' &&
            (!texto(s.aberturaId) || (aberturaId !== '' && texto(s.aberturaId) === aberturaId))
        );
        const resultadoRecente = maisRecente(resultadosAbertura);
        const decisaoMaisRecente = maisRecente([sinalInteresse, resultadoRecente].filter(Boolean));
        const resultadoAtual = resultadoRecente && decisaoMaisRecente === resultadoRecente ? resultadoRecente : null;

        let proximaAcao;
        if (preferenciaContato.naoContatar === true || bloqueioContatoAtivo) {
            proximaAcao = { codigo: 'respeitar_nao_contatar', motivo: 'Há um pedido de não contato registrado.' };
        } else if (resultadoAtual && texto(resultadoAtual.valor) === 'sem_interesse') {
            proximaAcao = { codigo: 'respeitar_sem_interesse', motivo: 'A pessoa informou que não tem interesse agora.' };
        } else if (resultadoAtual && texto(resultadoAtual.valor) === 'adiou') {
            proximaAcao = { codigo: 'retomar_conforme_combinado', motivo: 'A pessoa pediu para retomar em outra ocasião; confira a data combinada.' };
        } else if (resultadoAtual && texto(resultadoAtual.valor) === 'contato_invalido') {
            proximaAcao = { codigo: 'conferir_contato', motivo: 'O contato foi registrado como inválido; conferir a fonte antes de qualquer tentativa.' };
        } else if (resultadoAtual && texto(resultadoAtual.valor) === 'sem_resposta') {
            proximaAcao = { codigo: 'rever_combinado', motivo: 'Não houve resposta registrada; isso não informa o interesse da pessoa.' };
        } else if (resultadoAtual && texto(resultadoAtual.valor) === 'matriculou') {
            proximaAcao = { codigo: 'acompanhar_como_matriculado', motivo: 'Há matrícula confirmada na fonte acadêmica para esta abertura.' };
        } else if (interesse === 'inscrever') {
            proximaAcao = { codigo: 'apoiar_inscricao', motivo: 'Há um pedido explícito de inscrição.' };
        } else if (interesse === 'nao' || interesse === 'depois') {
            proximaAcao = { codigo: 'respeitar_momento', motivo: 'A declaração mais recente pede respeito ao momento da pessoa.' };
        } else if (adequacaoTurma === 'inadequada') {
            proximaAcao = { codigo: 'verificar_outra_turma', motivo: 'A disponibilidade registrada não combina com esta abertura.' };
        } else if (interesse === 'a_confirmar') {
            proximaAcao = { codigo: 'confirmar_interesse', motivo: 'Ainda não há uma declaração de interesse registrada.' };
        } else if (adequacaoTurma === 'a_confirmar') {
            proximaAcao = { codigo: 'confirmar_horario', motivo: 'O interesse foi declarado, mas a disponibilidade para esta abertura segue a confirmar.' };
        } else {
            proximaAcao = { codigo: 'orientar_proximo_passo', motivo: 'Há interesse declarado e disponibilidade confirmada para esta abertura.' };
        }

        const fundamentos = sinaisValidos.map(sinal => {
            let papel = 'contexto_sem_inferencia_de_interesse';
            if (sinal === sinalInteresse) papel = 'define_interesse_declarado';
            else if (sinal === sinalAdequacao) papel = 'define_adequacao_desta_abertura';
            else if (sinal === restricaoContato) papel = bloqueioContatoAtivo ? 'bloqueia_contato' : 'revoga_nao_contatar';
            else if (sinal === resultadoRecente) papel = 'resultado_atendimento';
            return {
                tipo: sinal.tipo,
                valor: sinal.valor,
                occurredAt: sinal.occurredAt,
                origem: texto(sinal.origem),
                natureza: sinal.natureza,
                responsavel: texto(sinal.responsavel),
                aberturaId: texto(sinal.aberturaId) || null,
                contextoHorario:sinal.contextoHorario||null,
                papel,
            };
        });
        if(preferenciaContato.naoContatar === true) fundamentos.push({tipo:'preferencia_contato_canonica',valor:'nao_contatar',occurredAt:preferenciaContato.atualizadoEm||null,origem:'CRM · preferência canônica',natureza:'observado',responsavel:preferenciaContato.responsavel||null,papel:'bloqueia_contato'});
        if (!sinalInteresse) fundamentos.push({
            tipo: 'interesse_declarado', valor: 'a_confirmar', occurredAt: null,
            origem: null, natureza: 'desconhecido', responsavel: null,
            aberturaId: aberturaId || null, papel: 'sem_declaracao_registrada',
        });
        if (!sinalAdequacao) fundamentos.push({
            tipo: 'disponibilidade_confirmada', valor: 'a_confirmar', occurredAt: null,
            origem: null, natureza: 'desconhecido', responsavel: null,
            aberturaId: aberturaId || null, papel: 'sem_confirmacao_para_esta_abertura',
        });

        return {
            versaoMotor: VERSAO_MOTOR,
            versaoRegras: texto(versao) || '1',
            avaliadoEm: dataValida(agora) ? new Date(agora).toISOString() : new Date().toISOString(),
            abertura: {
                id: aberturaId || null,
                diaSemana: Number.isInteger(abertura.diaSemana) ? abertura.diaSemana : null,
                inicioMinuto: Number.isInteger(abertura.inicioMinuto) ? abertura.inicioMinuto : null,
                primeiraAula: dataValida(abertura.primeiraAula) ? new Date(abertura.primeiraAula).toISOString() : null,
            },
            interesse: { estado: interesse, fonte: sinalInteresse ? texto(sinalInteresse.origem) : null },
            adequacaoTurma: { estado: adequacaoTurma, fonte: sinalAdequacao ? texto(sinalAdequacao.origem) : null },
            proximaAcao,
            fundamentos,
            // Inscrição em atividade, presença e resposta não alimentam interesse
            // ou adequação. Permanecem como fatos de contexto auditáveis.
        };
    }

    function validarEvento(evento) {
        if (!sinalValido(evento)) return { valido: false, erro: 'Sinal requer tipo, data ISO, origem, natureza e responsável.' };
        if (evento.tipo === 'interesse_declarado' && !INTERESSES.includes(texto(evento.valor)))
            return { valido: false, erro: 'Valor de interesse inválido.' };
        if (['disponibilidade_confirmada', 'presenca_palestra', 'outra_atividade', 'pedido_matricula', 'nao_contatar'].includes(evento.tipo) && valorBooleano(evento.valor) === null)
            return { valido: false, erro: 'Este sinal exige valor sim/não explícito.' };
        if (evento.tipo === 'resultado_atendimento' && !RESULTADOS_ATENDIMENTO.includes(texto(evento.valor)))
            return { valido: false, erro: 'Resultado de atendimento inválido.' };
        if (evento.tipo === 'nao_contatar' && evento.natureza !== 'declarado')
            return { valido: false, erro: 'Pedido de não contato ou sua revogação deve ser registrado como declaração explícita.' };
        if (evento.tipo === 'disponibilidade_confirmada' && !texto(evento.aberturaId))
            return { valido: false, erro: 'Disponibilidade deve identificar uma abertura específica.' };
        return { valido: true };
    }

    function gerarTags(resultado, sinais = []) {
        const tags = [];
        if (resultado?.interesse?.estado === 'a_confirmar') tags.push('Interesse a confirmar');
        else if (['conhecer', 'participar', 'inscrever'].includes(resultado?.interesse?.estado)) tags.push('Interesse declarado');
        if (resultado?.adequacaoTurma?.estado === 'a_confirmar') tags.push('Horário a confirmar');
        const instante = dataValida(resultado?.avaliadoEm) ? Date.parse(resultado.avaliadoEm) : Date.now();
        const pedidosContato = (Array.isArray(sinais) ? sinais : []).filter(s =>
            sinalValido(s) && s?.tipo === 'nao_contatar' && s?.natureza === 'declarado' &&
            timestamp(s.occurredAt) <= instante && valorBooleano(s.valor) !== null
        ).sort((a, b) => timestamp(b.occurredAt) - timestamp(a.occurredAt));
        if (pedidosContato[0] && valorBooleano(pedidosContato[0].valor) === true) tags.push('Não contatar');
        if (resultado?.proximaAcao?.codigo) tags.push(`Próxima ação: ${resultado.proximaAcao.codigo}`);
        return [...new Set(tags)];
    }

    return Object.freeze({
        VERSAO_MOTOR, TIPOS_SINAL, INTERESSES, RESULTADOS_ATENDIMENTO,
        avaliar, validarEvento, gerarTags,
    });
});

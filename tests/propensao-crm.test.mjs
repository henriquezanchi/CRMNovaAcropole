import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../js/propensao-modelo.js');
const crm = require('../js/propensao-crm.js');
require('../js/acompanhamento-modelo.js');
const acompanhamento = globalThis.AcompanhamentoModelo;

test('acompanha somente intenção declarada com data e responsável', () => {
    const resultado = crm.avaliarLead({ lead: { acompanhamento: {
        intencao: 'participar', intencao_atualizado_em: '2026-10-20T12:00:00.000Z', intencao_atualizado_por: 'Equipe A',
        atualizado_em: '2026-10-22T12:00:00.000Z', atualizado_por: 'Equipe B',
        preferencia_contato_em: '2026-10-22T12:00:00.000Z', preferencia_contato_por: 'Equipe B',
    } }, abertura: { id: 'abertura-1' }, agora: '2026-10-23T12:00:00.000Z' });
    assert.equal(resultado.interesse.estado, 'participar');
    assert.equal(resultado.fundamentos[0].occurredAt, '2026-10-20T12:00:00.000Z');
    assert.equal(resultado.fundamentos[0].origem, 'CRM · acompanhamento registrado');
    assert.equal(resultado.fundamentos[0].responsavel, 'Equipe A');
});

test('sem data ou responsável mantém o interesse a confirmar e não lê tags', () => {
    const resultado = crm.avaliarLead({ lead: {
        tags: ['Lead Forte 1', 'Interesse declarado'],
        acompanhamento: { intencao: 'participar', atualizado_em: '2026-10-22T12:00:00.000Z' },
    }, abertura: { id: 'abertura-1' }, agora: '2026-10-23T12:00:00.000Z' });
    assert.equal(resultado.interesse.estado, 'a_confirmar');
});

test('resumo aceita lista vazia e conta interesse separado da adequação', () => {
    assert.deepEqual(crm.resumo([]), {
        total: 0,
        interesse: { interessado: 0, sem_interesse: 0, a_confirmar: 0 },
        adequacaoTurma: { compativel: 0, incompativel: 0, a_confirmar: 0 },
    });
    const resumo = crm.resumo([
        { interesse: { estado: 'participar' }, adequacaoTurma: { estado: 'adequada' } },
        { interesse: { estado: 'nao' }, adequacaoTurma: { estado: 'inadequada' } },
        { interesse: { estado: 'a_confirmar' }, adequacaoTurma: { estado: 'a_confirmar' } },
    ]);
    assert.deepEqual(resumo, {
        total: 3,
        interesse: { interessado: 1, sem_interesse: 1, a_confirmar: 1 },
        adequacaoTurma: { compativel: 1, incompativel: 1, a_confirmar: 1 },
    });
});

test('normalização preserva a data separada da preferência sem mudar a data da intenção', () => {
    const dado = acompanhamento.normalizar({
        contato: 'nao_contatar', intencao: 'participar',
        atualizado_em: '2026-10-20T12:00:00.000Z', atualizado_por: 'Equipe A',
        intencao_atualizado_em: '2026-10-20T12:00:00.000Z', intencao_atualizado_por: 'Equipe A',
        preferencia_contato_em: '2026-10-22T12:00:00.000Z', preferencia_contato_por: 'Equipe B',
    });
    assert.equal(dado.atualizado_em, '2026-10-20T12:00:00.000Z');
    assert.equal(dado.intencao_atualizado_em, '2026-10-20T12:00:00.000Z');
    assert.equal(dado.preferencia_contato_em, '2026-10-22T12:00:00.000Z');
    assert.equal(dado.preferencia_contato_por, 'Equipe B');
});

test('tag legada de não contato continua bloqueando a recomendação',()=>{
 const avaliacao=crm.avaliarLead({lead:{tags:JSON.stringify(['Não Contatar'])},agora:'2026-10-23T12:00:00Z'});
 assert.equal(avaliacao.proximaAcao.codigo,'respeitar_nao_contatar');
});

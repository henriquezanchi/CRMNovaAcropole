import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const modelo = require('../js/propensao-modelo.js');
const agora = '2026-10-23T12:00:00.000Z';
const abertura = { id: 'turma-2026-11', diaSemana: 2, inicioMinuto: 1140, primeiraAula: '2026-11-03T19:00:00.000Z' };
const sinal = (tipo, valor, extras = {}) => ({
    contextoHorario:{diaSemana:abertura.diaSemana,inicioMinuto:abertura.inicioMinuto},
    tipo, valor, occurredAt: '2026-10-22T12:00:00.000Z', origem: 'CRM atendimento',
    natureza: 'declarado', responsavel: 'Atendente A', aberturaId: abertura.id, ...extras,
});

test('sem declaração ou disponibilidade, ambos ficam a confirmar sem score ou ranking', () => {
    const resultado = modelo.avaliar({ sinais: [], abertura, agora });
    assert.equal(resultado.interesse.estado, 'a_confirmar');
    assert.equal(resultado.adequacaoTurma.estado, 'a_confirmar');
    assert.equal(resultado.proximaAcao.codigo, 'confirmar_interesse');
    assert.equal(Object.hasOwn(resultado, 'score'), false);
    assert.equal(Object.hasOwn(resultado, 'rank'), false);
    assert.equal(resultado.versaoMotor, modelo.VERSAO_MOTOR);
});

test('inscrição em atividade, presença e resposta não provam interesse nem adequação', () => {
    const resultado = modelo.avaliar({ sinais: [
        sinal('presenca_palestra', true),
        sinal('outra_atividade', true),
        sinal('resposta_atendimento', 'respondeu'),
    ], abertura, agora });
    assert.equal(resultado.interesse.estado, 'a_confirmar');
    assert.equal(resultado.adequacaoTurma.estado, 'a_confirmar');
    assert.ok(resultado.fundamentos.some(f => f.tipo === 'presenca_palestra' && f.papel === 'contexto_sem_inferencia_de_interesse'));
});

test('interesse declarado é separado da compatibilidade e horário vale só para a abertura correspondente', () => {
    const resultado = modelo.avaliar({ sinais: [
        sinal('interesse_declarado', 'participar'),
        sinal('disponibilidade_confirmada', true, { aberturaId: 'outra-turma' }),
    ], abertura, agora });
    assert.equal(resultado.interesse.estado, 'participar');
    assert.equal(resultado.adequacaoTurma.estado, 'a_confirmar');
    assert.equal(resultado.proximaAcao.codigo, 'confirmar_horario');
});

test('confirmação explícita de horário atualiza apenas adequação da abertura', () => {
    const resultado = modelo.avaliar({ sinais: [
        sinal('interesse_declarado', 'conhecer'),
        sinal('disponibilidade_confirmada', true),
    ], abertura, agora });
    assert.equal(resultado.interesse.estado, 'conhecer');
    assert.equal(resultado.adequacaoTurma.estado, 'adequada');
    assert.equal(resultado.proximaAcao.codigo, 'orientar_proximo_passo');
    assert.equal(resultado.abertura.inicioMinuto, 1140);
    assert.equal(resultado.abertura.primeiraAula, '2026-11-03T19:00:00.000Z');
});

test('resultado de atendimento permanece separado e sem resposta não vira desinteresse', () => {
    const resultado = modelo.avaliar({ sinais: [
        sinal('resultado_atendimento', 'sem_resposta', { natureza: 'observado' }),
    ], abertura, agora });
    assert.equal(resultado.interesse.estado, 'a_confirmar');
    assert.equal(resultado.proximaAcao.codigo, 'rever_combinado');
    assert.match(resultado.proximaAcao.motivo, /não informa o interesse/i);
});

test('declaração mais recente prevalece e o fundamento conserva data, fonte e responsável', () => {
    const resultado = modelo.avaliar({ sinais: [
        sinal('interesse_declarado', 'participar', { occurredAt: '2026-10-20T10:00:00.000Z' }),
        sinal('interesse_declarado', 'depois', { occurredAt: '2026-10-22T10:00:00.000Z', origem: 'Conversa CRM', responsavel: 'Atendente B' }),
    ], abertura, agora });
    assert.equal(resultado.interesse.estado, 'depois');
    assert.equal(resultado.proximaAcao.codigo, 'respeitar_momento');
    const fundamento = resultado.fundamentos.find(f => f.papel === 'define_interesse_declarado');
    assert.equal(fundamento.occurredAt, '2026-10-22T10:00:00.000Z');
    assert.equal(fundamento.responsavel, 'Atendente B');
});

test('pedido de não contato bloqueia a próxima ação sem apagar interesse declarado', () => {
    const sinais = [sinal('interesse_declarado', 'participar'), sinal('nao_contatar', true)];
    const resultado = modelo.avaliar({ sinais, abertura, agora });
    assert.equal(resultado.interesse.estado, 'participar');
    assert.equal(resultado.proximaAcao.codigo, 'respeitar_nao_contatar');
    assert.ok(modelo.gerarTags(resultado, sinais).includes('Não contatar'));
});

test('sinais futuros são excluídos e declaração nova supera resultado antigo', () => {
    const resultado = modelo.avaliar({ sinais: [
        sinal('resultado_atendimento', 'sem_interesse', { natureza: 'observado', occurredAt: '2026-10-20T10:00:00.000Z' }),
        sinal('interesse_declarado', 'participar', { occurredAt: '2026-10-22T10:00:00.000Z' }),
        sinal('interesse_declarado', 'nao', { occurredAt: '2026-10-24T10:00:00.000Z' }),
    ], abertura, agora });
    assert.equal(resultado.interesse.estado, 'participar');
    assert.equal(resultado.proximaAcao.codigo, 'confirmar_horario');
    assert.equal(resultado.fundamentos.some(f => f.occurredAt === '2026-10-24T10:00:00.000Z'), false);
});

test('não contato permanece ativo até revogação explícita declarada', () => {
    const bloqueado = modelo.avaliar({ sinais: [
        sinal('nao_contatar', true, { natureza: 'declarado' }),
        sinal('nao_contatar', false, { natureza: 'observado', occurredAt: '2026-10-22T10:00:00.000Z' }),
    ], abertura, agora });
    const revogado = modelo.avaliar({ sinais: [
        sinal('nao_contatar', true, { natureza: 'declarado' }),
        sinal('nao_contatar', false, { natureza: 'declarado', occurredAt: '2026-10-22T13:00:00.000Z' }),
    ], abertura, agora });
    assert.equal(bloqueado.proximaAcao.codigo, 'respeitar_nao_contatar');
    assert.notEqual(revogado.proximaAcao.codigo, 'respeitar_nao_contatar');
});

test('tag de não contato ignora sinal futuro ou interpretado', () => {
    const resultado = modelo.avaliar({ sinais: [], abertura, agora });
    assert.equal(modelo.gerarTags(resultado, [
        sinal('nao_contatar', true, { occurredAt: '2026-10-24T10:00:00.000Z' }),
        sinal('nao_contatar', true, { natureza: 'interpretado' }),
    ]).includes('Não contatar'), false);
});

test('validação exige origem, natureza, data, responsável e vínculo específico do horário', () => {
    assert.deepEqual(modelo.validarEvento(sinal('interesse_declarado', 'participar')), { valido: true });
    assert.equal(modelo.validarEvento({ ...sinal('interesse_declarado', 'participar'), responsavel: '' }).valido, false);
    assert.equal(modelo.validarEvento({ ...sinal('disponibilidade_confirmada', true), aberturaId: '' }).valido, false);
    assert.equal(modelo.validarEvento(sinal('resultado_atendimento', 'sem_resposta')).valido, true);
});

test('tags são fatos de estado e horário a confirmar é específico da abertura', () => {
    const resultado = modelo.avaliar({ sinais: [], abertura, agora });
    assert.deepEqual(modelo.gerarTags(resultado), ['Interesse a confirmar', 'Horário a confirmar', 'Próxima ação: confirmar_interesse']);
});

test('preferência canônica de não contato vence um snapshot antigo de permissão',()=>{
 const atual=modelo.avaliar({sinais:[{tipo:'nao_contatar',valor:false,occurredAt:'2026-01-01T00:00:00Z',origem:'historico',natureza:'declarado',responsavel:'r'}],agora:'2026-02-01T00:00:00Z',preferenciaContato:{naoContatar:true}});
 assert.equal(atual.proximaAcao.codigo,'respeitar_nao_contatar');
});

test('mudança de horário exige reconfirmar disponibilidade mesmo na mesma abertura',()=>{
 const sinais=[sinal('disponibilidade_confirmada',true,{aberturaId:abertura.id})];
 const avaliacao=modelo.avaliar({sinais,abertura:{...abertura,diaSemana:3},agora});
 assert.equal(avaliacao.adequacaoTurma.estado,'a_confirmar');
});

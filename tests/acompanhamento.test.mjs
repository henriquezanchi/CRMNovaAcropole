import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { motivoBloqueioContato } from '../supabase/functions/_shared/preferencia-contato.ts';
const contexto = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../js/acompanhamento-modelo.js', import.meta.url), 'utf8'), contexto);
const modelo = contexto.AcompanhamentoModelo;
const agora = Date.parse('2026-10-17T12:00:00Z');
const base = () => ({ ...modelo.normalizar({}), contato: 'permitido', intencao: 'conhecer' });
test('registro antigo não autoriza campanhas nem inventa intenção ou origem', () => {
    assert.equal(modelo.normalizar(null).origem, 'desconhecida');
    assert.equal(modelo.prioridade({ acompanhamento: {} }, agora).campanha, false);
    assert.ok(motivoBloqueioContato({}, true, agora));
});
test('não contato impede mensagens mesmo fora de campanha; pausa e ausência de interesse impedem campanha', () => {
    assert.ok(motivoBloqueioContato({ contato: 'nao_contatar' }, false, agora));
    for (const contato of ['pausado', 'verificar', 'nao_contatar']) assert.ok(motivoBloqueioContato({ ...base(), contato }, true, agora));
    for (const intencao of ['nao', 'depois', 'desconhecida', 'inscrever']) assert.ok(motivoBloqueioContato({ ...base(), intencao }, true, agora));
});
test('pedidos e compromissos têm prioridade individual; não entram em campanha', () => {
    for (const proxima_em of ['2026-10-18T12:00:00Z', '2026-10-16T12:00:00Z']) {
        const dado = { ...base(), proxima_em };
        assert.equal(modelo.prioridade({ acompanhamento: dado }, agora).campanha, false);
        assert.ok(motivoBloqueioContato(dado, true, agora));
    }
    assert.equal(modelo.prioridade({ acompanhamento: { ...base(), proximo: 'responder' } }, agora).nivel, 1);
});
test('frontend e servidor concordam para campanhas em combinações de intenção e preferência', () => {
    for (const contato of Object.keys(modelo.campos.contato)) for (const intencao of Object.keys(modelo.campos.intencao)) {
        const dado = { ...base(), contato, intencao };
        assert.equal(!motivoBloqueioContato(dado, true, agora), modelo.prioridade({ acompanhamento: dado }, agora).campanha);
    }
});
test('próximo passo exige responsável e data; recusa não aceita convite agendado', () => {
    assert.throws(() => modelo.validar({ ...base(), proximo: 'convidar' }), /responsável/);
    assert.throws(() => modelo.validar({ ...base(), proximo: 'convidar', responsavel: 'Equipe', proxima_em: '2026-10-18T12:00:00Z', contato: 'nao_contatar' }), /não contato/);
    assert.throws(() => modelo.validar({ ...base(), proximo: 'nenhum', proxima_em: '2026-10-18T12:00:00Z' }), /próximo passo/);
});
test('experiência positiva não vira intenção de matrícula e campos desconhecidos não passam na validação', () => {
    assert.equal(modelo.validar({ ...base(), experiencia: 'positiva', intencao: 'desconhecida' }).intencao, 'desconhecida');
    assert.throws(() => modelo.validar({ ...base(), origem: 'inventada' }), /válida/);
    assert.throws(() => modelo.validar({ ...base(), nota: 'x'.repeat(601) }), /Resuma/);
});
test('aluno ativo não entra em captação e pausa encerrada pede revisão individual', () => {
    const ativo = { ...base(), relacao: 'ativo' };
    assert.equal(modelo.prioridade({ acompanhamento: ativo }, agora).campanha, false);
    assert.ok(motivoBloqueioContato(ativo, true, agora));
    const pausado = { ...base(), contato: 'pausado', pausa_ate: '2026-10-16T12:00:00Z' };
    const prioridade = modelo.prioridade({ acompanhamento: pausado }, agora);
    assert.equal(prioridade.nivel, 0);
    assert.equal(prioridade.campanha, false);
    assert.ok(motivoBloqueioContato(pausado, true, agora));
});

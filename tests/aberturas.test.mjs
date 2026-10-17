import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx = vm.createContext({});
for (const arquivo of ['aberturas-modelo.js', 'acompanhamento-modelo.js']) vm.runInContext(fs.readFileSync(new URL('../js/'+arquivo, import.meta.url), 'utf8'), ctx);
const modelo = ctx.AberturasModelo;
const pessoas = [
    { id: 1, pessoaIdentificador: '001', resposta_convite: 'confirmado', compareceu: null, _lead: { pessoaNome: 'João' } },
    { id: 2, pessoaIdentificador: '002', resposta_convite: 'talvez', compareceu: true, matriculado: null, _lead: { pessoaNome: 'Éliane' } },
    { id: 3, pessoaIdentificador: '003', resposta_convite: 'confirmado', compareceu: false, matriculado: false },
    { id: 4, pessoaIdentificador: '004', resposta_convite: 'confirmado', compareceu: true, matriculado: true },
];
test('presença desconhecida não vira falta e talvez não vira confirmação', () => {
    const resumo = modelo.resumir(pessoas);
    assert.equal(resumo.total, 4); assert.equal(resumo.confirmados, 3); assert.equal(resumo.talvez, 1);
    assert.equal(resumo.faltas, 1); assert.equal(resumo.presencaPendente, 1);
});
test('retorno após visita inclui somente presentes sem matrícula informada', () => {
    assert.deepEqual(Array.from(modelo.filtrar(pessoas, 'retorno'), p=>p.id), [2]);
    assert.deepEqual(Array.from(modelo.filtrar(pessoas, 'presenca_pendente'), p=>p.id), [1]);
});
test('busca ignora acentos e combina com situação', () => {
    assert.deepEqual(Array.from(modelo.filtrar(pessoas, 'todos', 'eliane'), p=>p.id), [2]);
    assert.equal(modelo.filtrar(pessoas, 'confirmados', 'eliane').length, 0);
    assert.deepEqual(Array.from(modelo.filtrar(pessoas, 'todos', 'joao'), p=>p.id), [1]);
});
test('cadastro conferido exige evidência, sem virar confirmação de pagamento', () => {
    const modeloContato = ctx.AcompanhamentoModelo;
    const base = { ...modeloContato.normalizar({}), inscricao: 'conferida' };
    assert.throws(()=>modeloContato.validar(base), /fonte, referência e data/);
    const resultado = modeloContato.validar({ ...base, fonte_registro: 'mercurio', referencia_registro: 'Registro de teste', conferido_em: '2026-10-17T12:00:00Z' });
    assert.equal(resultado.inscricao, 'conferida');
    assert.equal(Object.hasOwn(resultado, 'pagamento_confirmado'), false);
});

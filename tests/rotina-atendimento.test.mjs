import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../js/acompanhamento-modelo.js', import.meta.url), 'utf8'), ctx);
const modelo = ctx.AcompanhamentoModelo;
const agora = Date.parse('2026-10-17T12:00:00Z');
const base = () => ({ ...modelo.normalizar({}), contato: 'permitido', intencao: 'conhecer' });
test('fila combina busca sem acentos, origem e responsável sem trocar o dado de origem', () => {
    const leads = [{pessoaIdentificador:'1',pessoaNome:'Éliane',acompanhamento:{...base(),origem:'ulisses',responsavel:'João'}},{pessoaIdentificador:'2',pessoaNome:'Outra pessoa',acompanhamento:{...base(),origem:'instagram',responsavel:'João'}}];
    const resultado = modelo.selecionarFila(leads,{filtro:'ulisses',busca:'eliane',somenteMeus:true,responsavel:'joao'},agora);
    assert.equal(resultado.length,1);assert.equal(resultado[0].lead.pessoaIdentificador,'1');
    assert.equal(leads[0].acompanhamento.origem,'ulisses');
    assert.equal(modelo.selecionarFila(leads,{somenteMeus:true,responsavel:''},agora).length,0);
});
test('resumo conta pendências sem afirmar matrícula ou pagamento e permite sobreposição', () => {
    const resumo = modelo.resumir([{acompanhamento:{}},{acompanhamento:{...base(),inscricao:'solicitada'}},{acompanhamento:{...base(),inscricao:'conferida',responsavel:'Equipe'}}],agora);
    assert.equal(resumo.total,3);assert.equal(resumo.inscricoes,1);assert.equal(resumo.semResponsavel,2);
    assert.equal(resumo.cadastrosConferidos,1);assert.equal(resumo.preferenciaPendente,1);
    assert.equal(Object.hasOwn(resumo,'pagamentos'),false);
});
test('sugestões não incentivam contato em recusa, pausa, data futura ou aluno ativo', () => {
    for(const dado of [{...base(),contato:'nao_contatar'},{...base(),contato:'pausado'},{...base(),intencao:'nao'},{...base(),intencao:'depois'},{...base(),proxima_em:'2026-10-18T12:00:00Z'},{...base(),relacao:'ativo'}]) assert.equal(modelo.sugerirConversa(dado,agora).texto,'');
});
test('cadastro pendente pede conferência interna e convite sem atividade não inventa data', () => {
    assert.equal(modelo.sugerirConversa({...base(),inscricao:'aguardando_registro'},agora).texto,'');
    assert.match(modelo.sugerirConversa({...base(),proximo:'conferir'},agora).orientacao,/antes de perguntar/);
    assert.equal(modelo.sugerirConversa({...base(),proximo:'convidar'},agora).texto,'');
});
test('retorno após visita abre espaço para dúvida e não presume encantamento', () => {
    const resultado=modelo.sugerirConversa({...base(),proximo:'ouvir'},agora);
    assert.match(resultado.texto,/Como foi/);assert.match(resultado.texto,/prefere outro momento/);
    assert.doesNotMatch(resultado.texto,/adorou|amou|matrícula confirmada/);
});

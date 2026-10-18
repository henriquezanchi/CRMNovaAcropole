import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../js/acompanhamento-modelo.js',import.meta.url),'utf8'),ctx);const m=ctx.AcompanhamentoModelo;
const agora=new Date(2026,9,18,12).getTime();const lead=(d={})=>({acompanhamento:{contato:'permitido',...d}});
test('fila diária diferencia dias locais e aguarda horário futuro de hoje',()=>{
 assert.equal(m.atendimentoDiario(lead({proxima_em:new Date(2026,9,17,23,59).toISOString()}),agora).grupo,'atrasados');
 assert.match(m.atendimentoDiario(lead({proxima_em:new Date(2026,9,18,18).toISOString()}),agora).rotulo,/aguardar o horário/);
 assert.equal(m.atendimentoDiario(lead({proxima_em:new Date(2026,9,19,1).toISOString()}),agora).grupo,'futuro');
});
test('conferência é interna, recusa não vira abordagem e intenção não vira urgência',()=>{
 assert.equal(m.atendimentoDiario(lead({inscricao:'aguardando_registro',contato:'nao_contatar'}),agora).grupo,'interno');
 assert.equal(m.atendimentoDiario(lead({intencao:'nao',proxima_em:'2020-01-01'}),agora).grupo,'revisar');
 assert.equal(m.atendimentoDiario(lead({intencao:'inscrever'}),agora).grupo,'pedidos');
 assert.equal(m.atendimentoDiario(lead({experiencia:'positiva'}),agora).grupo,'organizar');
});
test('seleção diária exclui futuros e respeita busca e responsável',()=>{
 const lista=[lead({responsavel:'Eliane',intencao:'inscrever'}),lead({responsavel:'Outro',intencao:'inscrever'}),lead({responsavel:'Eliane',proxima_em:'2099-01-01'}),lead({responsavel:'Eliane',contato:'nao_contatar',intencao:'inscrever'})];
 assert.equal(m.selecionarFila(lista,{filtro:'dia:pendentes',somenteMeus:true,responsavel:'Eliane'},agora).length,1);
});

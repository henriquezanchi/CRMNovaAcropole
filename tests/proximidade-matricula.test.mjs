import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../js/acompanhamento-modelo.js',import.meta.url),'utf8'),ctx);
const modelo=ctx.AcompanhamentoModelo;
const lead=(dado={},extra={})=>({acompanhamento:{...modelo.normalizar({}),...dado},...extra});
test('antigo evento, muitas tags, lead forte e prazo vencido não significam intenção de matrícula',()=>{
 for(const l of [lead({}, {tags:'["Lead Forte 1","Jornada: Engajado"]',funil_agencia:'RSVP'}),lead({proximo:'responder',proxima_em:'2020-01-01'}),lead({experiencia:'positiva'})])assert.equal(modelo.proximidade(l).grupo,'qualificar');
});
test('separa decisão, processo de inscrição, relato após visita e interesse em participar',()=>{
 assert.equal(modelo.proximidade(lead({intencao:'inscrever'})).grupo,'decididos');
 assert.equal(modelo.proximidade(lead({inscricao:'aguardando_registro'})).grupo,'inscricao');
 assert.equal(modelo.proximidade(lead({relacao:'visitante',experiencia:'positiva'})).grupo,'visita');
 assert.equal(modelo.proximidade(lead({intencao:'participar'})).grupo,'participar');
});
test('recusa, pausa, não contato e indicação de aluno superam sinais antigos de interesse',()=>{
 for(const dado of [{intencao:'nao',inscricao:'solicitada'},{intencao:'inscrever',contato:'nao_contatar'},{intencao:'inscrever',contato:'pausado'}])assert.equal(modelo.proximidade(lead(dado)).grupo,'momento');
 for(const extra of [{tags:'["Ativo"]'},{funil_agencia:'Matriculados'}])assert.equal(modelo.proximidade(lead({intencao:'inscrever'},extra)).grupo,'fora');
 assert.equal(modelo.proximidade(lead({intencao:'inscrever'},{tags:'["Não Contatar"]'})).grupo,'momento');
});
test('cadastro conferido exige referência real e não declara pagamento',()=>{
 assert.equal(modelo.proximidade(lead({inscricao:'conferida'})).grupo,'qualificar');
 const resultado=modelo.proximidade(lead({inscricao:'conferida',fonte_registro:'mercurio',referencia_registro:'Registro teste',conferido_em:'2026-10-18'}));assert.equal(resultado.grupo,'conferidos');assert.match(resultado.acao,/não comprova pagamento/);
});
test('fila dos mais próximos ordena evidência, mantém próxima data e restrição visíveis, busca antes do limite',()=>{
 const leads=[lead({intencao:'conhecer'},{pessoaIdentificador:'1'}),lead({intencao:'inscrever',proxima_em:'2099-01-01'},{pessoaIdentificador:'2'}),lead({relacao:'visitante',experiencia:'positiva'},{pessoaIdentificador:'3'}),lead({inscricao:'solicitada'},{pessoaIdentificador:'4'}),lead({intencao:'inscrever',contato:'nao_contatar'},{pessoaIdentificador:'5'})];
 assert.deepEqual(Array.from(modelo.selecionarFila(leads,{filtro:'proximos'}),i=>i.lead.pessoaIdentificador),['4','2','3']);
 assert.equal(modelo.selecionarFila(leads,{filtro:'sinal:qualificar'}).length,0);
});

test('análise automática diferencia conversa, evento e matrícula sem autorizar campanha', () => {
 const lead={pessoaIdentificador:'auto',acompanhamento:{},analise_funil:{resultado:{continuidade:{aceitou:true,trecho:'Pode mandar'}}}};
 assert.equal(modelo.proximidade(lead).grupo,'conversa');
 assert.equal(modelo.selecionarFila([lead],{filtro:'proximos'}).length,0);
 assert.equal(modelo.prioridade(lead).campanha,false);
 lead.analise_funil.resultado.intencao={pretende:true,trecho:'Vou me inscrever na palestra'};
 assert.equal(modelo.proximidade(lead).grupo,'evento');
 lead.acompanhamento={contato:'nao_contatar'};
 assert.equal(modelo.proximidade(lead).grupo,'momento');
});

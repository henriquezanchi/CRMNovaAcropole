import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../js/acompanhamento-modelo.js', import.meta.url), 'utf8'), ctx);
const modelo = ctx.AcompanhamentoModelo;
const lead = (acompanhamento = {}, extra = {}) => ({ acompanhamento, ...extra });
test('separa inscrição em evento de pedido de matrícula com evidência automática', () => {
 const evento = lead({}, { analise_funil: { resultado: { intencao: { pretende: true, trecho: 'Vou preencher a inscrição da palestra' } } } });
 const antes = JSON.stringify(evento);
 assert.equal(modelo.trabalhoEspecializado(evento).frente, 'Acompanhamento de evento');
 assert.equal(modelo.trabalhoEspecializado(lead({intencao:'inscrever'})).frente, 'Apoio à matrícula');
 assert.equal(JSON.stringify(evento), antes);
 assert.match(modelo.trabalhoEspecializado(evento).proximo, /não comprovam inscrição nem presença/);
});
test('evidência de aceitação orienta entregar informação e não confirmar presença', () => {
 const l = lead({}, {analise_funil:{resultado:{continuidade:{aceitou:true,trecho:'Pode mandar os detalhes'}}}});
 assert.equal(modelo.trabalhoEspecializado(l).frente, 'Informações iniciais');
 assert.match(modelo.trabalhoEspecializado(l).proximo, /sem antecipar confirmação/);
});
test('identidade, recusa e pausa prevalecem sobre matrícula e interesse anteriores', () => {
 for (const tag of ['Contato em conferência','Histórico em conferência'])
  assert.equal(modelo.trabalhoEspecializado(lead({intencao:'inscrever'},{tags:JSON.stringify([tag])})).frente, 'Conferência de identidade');
 assert.equal(modelo.trabalhoEspecializado(lead({intencao:'inscrever',contato:'nao_contatar'})).frente, 'Respeitar pedido de não contato');
 assert.equal(modelo.trabalhoEspecializado(lead({intencao:'inscrever'},{tags:['Não Contatar']})).frente, 'Respeitar pedido de não contato');
 assert.equal(modelo.trabalhoEspecializado(lead({intencao:'inscrever',contato:'pausado'})).frente, 'Acompanhamento em pausa');
});
test('encaminha registro pendente internamente e aluno ativo para acolhimento', () => {
 assert.equal(modelo.trabalhoEspecializado(lead({inscricao:'aguardando_registro'})).frente,'Conferência com a escola');
 assert.equal(modelo.trabalhoEspecializado(lead({intencao:'inscrever'},{tags:['Ativo']})).frente,'Acolhimento de aluno');
 assert.equal(modelo.trabalhoEspecializado(lead({relacao:'antigo'})).frente,'Acolhimento de antigo aluno');
 assert.equal(modelo.trabalhoEspecializado(lead({proximo:'ouvir'})).frente,'Acolhimento após visita');
});
test('sem prova não inventa interesse e não altera permissão, responsável ou retorno', () => {
 const l=lead({}, {tags:['Lead Forte 1'],analise_funil:{resultado:{intencao:{pretende:true,trecho:null}}}});
 const antes=JSON.stringify(l);
 assert.equal(modelo.trabalhoEspecializado(l).frente,'Qualificação inicial');
 assert.equal(JSON.stringify(l),antes);
 assert.equal(modelo.impedimento(l.acompanhamento),'Preferência de contato ainda não conferida');
});

import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const c=vm.createContext({});vm.runInContext(fs.readFileSync('js/leads-a-tratar.js','utf8'),c);
const s=fs.readFileSync('js/app.js','utf8'),a=s.indexOf('function buscarStatusRedeAtivosInativos(lead) {'),b=s.indexOf('\n// ==========================================',a);vm.runInContext(s.slice(a,b),c);
c.mapaRedeAtivosInativosTelefone=new Map();c.mapaRedeAtivosInativosEmail=new Map();c.normalizarTelefoneParaChave=(d,n)=>d+n;
test('status de outra filial exige contato e nome compatível, sem escolher por ordem nem compartilhar status da família',()=>{
 const lead={pessoaNome:'Maria Silva',pessoaTelefoneDDD:'62',pessoaTelefoneNumero:'999998888',pessoaEmail:'familia@example.test',tags:'[]'};
 const maria={nome:'Maria Silva',status:'Ativo',filial:'A'},joao={nome:'João Souza',status:'Inativo',filial:'B'};
 c.mapaRedeAtivosInativosTelefone.set('62999998888',[joao,maria]);c.mapaRedeAtivosInativosEmail.set('familia@example.test',[joao]);
 assert.equal(c.buscarStatusRedeAtivosInativos(lead).nome,'Maria Silva');
 assert.equal(c.buscarStatusRedeAtivosInativos({...lead,pessoaNome:'Bárbara Prego'}),null);
 assert.equal(c.buscarStatusRedeAtivosInativos({...lead,tags:'["Contato em conferência"]'}),null);
 c.mapaRedeAtivosInativosTelefone.set('62999998888',[maria,{...maria,status:'Inativo'}]);assert.equal(c.buscarStatusRedeAtivosInativos(lead),null);
});

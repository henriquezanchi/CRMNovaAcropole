import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const c=vm.createContext({document:{addEventListener(){}}});vm.runInContext(fs.readFileSync('js/leads-a-tratar.js','utf8'),c);vm.runInContext(fs.readFileSync('js/importador.js','utf8'),c);
const obj=x=>JSON.parse(JSON.stringify(x));
test('inativos não recebem DDD pela escola; preserva local e prefere número com DDD explícito',()=>{
 for(const escola of ['Goiânia II','Barra do Garças/MT'])assert.equal(c.dddPadraoDaFilial(escola),'');
 assert.deepEqual(obj(c.parseTelefoneInativo('99999-8888','62')),{ddd:'',numero:'999998888'});
 assert.deepEqual(obj(c.parseTelefoneInativo('(65) 99999-8888','66')),{ddd:'65',numero:'999998888'});
 assert.deepEqual(obj(c.parseTelefoneInativo('+55 (66) 99999-8888')),{ddd:'66',numero:'999998888'});
 assert.deepEqual(obj(c.parseTelefoneInativo('99999-8888 / (65) 99999-7777')),{ddd:'65',numero:'999997777'});
 assert.equal(c.parseTelefoneInativo('000000000000000'),null);
});
test('ID global não pode trocar de pessoa ou filial; atualização do mesmo nome e abreviação é permitida',()=>{
 const antigo={pessoaIdentificador:'990000040',pessoaNome:'Tatiana Silva Borges',filial:'A'};
 const atual={...antigo,pessoaNome:'Bárbara Guedes Cortez'};
 assert.equal(c.conflitosIdentidadeImportacao([atual],[antigo]).length,1);
 assert.equal(c.conflitosIdentidadeImportacao([{...antigo,filial:'B'}],[antigo]).length,1);
 assert.equal(c.conflitosIdentidadeImportacao([{...antigo,pessoaNome:'TATIANA S BORGES'}],[antigo]).length,0);
 assert.equal(c.conflitosIdentidadeImportacao([antigo,atual],[antigo,atual]).length,1);
 assert.equal(c.conflitosIdentidadeImportacao([{...antigo,matricula_mercurio:20}],[{...antigo,matricula_mercurio:10}]).length,1);
});

test('IDs sintéticos não mudam com posição e não colidem entre escolas ou nomes',()=>{
 const nomes=['Vanessa Arnhold','Bruna Ribeiro Carvalho'];
 const primeira=nomes.map(n=>c.idSinteticoEstavel('inativo',n,'Goiânia II'));
 const segunda=[...nomes].reverse().map(n=>c.idSinteticoEstavel('inativo',n,'Goiânia II'));
 assert.equal(primeira[0],segunda[1]);assert.equal(primeira[1],segunda[0]);assert.notEqual(primeira[0],primeira[1]);
 assert.notEqual(primeira[1],c.idSinteticoEstavel('inativo',nomes[1],'Barra do Garças/MT'));
 assert.ok(primeira.every(n=>Number.isSafeInteger(Number(n))&&Number(n)>=1000000000000));
});

test('contato ou histórico em conferência não entra na mesclagem automática',()=>{
 const a={pessoaIdentificador:'1',pessoaNome:'Maria Silva',tags:'[]'},b={...a,pessoaIdentificador:'2',tags:'["Histórico em conferência"]'};
 assert.equal(c.grupoElegivelParaAutoMesclagem([a,b]),false);
 assert.equal(c.grupoElegivelParaAutoMesclagem([a,{...b,tags:'["Contato em conferência"]'}]),false);
});

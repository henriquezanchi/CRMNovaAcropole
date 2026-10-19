import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
test('audita cada identidade, corrige só prova forte e não transforma ausência ou homônimo em inativo',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'crm-auditoria-'));
 try {
 const lead=(id,nome,matricula,tags=['Inativo'],extra={})=>({pessoaIdentificador:id,pessoaNome:nome,matricula_mercurio:matricula,tags:JSON.stringify(tags),filial:'A',pessoaTelefoneDDD:null,pessoaTelefoneNumero:null,pessoaEmail:null,...extra});
 const leads=[lead('1','Maria Silva',10),lead('2','José Costa',null,['Ativo']),lead('3','Ana Santos',null,['Ativo']),lead('4','Outra Pessoa',10,['Ativo']),lead('5','Paulo Souza',null,['Inativo'],{pessoaTelefoneDDD:'62',pessoaTelefoneNumero:'999998888'}),lead('6','Lara Lima',null,['Ativo'],{pessoaEmail:'lara@example.test'})];
 const fonte=[{execucao:'teste',matricula:10,unidade:'A',nome:'Maria Silva',situacao:'ATI',nivel:'N1'},{execucao:'teste',matricula:11,unidade:'A',nome:'Ana Santos',situacao:'INA'},{execucao:'teste',matricula:12,unidade:'A',nome:'Paulo Souza',situacao:'ATI',telefone_ddd:'62',telefone:'999998888'},{execucao:'teste',matricula:13,unidade:'A',nome:'Lara Lima',situacao:'INA',email:'lara@example.test'},{execucao:'teste',matricula:14,unidade:'B',nome:'Lara Lima',situacao:'ATI',email:'lara@example.test'}];
 await writeFile(join(dir,'leads.json'),JSON.stringify(leads));await writeFile(join(dir,'fonte.json'),JSON.stringify(fonte));
 execFileSync(process.execPath,['tools/auditoria/planejar.mjs',join(dir,'leads.json'),join(dir,'fonte.json'),join(dir,'saida.json')]);
 const r=JSON.parse(await readFile(join(dir,'saida.json'),'utf8')).resultado;
 assert.equal(r.length,6);assert.deepEqual(JSON.parse(r[0].tags_depois),['Ativo','N1']);
 assert.equal(r[1].resultado,'status_sem_correspondencia');assert.equal(r[1].tags_depois,leads[1].tags);
 assert.equal(r[2].resultado,'nome_sem_identificador');assert.equal(r[2].tags_depois,leads[2].tags);
 assert.equal(r[3].resultado,'identidade_ambigua');assert.equal(r[4].metodo,'telefone_nome');assert.equal(r[5].resultado,'identidade_ambigua');
 }finally{await rm(dir,{recursive:true,force:true});}
});

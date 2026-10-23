import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({console,Date,Set,Map,clearTimeout,setTimeout,setInterval(){return 0},localStorage:{getItem(){return null}},document:{addEventListener(){}}});
vm.runInContext(fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8'),ctx);
test('tags duplicadas e aliases são compactados sem alterar a origem',()=>{
 const origem=['Ativo','Aluno Ativo','CRM','Trilha: Filosófica','Não Contatar','Interesse em Filosofia'];const copia=[...origem];
 const grupos=ctx.organizarTagsDoCartao(origem);assert.equal(grupos.principais[0],'Não Contatar');assert.equal(grupos.principais.filter(t=>t==='Ativo').length,1);assert.ok(grupos.outras.includes('CRM'));assert.ok(grupos.outras.includes('Trilha: Filosófica'));assert.deepEqual(origem,copia);
});
test('cartão tem até três destaques e conserva as demais tags acessíveis',()=>{
 const origem=['Não Contatar','Ativo','Indicação de Aluno','Convite: Pediu Informação','Horário a combinar','Lead Forte 2','Jornada: Engajado','Retorno: Só 1 Evento'];const grupos=ctx.organizarTagsDoCartao(origem);
 const exibidas=[...grupos.principais,...grupos.outras];
 const legado=/^(Lead Forte(?:\s+[1-3])?|Jornada\s*:|Retorno:\s*Só 1 Evento)/i;
 assert.equal(grupos.principais.length,3);
 assert.deepEqual(exibidas.sort(),origem.filter(tag=>!legado.test(tag)).sort());
});

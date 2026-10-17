import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const fonte=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
function ambiente({falharPagina=false,espera=null}={}){
 const elementos=new Map();const chamadas=[];
 const ctx=vm.createContext({console,Date,Set,Map,clearTimeout,setTimeout,setInterval(){return 0},localStorage:{getItem(){return null},setItem(){}},document:{addEventListener(){},getElementById(id){return elementos.get(id)||null},querySelector(){return null},querySelectorAll(){return []}},window:{supabaseClient:{from(){const q={select(){return q},eq(k,v){if(k==='filial')q.filial=v;return q},is(){return q},order(){return q},range(a,b){q.faixa=[a,b];return q},then(resolve){chamadas.push({filial:q.filial,inicio:q.faixa[0]});return(async()=>{if(espera)await espera(q);if(falharPagina&&q.faixa[0]===1000)return{data:null,error:{message:'rede'}};return {data:dados.filter(l=>l.filial===q.filial).slice(q.faixa[0],q.faixa[1]+1),error:null}})().then(resolve)}};return q}}}});
 const dados=Array.from({length:2507},(_,i)=>({pessoaIdentificador:String(i).padStart(6,'0'),filial:'Escola A',funil_agencia:i===2505?null:i===2506?'Coluna antiga':i%2?'Abordagem':'Frios',tags:i>=2400?'["Alvo"]':'[]'}));
 vm.runInContext(fonte,ctx);
 vm.runInContext(`filialAtual='Escola A';leadsAtuais=[];renderizarCards=function(){globalThis.renders=(globalThis.renders||0)+1};registrarUsoFiltroTag=function(){};montarChipsTagsAgrupados=function(){};montarChips=function(){};`,ctx);
 return{ctx,chamadas,dados,elementos};
}
test('filtro rápido percorre todas as páginas e encontra registros tardios em todas as colunas, nulos e legados',async()=>{
 const {ctx,chamadas}=ambiente();await ctx.quickFilterTag('Alvo');
 assert.equal(vm.runInContext('leadsAtuais.length',ctx),2507);
 assert.deepEqual(chamadas.map(c=>c.inicio),[0,1000,2000]);
 assert.equal(vm.runInContext('leadsAtuais.filter(l=>l.tags.includes("Alvo")).length',ctx),107);
 assert.equal(vm.runInContext('baseFiltravelCompleta',ctx),true);
 assert.equal(vm.runInContext('podeCarregarMais',ctx),false);
});
test('busca por coluna também considera base inteira sem limite de 300 resultados',async()=>{
 const {ctx}=ambiente();await ctx.processarBuscaColuna('Frios');assert.equal(vm.runInContext('leadsAtuais.length',ctx),2507);
});
test('aplicações simultâneas compartilham consulta e não duplicam registros',async()=>{
 const {ctx,chamadas}=ambiente();await Promise.all([ctx.garantirColunaFiltravelCompleta('Frios'),ctx.garantirColunaFiltravelCompleta('Abordagem')]);
 assert.equal(chamadas.length,3);assert.equal(vm.runInContext('new Set(leadsAtuais.map(l=>l.pessoaIdentificador)).size',ctx),2507);
});
test('falha em página intermediária não publica cache parcial nem marca completude; permite nova tentativa',async()=>{
 const {ctx,chamadas}=ambiente({falharPagina:true});await assert.rejects(()=>ctx.garantirColunaFiltravelCompleta('Frios'),/toda a base/);
 assert.equal(vm.runInContext('baseFiltravelCompleta',ctx),false);assert.equal(vm.runInContext('leadsAtuais.length',ctx),0);
 await assert.rejects(()=>ctx.garantirColunaFiltravelCompleta('Frios'));assert.equal(chamadas.length,4);
});
test('troca de escola durante consulta descarta o resultado antigo',async()=>{
 let liberar;const pausa=new Promise(r=>{liberar=r});const {ctx}=ambiente({espera:()=>pausa});
 const consulta=ctx.garantirColunaFiltravelCompleta('Frios');
 vm.runInContext("filialAtual='Escola B';versaoCargaLeads++;",ctx);liberar();
 await assert.rejects(()=>consulta,/escola mudou/);assert.equal(vm.runInContext('leadsAtuais.length',ctx),0);
});

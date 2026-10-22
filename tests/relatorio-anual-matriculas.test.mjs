import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({escapeHTML:s=>String(s).replace(/</g,'&lt;').replace(/"/g,'&quot;')});
vm.runInContext(fs.readFileSync(new URL('../js/relatorio-anual-matriculas.js',import.meta.url),'utf8'),ctx);
const filiais=[{id:1,nome:'Rio Verde'},{id:2,nome:'Jataí',filial_cobranca_id:1},{id:3,nome:'Outra'}];
function dados(){return [1,3].flatMap(id=>Array.from({length:12},(_,i)=>({filial_id:id,mes:i+1,novas:i<3?(id===1?10:5):null,reingressos:i<3?2:null,membros_referencia:id===1?20:10,fonte_data:'2026-03-17',parcial:i===2})));}
test('consolida Jataí sem duplicar membros e alterna reingressos explicitamente',()=>{
 const r=ctx.resumirMatriculasAnuais(dados(),filiais,'novas');
 assert.equal(r.escolas.length,2);assert.equal(r.total,45);assert.equal(r.membros,30);assert.equal(r.escolas[0].rotulo,'Rio Verde + Jataí');assert.equal(r.escolas[0].taxa,150);
 assert.equal(ctx.resumirMatriculasAnuais(dados(),filiais,'total').total,57);
});
test('meses futuros não viram zero e mês parcial não entra em melhores meses',()=>{
 const r=ctx.resumirMatriculasAnuais(dados(),filiais);
 assert.equal(r.meses[3].total,null);assert.equal(r.meses[2].parcial,true);assert.equal(r.meses[2].completo,false);
 assert.deepEqual(Array.from(r.melhores,m=>m.mes),[1,2]);
});
test('escola sem mês ou membros não produz total mensal completo nem taxa fictícia',()=>{
 const d=dados().filter(r=>!(r.filial_id===3&&r.mes===2));d.filter(r=>r.filial_id===3).forEach(r=>r.membros_referencia=null);
 const r=ctx.resumirMatriculasAnuais(d,filiais);
 assert.equal(r.meses[1].total,null);assert.equal(r.meses[1].completo,false);assert.equal(r.escolas[1].taxa,null);assert.equal(r.membros,null);
 d.filter(r=>r.filial_id===3).forEach(r=>r.membros_referencia=0);assert.equal(ctx.resumirMatriculasAnuais(d,filiais).escolas[1].taxa,null);
});
test('curva não liga intervalos sem cobertura e mantém mês futuro sem ponto',()=>{
 const svg=ctx.curvaSvgAnual([{total:10},{total:null},{total:20}],2026,'Teste');
 assert.equal((svg.match(/<circle /g)||[]).length,2);assert.match(svg,/viewBox="0 0 920 280"/);assert.match(svg,/Jan\/2026: 10/);assert.doesNotMatch(svg,/Feb\/2026: 0/);
});

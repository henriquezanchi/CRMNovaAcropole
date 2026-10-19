import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import ts from '/workspace/BPO/node_modules/typescript/lib/typescript.js';
import * as agentes from '../supabase/functions/_shared/agentes-crm.mjs';
const fonte=await readFile('supabase/functions/_shared/agentes-crm.ts','utf8');
const codigo=ts.transpileModule(fonte.replace(/^import .*;\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace('export async function','async function');
const carregar=(db,chamar)=>new Function('supabaseAdmin','chamarClaude','REGRAS_QUALIFICACAO','validarQualificacao','coordenarAgente','instrucoesEspecialista','Deno',codigo+'; return prepararAgente;')(db,chamar,agentes.REGRAS_QUALIFICACAO,agentes.validarQualificacao,agentes.coordenarAgente,agentes.instrucoesEspecialista,{env:{get(){return 'teste-sem-chave-real';}}});
function banco(mensagens,{falhaPagina=false,tags=[]}={}){
 const consultas=[];
 return {consultas,from(tabela){let inicio=0,fim=999;const filtros={};const ordem=[];const q={select(){return q;},eq(k,v){filtros[k]=v;return q;},lte(k,v){filtros['max_'+k]=v;return q;},order(k){ordem.push(k);return q;},range(a,b){inicio=a;fim=b;return q;},maybeSingle(){return q;},then(resolve,reject){consultas.push({tabela,inicio,filtros,ordem});let r;if(tabela==='leads_inscricoes')r={data:{tags,acompanhamento:{}},error:null};else if(filtros.id)r={data:mensagens.find(m=>m.id===filtros.id),error:null};else r={data:mensagens.filter(m=>m.filial===filtros.filial && m.pessoaIdentificador===filtros.pessoaIdentificador && m.id<=filtros.max_id).slice(inicio,fim+1),error:falhaPagina&&inicio>0?{message:'indisponível'}:null};return Promise.resolve(r).then(resolve,reject);}};return q;}};
}
const mensagem=(id,extra={})=>({id,filial:'A',pessoaIdentificador:'p',direcao:'entrada',tipo:'texto',corpo_texto:id===1?'Qual valor?':'Olá',...extra});
test('qualificação vê toda a conversa paginada de uma só filial e preserva evidência antiga',async()=>{
 const msgs=Array.from({length:1001},(_,i)=>mensagem(i+1));msgs.push(mensagem(1002,{filial:'B',corpo_texto:'Outra pessoa na outra filial'}));const db=banco(msgs);let chamadas=0;
 const preparar=carregar(db,async opts=>{chamadas++;const m=JSON.parse(opts.blocoDinamico);assert.equal(m.length,1001);assert.equal(m[0].corpo_texto,'Qual valor?');return {texto:JSON.stringify({etapa:'informacoes',evidencia:{mensagem_id:1,trecho:'Qual valor?'},restricao:null})};});
 const r=await preparar('p','A',1001);assert.equal(r.plano.agente,'informacoes');assert.equal(chamadas,1);
 const paginas=db.consultas.filter(c=>c.tabela==='mensagens_whatsapp');assert.equal(paginas.length,2);assert.deepEqual(paginas[0].ordem,['criado_em','id']);assert.equal(paginas[1].filtros.filial,'A');
});
test('histórico parcial, erro do provedor e evidência inventada impedem encaminhamento',async()=>{
 const msgs=Array.from({length:1001},(_,i)=>mensagem(i+1));
 await assert.rejects(carregar(banco(msgs,{falhaPagina:true}),async()=>{throw new Error('não deve chamar modelo');})('p','A',1001),/Histórico indisponível/);
 await assert.rejects(carregar(banco([mensagem(1)]),async()=>({erro:'falha'}))('p','A',1),/Falha técnica/);
 await assert.rejects(carregar(banco([mensagem(1)]),async()=>({texto:'{"etapa":"matricula","evidencia":{"mensagem_id":1,"trecho":"Inventado"}}'}))('p','A',1),/evidência/);
});
test('bloqueio existente não consome modelo nem gera contato; histórico grande não é truncado',async()=>{
 const naoChamar=async()=>{throw new Error('modelo não deve ser chamado');};
 const r=await carregar(banco([mensagem(1)],{tags:['Não Contatar']}),naoChamar)('p','A',1);assert.equal(r.plano.bloqueado,true);
 await assert.rejects(carregar(banco([mensagem(1,{corpo_texto:'x'.repeat(180001)})]),naoChamar)('p','A',1),/limite/);
});

import {test} from 'node:test';import assert from 'node:assert/strict';
import {motivoRascunhoAgente} from '../supabase/functions/_shared/rascunho-agente.mjs';
function db({novo=false,erro=false,filial='A',status='pendente',bloqueado=false}={}){let consulta=0;return {from(){const resposta=consulta++===0?{status,mensagem_origem_id:10,agente_ia:{bloqueado,qualificacao:{etapa:'matricula'}}}:consulta===2?{filial}:novo?[{id:11}]:[];const q=new Proxy({then(resolve){return Promise.resolve({data:resposta,error:erro?{}:null}).then(resolve);}},{get(t,k){return k in t?t[k]:(...args)=>q;}});return q;}};}
const ref={tipo:'geral',id:1};
test('rascunho atual pode ser revisado; nova mensagem, erro e filial divergente impedem envio',async()=>{
 assert.equal(await motivoRascunhoAgente(db(),ref,'p','A',{}),'');
 for(const op of [{novo:true},{erro:true},{filial:'B'},{status:'enviada'},{bloqueado:true}])assert.ok(await motivoRascunhoAgente(db(op),ref,'p','A',{}));
});
test('bloqueios atuais são rechecados mesmo após a geração; referência inválida não consulta banco',async()=>{
 for(const lead of [{tags:['Não Contatar']},{acompanhamento:{contato:'pausado'}},{tags:['Contato em conferência']}])assert.ok(await motivoRascunhoAgente(db(),ref,'p','A',lead));
 assert.ok(await motivoRascunhoAgente({from(){throw new Error('Não consultar');}},{tipo:'outro',id:1},'p','A',{}));
});

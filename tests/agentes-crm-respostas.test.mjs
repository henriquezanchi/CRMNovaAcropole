import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import ts from '/workspace/BPO/node_modules/typescript/lib/typescript.js';
async function carregar(caminho,nome,{preparar,chamar}){
 const src=(await readFile(caminho,'utf8')).replace(/^import .*;\n/gm,'');
 const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 return new Function('Deno','prepararAgente','chamarClaude','montarTabelaDiasSemana',js+'; return '+nome+';')({env:{get(){return 'teste';}},serve(){}},preparar,chamar,()=> 'Calendário de teste');
}
const preparo={plano:{agente:'matricula',nome:'Apoio à matrícula',bloqueado:false},historico:'HISTÓRICO INTEGRAL TESTE',instrucoes:'MISSÃO MATRÍCULA TESTE'};
test('agente especializado gera rascunho com histórico integral e contabilização por etapa',async()=>{
 const sugerir=await carregar('supabase/functions/sugerir-resposta-whatsapp/index.ts','sugerirUma',{preparar:async()=>preparo,chamar:async opts=>{
 assert.match(opts.blocoCacheavel,/MISSÃO MATRÍCULA TESTE/);assert.match(opts.blocoDinamico,/HISTÓRICO INTEGRAL TESTE/);assert.equal(opts.functionName,'agente-crm-matricula');
 return {texto:JSON.stringify({sugestao:'Vamos conferir o próximo passo?',tag_sugerida:'interessado'})};}});
 const r=await sugerir('recorte antigo','Dados reais','Quero entrar no curso','','2026-10-19',{pessoaIdentificador:'p',filial:'A',mensagem_id:2});
 assert.equal(r.agente.agente,'matricula');assert.equal(r.sugestao,'Vamos conferir o próximo passo?');
});
test('convite antigo não transforma pedido atual de matrícula em confirmação de evento',async()=>{
 const classificar=await carregar('supabase/functions/classificar-resposta-convite/index.ts','classificarUma',{preparar:async()=>preparo,chamar:async()=>({texto:JSON.stringify({categoria:'confirmou',sugestao_resposta:'Vamos ver sua dúvida sobre a matrícula?'})})});
 const r=await classificar({pessoaIdentificador:'p',mensagem_id:2,evento_id:1,evento_nome:'Evento antigo',evento_data:'2026-10-19'},'recorte',{},'','2026-10-19','');
 assert.equal(r.agente.agente,'matricula');assert.equal(r.categoria,'ambiguo');assert.equal(r.sugestao_resposta,'Vamos ver sua dúvida sobre a matrícula?');
});
test('bloqueio impede chamada ao redator e erro técnico continua retentável',async()=>{
 const naoChamar=async()=>{throw new Error('Redator não deveria ser chamado');};
 const bloqueado=await carregar('supabase/functions/sugerir-resposta-whatsapp/index.ts','sugerirUma',{preparar:async()=>({...preparo,plano:{...preparo.plano,bloqueado:true}}),chamar:naoChamar});
 const args=['','','','','2026-10-19',{pessoaIdentificador:'p',filial:'A',mensagem_id:2}];
 assert.equal((await bloqueado(...args)).sugestao,null);
 const falha=await carregar('supabase/functions/sugerir-resposta-whatsapp/index.ts','sugerirUma',{preparar:async()=>{throw new Error('Falha de rede');},chamar:naoChamar});
 assert.equal((await falha(...args)).erro,'qualificacao_indisponivel');
});

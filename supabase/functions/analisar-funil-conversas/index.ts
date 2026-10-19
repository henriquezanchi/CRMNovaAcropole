import { REGRAS, validarAnalise, extrairJsonAnalise, convitesDeterministicos, FERRAMENTA_ANALISE } from './criterios.mjs';
const url=Deno.env.get('SUPABASE_URL')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const modelo='claude-haiku-4-5-20251001';
async function rpc(nome:string,body:unknown={}) {
 const r=await fetch(`${url}/rest/v1/rpc/${nome}`,{method:'POST',headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!r.ok)throw new Error(`rpc_${nome}_${r.status}`);
 return r.json();
}
async function processar(c:any) {
 try {
  let bruto:any={respostas:[],continuidade:{aceitou:null},intencao:{pretende:null},convites:[]};
  if(c.mensagens.some((m:any)=>m.direcao==='entrada')) {
   const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':Deno.env.get('ANTHROPIC_API_KEY')!,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model:modelo,max_tokens:12000,system:REGRAS,tools:[FERRAMENTA_ANALISE],tool_choice:{type:'tool',name:'registrar_analise'},messages:[{role:'user',content:JSON.stringify({filial:c.filial,mensagens:c.mensagens,eventos:c.eventos})}]}),signal:AbortSignal.timeout(90000)});
   if(!r.ok)throw new Error(`provedor_ia_http_${r.status}`);
   const d=await r.json();if(d.stop_reason==='max_tokens')throw new Error('resposta_truncada');
   let texto=d.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('');
   texto=texto.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');bruto=d.content.find((b:any)=>b.type==='tool_use' && b.name==='registrar_analise')?.input || extrairJsonAnalise(texto);
   // Mesmo controle de consumo das outras funções de IA; falha de log não repete análise.
   await fetch(`${url}/rest/v1/ia_uso_tokens`,{method:'POST',headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'},body:JSON.stringify({function_name:'analisar-funil-conversas',modelo,input_tokens:d.usage?.input_tokens||0,output_tokens:d.usage?.output_tokens||0})}).catch(()=>{});
  }
  bruto.convites=[...(bruto.convites||[]),...convitesDeterministicos(c)];
  const resultado=validarAnalise(c,bruto);
  return await rpc('concluir_conversa_funil',{p_filial:c.filial,p_pessoa:c.pessoa,p_versao:c.versao,p_resultado:resultado,p_modelo:c.mensagens.some((m:any)=>m.direcao==='entrada')?modelo:'regra-sem-resposta-v1'});
 } catch(e) {
  await rpc('concluir_conversa_funil',{p_filial:c.filial,p_pessoa:c.pessoa,p_versao:c.versao,p_resultado:null,p_modelo:modelo,p_erro:String(e?.message||e)});
  return false;
 }
}
Deno.serve(async(req)=>{
 if(req.method!=='POST')return new Response('Método não permitido',{status:405});
 // Chave própria do trabalhador, armazenada no Vault e nos secrets, nunca no navegador.
 if(!Deno.env.get('FUNIL_ANALISE_TOKEN') || req.headers.get('x-funil-token')!==Deno.env.get('FUNIL_ANALISE_TOKEN'))return new Response('Não autorizado',{status:401});
 const inicio=Date.now();let concluidas=0,executadas=0;
 while(Date.now()-inicio<35000 && executadas<100) {
  const lote=[];for(let i=0;i<3;i++){const c=await rpc('assumir_conversa_funil');if(c)lote.push(c);}
  if(!lote.length)break;
  const resultados=await Promise.all(lote.map(processar));executadas+=lote.length;concluidas+=resultados.filter(Boolean).length;
 }
 return Response.json({executadas,concluidas});
});

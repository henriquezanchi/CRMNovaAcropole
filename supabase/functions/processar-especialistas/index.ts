import {supabaseAdmin as db} from '../_shared/supabaseAdmin.ts';
import {prepararAgente} from '../_shared/agentes-crm.ts';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Método não permitido',{status:405});
 const token=Deno.env.get('FUNIL_ANALISE_TOKEN');if(!token||req.headers.get('x-funil-token')!==token)return new Response('Não autorizado',{status:401});
 const inicio=Date.now();let concluidas=0,adiadas=0;
 while(Date.now()-inicio<40000&&concluidas+adiadas<40){
  const {data:c,error}=await db.rpc('crm_proxima_qualificacao');if(error)return Response.json({erro:'fila_indisponivel'},{status:503});if(!c)break;
  try{await prepararAgente(c.pessoa,c.filial,c.ultima,false);concluidas++;}
  catch(e){adiadas++;if(/orcamento|ocupado|aguardar|indisponivel|HTTP (401|402|403|429)/.test(String(e)))break;}
 }
 return Response.json({concluidas,adiadas});
});

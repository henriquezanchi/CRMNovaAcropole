import {supabaseAdmin as db} from '../_shared/supabaseAdmin.ts';
import {validarURLAudio,lerAudioLimitado}from '../_shared/audio-crm.mjs';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Método não permitido',{status:405});
 const token=Deno.env.get('FUNIL_ANALISE_TOKEN');if(!token||req.headers.get('x-funil-token')!==token)return new Response('Não autorizado',{status:401});
 const chave=Deno.env.get('OPENAI_API_KEY');
 await db.from('crm_ia_config').update({transcricao_disponivel:Boolean(chave)}).eq('id',true);
 if(!chave)return Response.json({processadas:0,pendencia:'Configurar OPENAI_API_KEY no Supabase para habilitar a transcrição.'});
 const {data:t,error}=await db.rpc('crm_assumir_audio');if(error)return Response.json({erro:'fila_audio_indisponivel'},{status:503});if(!t)return Response.json({processadas:0});
 const modelo='gpt-4o-mini-transcribe';
 try{
  const url=validarURLAudio(t.url,Deno.env.get('SUPABASE_URL'));
  const resposta=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
  const blob=await lerAudioLimitado(resposta,Math.min(t.limite_bytes,12000000));
  const extensao=new URL(url).pathname.split('.').pop()?.split(';')[0]||'ogg';
  const form=new FormData();form.append('file',blob,'audio.'+extensao);form.append('model',modelo);form.append('language','pt');
  const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+chave},body:form,signal:AbortSignal.timeout(45000)});
  if(!r.ok)throw new Error('provedor_transcricao_http_'+r.status);
  const resultado=await r.json();if(typeof resultado.text!=='string'||!resultado.text.trim())throw new Error('transcricao_sem_texto');
  if(resultado.usage?.type==='tokens')await db.from('ia_uso_tokens').insert({function_name:'agente-transcricao-audio',modelo,input_tokens:resultado.usage.input_tokens||0,output_tokens:resultado.usage.output_tokens||0});
  const {data:ok,error}=await db.rpc('crm_concluir_audio',{p_id:t.id,p_assinatura:t.assinatura,p_lease:t.lease,p_texto:resultado.text,p_modelo:modelo,p_bytes:blob.size});
  if(error)throw new Error('registro_transcricao_indisponivel');
  return Response.json({processadas:ok?1:0});
 }catch(e){
  const codigo=String((e as Error).message||'falha_transcricao');
  const seguro=/^(origem_audio_invalida|download_audio_indisponivel|audio_acima_limite|audio_vazio|provedor_transcricao_http_\d+|transcricao_sem_texto|registro_transcricao_indisponivel)$/.test(codigo)?codigo:'falha_transcricao';
  await db.rpc('crm_concluir_audio',{p_id:t.id,p_assinatura:t.assinatura,p_lease:t.lease,p_texto:null,p_modelo:modelo,p_bytes:0,p_erro:seguro});
  return Response.json({processadas:0,erro:seguro});
 }
});

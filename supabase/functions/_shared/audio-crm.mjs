export function validarURLAudio(valor,base){
 const url=new URL(valor),raiz=new URL(base);
 if(url.origin!==raiz.origin||url.protocol!=='https:'||url.username||url.password||!url.pathname.startsWith('/storage/v1/object/public/whatsapp-midia/entrada/'))throw new Error('origem_audio_invalida');
 return url.href;
}
export async function lerAudioLimitado(resposta,limite){
 if(!resposta.ok)throw new Error('download_audio_indisponivel');
 if(Number(resposta.headers.get('content-length')||0)>limite)throw new Error('audio_acima_limite');
 const reader=resposta.body?.getReader();if(!reader)throw new Error('audio_vazio');
 const blocos=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limite)throw new Error('audio_acima_limite');blocos.push(value);}}finally{await reader.cancel().catch(()=>{});}
 if(!total)throw new Error('audio_vazio');
 return new Blob(blocos,{type:resposta.headers.get('content-type')||'application/octet-stream'});
}

export async function enriquecerTranscricoes(db:any,mensagens:any[]) {
 const ids=mensagens.filter(m=>m.tipo==='audio').map(m=>m.id);if(!ids.length)return mensagens;
 const mapa=new Map<string,string>();
 for(let i=0;i<ids.length;i+=500){
  const {data,error}=await db.rpc('crm_transcricoes_validas',{p_ids:ids.slice(i,i+500)});
  if(error)throw new Error('transcricoes_indisponiveis');
  for(const r of data||[])mapa.set(String(r.id),r.texto);
 }
 return mensagens.map(m=>mapa.has(String(m.id))?{...m,tipo:'texto',origem_tipo:'audio',fonte:'transcricao_automatica',corpo_texto:mapa.get(String(m.id)),texto:mapa.get(String(m.id))}:m);
}

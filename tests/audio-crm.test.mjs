import{test}from'node:test';import assert from'node:assert/strict';import{validarURLAudio,lerAudioLimitado}from'../supabase/functions/_shared/audio-crm.mjs';
test('somente áudio da pasta de entrada do próprio Storage pode ser baixado',()=>{
 const base='https://projeto.supabase.co',url=base+'/storage/v1/object/public/whatsapp-midia/entrada/a.ogg';assert.equal(validarURLAudio(url,base),url);
 for(const u of ['https://evil.test/a.ogg','http://projeto.supabase.co/a.ogg',base+'/storage/v1/object/public/outro/a.ogg','https://user:pass@projeto.supabase.co/storage/v1/object/public/whatsapp-midia/entrada/a.ogg'])assert.throws(()=>validarURLAudio(u,base));
});
test('download tem limite real de bytes mesmo sem Content-Length',async()=>{
 assert.equal((await lerAudioLimitado(new Response(new Uint8Array([1,2,3])),3)).size,3);
 await assert.rejects(lerAudioLimitado(new Response(new Uint8Array([1,2,3,4])),3),/limite/);
 await assert.rejects(lerAudioLimitado(new Response(new Uint8Array([1]),{headers:{'content-length':'100'}}),3),/limite/);
 await assert.rejects(lerAudioLimitado(new Response('erro',{status:500}),3),/indisponivel/);
});

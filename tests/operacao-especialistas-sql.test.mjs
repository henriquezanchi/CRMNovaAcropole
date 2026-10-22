import {test}from'node:test';import assert from'node:assert/strict';import {readFile}from'node:fs/promises';
test('fila histórica, cache, orçamento, versões, áudio e passagens têm escopo e escrita privada',async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table leads_inscricoes("pessoaIdentificador" text primary key,"pessoaNome" text,filial text,tags jsonb default '"[]"',acompanhamento jsonb default '{}',lixeira_em timestamptz);
 create table mensagens_whatsapp(id bigint primary key,"pessoaIdentificador" text,filial text,direcao text,tipo text,corpo_texto text,payload_bruto jsonb default '{}');
 create table funil_analises_conversa(filial text,pessoa text,versao bigint default 1,estado text,atualizado_em timestamptz);
 create table ia_uso_tokens(criado_em timestamptz,function_name text,modelo text,input_tokens int,output_tokens int,cache_read_input_tokens int,cache_creation_input_tokens int);
 create function fatos_funil_interacoes(timestamptz,timestamptz,text)returns table(filial text,pessoa text,inscricao boolean,presenca boolean,matricula boolean)language sql as $$select 'A','p',true,false,false$$;
 insert into leads_inscricoes("pessoaIdentificador","pessoaNome",filial)values('p','Pessoa A','A'),('b','Pessoa B','B');
 insert into mensagens_whatsapp values(1,'p','A','entrada','texto','Qual valor?','{}');
 insert into funil_analises_conversa(filial,pessoa)values('A','p');`);
 await db.exec(await readFile('migracao_operacao_especialistas.sql','utf8'));
 const claim=async(chars=10)=>(await db.query(`select crm_assumir_qualificacao('A','p',(select max(id)from mensagens_whatsapp where filial='A'),$1,'v2')r`,[chars])).rows[0].r;
 const fim=async(c,result={etapa:'informacoes',evidencia:{mensagem_id:1,trecho:'Qual valor?'}})=>(await db.query(`select crm_concluir_qualificacao('A','p',$1,$2,1,'v2',$3)ok`,[c.versao,c.lease,result])).rows[0].ok;
 const c=await claim();assert.equal(c.estado,'assumido');assert.equal((await claim()).estado,'ocupado');assert.equal(await fim(c),true);
 assert.equal((await claim()).estado,'cache');assert.equal((await db.query('select caracteres from crm_ia_orcamento')).rows[0].caracteres,10);
 assert.equal((await db.query('select count(*)::int n from crm_passagens_agente')).rows[0].n,1);
 await db.exec(`update mensagens_whatsapp set corpo_texto='Quero entrar no curso'where id=1;`);
 const c2=await claim();await db.exec(`update mensagens_whatsapp set corpo_texto='Desisti'where id=1;`);assert.equal(await fim(c2),false);
 await db.exec('update crm_ia_config set limite_caracteres_dia=20');assert.equal((await claim(100)).estado,'orcamento');
 await db.exec(`insert into mensagens_whatsapp values(2,'p','A','entrada','audio','[Áudio recebido]','{"audio_url":"https://example.test/audio.ogg"}');`);
 assert.equal((await db.query('select crm_assumir_audio()r')).rows[0].r,null);
 await db.exec('update crm_ia_config set transcricao_disponivel=true');const audio=(await db.query('select crm_assumir_audio()r')).rows[0].r;assert.equal(audio.id,2);
 const concluir=async()=>(await db.query(`select crm_concluir_audio(2,$1,$2,'Quero entrar no curso','teste',2000)ok`,[audio.assinatura,audio.lease])).rows[0].ok;
 assert.equal(await concluir(),true);assert.equal(await concluir(),false);
 assert.equal((await db.query('select * from crm_transcricoes_validas(array[2::bigint])')).rows[0].texto,'Quero entrar no curso');
 assert.equal((await db.query(`select estado from funil_analises_conversa where filial='A'`)).rows[0].estado,'pendente');
 await db.exec(`update mensagens_whatsapp set payload_bruto='{"audio_url":"https://example.test/novo.ogg"}'where id=2;`);
 assert.equal((await db.query('select * from crm_transcricoes_validas(array[2::bigint])')).rows.length,0);
 const painel=(await db.query(`select painel_especialistas_crm('A')r`)).rows[0].r;assert.equal(painel.itens.length,1);assert.equal(painel.itens[0].pessoa,'p');


 await db.exec(`insert into ia_uso_tokens values(now(),'agente-teste','claude-haiku-4-5-20251001',1000000,1000000,1000000,1000000);`);
 const custo=(await db.query('select consumo_especialistas_crm(30)r')).rows[0].r[0];assert.equal(Number(custo.usd_estimado),7.35);
 await db.exec(await readFile('migracao_ciclo_vida_especialistas.sql','utf8'));
 await db.exec(`insert into leads_inscricoes("pessoaIdentificador","pessoaNome",filial)values('novo','Novo cadastro','A');`);
 assert.equal((await db.query(`select estado from crm_qualificacoes where pessoa='novo'`)).rows[0].estado,'concluido');
 await db.exec(`delete from leads_inscricoes where "pessoaIdentificador"='p';`);
 assert.equal((await db.query(`select count(*)::int n from crm_qualificacoes where pessoa='p'`)).rows[0].n,0);
 assert.equal((await db.query(`select count(*)::int n from crm_passagens_agente where pessoa='p'`)).rows[0].n,0);
 assert.equal((await db.query(`select count(*)::int n from crm_audio_transcricoes where mensagem_id=2`)).rows[0].n,0);
 assert.equal((await db.query(`select has_function_privilege('anon','crm_assumir_audio()','execute')ok`)).rows[0].ok,false);
 assert.equal((await db.query(`select has_function_privilege('anon','crm_assumir_qualificacao(text,text,bigint,int,text)','execute')ok`)).rows[0].ok,false);
 }finally{await db.close();}
});

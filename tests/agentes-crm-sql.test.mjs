import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('publicação atômica evita duplicação, histórico obsoleto e mistura de filial; registra bloqueio',async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table leads_inscricoes("pessoaIdentificador" text primary key,filial text,tags jsonb default '"[]"',acompanhamento jsonb,lixeira_em timestamptz,ia_sugestao_resposta boolean);
 create table mensagens_whatsapp(id bigint primary key,"pessoaIdentificador" text,filial text,direcao text,tipo text,corpo_texto text,criado_em timestamptz default now());
 create table filiais(nome text,ia_sugestao_resposta_habilitada boolean);insert into filiais values('A',true),('B',true);
 create table eventos(id bigint primary key,nome text,filial text,data date);
 create table evento_leads("pessoaIdentificador" text,evento_id bigint,resposta_convite text);
 create table sugestoes_resposta_wpp(id bigint generated always as identity primary key,"pessoaIdentificador" text,mensagem_origem_id bigint unique,sugestao_resposta text,lembrete_sugerido_data date,lembrete_sugerido_motivo text,status text default 'pendente');
 create table classificacoes_resposta_convite(id bigint generated always as identity primary key,"pessoaIdentificador" text,mensagem_origem_id bigint unique,evento_id bigint,categoria text,sugestao_resposta text,lembrete_sugerido_data date,lembrete_sugerido_motivo text,status text default 'pendente');
 insert into leads_inscricoes("pessoaIdentificador",filial)values('p','A');
 insert into mensagens_whatsapp(id,"pessoaIdentificador",filial,direcao,tipo,corpo_texto)values(1,'p','A','entrada','texto','Qual o valor?');
 insert into eventos values(10,'Palestra','A',current_date),(20,'Outro evento','B',current_date);
 insert into evento_leads values('p',10,'pendente');`);
 await db.exec(await readFile('migracao_agentes_especializados_crm.sql','utf8'));
 const salvar=async(tipo,id,extra={})=>(await db.query('select registrar_rascunho_agente($1,$2,$3,$4) ok',[tipo,'p',id,{sugestao_resposta:'Rascunho',categoria:'pediu_informacao',evento_id:10,agente_ia:{agente:'informacoes'},...extra}])).rows[0].ok;
 assert.equal((await db.query('select * from mensagens_candidatas_sugestao_resposta(30)')).rows.length,1);
 assert.equal(await salvar('convite',1,{evento_id:20}),false);
 assert.equal(await salvar('geral',1),true);assert.equal(await salvar('convite',1),false);
 await db.exec(`insert into mensagens_whatsapp(id,"pessoaIdentificador",filial,direcao,tipo,corpo_texto)values(2,'p','A','entrada','texto','Onde fica?'),(3,'p','A','entrada','texto','Não me contate mais');`);
 assert.equal(await salvar('geral',2),false);
 assert.deepEqual((await db.query('select mensagem_id from mensagens_candidatas_sugestao_resposta(30)')).rows.map(r=>Number(r.mensagem_id)),[3]);
 assert.equal(await salvar('convite',3,{agente_ia:{bloqueado:true,qualificacao:{restricao:{tipo:'nao_contatar'}}},sugestao_resposta:null}),true);
 assert.equal((await db.query('select status from sugestoes_resposta_wpp')).rows[0].status,'descartada');
 assert.ok(JSON.parse((await db.query('select tags from leads_inscricoes')).rows[0].tags).includes('Não Contatar'));
 await db.exec(`insert into mensagens_whatsapp(id,"pessoaIdentificador",filial,direcao,tipo,corpo_texto)values(4,'p','B','entrada','texto','Olá');`);
 assert.equal(await salvar('geral',4),false);
 assert.equal((await db.query(`select has_function_privilege('anon','registrar_rascunho_agente(text,text,bigint,jsonb)','execute') ok`)).rows[0].ok,false);
 }finally{await db.close();}
});

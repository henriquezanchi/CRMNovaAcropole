import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
let PGlite;try{({PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite'));}catch{}
test('interação nova reclassifica snapshot, recusa altera funil e resultado antigo não sobrescreve o novo', {skip:!PGlite},async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table mensagens_whatsapp(id bigint primary key,"pessoaIdentificador" text,filial text,direcao text,wa_status text,wa_message_id text,importado_manualmente boolean,criado_em timestamptz,corpo_texto text,tipo text);
 create table filiais(nome text,ativo boolean);create table eventos(id bigint primary key,filial text,nome text,data date,link_inscricao text);
 create table leads_inscricoes("pessoaIdentificador" text primary key,"pessoaNome" text,filial text,matricula_mercurio int,data_matricula date,data_matricula_verificada_mercurio_em timestamptz,historico_eventos jsonb);
 create table mercurio_alunos(matricula int,filial text,pessoa_identificador text,data_efetiva date,visto_em timestamptz);
 create table evento_leads(evento_id bigint,"pessoaIdentificador" text,origem text,compareceu boolean);
 create table log_atividade(id bigserial,filial text,acao text,autor text,pessoa_ids jsonb,detalhes jsonb);`);
 for(const f of ['migracao_funil_interacoes_objetivo.sql','migracao_funil_automatico.sql','migracao_relatorio_funil_automatico.sql'])await db.exec(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'));
 await db.exec(`insert into eventos values(1,'A','Aula',current_date,'https://example.test/1');insert into evento_leads values(1,'p','ulisses',true);
 insert into mensagens_whatsapp values(1,'p','A','saida','lido','w1',false,now()-interval '1 hour','Quer se inscrever na Aula?','texto'),(2,'p','A','entrada','entregue','w2',false,now(),'Vou me inscrever','texto');`);
 let c=(await db.query('select assumir_conversa_funil() c')).rows[0].c;
 const resultado={respostas:[{mensagem_id:2,classe:'inscricao',trecho:'Vou me inscrever',evento_id:1}],continuidade:{aceitou:true,mensagem_id:2,trecho:'Vou me inscrever'},intencao:{pretende:true,mensagem_id:2,trecho:'Vou me inscrever',evento_id:1},convites:[{mensagem_id:1,evento_id:1}]};
 const salvar=async(v,r)=>(await db.query(`select concluir_conversa_funil('A','p',$1,$2,'teste',null) ok`,[v,r])).rows[0].ok;
 assert.equal(await salvar(c.versao,resultado),true);
 const rel=async()=>(await db.query(`select relatorio_funil_interacoes(now()-interval '2 days',now()+interval '1 day',null) r`)).rows[0].r.find(x=>x.total);
 let r=await rel();assert.equal(r.validas,1);assert.equal(r.aceitaram,1);assert.equal(r.intencoes,1);assert.equal(r.inscritos,1);assert.equal(r.presentes,1);assert.equal(r.pendentes,0);
 await db.exec(`insert into mensagens_whatsapp values(3,'p','A','entrada','entregue','w3',false,now(),'Desisti, não quero mais informações','texto');`);
 assert.equal((await rel()).pendentes,1);assert.equal(await salvar(c.versao,resultado),false);
 c=(await db.query('select assumir_conversa_funil() c')).rows[0].c;
 resultado.respostas.push({mensagem_id:3,classe:'recusa',trecho:'Desisti',evento_id:null});resultado.continuidade={aceitou:false,mensagem_id:3,trecho:'Desisti'};resultado.intencao={pretende:false,mensagem_id:3,trecho:'Desisti'};
 assert.equal(await salvar(c.versao,resultado),true);r=await rel();assert.equal(r.validas,1);assert.equal(r.aceitaram,0);assert.equal(r.intencoes,0);assert.equal(r.inscritos,1);assert.equal(r.pendentes,0);
 assert.equal((await db.query('select count(*)::int n from log_atividade')).rows[0].n,2);
 await db.exec(`update mensagens_whatsapp set wa_status='entregue' where id=1`);
 assert.equal((await rel()).pendentes,0); // recibo de leitura/entrega não muda a conversa
 assert.equal(await salvar(c.versao,resultado),true);
 assert.equal((await db.query('select count(*)::int n from log_atividade')).rows[0].n,2); // idempotência

 await db.close();
});

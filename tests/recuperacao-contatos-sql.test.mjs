import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('recuperação preserva originais, separa eventos duvidosos, corrige pela fonte e recusa concorrência ou conversa vinculada',async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table leads_inscricoes("pessoaIdentificador" text primary key,"pessoaNome" text,filial text,"pessoaTelefoneDDD" text,"pessoaTelefoneNumero" text,"pessoaEmail" text,matricula_mercurio bigint,historico_eventos jsonb,tags jsonb,"eventoNome" text,"eventoData" text);
 create table crm_leads_mesclados(original text,destino text);create table auditoria_contatos_fontes(pessoa text primary key,consultado_em timestamptz default now(),cadastro_antes jsonb,fontes jsonb);
 create table auditoria_crm_fonte(nome text,email text);create table mensagens_whatsapp("pessoaIdentificador" text);create table tarefa_leads("pessoaIdentificador" text);create table cobranca_itens(pessoa_identificador text);
 create table filiais(nome text,mercurio_unidade text);insert into filiais values('A','A'),('B','B');
 create table evento_leads(id int primary key,"pessoaIdentificador" text,evento_id int,compareceu bool);create table auditoria_crm_backup(id bigint generated always as identity primary key,sobrevivente text,origem text,registros jsonb);
 create table auditoria_crm_pendencias(execucao text,filial text,pessoas_ids jsonb,motivo text,evidencias jsonb,estado text default 'pendente');create table auditoria_crm_execucoes(id text,criado_em timestamptz);insert into auditoria_crm_execucoes values('teste',now());
 create table log_atividade(acao text,autor text,filial text,pessoa_ids jsonb,detalhes jsonb);
 insert into leads_inscricoes values('1','Tatiana Silva Borges','A','62','999998888','tatiana@example.test',10,'[{"evento":"Palestra"}]','"[\\"Inativo\\"]"','','');
 insert into leads_inscricoes values('990000040','Bárbara Guedes Cortez','A','62','999998888','tatiana@example.test',20,'[{"evento":"Palestra"}]','"[\\"Inativo\\",\\"Retorno: Só 1 Evento\\"]"','','');
 insert into auditoria_crm_fonte values('Tatiana Silva Borges','tatiana@example.test');insert into evento_leads values(1,'990000040',3,true);
 insert into auditoria_contatos_fontes(pessoa,cadastro_antes,fontes) select "pessoaIdentificador",jsonb_build_object('pessoaIdentificador',"pessoaIdentificador",'pessoaNome',"pessoaNome",'filial',filial,'pessoaTelefoneDDD',"pessoaTelefoneDDD",'pessoaTelefoneNumero',"pessoaTelefoneNumero",'pessoaEmail',"pessoaEmail",'matricula_mercurio',matricula_mercurio),'[{"cad_matr":"20","cad_nome":"Bárbara Guedes Cortez","cad_email":"barbara@example.test","cad_unidade":"B","cad_res_ddd":"61","cad_res_fone":"988887777"}]' from leads_inscricoes where "pessoaIdentificador"='990000040';`);
 await db.exec(await readFile('migracao_recuperacao_contatos_crm.sql','utf8'));
 await db.query(`select recuperar_contato_crm('990000040','mistura')`);
 let r=(await db.query(`select * from leads_inscricoes where "pessoaIdentificador"='990000040'`)).rows[0];
 assert.equal(r.filial,'B');assert.equal(r.pessoaTelefoneDDD,'61');assert.equal(r.pessoaTelefoneNumero,'988887777');assert.equal(r.pessoaEmail,'barbara@example.test');assert.deepEqual(r.historico_eventos,[]);
 assert.equal((await db.query('select * from evento_leads')).rows.length,0);let b=(await db.query('select registros from auditoria_crm_backup')).rows[0].registros;assert.equal(b.lead.pessoaEmail,'tatiana@example.test');assert.equal(b.evento_leads.length,1);
 assert.equal((await db.query('select historico_em_conferencia from auditoria_contatos_correcoes')).rows[0].historico_em_conferencia.length,1);
 assert.equal((await db.query(`select painel_recuperacao_contatos(null,'',null) r`)).rows[0].r.contatos,1);
 assert.equal((await db.query(`select recuperar_contato_crm('990000040','mistura') r`)).rows[0].r.estado,'ja_recuperado');
 await db.exec(`insert into leads_inscricoes values('2','Ana Lima','B','62','999991234','ana@example.test',30,'[]','[]','','');insert into auditoria_contatos_fontes(pessoa,cadastro_antes,fontes) select "pessoaIdentificador",jsonb_build_object('pessoaIdentificador',"pessoaIdentificador",'pessoaNome',"pessoaNome",'filial',filial,'pessoaTelefoneDDD',"pessoaTelefoneDDD",'pessoaTelefoneNumero',"pessoaTelefoneNumero",'pessoaEmail',"pessoaEmail",'matricula_mercurio',matricula_mercurio),'[{"cad_matr":"30","cad_nome":"Ana Lima","cad_email":"ana@example.test","cad_res_ddd":"66","cad_res_fone":"999991234"}]' from leads_inscricoes where "pessoaIdentificador"='2';update leads_inscricoes set "pessoaEmail"='nova@example.test' where "pessoaIdentificador"='2';`);
 await assert.rejects(db.query(`select recuperar_contato_crm('2','ddd')`),/alterado/);
 await db.exec(`update leads_inscricoes set "pessoaEmail"='ana@example.test' where "pessoaIdentificador"='2';`);await db.query(`select recuperar_contato_crm('2','ddd')`);assert.equal((await db.query(`select "pessoaTelefoneDDD" d from leads_inscricoes where "pessoaIdentificador"='2'`)).rows[0].d,'66');
 // A recuperação de DDD não remove histórico nem altera a escola.
 assert.equal((await db.query(`select count(*) c from auditoria_crm_backup`)).rows[0].c,2);
 }finally{await db.close();}
});

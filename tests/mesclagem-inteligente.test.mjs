import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const sql=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('decisão oficial, contatos divergentes, bloqueios, simulação e preservação transacional',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table leads_inscricoes("pessoaIdentificador" text primary key,"pessoaNome" text,filial text,"pessoaTelefoneDDD" text,"pessoaTelefoneNumero" text,"pessoaEmail" text,tags jsonb,historico_eventos jsonb,"eventoNome" text,"eventoData" text,resumo_ia text,matricula_mercurio int,acompanhamento jsonb,lixeira_em timestamptz,data_nascimento text,data_matricula text,data_saida text,motivo_saida text,unique(filial,matricula_mercurio));
 create table mensagens_whatsapp(id int primary key,"pessoaIdentificador" text,filial text);
 create table evento_leads(id int primary key,evento_id int,"pessoaIdentificador" text,origem text,compareceu boolean,matriculado boolean,resposta_convite text,atualizado_em timestamptz,nota text,unique(evento_id,"pessoaIdentificador"));
 create table tarefa_leads(id int primary key,tarefa_id int,"pessoaIdentificador" text,concluida boolean,concluida_em timestamptz,unique(tarefa_id,"pessoaIdentificador"));
 create table funil_analises_conversa(filial text,pessoa text,versao bigint default 1,estado text default 'pendente',atualizado_em timestamptz default now(),primary key(filial,pessoa));
 create table leads_a_tratar(pessoa_id text);create table log_atividade(id bigserial,filial text,acao text,autor text,pessoa_ids jsonb,detalhes jsonb);`);
 for(const f of ['migracao_auditoria_base_crm.sql','migracao_mesclagem_preservar_vinculos.sql','migracao_painel_auditoria_crm.sql','migracao_mesclagem_inteligente.sql'])await db.exec(sql(f));
 // Migração repetível.
 await db.exec(sql('migracao_mesclagem_inteligente.sql'));
 const comp=async(a,b)=>(await db.query('select nomes_seguros_mesclagem($1,$2) r',[a,b])).rows[0].r;
 assert.equal(await comp('Tatiane Lagoa','TATIANE BARBOSA LAGOA'),true);
 assert.equal(await comp('Carlos Teles','CARLOS ALBERTO OLIVEIRA TELES'),true);
 for(const [a,b] of [['Maria','Maria Silva'],['Ana Silva','Ana Paula Silva Junior'],['Carlos Teles','Carla Teles'],['João Silva','João Pedro Souza'],['Maria Ana Silva','Maria Paula Silva'],['Ana Silva','Silva Ana']])assert.equal(await comp(a,b),false,`${a}/${b}`);
 const exec=(await db.query('insert into auditoria_crm_execucoes(fonte_completa) values(true) returning id')).rows[0].id;
 await db.query(`insert into auditoria_crm_fonte(execucao,matricula,unidade,nome,email) values($1,42633,'GY2','TATIANE BARBOSA LAGOA','tatilagoa@example.test')`,[exec]);
 const lead=async(id,nome,email,tel,mat,tags=[],extra={})=>{
  const l={pessoaIdentificador:id,pessoaNome:nome,filial:'Goiânia II',pessoaEmail:email,pessoaTelefoneDDD:'62',pessoaTelefoneNumero:tel,matricula_mercurio:mat,tags:JSON.stringify(tags),historico_eventos:[],...extra};
  await db.query(`insert into leads_inscricoes select * from jsonb_populate_record(null::leads_inscricoes,$1)`,[l]);
 };
 await lead('477646','TATIANE LAGOA','tatilagoa@example.test','992856139',null,['Inativo'],{historico_eventos:[{evento:'Evento A',data:'2024-08-07'}]});
 await lead('990000066','TATIANE BARBOSA LAGOA','outro@example.test','996552086',42633,['Inativo','Retorno: Só 1 Evento'],{historico_eventos:[{evento:'Evento B',data:'2024-06-06'}],data_matricula:'2024-09-25',data_nascimento:'1995-07-24',acompanhamento:{contato:'nao_contatar'}});
 const avaliar=async(ids)=>(await db.query('select avaliar_mesclagem_inteligente($1) r',[ids])).rows[0].r;
 const ids=['477646','990000066'];
 assert.equal((await avaliar(ids)).regra,'identidade_oficial_confirmada');
 await db.query('insert into auditoria_crm_pendencias(execucao,filial,pessoas_ids,motivo) values($1,$2,$3,$4)',[exec,'Goiânia II',ids,'Mesma matrícula']);
 await db.exec(`insert into mensagens_whatsapp values(1,'990000066','Goiânia II');insert into evento_leads values(1,10,'990000066','ulisses',true,false,'confirmado',now(),null);insert into tarefa_leads values(1,20,'990000066',true,now());`);
 const sim=(await db.query('select processar_mesclagens_inteligentes(false,100) r')).rows[0].r;
 assert.equal(sim.total,1);assert.equal((await db.query('select count(*)::int n from leads_inscricoes')).rows[0].n,2);
 await db.query(`update leads_inscricoes set tags=$1 where "pessoaIdentificador"='990000066'`,[JSON.stringify(['Histórico em conferência'])]);
 assert.equal((await avaliar(ids)).elegivel,false);
 await db.query(`update leads_inscricoes set tags=$1 where "pessoaIdentificador"='990000066'`,[JSON.stringify(['Inativo'])]);
 await db.query(`update leads_inscricoes set "pessoaEmail"='semprova@example.test' where "pessoaIdentificador"='477646'`);
 assert.equal((await avaliar(ids)).elegivel,false);
 await db.query(`update leads_inscricoes set "pessoaEmail"='tatilagoa@example.test' where "pessoaIdentificador"='477646'`);
 const run=(await db.query('select processar_mesclagens_inteligentes(true,100) r')).rows[0].r;
 assert.equal(run.total,1,JSON.stringify(run));
 const l=(await db.query('select * from leads_inscricoes')).rows[0];
 assert.equal(l.pessoaIdentificador,'477646');assert.equal(l.pessoaNome,'TATIANE BARBOSA LAGOA');assert.equal(l.matricula_mercurio,42633);assert.equal(l.historico_eventos.length,2);assert.equal(l.data_nascimento,'1995-07-24');assert.equal(l.acompanhamento.contato,'nao_contatar');assert.match(l.resumo_ia,/outro@example.test/);assert.match(l.resumo_ia,/996552086/);
 for(const table of ['mensagens_whatsapp','evento_leads','tarefa_leads'])assert.equal((await db.query(`select "pessoaIdentificador" id from ${table}`)).rows[0].id,'477646');
 assert.equal((await db.query('select count(*)::int n from auditoria_crm_backup')).rows[0].n,1);
 assert.equal((await db.query('select processar_mesclagens_inteligentes(true,100) r')).rows[0].r.total,0);
 // Mesmo telefone e e-mail, sem presumir identidade de familiar.
 await lead('10','Carlos Teles','ct@example.test','992911138',null);
 await lead('11','Carlos Alberto Oliveira Teles','ct@example.test','992911138',null,['Histórico em conferência']);
 assert.equal((await avaliar(['10','11'])).elegivel,false);
 await db.exec(`update leads_inscricoes set tags='"[]"' where "pessoaIdentificador"='11'`);
 assert.equal((await avaliar(['10','11'])).regra,'nome_telefone_email');
 await lead('12','Carla Teles','ct@example.test','992911138',null);
 assert.equal((await avaliar(['10','11'])).elegivel,false);
 await db.exec(`delete from leads_inscricoes where "pessoaIdentificador"='12';update leads_inscricoes set matricula_mercurio=123 where "pessoaIdentificador"='10';update leads_inscricoes set matricula_mercurio=456 where "pessoaIdentificador"='11'`);
 assert.equal((await avaliar(['10','11'])).elegivel,false);
 await db.exec(`update leads_inscricoes set matricula_mercurio=null where "pessoaIdentificador" in ('10','11');update leads_inscricoes set filial='Outra' where "pessoaIdentificador"='11'`);
 assert.equal((await avaliar(['10','11'])).elegivel,false);
 await db.exec(`update leads_inscricoes set filial='Goiânia II' where "pessoaIdentificador"='11'`);
 await db.query(`insert into auditoria_crm_pendencias(execucao,pessoas_ids,motivo,estado) values($1,$2,'Não são duplicados','descartada')`,[exec,['10','11']]);
 assert.equal((await avaliar(['10','11'])).elegivel,false);
 }finally{await db.close();}
});

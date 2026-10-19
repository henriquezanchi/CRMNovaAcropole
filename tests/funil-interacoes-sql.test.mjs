import { test } from 'node:test';
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')); } catch { /* Teste opcional: requer PGlite, sem dependência de runtime no CRM. */ }
import fs from 'node:fs';
import assert from 'node:assert/strict';
test('funil SQL agrega fatos, deduplica pessoas e audita revisões', { skip: !PGlite }, async () => {
const db = new PGlite();
await db.exec(`create table mensagens_whatsapp(id bigint primary key,"pessoaIdentificador" text,filial text,direcao text,wa_status text,wa_message_id text,importado_manualmente boolean,criado_em timestamptz,corpo_texto text,tipo text);
create table filiais(nome text,ativo boolean);
create table eventos(id bigint primary key,filial text,nome text,data date);
create table leads_inscricoes("pessoaIdentificador" text primary key,"pessoaNome" text,filial text,matricula_mercurio int,data_matricula date,data_matricula_verificada_mercurio_em timestamptz);
create table mercurio_alunos(matricula int,filial text,pessoa_identificador text,data_efetiva date,visto_em timestamptz);
create table evento_leads(evento_id bigint,"pessoaIdentificador" text,origem text,compareceu boolean);
create table log_atividade(id bigserial,filial text,acao text,autor text,pessoa_ids jsonb,detalhes jsonb);`);
await db.exec(fs.readFileSync(new URL('../migracao_funil_interacoes_objetivo.sql',import.meta.url),'utf8'));
const now = new Date(), before = new Date(now-86400000), start=new Date(now-172800000);
const d=now.toISOString().slice(0,10);
await db.query(`insert into eventos values(1,'A','Aula',$1)`,[d]);
await db.query(`insert into leads_inscricoes values('p1','Pessoa','A',10,$1,now())`,[d]);
await db.query(`insert into mensagens_whatsapp values
(1,'p1','A','saida','lido','w1',false,$1,'convite','texto'),
(2,'p1','A','saida','entregue','w2',false,$1,'oi','texto'),
(3,'p1','A','entrada','entregue','w3',false,now(),'quero me inscrever','texto'),
(4,'p2','A','saida','falhou','w4',false,$1,'erro','texto'),
(5,'p3','A','saida','lido','w5',true,$1,'importada','texto'),
(6,'p4','A','saida','reenviada','w6',false,$1,'substituída','texto'),
(7,'p1','B','saida','enviado','w7',false,$1,'olá','texto'),
(8,'p1','A','entrada','entregue','w8',false,$2,'antiga','texto')`,[before.toISOString(),new Date(now-259200000).toISOString()]);
await db.exec(`insert into evento_leads values(1,'p1','crm',false)`);
const report=async()=> (await db.query(`select relatorio_funil_interacoes($1,$2,null) r`,[start.toISOString(),new Date(+now+86400000).toISOString()])).rows[0].r;
let r=await report(),t=r.find(x=>x.total);
assert.equal(t.mensagens,3);assert.equal(t.contatados,1);assert.equal(t.responderam,1);assert.equal(t.validas,0);assert.equal(t.pendentes,1);assert.equal(t.inscritos,0);assert.equal(t.matriculados,1);
await db.query(`select registrar_resposta_funil(3,'inscricao',1,'Atendente')`);
r=await report();t=r.find(x=>x.total);assert.equal(t.validas,1);assert.equal(t.aceitaram,1);assert.equal(t.intencoes,1);assert.equal(t.inscritos,0);assert.equal(t.presentes,0);assert.equal(t.pendentes,0);
await db.exec(`update evento_leads set origem='ulisses',compareceu=true`);
r=await report();t=r.find(x=>x.total);assert.equal(t.inscritos,1);assert.equal(t.presentes,1);
await db.query(`select registrar_resposta_funil(3,'recusa',null,'Atendente')`);
r=await report();t=r.find(x=>x.total);assert.equal(t.validas,1);assert.equal(t.aceitaram,0);assert.equal(t.intencoes,0);assert.equal(t.inscritos,0);
await db.exec(`select registrar_convite_funil('w1',1)`);
r=await report();assert.equal(r.find(x=>x.total).inscritos,1);
await assert.rejects(db.exec(`select registrar_resposta_funil(1,'aceitou',null,'Atendente')`));
await assert.rejects(db.exec(`select registrar_resposta_funil(3,'inscricao',null,'Atendente')`));
await db.query(`select registrar_resposta_funil(3,'automatica',null,'Atendente')`);
r=await report();assert.equal(r.find(x=>x.total).validas,0);
assert.equal((await db.query('select count(*)::int n from log_atividade')).rows[0].n,3);
await db.exec(`update leads_inscricoes set data_matricula_verificada_mercurio_em=null`);
r=await report();assert.equal(r.find(x=>x.total).matriculados,0);
await db.query(`insert into mercurio_alunos values(10,'A','p1',$1,now())`,[d]);
r=await report();assert.equal(r.find(x=>x.total).matriculados,1);
// >1000 pessoas: SQL não depende do limite de linhas do PostgREST nem do Kanban.
await db.query(`insert into mensagens_whatsapp select 100+n,'p'||(100+n),'A','saida','lido','wm'||n,false,$1,'oi','texto' from generate_series(1,1500) n`,[before.toISOString()]);
r=await report();assert.equal(r.find(x=>x.total).contatados,1501);assert.equal(r.find(x=>x.total).mensagens,1503);
const fila=(await db.query(`select fila_revisao_funil($1,$2,null,null,true) r`,[start.toISOString(),new Date(+now+86400000).toISOString()])).rows[0].r;
assert.equal(fila.length,1);assert.equal(fila[0].id,3);
console.log('PASS SQL: envios reais, deduplicação, >1000 pessoas, revisão auditada, intenção ≠ inscrição, presença e Mercúrio.');
await db.close();

});

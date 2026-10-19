import {chromium} from '/workspace/BPO/node_modules/playwright/index.mjs';
import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
let html=(await readFile('index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link[^>]+href="https:[^>]+>/gi,'');
html=html.replace('</body>','<script src="/js/app.js"></script><script src="/js/whatsapp.js"></script><script src="/js/visao-geral.js"></script></body>');
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');try{res.end(path==='/'?html:await readFile('.'+path));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{for(const width of [390,1365]){
 const page=await browser.newPage({viewport:{width,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const origin='http://127.0.0.1:'+server.address().port;await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await page.goto(origin);
 await page.evaluate(()=>{
  document.querySelectorAll('.tab-pane').forEach(e=>e.classList.remove('active'));document.getElementById('tab-whatsapp').classList.add('active');
  const a=document.getElementById('wppSugestaoIaBox');document.body.append(a);a.style.display='block';
  window.enviosAgentes=0;window.planoTeste={nome:'Apoio à matrícula',objetivo:'Ajudar com o pedido atual.',motivo:'Pedido explícito.',qualificacao:{evidencia:{mensagem_id:7,trecho:'Quero entrar no curso <img src=x onerror="window.injecao=true">'}}};
  window.supabaseClient={from(tabela){const q=new Proxy({then(resolve){let data=tabela==='sugestoes_resposta_wpp'?{id:1,sugestao_resposta:planoTeste.bloqueado?null:'Vamos conferir o que falta para sua inscrição?',agente_ia:planoTeste}:tabela==='classificacoes_resposta_convite'?[{id:2,pessoaIdentificador:'teste',evento_id:1,categoria:'pediu_informacao',sugestao_resposta:'Informação do evento.',agente_ia:planoTeste}]:tabela==='leads_inscricoes'?[{pessoaIdentificador:'teste',pessoaNome:'Teste',filial:'A'}]:[{id:1,nome:'Palestra teste'}];return Promise.resolve({data,error:null}).then(resolve);}},{get(t,k){return k in t?t[k]:(...args)=>q;}});return q;},functions:{invoke(){enviosAgentes++;throw new Error('Sem envio em teste');}}};
 });
 await page.evaluate(()=>carregarSugestaoIaWpp('teste'));
 assert.match(await page.locator('#wppSugestaoIaBox').innerText(),/Agente: Apoio à matrícula/);assert.match(await page.locator('#wppSugestaoIaBox').innerText(),/Evidência da mensagem 7/);assert.equal(await page.locator('#wppSugestaoIaBox img').count(),0);assert.equal(await page.evaluate(()=>window.injecao===true),false);
 await page.evaluate(()=>{planoTeste={...planoTeste,nome:'Conferência interna',bloqueado:true,motivo:'Pedido de não contato.'};return carregarSugestaoIaWpp('teste');});
 assert.equal(await page.locator('#wppSugestaoTexto').count(),0);assert.equal(await page.locator('#wppSugestaoIaBox button').filter({hasText:'Enviar'}).count(),0);assert.match(await page.locator('#wppSugestaoIaBox').innerText(),/Contato suspenso/);
 await page.evaluate(()=>{document.getElementById('tab-overview')?.classList.add('active');return carregarAgendaGeralRespostasConvite();});
 assert.match(await page.locator('#agendaGeralRespostasConvite').innerText(),/Agente: Conferência interna/);
 assert.equal(await page.evaluate(()=>enviosAgentes),0);assert.deepEqual(errors,[]);await page.screenshot({path:'/tmp/crm-agentes-'+width+'.png',fullPage:true});console.log('PASS '+width+'px: agente, evidência escapada, bloqueio sem botão de envio, Agenda e zero mensagens enviadas.');await page.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));}

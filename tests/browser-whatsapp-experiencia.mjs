import {chromium} from '/workspace/BPO/node_modules/playwright/index.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
let html=(await readFile('index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link[^>]+href="https:[^>]+>/gi,'');
html=html.replace('</body>','<script src="/js/app.js"></script><script src="/js/whatsapp.js"></script></body>');
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');try{res.end(path==='/'?html:await readFile('.'+path));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{for(const width of [390,1365]){const page=await browser.newPage({viewport:{width,height:844}});const origin='http://127.0.0.1:'+server.address().port;await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await page.goto(origin);
await page.evaluate(()=>{
 document.querySelectorAll('.tab-pane').forEach(e=>e.classList.remove('active'));document.getElementById('tab-whatsapp').classList.add('active');
 window.enviosTeste=[];
 const chain=()=>{const q=new Proxy({then(resolve){return Promise.resolve({data:null,error:null}).then(resolve);}},{get(t,k){return k in t?t[k]:(...a)=>q;}});return q;};
 window.supabaseClient={from:chain,channel:()=>{const c={on(){return c;},subscribe(){return c;}};return c;},removeChannel(){},functions:{async invoke(n,args){window.enviosTeste.push(args.body);return {data:{ok:false,erro:'teste_falha'},error:{message:'Falha simulada'}};}}};
 iniciarEscutaGlobalWpp=()=>{};popularFiltroFilialWpp=()=>{};marcarConversaLidaWpp=()=>{};marcarUltimaMensagemComoLidaWpp=()=>{};renderizarContatosWpp=()=>{};renderizarTagsWpp=()=>{};carregarSugestaoIaWpp=()=>{};obterNomeAtendente=()=> 'Atendente teste';
 leadsAtuais=[{pessoaIdentificador:'a',pessoaNome:'Ana (simulação)'},{pessoaIdentificador:'b',pessoaNome:'Bruno (simulação)'}];
 carregarHistoricoMensagens=async id=>{if(id==='lento')await new Promise(r=>setTimeout(r,100));return Array.from({length:35},(_,i)=>({id:i,pessoaIdentificador:id,direcao:i%2?'saida':'entrada',tipo:'texto',corpo_texto:id==='lento'?'Conversa antiga':i%2?'Que bom saber de você! Como foi sua semana?':'Tudo bem! Gostaria de saber mais sobre as atividades.',criado_em:new Date(Date.now()-600000+i*1000).toISOString(),status:'entregue'}));};
});
await page.evaluate(()=>abrirChatWpp('a'));await page.locator('#wppChatInputArea textarea').fill('Olá Ana, como você está?');await page.evaluate(()=>abrirChatWpp('b'));assert.equal(await page.locator('#wppChatInputArea textarea').inputValue(),'');await page.evaluate(()=>abrirChatWpp('a'));assert.equal(await page.locator('#wppChatInputArea textarea').inputValue(),'Olá Ana, como você está?');
await page.locator('#wppChatInputArea textarea').press('Shift+Enter');assert.ok((await page.locator('#wppChatInputArea textarea').inputValue()).includes('\n'));page.once('dialog',d=>d.accept());await page.locator('#wppChatInputArea textarea').press('Enter');await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>enviosTeste.length),1);assert.ok((await page.locator('#wppChatInputArea textarea').inputValue()).startsWith('Olá Ana'));
await page.evaluate(()=>{window.supabaseClient.functions.invoke=async()=>({data:{ok:true}});moverParaAbordagemAposEnvio=async()=>{};});await page.locator('#wppChatInputArea textarea').press('Enter');await page.waitForTimeout(50);assert.equal(await page.locator('#wppChatInputArea textarea').inputValue(),'');
await page.evaluate(()=>Promise.all([chatWpp.abrir('lento'),chatWpp.abrir('b')]));assert.equal(await page.locator('#wppMessages [data-msg-db-id]').count(),35);assert.equal(await page.locator('#wppMessages').textContent().then(t=>t.includes('Conversa antiga')),false);
if(width===390){assert.equal(await page.locator('.wpp-sidebar').isVisible(),false);await page.getByRole('button',{name:'← Conversas',exact:true}).click();assert.equal(await page.locator('.wpp-sidebar').isVisible(),true);await page.evaluate(()=>abrirChatWpp('a'));}
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/whatsapp-'+width+'.png'});console.log('PASS '+width+'px: troca de contatos, rascunhos, multiline, falha de envio, abertura concorrente e navegação.');await page.close();}}finally{await browser.close();await new Promise(r=>server.close(r));}

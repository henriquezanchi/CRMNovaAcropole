import {chromium} from '/workspace/BPO/node_modules/playwright/index.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
let html=(await readFile('index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link[^>]+href="https:[^>]+>/gi,'');
html=html.replace('</body>','<script>function usuarioLogado(){return {nome:"Equipe teste"};}</script><script src="/js/app.js"></script><script src="/js/acompanhamento-modelo.js"></script><script src="/js/acompanhamento.js"></script></body>');
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');try{res.end(path==='/'?html:await readFile('.'+path));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{for(const width of [390,1365]){const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const origin='http://127.0.0.1:'+server.address().port;await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await page.goto(origin);
await page.evaluate(()=>{
 filialAtual='Escola teste';window.paginasTeste=0;
 const base=Array.from({length:1201},(_,i)=>({pessoaIdentificador:String(i).padStart(4,'0'),pessoaNome:'Contato '+i,filial:filialAtual,acompanhamento:{}}));
 base[1199].pessoaNome='Pessoa decidida (teste)';base[1199].acompanhamento={intencao:'inscrever',contato:'permitido',responsavel:'Equipe teste'};
 base[1200].pessoaNome='Pessoa em pausa (teste)';base[1200].acompanhamento={intencao:'inscrever',contato:'pausado'};
 window.supabaseClient={from(){let inicio=0,fim=999;const q=new Proxy({then(resolve){paginasTeste++;return Promise.resolve({data:base.slice(inicio,fim+1),error:null}).then(resolve);}},{get(t,k){if(k in t)return t[k];return(...args)=>{if(k==='range')[inicio,fim]=args;return q;};}});return q;}};
});
await page.getByRole('button',{name:'Quem está mais próximo da matrícula?',exact:true}).click();await page.getByText('Pessoa decidida (teste)',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>paginasTeste),2);assert.equal(await page.locator('#acompanhamentoLista article').count(),1);assert.match(await page.locator('#acompanhamentoLista').innerText(),/Quer se inscrever/);assert.match(await page.locator('#acompanhamentoLista').innerText(),/Sem data/);
await page.locator('[data-sinal-filtro="sinal:momento"]').click();assert.match(await page.locator('#acompanhamentoLista').innerText(),/Pessoa em pausa/);
await page.locator('[data-sinal-filtro="sinal:qualificar"]').click();assert.equal(await page.locator('#acompanhamentoLista article').count(),100);await page.locator('#acompanhamentoBusca').fill('Contato 1188');assert.equal(await page.locator('#acompanhamentoLista article').count(),1);assert.match(await page.locator('#acompanhamentoLista').innerText(),/Contato 1188/);
await page.locator('#acompanhamentoBusca').fill('');await page.locator('[data-sinal-filtro="proximos"]').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/interesse-matricula-'+width+'.png'});assert.deepEqual(errors,[]);console.log('PASS '+width+'px: painel real, base de 1201 contatos, intenção explícita, pausa e busca fora da página visível.');await page.close();}}finally{await browser.close();await new Promise(r=>server.close(r));}

import {chromium} from '/workspace/BPO/node_modules/playwright/index.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"><main style="padding:16px;min-width:0;width:100%;overflow:auto"><section id="funilInteracoes"></section></main><script>
let filialAtual='Escola teste';const chamadas=[];
function escapeHTML(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function usuarioLogado(){return {nome:'Equipe teste'};}
window.supabaseClient={rpc:async(nome,p)=>{chamadas.push({nome,p});if(nome==='relatorio_funil_interacoes')return {data:[{total:true,filial:'Total',mensagens:12000,contatados:4000,responderam:1200,validas:900,aceitaram:600,intencoes:300,inscritos:200,presentes:100,matriculados:35,pendentes:300},{total:false,filial:'Escola teste',mensagens:100,contatados:50,responderam:20,validas:15,aceitaram:10,intencoes:8,inscritos:5,presentes:3,matriculados:1,pendentes:5}]};if(nome==='fila_revisao_funil')return {data:[{id:3,filial:'Escola teste',pessoa:'1',nome:'Contato <teste>',criado_em:new Date().toISOString(),corpo_texto:'Sim, vou me inscrever <img src=x onerror=alert(1)>',contexto:'Você gostaria de saber mais sobre a aula?',eventos:[{id:1,nome:'Aula teste',data:'2026-10-25'}]}]};return {data:null};}};
</script><script src="/js/funil-interacoes.js"></script><script>iniciarFunilInteracoes();</script>`;
const arquivos=['/js/funil-interacoes.js','/css/style.css'];
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}else if(arquivos.includes(path)){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(new URL('..'+path,import.meta.url)));}else res.writeHead(404).end();});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try { browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 for(const width of [414,1365]){const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const origin='http://127.0.0.1:'+server.address().port;
 await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await page.goto(origin);
 await page.getByText('12.000 mensagens enviadas',{exact:true}).waitFor();assert.ok((await page.locator('#funilInteracoesDados').innerText()).includes('22,5%'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#funilEscopo').selectOption('atual');await page.getByRole('button',{name:'Atualizar resultados'}).click();assert.equal(await page.evaluate(()=>chamadas.at(-1).p.p_filial),'Escola teste');
 await page.locator('#funilRevisao summary').click();await page.getByRole('button',{name:'Carregar respostas',exact:true}).click();await page.locator('#funilClasse3').selectOption('inscricao');await page.getByRole('button',{name:'Salvar conferência'}).click();assert.equal(await page.evaluate(()=>chamadas.filter(c=>c.nome==='registrar_resposta_funil').length),0);
 await page.locator('#funilEvento3').selectOption('1');await page.getByRole('button',{name:'Salvar conferência'}).click();await page.getByText('Conferência salva com histórico.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>chamadas.filter(c=>c.nome==='registrar_resposta_funil').length),1);assert.equal(await page.locator('.funil-resposta img').count(),0);
 await page.screenshot({path:'/tmp/crm-funil-'+width+'.png',fullPage:true});assert.deepEqual(errors,[]);console.log('PASS funil '+width+'px: percentuais, filtro, revisão com evento obrigatório, texto seguro e sem envios.');await page.close(); }
} finally {await browser?.close();await new Promise(r=>server.close(r));}

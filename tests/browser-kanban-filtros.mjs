// Quadro e filtros reais; dados sintéticos e nenhuma conexão ao Supabase/WhatsApp.
import { chromium } from '/workspace/BPO/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><link rel="stylesheet" href="/css/style.css"><body><main style="width:100%;overflow:auto"><div id="statsBar"></div><div id="filtrosRapidosContainer"></div><div id="colunasRecolhidasBar"></div><div id="kanbanBoard" style="display:flex;gap:10px"></div></main><script>
const banco=Array.from({length:2507},(_,i)=>({pessoaIdentificador:String(i).padStart(6,'0'),pessoaNome:(i>=2100?'BuscaAlvo ':'Pessoa ')+i,filial:'Escola teste',funil_agencia:i===2505?null:i===2506?'Coluna antiga':['Frios','Abordagem','RSVP','Matriculados','Truncados'][i%5],tags:JSON.stringify(i>=2400?['Alvo']:[]),data_matricula:'2026-10-17'}));
let consultas=0;let falhar=false;
window.supabaseClient={from(){let inicio=0,fim=999;const q={select(){return q},eq(){return q},is(){return q},order(){return q},range(a,b){inicio=a;fim=b;return q},then(resolve){consultas++;return Promise.resolve(falhar&&inicio===1000?{data:null,error:{message:'offline'}}:{data:banco.slice(inicio,fim+1),error:null}).then(resolve)}};return q}};
</script><script src="/js/app.js"></script></body></html>`;
const servidor=createServer(async(req,res)=>{const caminho=new URL(req.url,'http://localhost').pathname;if(caminho==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}if(!['/js/app.js','/css/style.css'].includes(caminho)){res.writeHead(404).end();return;}res.setHeader('Content-Type',caminho.endsWith('.js')?'text/javascript':'text/css');res.end(caminho==='/js/app.js'&&process.env.KANBAN_APP_REV?execFileSync('git',['show',process.env.KANBAN_APP_REV+':js/app.js']):await readFile(new URL('..'+caminho,import.meta.url)));});
await new Promise(resolve=>servidor.listen(0,'127.0.0.1',resolve));let navegador;
try{
 navegador=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const pagina=await navegador.newPage({viewport:{width:1400,height:900}});const erros=[];pagina.on('pageerror',e=>erros.push(e.message));
 const origem='http://127.0.0.1:'+servidor.address().port;await pagina.route('**/*',rota=>rota.request().url().startsWith(origem+'/')?rota.continue():rota.abort());await pagina.goto(origem);
 await pagina.evaluate(()=>{filialAtual='Escola teste';leadsAtuais=banco.slice(0,500);podeCarregarMais=true;renderizarColunas();renderizarCards();});
 assert.equal(await pagina.locator('.lead-card').count(),500);
 await pagina.evaluate(()=>quickFilterTag('Alvo'));
 assert.equal(await pagina.evaluate(()=>consultas),3);
 const visiveis=await pagina.locator('.lead-card:visible').count();assert.equal(visiveis,107);
 assert.equal(await pagina.locator('#card-002505').isVisible(),true);assert.equal(await pagina.locator('#card-002506').isVisible(),true);
 assert.equal(await pagina.locator('#btn-carregar-mais').count(),0);
 for(const chave of ['Frios','Abordagem','RSVP','Matriculados','Truncados'])assert.ok(await pagina.locator('#col-'+chave+' .lead-card:visible').count()>0);
 await pagina.evaluate(()=>{limparFiltros();document.querySelector('.column-search[data-col="col-Frios"]').value='BuscaAlvo';return processarBuscaColuna('Frios');});
 assert.ok(await pagina.locator('#col-Frios .lead-card:visible').count()>0);assert.equal(await pagina.evaluate(()=>consultas),3);
 await pagina.evaluate(()=>{limparFiltros();baseFiltravelCompleta=false;leadsAtuais=banco.slice(0,500);renderizarCards();return toggleFiltroColunaChip('Frios','tags','Alvo');});
 assert.equal(await pagina.locator('#col-Frios .lead-card:visible').count(),23);
 await pagina.evaluate(()=>toggleFiltroColunaChipExcluir('Abordagem','Alvo'));
 assert.equal(await pagina.locator('#col-Abordagem .lead-card:visible').count(),480);
 // Nova consulta que falha: não mostrar resultado parcial como se estivesse completo.
 await pagina.evaluate(()=>{baseFiltravelCompleta=false;promessaBaseFiltravel=null;falhar=true;leadsAtuais=banco.slice(0,500);renderizarCards();return quickFilterTag('Alvo');});
 assert.equal(await pagina.locator('#col-Frios').isVisible(),false);assert.match(await pagina.locator('#estadoFiltroCompleto-Frios').textContent(),/toda a base/);
 await pagina.evaluate(()=>{falhar=false;return quickFilterTag('Alvo');});
 // O segundo clique desmarca a tag; o importante é recuperar a base completa.
 assert.equal(await pagina.evaluate(()=>leadsAtuais.length),2507);assert.equal(await pagina.locator('#col-Frios').isVisible(),true);
 await pagina.evaluate(()=>{limparFiltros();return quickFilterTag('Sem correspondência');});
 assert.equal(await pagina.locator('.lead-card:visible').count(),0);
 assert.equal(await pagina.evaluate(()=>getColumnKeys().every(key=>getFiltroColuna(key).tags.includes('Sem correspondência'))),true);
 assert.deepEqual(erros,[]);console.log('PASS quadro real: 2.507 contatos, todas as colunas, filtros rápidos e busca, funis nulos/legados, falha visível e recuperação sem Carregar Mais.');
 await pagina.close();
}finally{await navegador?.close();await new Promise(resolve=>servidor.close(resolve));}

// Componentes reais, backend em memória e rede externa bloqueada. Nenhum dado de produção.
import { chromium } from '/workspace/BPO/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const pagina = `<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/style.css"><style>body{display:block;overflow:auto;height:auto}</style><body>
<div class="acompanhamento-painel"><select id="acompanhamentoFiltro"><option value="todos">Todos</option></select><input id="acompanhamentoBusca"><input type="checkbox" id="acompanhamentoMeus"><p id="acompanhamentoResumo"></p><p id="acompanhamentoContagem"></p><div id="acompanhamentoLista"></div></div>
<section id="acompanhamentoLead" class="acompanhamento-painel"></section><section class="acompanhamento-painel"><div id="conteudoConvitesLista"></div><div id="conteudoConvitesEditor"></div></section>
<section class="aberturas-conferencia"><select id="participantesFiltroSituacao"><option value="todos">Todos</option><option value="presenca_pendente">Presença pendente</option></select><input id="participantesFiltroNome"><p id="participantesResumoConferencia"></p></section>
<div id="participantesLista"></div><input id="participantesSelecionarTodos" type="checkbox"><div id="participantesBulkBar"><span id="participantesBulkContador"></span></div>
<script>
const REORDENADORES_LISTA={};
let filialAtual='Escola teste', leadsAtuais=[], NOME_TABELA='leads_inscricoes';
function escapeHTML(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function usuarioLogado(){return {nome:'Equipe teste'};}
function abrirGaveta(id){renderizarAcompanhamento(leadsAtuais.find(l=>String(l.pessoaIdentificador)===String(id)));}
const db={leads_inscricoes:[{pessoaIdentificador:'001',pessoaNome:'Teste <script>alert(1)</'+'script>',filial:'Escola teste',acompanhamento:{}}],eventos:[{id:1,nome:'Abertura teste',filial:'Escola teste',data:'2026-10-21',ativo:true,planejamento_conteudo:{}}]};
let conflito=false, erroConsulta=false;
window.supabaseClient={from(tabela){let filtros=[],mudanca=null,faixa=null,unico=false;const q={select(){return q},is(){return q},eq(k,v){filtros.push([k,v]);return q},order(){return q},range(a,b){faixa=[a,b];return q},maybeSingle(){unico=true;return q},update(v){mudanca=v;return q},then(resolve){if(erroConsulta)return Promise.resolve({data:null,error:{message:'simulado'}}).then(resolve);let linhas=db[tabela].filter(r=>filtros.every(([k,v])=>typeof r[k]==='object'?JSON.stringify(r[k])===v:r[k]===v));if(mudanca&&conflito)linhas=[];if(mudanca)linhas.forEach(r=>Object.assign(r,structuredClone(mudanca)));if(faixa)linhas=linhas.slice(faixa[0],faixa[1]+1);return Promise.resolve({data:structuredClone(unico?linhas[0]||null:linhas),error:null}).then(resolve)}};return q}};
</script><script src="/js/acompanhamento-modelo.js"></script><script src="/js/acompanhamento.js"></script><script src="/js/conteudo-convites.js"></script><script src="/js/aberturas-modelo.js"></script><script src="/js/eventos.js"></script></body></html>`;
const servidor = createServer(async (req, res) => {
    try { const url = new URL(req.url, 'http://localhost'); if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(pagina); return; }
        const permitidos = ['/css/style.css','/js/acompanhamento-modelo.js','/js/acompanhamento.js','/js/conteudo-convites.js','/js/aberturas-modelo.js','/js/eventos.js'];
        if (!permitidos.includes(url.pathname)) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await readFile(new URL('..'+url.pathname, import.meta.url)));
    } catch { res.writeHead(500).end(); }
});
await new Promise(resolve=>servidor.listen(0,'127.0.0.1',resolve));
const origem='http://127.0.0.1:'+servidor.address().port;
let navegador;
try {
    navegador=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
    for(const largura of [320,414,1365]){
        const paginaBrowser=await navegador.newPage({viewport:{width:largura,height:896}});
        const erros=[];paginaBrowser.on('pageerror',e=>erros.push(e.message));
        await paginaBrowser.route('**/*',rota=>rota.request().url().startsWith(origem+'/')?rota.continue():rota.abort());
        await paginaBrowser.goto(origem);
        await paginaBrowser.evaluate(async()=>{await carregarFilaAcompanhamento();});
        assert.equal(await paginaBrowser.locator('#acompanhamentoLista article').count(),1);
        assert.equal(await paginaBrowser.locator('#acompanhamentoLista script').count(),0);
        await paginaBrowser.getByRole('button',{name:'Abrir atendimento'}).click();
        await paginaBrowser.locator('[name=origem]').selectOption('instagram');
        await paginaBrowser.locator('[name=entrada]').selectOption('ativa');
        await paginaBrowser.locator('[name=contato]').selectOption('permitido');
        await paginaBrowser.locator('[name=intencao]').selectOption('conhecer');
        await paginaBrowser.locator('[name=responsavel]').fill('Equipe teste');
        await paginaBrowser.getByRole('button',{name:'Salvar acompanhamento'}).click();
        await paginaBrowser.getByText('Acompanhamento salvo.',{exact:true}).waitFor();
        assert.equal(await paginaBrowser.evaluate(()=>db.leads_inscricoes[0].acompanhamento.origem),'instagram');
        assert.equal(await paginaBrowser.locator('#acompanhamentoSugestao textarea').count(),1);
        await paginaBrowser.locator('#acompanhamentoBusca').fill('inexistente');
        await paginaBrowser.evaluate(()=>renderizarFilaAcompanhamento());
        assert.equal(await paginaBrowser.locator('#acompanhamentoLista article').count(),0);
        await paginaBrowser.locator('#acompanhamentoBusca').fill('teste');
        await paginaBrowser.locator('#acompanhamentoMeus').check();
        await paginaBrowser.evaluate(()=>renderizarFilaAcompanhamento());
        assert.equal(await paginaBrowser.locator('#acompanhamentoLista article').count(),1);
        await paginaBrowser.evaluate(()=>{conflito=true;});
        await paginaBrowser.locator('[name=intencao]').selectOption('inscrever');
        await paginaBrowser.getByRole('button',{name:'Salvar acompanhamento'}).click();
        await paginaBrowser.getByText('Este contato mudou em outra sessão. Atualize a lista antes de editar.',{exact:true}).waitFor();
        assert.equal(await paginaBrowser.evaluate(()=>db.leads_inscricoes[0].acompanhamento.intencao),'conhecer');
        await paginaBrowser.evaluate(async()=>{conflito=false;await carregarConteudoConvites();});
        await paginaBrowser.getByRole('button',{name:'21/10/2026 · Abertura teste'}).click();
        await paginaBrowser.locator('#conteudoConvitesForm [name=responsavel]').fill('Escola teste');
        await paginaBrowser.locator('#conteudoConvitesForm [name=texto]').fill('Convite para conhecer a escola.');
        await paginaBrowser.getByRole('button',{name:'Salvar planejamento'}).click();
        await paginaBrowser.getByText('Planejamento salvo. A publicação permanece manual.',{exact:true}).waitFor();
        assert.equal(await paginaBrowser.evaluate(()=>db.eventos[0].planejamento_conteudo.texto),'Convite para conhecer a escola.');
        await paginaBrowser.evaluate(()=>{
            participantesAtuais=[{id:1,pessoaIdentificador:'001',resposta_convite:'talvez',compareceu:null,_lead:{pessoaNome:'Pessoa uma'}},{id:2,pessoaIdentificador:'002',resposta_convite:'confirmado',compareceu:true,_lead:{pessoaNome:'Pessoa duas'}}];
            permiteMatriculaEventoAtual=false;renderizarListaParticipantes();toggleSelecionarTodosParticipantes(true);
        });
        assert.equal(await paginaBrowser.evaluate(()=>participantesSelecionados.size),2);
        await paginaBrowser.locator('#participantesFiltroSituacao').selectOption('presenca_pendente');
        await paginaBrowser.evaluate(()=>alterarFiltroConferenciaParticipantes());
        assert.equal(await paginaBrowser.evaluate(()=>participantesSelecionados.size),0);
        await paginaBrowser.evaluate(()=>toggleSelecionarTodosParticipantes(true));
        assert.deepEqual(await paginaBrowser.evaluate(()=>Array.from(participantesSelecionados)),[1]);
        assert.equal(await paginaBrowser.locator('#participantesLista .participante-row').count(),1);
        await paginaBrowser.evaluate(()=>{participantesAtuais[0].compareceu=true;renderizarListaParticipantes();});
        assert.equal(await paginaBrowser.evaluate(()=>participantesSelecionados.size),0);
        assert.equal(await paginaBrowser.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await paginaBrowser.evaluate(async()=>{erroConsulta=true;await carregarFilaAcompanhamento();});
        assert.equal(await paginaBrowser.locator('#acompanhamentoLista article').count(),0);
        assert.deepEqual(erros,[]);
        await paginaBrowser.close();
        console.log('PASS componentes reais em '+largura+'px: origem, persistência, conflito, rascunho, erro e largura.');
    }
} finally {await navegador?.close();await new Promise(resolve=>servidor.close(resolve));}

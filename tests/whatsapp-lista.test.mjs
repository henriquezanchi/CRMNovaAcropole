import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const fonte=readFileSync(new URL('../js/whatsapp.js',import.meta.url),'utf8');
test('busca de conversas percorre páginas antes de filtrar e não oculta conversa antiga',async()=>{
 const lista={innerHTML:''};const conversas=Array.from({length:1201},(_,i)=>({pessoaIdentificador:String(i),ultima_mensagem_em:new Date().toISOString()}));let paginas=0;
 const leads=conversas.map((c,i)=>({...c,pessoaNome:i===1200?'Ana distante':'Contato '+i}));
 const contexto={document:{getElementById:id=>id==='wppContactList'?lista:null},iniciarEscutaGlobalWpp(){},popularFiltroFilialWpp(){},leadsAtuais:leads,horasRestantesJanelaWpp:()=>null,conversaNaoLidaWpp:()=>false,htmlContatoWpp:l=>l.pessoaNome,window:{supabaseClient:{from(tabela){let inicio=0,fim=499;const q=new Proxy({then(resolve){if(tabela==='vw_wpp_conversas')paginas++;return Promise.resolve({data:tabela==='vw_wpp_conversas'?conversas.slice(inicio,fim+1):[],error:null}).then(resolve);}},{get(t,k){if(k in t)return t[k];return(...args)=>{if(k==='range')[inicio,fim]=args;return q;};}});return q;}}}};
 vm.createContext(contexto);const inicio=fonte.indexOf('let versaoListaWpp =');const fim=fonte.indexOf('\nfunction filtrarContatosWpp',inicio);vm.runInContext(fonte.slice(inicio,fim),contexto);
 await contexto.renderizarContatosWpp('ana distante');assert.equal(paginas,3);assert.equal(lista.innerHTML,'Ana distante');
});

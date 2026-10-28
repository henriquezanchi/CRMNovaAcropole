import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VERSAO_MEMORIA,planejarLeitura,montarEntradaIA,validarMemoria,registroMemoria,extrairJsonIA,qualificarComEvidencia,validarQualificacao,coordenarAgente,historicoParaEspecialista} from '../supabase/functions/_shared/agentes-crm.mjs';

const msg=(id,direcao,corpo_texto,extra={})=>({id,direcao,tipo:'texto',corpo_texto,criado_em:`2026-10-${String(id).padStart(2,'0')}T10:00:00Z`,...extra});
const conversa=[msg(1,'saida','Olá! Gostaria de vir à palestra de quinta?'),msg(2,'entrada','Pode sim'),msg(3,'saida','Ótimo!'),msg(4,'entrada','Trabalho até as 18h, só consigo à noite')];
const memoriaBase=(extra={})=>({versao:VERSAO_MEMORIA,resumo:'02/10/2026: aceitou o convite.',perfil:{},ate_mensagem_id:2,qtd_ate:2,transcritas:[],incrementos:0,gerado_em:'2026-10-02T10:00:00Z',...extra});

test('sem memória a leitura é completa; com memória válida só as mensagens novas vão para a IA',()=>{
 assert.equal(planejarLeitura(conversa,null).modo,'completo');
 const l=planejarLeitura(conversa,memoriaBase());
 assert.equal(l.modo,'incremental');
 assert.deepEqual(l.mensagens.map(m=>m.id),[3,4]);
 assert.deepEqual(l.contexto.map(m=>m.id),[1,2]);
 const entrada=JSON.parse(montarEntradaIA(l,memoriaBase()));
 assert.equal(entrada.modo,'incremental');assert.equal(entrada.memoria_anterior.resumo,'02/10/2026: aceitou o convite.');
 assert.equal(entrada.mensagens.length,2);
});

test('histórico alterado, transcrição nova, versão antiga ou revisão periódica forçam releitura completa',()=>{
 assert.equal(planejarLeitura(conversa,memoriaBase({qtd_ate:3})).motivo,'historico_alterado');
 assert.equal(planejarLeitura(conversa,memoriaBase({versao:'antiga'})).modo,'completo');
 assert.equal(planejarLeitura(conversa,memoriaBase({incrementos:20})).motivo,'revisao_periodica');
 assert.equal(planejarLeitura(conversa,memoriaBase({ate_mensagem_id:99})).motivo,'ponto_de_corte_ausente');
 const comAudio=[conversa[0],{...conversa[1],fonte:'transcricao_automatica',origem_tipo:'audio'},conversa[2],conversa[3]];
 assert.equal(planejarLeitura(comAudio,memoriaBase()).motivo,'transcricao_nova');
 assert.equal(planejarLeitura(comAudio,memoriaBase({transcritas:[2]})).modo,'incremental');
 assert.equal(planejarLeitura(conversa.slice(0,2),memoriaBase()).motivo,'sem_mensagem_nova');
});

test('etapa provável exige indício literal do contato e nunca vale para matrícula',()=>{
 const q=validarQualificacao({etapa:'qualificacao',etapa_provavel:'eventos',indicio:{mensagem_id:2,trecho:'Pode sim'}},conversa);
 assert.equal(q.etapa_provavel,'eventos');assert.equal(q.confianca,'provavel');
 assert.equal(coordenarAgente({},q).agente,'eventos');
 assert.match(coordenarAgente({},q).motivo,/provável/);
 assert.equal(validarQualificacao({etapa:'qualificacao',etapa_provavel:'matricula',indicio:{mensagem_id:2,trecho:'Pode sim'}},conversa).etapa_provavel,null);
 assert.equal(validarQualificacao({etapa:'qualificacao',etapa_provavel:'eventos',indicio:{mensagem_id:1,trecho:'Gostaria de vir'}},conversa).etapa_provavel,null);
 assert.equal(validarQualificacao({etapa:'qualificacao'},conversa).confianca,'sem_sinal');
 // Bloqueios continuam prevalecendo sobre o palpite.
 assert.equal(coordenarAgente({tags:['Não Contatar']},q).agente,'interno');
});

test('etapa confirmada sem prova cai para provável quando há indício, sem perder a restrição comprovada',()=>{
 const r=qualificarComEvidencia({etapa:'eventos',evidencia:{mensagem_id:2,trecho:'Inventado'},indicio:{mensagem_id:2,trecho:'Pode sim'}},conversa);
 assert.equal(r.etapa,'qualificacao');assert.equal(r.etapa_provavel,'eventos');assert.ok(r.inconclusiva);
 const s=qualificarComEvidencia({etapa:'informacoes',evidencia:{mensagem_id:4,trecho:'só consigo à noite'},restricao:{tipo:'pausa',mensagem_id:4,trecho:'Inventado'}},conversa);
 assert.equal(s.etapa,'informacoes');assert.equal(s.restricao,null);
});

test('perfil só guarda itens com citação literal; memória anterior continua quando a IA não devolve a lista',()=>{
 const m=validarMemoria({resumo:'04/10/2026: trabalha até as 18h.',perfil:{disponibilidade:[{valor:'Só à noite',mensagem_id:4,trecho:'só consigo à noite'},{valor:'Sábado',mensagem_id:4,trecho:'Inventado'},{valor:'só à NOITE',mensagem_id:4,trecho:'só consigo à noite'}],contexto:[{valor:'Fala da escola',mensagem_id:1,trecho:'Gostaria de vir'}]},proximo_passo:'Enviar turmas noturnas.'},conversa,null);
 assert.deepEqual(m.perfil.disponibilidade.map(i=>i.valor),['Só à noite']);
 assert.deepEqual(m.perfil.contexto,[]);
 assert.equal(m.proximo_passo,'Enviar turmas noturnas.');
 const anterior={resumo:'antigo',perfil:{interesses:[{valor:'Palestras',mensagem_id:2,trecho:'Pode sim'}]}};
 const n=validarMemoria({resumo:'novo'},conversa,anterior);
 assert.equal(n.perfil.interesses[0].valor,'Palestras');
 assert.equal(validarMemoria({},conversa,null),null);
 const r=registroMemoria(m,{etapa:'qualificacao',evidencia:null},conversa,{modo:'incremental'},{incrementos:3});
 assert.equal(r.ate_mensagem_id,4);assert.equal(r.qtd_ate,4);assert.equal(r.incrementos,4);assert.equal(r.versao,VERSAO_MEMORIA);
});

test('resposta com texto em volta ainda é lida; resposta sem JSON gera erro específico',()=>{
 assert.equal(extrairJsonIA('Claro! ```json\n{"etapa":"qualificacao"}\n``` Espero ter ajudado.').etapa,'qualificacao');
 assert.throws(()=>extrairJsonIA('não sei'),/fora do formato JSON/);
});

test('especialista recebe a conversa inteira se for curta e resumo + últimas falas se for longa',()=>{
 assert.equal(JSON.parse(historicoParaEspecialista(conversa,memoriaBase())).length,4);
 const longa=Array.from({length:60},(_,i)=>msg(i+1,i%2?'entrada':'saida','x'));
 const h=JSON.parse(historicoParaEspecialista(longa,memoriaBase()));
 assert.equal(h.ultimas_mensagens.length,40);assert.ok(h.resumo_da_conversa);
});

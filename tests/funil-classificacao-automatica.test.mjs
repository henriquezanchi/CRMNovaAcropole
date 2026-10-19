import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validarAnalise, extrairJsonAnalise, convitesDeterministicos} from '../supabase/functions/analisar-funil-conversas/criterios.mjs';
const c={mensagens:[{id:1,direcao:'saida',texto:'Quer receber informações da Aula?',status:'lido',importada:false},{id:2,direcao:'entrada',texto:'Pode mandar'},{id:3,direcao:'entrada',texto:'Não quero mais, obrigado'},{id:4,direcao:'entrada',tipo:'audio',texto:'(áudio)'},{id:5,direcao:'saida',status:'falhou',texto:'Convite da Aula'}],eventos:[{id:10}]};
test('valida evidência exata e direção, sem inventar mensagens, eventos ou conteúdo de áudio',()=>{
 const r=validarAnalise(c,{respostas:[{mensagem_id:2,classe:'aceitou',trecho:'Pode mandar',evento_id:999},{mensagem_id:3,classe:'recusa',trecho:'Texto inventado'},{mensagem_id:4,classe:'aceitou',trecho:'(áudio)'}],continuidade:{aceitou:true,mensagem_id:1,trecho:'Quer receber'},intencao:{pretende:true,mensagem_id:999,trecho:'sim'},convites:[{mensagem_id:5,evento_id:10,trecho:'Convite da Aula'}]});
 assert.equal(r.respostas.length,3);assert.equal(r.respostas[0].classe,'aceitou');assert.equal(r.respostas[0].evento_id,null);assert.equal(r.respostas[1].classe,'inconclusiva');assert.equal(r.respostas[2].classe,'inconclusiva');assert.equal(r.continuidade.aceitou,null);assert.equal(r.intencao.pretende,null);assert.equal(r.convites.length,0);
});
test('decisão posterior substitui aceitação anterior e mantém recusa como resposta humana válida',()=>{
 const r=validarAnalise(c,{respostas:[{mensagem_id:2,classe:'aceitou',trecho:'Pode mandar'},{mensagem_id:3,classe:'recusa',trecho:'Não quero mais'}],continuidade:{aceitou:false,mensagem_id:3,trecho:'Não quero mais'},intencao:{pretende:false,mensagem_id:3,trecho:'Não quero mais'},convites:[]});
 assert.equal(r.continuidade.aceitou,false);assert.equal(r.continuidade.mensagem_id,3);assert.equal(r.respostas[0].classe,'aceitou');assert.equal(r.respostas[1].classe,'recusa');
});

test('JSON com explicação é extraído sem executar instruções e JSON truncado falha',()=>{assert.deepEqual(extrairJsonAnalise('```json\n{"respostas":[]}\n``` explicação'),{respostas:[]});assert.throws(()=>extrairJsonAnalise('{"respostas":['));});
test('vínculo determinístico exige link exato ou título único; falha não é convite',()=>{const base={mensagens:[{id:1,direcao:'saida',status:'lido',texto:'Venha: https://exemplo.test/1'},{id:2,direcao:'saida',status:'falhou',texto:'Venha: https://exemplo.test/1'}],eventos:[{id:10,nome:'Uma palestra de filosofia muito especial',link:'https://exemplo.test/1'}]};assert.equal(convitesDeterministicos(base).length,1);});

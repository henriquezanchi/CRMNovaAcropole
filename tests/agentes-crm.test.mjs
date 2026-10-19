import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AGENTES,validarQualificacao,coordenarAgente,instrucoesEspecialista} from '../supabase/functions/_shared/agentes-crm.mjs';
const mensagens=[{id:1,direcao:'saida',tipo:'texto',corpo_texto:'Quer fazer matrícula?'},{id:2,direcao:'entrada',tipo:'texto',corpo_texto:'Quero me inscrever na palestra'},{id:3,direcao:'entrada',tipo:'audio',corpo_texto:'Quero fazer matrícula'}];
test('cada especialista tem missão própria e o coordenador mantém evidência sem alterar cadastro',()=>{
 for(const etapa of Object.keys(AGENTES).filter(k=>k!=='interno')){
  const q=validarQualificacao({etapa,evidencia:{mensagem_id:2,trecho:'Quero me inscrever na palestra'},restricao:null},mensagens);
  const lead={acompanhamento:{responsavel:'Equipe'}};const antes=JSON.stringify(lead);
  const plano=coordenarAgente(lead,q);
  assert.equal(plano.agente,etapa);assert.equal(plano.qualificacao.evidencia.mensagem_id,2);assert.equal(JSON.stringify(lead),antes);
  assert.match(instrucoesEspecialista(plano),/Não repita perguntas/);
 }
});
test('citação inventada, fala do atendente, áudio indisponível e etapa livre são recusados',()=>{
 for(const prova of [{mensagem_id:1,trecho:'Quer fazer matrícula?'},{mensagem_id:2,trecho:'Quero fazer matrícula'},{mensagem_id:3,trecho:'Quero fazer matrícula'}])assert.throws(()=>validarQualificacao({etapa:'matricula',evidencia:prova},mensagens));
 assert.throws(()=>validarQualificacao({etapa:'inventado'},mensagens));
 assert.throws(()=>validarQualificacao({etapa:'informacoes',evidencia:null},mensagens));
 assert.equal(validarQualificacao({etapa:'qualificacao',evidencia:null},mensagens).evidencia,null);
});
test('restrições, identidade e retorno combinado prevalecem sobre todos os especialistas',()=>{
 const q={etapa:'matricula',evidencia:{mensagem_id:2,trecho:'Quero me inscrever na palestra'},restricao:null};
 for(const lead of [{tags:'["Contato em conferência"]'},{tags:['Histórico em conferência']},{tags:['Não Contatar']},{acompanhamento:{contato:'nao_contatar'}},{acompanhamento:{contato:'pausado'}},{acompanhamento:{intencao:'depois'}},{acompanhamento:{proxima_em:'2099-01-01'}},{acompanhamento:{inscricao:'aguardando_registro'}}])assert.equal(coordenarAgente(lead,q).agente,'interno');
 assert.equal(coordenarAgente({}, {...q,restricao:{tipo:'nao_contatar'}}).bloqueado,true);
});
test('restrição automática exige citação textual do contato',()=>{
 assert.throws(()=>validarQualificacao({etapa:'qualificacao',restricao:{tipo:'nao_contatar',mensagem_id:1,trecho:'Quer fazer matrícula?'}},mensagens));
 const m=[{id:5,direcao:'entrada',tipo:'texto',corpo_texto:'Não me contate mais'}];
 const q=validarQualificacao({etapa:'qualificacao',restricao:{tipo:'nao_contatar',mensagem_id:5,trecho:'Não me contate mais'}},m);
 assert.equal(coordenarAgente({},q).bloqueado,true);
});

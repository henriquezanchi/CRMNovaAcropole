import {test} from 'node:test';import assert from 'node:assert/strict';
import {montarConsultaAtivos,confirmaIdentidadeAtiva} from '../supabase/functions/auditar-base-crm/consulta-ativos.mjs';
test('reconsulta sempre filtra ATI e somente identificadores dos cadastros mesclados',()=>{
 const q=montarConsultaAtivos({matriculas:[27,'1 OR 1=1'],lead:{nome:"Maria D'Ávila",email:'maria@example.test'}});
 assert.match(q,/cad_situacao='ATI' AND/);assert.match(q,/cad_matr IN \(27\)/);assert.match(q,/D''Ávila/);assert.doesNotMatch(q,/1 OR 1=1/);
 assert.match(montarConsultaAtivos({}),/AND \(1=0\)/);
});
test('ativo requer identidade e ausência não vira inativação',()=>{
 const c={matriculas:[27],lead:{nome:'Maria Silva',ddd:'62',telefone:'999998888'}};
 assert.equal(confirmaIdentidadeAtiva(c,{cad_matr:27,cad_nome:'Maria Silva',cad_situacao:'ATI'}),true);
 assert.equal(confirmaIdentidadeAtiva(c,{cad_matr:27,cad_nome:'Pessoa Diferente',cad_situacao:'ATI'}),false);
 assert.equal(confirmaIdentidadeAtiva(c,{cad_matr:27,cad_nome:'Maria Silva',cad_situacao:'INA'}),false);
});

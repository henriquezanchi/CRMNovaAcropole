import test from 'node:test';
import assert from 'node:assert/strict';
import { validarConsultaEscola, hashChaveEscola } from '../supabase/functions/_shared/painel-escola.ts';
test('link não aceita filial fornecida pelo navegador nem chave curta',()=>{
 assert.throws(()=>validarConsultaEscola({chave:'a'.repeat(64),filial:'Outra escola'}),/não permitidos/);
 assert.throws(()=>validarConsultaEscola({chave:'123'}),/inválido/);
 assert.throws(()=>validarConsultaEscola({chave:'a'.repeat(64),inicio:-1}),/Página/);
});
test('consulta válida normaliza busca e hash não guarda o segredo original',async()=>{
 const c=validarConsultaEscola({chave:'a'.repeat(64),busca:' Nome ',categoria:'apoio',inicio:50});
 assert.equal(c.busca,'Nome');assert.equal(c.inicio,50);
 const hash=await hashChaveEscola(c.chave);assert.match(hash,/^[a-f0-9]{64}$/);assert.notEqual(hash,c.chave);
});

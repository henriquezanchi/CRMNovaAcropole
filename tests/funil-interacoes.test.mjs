import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('percentual usa pessoas como base e vínculo de medição nunca causa reenvio', async () => {
 const contexto = { console: { warn() {} }, window: { supabaseClient: { rpc: async () => { throw new Error('rede'); } } } };
 vm.createContext(contexto); vm.runInContext(fs.readFileSync('js/funil-interacoes.js','utf8'),contexto);
 assert.equal(contexto.percentualFunil(1,4),'25%');
 assert.equal(contexto.percentualFunil(1,0),'—');
 await assert.doesNotReject(contexto.registrarConviteFunil('wamid.1',1));
});

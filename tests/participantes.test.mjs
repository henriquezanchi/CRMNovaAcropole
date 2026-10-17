import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const fonte = fs.readFileSync(new URL('../js/eventos.js', import.meta.url), 'utf8');
function ambiente(falharSegundaPagina = false) {
    const chamadas = [];
    const elemento = { textContent: '', innerHTML: '' };
    const participantes = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, evento_id: 1, pessoaIdentificador: String(i).padStart(5, '0'), compareceu: null }));
    const ctx = vm.createContext({ REORDENADORES_LISTA: {}, document: { getElementById: () => elemento }, NOME_TABELA: 'leads_inscricoes', window: { supabaseClient: { from(tabela) {
        let faixa = null, ids = null;
        const q = { select() { return q; }, in(chave, valores) { ids = valores; return q; }, order() { return q; }, range(a, b) { faixa = [a, b]; return q; }, then(resolve) {
            chamadas.push({ tabela, faixa, quantidade: ids?.length });
            if (falharSegundaPagina && faixa?.[0] === 1000) return Promise.resolve({ data: null, error: {} }).then(resolve);
            const linhas = tabela === 'evento_leads' ? participantes.slice(faixa[0], faixa[1] + 1) : ids.map(id => ({ pessoaIdentificador: id, pessoaNome: 'Pessoa teste' }));
            return Promise.resolve({ data: linhas, error: null }).then(resolve);
        } }; return q;
    } } } });
    vm.runInContext(fonte, ctx);
    vm.runInContext('eventoParticipantesId=1; eventoIdsGrupoAtual=[1]; renderizarListaParticipantes=function(){globalThis.quantidadeRenderizada=participantesAtuais.length;};', ctx);
    return { ctx, chamadas, elemento };
}
test('participantes acima de mil são carregados integralmente e dados buscados em lotes pequenos', async () => {
    const { ctx, chamadas } = ambiente();
    await ctx.carregarParticipantesEvento();
    assert.equal(ctx.quantidadeRenderizada, 1001);
    assert.equal(chamadas.filter(c => c.tabela === 'evento_leads').length, 2);
    assert.ok(chamadas.filter(c => c.tabela === 'leads_inscricoes').every(c => c.quantidade <= 200));
    assert.equal(vm.runInContext('participantesAtuais.filter(p=>p.compareceu===false).length', ctx), 0);
});
test('falha após primeira página não apresenta participantes parciais como lista completa', async () => {
    const { ctx, elemento } = ambiente(true);
    await ctx.carregarParticipantesEvento();
    assert.equal(ctx.quantidadeRenderizada, undefined);
    assert.match(elemento.textContent, /Nenhuma lista parcial/);
    assert.equal(vm.runInContext('participantesAtuais.length', ctx), 0);
});

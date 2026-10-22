import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const ciclos = fs.readFileSync(new URL('../js/cobranca-ciclos.js', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../supabase/functions/cobranca-mensal/index.ts', import.meta.url), 'utf8');

function recortar(fonte, inicio, fim) {
    const a = fonte.indexOf(inicio);
    const b = fonte.indexOf(fim, a + inicio.length);
    assert.notEqual(a, -1, `marcador inicial ausente: ${inicio}`);
    assert.notEqual(b, -1, `marcador final ausente: ${fim}`);
    return fonte.slice(a, b);
}

function contextoPrecoApp() {
    const helpers = recortar(app, 'const CENTAVOS_POR_MEMBRO_MODULO2 = 496;', '// Conta matrículas REMUNERÁVEIS');
    const contexto = vm.createContext({});
    vm.runInContext(helpers, contexto);
    return contexto;
}

function contextoPrecoEdge() {
    const helpers = `const CENTAVOS_POR_MEMBRO_MODULO2 = 496;\n${recortar(edge, 'function numeroNaoNegativo(', 'async function lerTudo(')}`;
    const contexto = vm.createContext({});
    vm.runInContext(stripTypeScriptTypes(helpers), contexto);
    return contexto;
}

const casos = [[0, 0], [1, 4.96], [30, 148.8], [31, 153.76], [80, 396.8], [81, 401.76], [247, 1225.12]];

test('a taxa mensal é R$4,96 por membro nos limites históricos e sem mínimo ou teto', () => {
    const ctx = contextoPrecoApp();
    for (const [membros, esperado] of casos) {
        assert.equal(ctx.calcularValorFixoModulo2({ membros }), esperado, `${membros} membros`);
    }
});

test('a Edge Function usa o mesmo valor por membro e origem manual antes do Mercúrio', () => {
    const ctx = contextoPrecoEdge();
    for (const [membros, esperado] of casos) {
        assert.equal(ctx.valorFixo({}, membros).valor, esperado, `${membros} membros`);
    }
    assert.equal(ctx.obterQuantidadeMembrosFilial({ membros: 31, membros_mercurio: 247 }), 31);
    assert.equal(ctx.obterQuantidadeMembrosFilial({ membros: null, membros_mercurio: 247 }), 247);
    assert.equal(ctx.obterQuantidadeMembrosFilial({ membros: 'inválido', membros_mercurio: 247 }), null);
    assert.equal(ctx.quantidadeMembros(31), 31);
});

test('quantidade manual vence a do Mercúrio; valor manual R$0 continua autoritativo', () => {
    const appCtx = contextoPrecoApp();
    assert.equal(appCtx.calcularValorFixoModulo2({ membros: 31, membros_mercurio: 247 }), 153.76);
    assert.equal(appCtx.calcularValorFixoModulo2({ membros: null, membros_mercurio: 247 }), 1225.12);
    assert.equal(appCtx.calcularValorFixoModulo2({ membros: 'inválido', membros_mercurio: 247 }), null);
    assert.equal(appCtx.calcularValorFixoModulo2({ membros_mercurio: null }), null);
    assert.equal(appCtx.calcularValorFixoModulo2({ membros: null, membros_mercurio: 247, valor_fixo_mensal_agencia: 0 }), 0);
    assert.equal(appCtx.calcularValorFixoModulo2({ membros: 31, valor_fixo_mensal_agencia: 'inválido' }), null);

    const edgeCtx = contextoPrecoEdge();
    assert.equal(edgeCtx.quantidadeMembros(0), 0);
    assert.equal(edgeCtx.quantidadeMembros(null), null);
    assert.equal(edgeCtx.quantidadeMembros(-1), null);
    assert.equal(edgeCtx.quantidadeMembros(1.5), null);
    assert.equal(edgeCtx.valorFixo({ valor_fixo_mensal_agencia: 0 }, null).valor, 0);
});

test('filial agrupada usa fixo zero e não atribui matrículas ou comissão acadêmica em duplicidade', () => {
    const ctx = contextoPrecoApp();
    const filiais = [
        { id: 52, nome: 'Rio Verde', membros: 247, valor_mensalidade: 150, mercurio_unidade: 'RVD' },
        { id: 88, nome: 'Jataí', filial_cobranca_id: 52, valor_mensalidade: 130, modulo2_contratado: true },
    ];
    const detalhe = JSON.parse(JSON.stringify(ctx.detalharValorFixoModulo2(filiais[1], filiais)));
    assert.deepEqual(detalhe, { valor: 0, manual: false, membros: null, agrupada: true, grupoNome: 'Rio Verde' });
    assert.equal(ctx.calcularValorFixoModulo2(filiais[1]), 0);
    const resultado = JSON.parse(JSON.stringify(ctx.resultadoComissaoAgrupadaModulo2(filiais[1], filiais)));
    assert.equal(resultado.fonte, 'agrupada');
    assert.equal(resultado.grupoCobranca, 'Rio Verde');
    assert.equal(resultado.qtd, 0);
    assert.equal(resultado.membros, null);
    assert.equal(resultado.valorFixo, 0);
    assert.equal(resultado.comissao, 0);
    assert.equal(resultado.totalCobrar, 0);
});

test('Edge inclui todas as filiais ativas e não consulta Mercury sem unidade mapeada', async () => {
    const helpers = `async function lerTudo() { return []; }\n${recortar(edge, 'async function buscarFiliaisAtivasCobranca(', 'async function gerarFilial(')}`;
    const ctx = vm.createContext({});
    vm.runInContext(stripTypeScriptTypes(helpers), ctx);

    const linhas = Array.from({ length: 13 }, (_, i) => ({ id: i + 1, nome: `Filial ${i + 1}`, ativo: true }));
    const filtros = [];
    const query = {
        select() { return this; },
        eq(campo, valor) { filtros.push(['eq', campo, valor]); if (campo === 'ativo') this.linhas = linhas.filter(f => f.ativo === valor); return this; },
        order() { return this; },
        then(resolve) { return Promise.resolve({ data: this.linhas, error: null }).then(resolve); },
    };
    const resultado = await ctx.buscarFiliaisAtivasCobranca({}, { from: () => query });
    assert.equal(resultado.data.length, 13);
    assert.deepEqual(filtros, [['eq', 'ativo', true]]);

    let chamadasMercury = 0;
    const semUnidade = await ctx.lerDadosMercurioFilial({ nome: 'Jataí', mercurio_unidade: null }, {
        from() { chamadasMercury++; throw new Error('não deveria consultar unidade nula'); },
    });
    assert.equal(chamadasMercury, 0);
    assert.equal(semUnidade.fonteDisponivel, false);
    assert.equal(semUnidade.alunos.length, 0);

    const agrupada = JSON.parse(JSON.stringify(ctx.resultadoFilialAgrupada({ nome: 'Jataí', filial_cobranca_id: 52, nome_filial_cobranca: 'Rio Verde' })));
    assert.equal(agrupada.agrupadaEm, 'Rio Verde');
    assert.match(agrupada.pulada, /Rio Verde/);
});

test('a cobrança não converte fixo ou comissão ausente em total zero', () => {
    const ctx = contextoPrecoApp();
    assert.equal(ctx.totalCobrarModulo2(null, 30, true), null);
    assert.equal(ctx.totalCobrarModulo2(100, null, true), null);
    assert.equal(ctx.totalCobrarModulo2(0, 0, true), 0);
    assert.equal(ctx.totalCobrarModulo2(null, null, false), 0);
});

function contextoCobrancaComMock(cobrancas) {
    const chamadas = [];
    const alertas = [];
    let confirmacoes = 0;
    const query = {
        update(dados) { chamadas.push({ tipo: 'update', dados }); return query; },
        eq(campo, valor) { chamadas.push({ tipo: 'eq', campo, valor }); return query; },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
    };
    const contexto = vm.createContext({
        window: { supabaseClient: { from: () => query } },
        document: { getElementById: () => null },
        localStorage: { getItem: () => null },
        alert: (mensagem) => alertas.push(mensagem),
        confirm: () => { confirmacoes++; return true; },
        __cobrancas: cobrancas,
    });
    vm.runInContext(ciclos, contexto);
    vm.runInContext("mesSelecionadoCobranca = '2026-10'; carregarCobrancasMes = async () => globalThis.__cobrancas;", contexto);
    return { contexto, chamadas, alertas, get confirmacoes() { return confirmacoes; } };
}

test('não fecha rascunho sem contagem válida nem substitui ausência por zero', async () => {
    const mock = contextoCobrancaComMock([{ filial: 'Goiânia', status: 'rascunho', modulo2_contratado: true,
        membros_congelados: null, valor_fixo: null, matriculas: 0, valor_mensalidade: 100, total: null, itens: [] }]);
    await mock.contexto.fecharCobrancaMes();
    assert.equal(mock.confirmacoes, 0);
    assert.equal(mock.chamadas.some(c => c.tipo === 'update'), false);
    assert.match(mock.alertas[0], /contagem de membros não foi congelada/);
});

test('não fecha rascunho com matrículas quando falta mensalidade para a comissão', async () => {
    const mock = contextoCobrancaComMock([{ filial: 'Catalão', status: 'rascunho', modulo2_contratado: true,
        membros_congelados: 18, valor_fixo: 89.28, fixo_manual: false, matriculas: 2,
        valor_mensalidade: null, comissao: null, total: null, itens: [] }]);
    await mock.contexto.fecharCobrancaMes();
    assert.equal(mock.confirmacoes, 0);
    assert.equal(mock.chamadas.some(c => c.tipo === 'update'), false);
    assert.match(mock.alertas[0], /Falta o valor da mensalidade/);
});

test('bloqueia rascunho próprio da filial agrupada e explica cobrança consolidada', async () => {
    const mock = contextoCobrancaComMock([{ filial: 'Jataí', status: 'rascunho', modulo2_contratado: true,
        membros_congelados: null, valor_fixo: null, matriculas: 0, total: 0, itens: [] }]);
    mock.contexto.filiaisDisponiveis = [
        { id: 52, nome: 'Rio Verde' },
        { id: 88, nome: 'Jataí', filial_cobranca_id: 52 },
    ];
    await mock.contexto.fecharCobrancaMes();
    assert.equal(mock.confirmacoes, 0);
    assert.equal(mock.chamadas.some(c => c.tipo === 'update'), false);
    assert.match(mock.alertas[0], /incluída na cobrança de Rio Verde/);
});

test('cobrança sem fonte de matrículas fica pendente e informa que o vínculo com Mercúrio falta', () => {
    const contexto = vm.createContext({ filiaisDisponiveis: [] });
    vm.runInContext(ciclos, contexto);
    const motivo = contexto.motivoPendenciaCobranca({ filial: 'Jataí', status: 'rascunho', modulo2_contratado: true,
        membros_congelados: 18, valor_fixo: 89.28, matriculas: null, comissao: null, total: null });
    assert.match(motivo, /quantidade de matrículas não foi consultada/);
});

test('recalcularTotaisCobranca deixa a linha fechada intacta', async () => {
    const atualizacoes = [];
    const contexto = vm.createContext({
        window: { supabaseClient: { from(tabela) {
            const query = {
                select() { return query; },
                eq() { return query; },
                single() { return Promise.resolve({ data: { valor_fixo: 100, valor_mensalidade: 200, matriculas: 2, modulo2_contratado: true, status: 'fechada' }, error: null }); },
                update(dados) { atualizacoes.push({ tabela, dados }); return query; },
                then(resolve) { return Promise.resolve({ count: 3 }).then(resolve); },
            };
            return query;
        } } },
    });
    vm.runInContext(ciclos, contexto);
    await contexto.recalcularTotaisCobranca(42);
    assert.equal(atualizacoes.length, 0);
});

test('valor manual zero permite cobrança sem contagem, e fechamento não reescreve faturas fechadas', async () => {
    const mock = contextoCobrancaComMock([
        { filial: 'Histórica', status: 'fechada', modulo2_contratado: true, membros_congelados: null,
            fixo_manual: false, valor_fixo: null, matriculas: 0, valor_mensalidade: 100, total: null, itens: [] },
        { filial: 'Nova', status: 'rascunho', modulo2_contratado: true, membros_congelados: null,
            fixo_manual: true, valor_fixo: 0, matriculas: 0, valor_mensalidade: 100, total: 0, itens: [] },
    ]);
    await mock.contexto.fecharCobrancaMes();
    assert.equal(mock.confirmacoes, 1);
    assert.equal(mock.chamadas.some(c => c.tipo === 'update' && c.dados.status === 'fechada'), true);
    assert.deepEqual(mock.chamadas.filter(c => c.tipo === 'eq' && c.campo === 'status').map(c => c.valor), ['rascunho']);
});

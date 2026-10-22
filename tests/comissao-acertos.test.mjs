import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const fonte=fs.readFileSync(new URL('../js/comissao-acertos.js',import.meta.url),'utf8');
const ctx=vm.createContext({});vm.runInContext(fonte,ctx);
const calc=linhas=>JSON.parse(JSON.stringify(ctx.calcularAcertosComissao(linhas)));
test('pagamento por estimativa maior vira desconto no mês seguinte, uma vez só',()=>{
 const r=calc([{mes:'2026-07',comissao_devida:300,valor_recebido:400},{mes:'2026-08',comissao_devida:200,valor_recebido:100},{mes:'2026-09',comissao_devida:150,valor_recebido:150}]);
 assert.equal(r[0].saldoSeguinte,-10000);assert.equal(r[1].ajustado,10000);assert.equal(r[1].saldoSeguinte,0);assert.equal(r[2].ajustado,15000);
});
test('pagamento menor aumenta o próximo mês e correção tardia recalcula todos os seguintes',()=>{
 const rows=[{mes:'2026-07',comissao_devida:300,valor_recebido:200},{mes:'2026-08',comissao_devida:200,valor_recebido:300}];
 assert.equal(calc(rows)[1].saldoSeguinte,0);rows[0].comissao_devida=450;
 assert.equal(calc(rows)[1].ajustado,45000);assert.equal(calc(rows)[1].saldoSeguinte,15000);
});
test('crédito maior que comissão permanece até ser consumido',()=>{
 const r=calc([{mes:'2026-07',comissao_devida:100,valor_recebido:500},{mes:'2026-08',comissao_devida:150,valor_recebido:0},{mes:'2026-09',comissao_devida:300,valor_recebido:50}]);
 assert.equal(r[1].ajustado,-25000);assert.equal(r[1].aReceber,0);assert.equal(r[1].creditoDaEscola,25000);assert.equal(r[2].saldoSeguinte,0);
});
test('valor desconhecido e mês ausente não são tratados como pagamento zero',()=>{
 assert.equal(calc([{mes:'2026-07',comissao_devida:100,valor_recebido:null},{mes:'2026-08',comissao_devida:200,valor_recebido:0}])[1].ajustado,null);
 assert.equal(calc([{mes:'2026-07',comissao_devida:100,valor_recebido:100},{mes:'2026-09',comissao_devida:200,valor_recebido:0}])[1].ajustado,null);
 assert.equal(calc([{mes:'2026-07',comissao_devida:100,valor_recebido:0}])[0].saldoSeguinte,10000);
});
test('centavos exatos, rejeita negativos, inválidos e casas extras',()=>{
 assert.equal(ctx.centavosAcerto('4,96'),496);assert.equal(ctx.centavosAcerto('0'),0);assert.equal(ctx.centavosAcerto(''),null);
 for(const v of ['NaN','Infinity','-1','1.999','abc','1e5'])assert.throws(()=>ctx.centavosAcerto(v));
 assert.equal(calc([{mes:'2026-12',comissao_devida:'4.96',valor_recebido:'4.95'},{mes:'2027-01',comissao_devida:'4.96',valor_recebido:'4.97'}])[1].saldoSeguinte,0);
});

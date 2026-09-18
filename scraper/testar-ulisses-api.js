// Roda `npm run testar-ulisses-api` a qualquer momento pra conferir se o
// Célio (Acrópole Brasil) já autorizou o client_id da API oficial do
// Ulisses pros endpoints que a integração precisa de verdade — sem
// precisar pedir pra alguém testar via curl/Postman na mão. Ver
// scraper/ulisses-api.js e CLAUDE.md ("API oficial do Ulisses").
import 'dotenv/config';
import * as api from './ulisses-api.js';

const TESTES_PUBLICOS = [
    ['tiposEvento()', () => api.tiposEvento()],
    ['proximosEventos()', () => api.proximosEventos()],
];

// filialId/eventoId são chutes só pra disparar a chamada — o que importa
// aqui é o STATUS HTTP (401 = ainda sem scope; 200/404/etc = já tem
// scope, e a resposta em si já pode ser usada). Trocar por um ID real
// assim que soubermos o ID da nossa filial na base deles (facade/filiaisAtivas).
const TESTES_PROTEGIDOS = [
    ['filiaisAtivas()', () => api.filiaisAtivas()],
    ['filial(1)', () => api.filial(1)],
    ['listarTodosEventos(1)', () => api.listarTodosEventos(1)],
    ['participantesEvento(24343)', () => api.participantesEvento(24343)],
    ['csvInscricoes(1)', () => api.csvInscricoes(1)],
];

async function rodarGrupo(titulo, testes, statusEsperadoSeBloqueado) {
    console.log(`\n=== ${titulo} ===`);
    for (const [nome, fn] of testes) {
        try {
            const resultado = await fn();
            const resumo = typeof resultado === 'string' ? resultado.slice(0, 120) : JSON.stringify(resultado).slice(0, 120);
            console.log(`  ✅ ${nome} -> OK: ${resumo}`);
        } catch (erro) {
            const bloqueadoComoEsperado = statusEsperadoSeBloqueado && erro.status === statusEsperadoSeBloqueado;
            console.log(`  ${bloqueadoComoEsperado ? '🔒' : '❌'} ${nome} -> ${erro.message}`);
        }
    }
}

async function main() {
    console.log('Testando API oficial do Ulisses (https://api.acropolebrasil.com.br/)...');
    await rodarGrupo('Endpoints públicos (deveriam sempre funcionar)', TESTES_PUBLICOS, null);
    await rodarGrupo('Endpoints protegidos (🔒 = ainda sem scope, esperado até o Célio liberar)', TESTES_PROTEGIDOS, 401);
    console.log('\nSe TODOS os protegidos ainda aparecerem com 🔒, nada mudou do lado da Acrópole Brasil ainda.');
    console.log('Se algum virar ✅, já dá pra começar a migrar aquele pedaço do scraper pra API oficial.');
}

main().catch((erro) => {
    console.error('Erro inesperado rodando o teste:', erro);
    process.exit(1);
});

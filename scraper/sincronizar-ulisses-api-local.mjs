// Sincroniza eventos + Inscrições do Ulisses via API oficial — LOCAL,
// mas 100% HEADLESS (sem janela de Chromium visível, sem login manual
// nenhum) — diferente de `ulisses-local.js`, que precisa de você resolver
// o Cloudflare/logar à mão pro comparecimento.
//
// Por quê existe SEPARADO de `ulisses-local.js` (que já ganhou este MESMO
// passo dentro do loop por filial, ver `sincronizar-inscricoes-via-api`):
// esta chamada não depende de login humano em NADA (é OAuth2 client
// credentials — token, sem tela), então dá pra rodar sozinha, sem
// supervisão — inclusive numa Tarefa Agendada do Windows, todo dia de
// manhã, sem precisar o usuário estar na máquina. Reaproveita a MESMA
// função (`executarSomenteUlissesApi`) que o CRM disparava antes via
// GitHub Actions — descoberto (2026-09-21, 2 testes reais) que
// api.acropolebrasil.com.br está atrás do MESMO Cloudflare que já
// bloqueava login por navegador, e o bloqueio NÃO poupa chamada HTTPS
// pura com token — GitHub Actions (IP de datacenter) recebe a mesma
// página de desafio "Just a moment..." no lugar do JSON esperado, mesmo
// com Bearer válido. Rodando desta máquina (IP residencial), funciona.
//
// Uso:
//   npm run ulisses-api-local              (todas as filiais ativas)
//   npm run ulisses-api-local -- "Garavelo" (só 1 filial)
//
// Também aceita ser chamado pelo protocolo customizado
// abrirulissesapi://rodar?filial=Garavelo (botão "Sincronizar via API do
// Ulisses agora" no CRM, ver abrirProtocoloUlissesApi() em
// js/importador.js). **Registrado apontando DIRETO pro node.exe, sem
// nenhum cmd.exe/.bat no meio** (`HKCU\Software\Classes\abrirulissesapi`)
// — bug real achado testando de verdade (2026-09-21): cmd.exe interpreta
// `%` como caractere de variável, então uma URL codificada
// (`?filial=Barra%20do%20Gar%C3%A7as`) passada por um `.bat` chegava
// corrompida (`Barra0do0GarA7as` — "%20"/"%C3" viravam "0"/"A7", o
// cmd.exe tentando expandir "%2"/"%C" como parâmetro). Indo direto pro
// node.exe (sem shell nenhum reinterpretando o argv), a URL chega
// intacta — é assim que qualquer app registrado como handler de
// protocolo customizado deveria receber o argumento.
// `process.chdir()` logo abaixo substitui o `cd /d` que um `.bat` faria
// — sem ele, dotenv (dotenv/config) não acharia o `.env` desta pasta se
// o processo for iniciado com outro diretório de trabalho (o padrão ao
// vir do protocolo customizado).
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.chdir(path.dirname(fileURLToPath(import.meta.url)));

const argRaw = process.argv[2];
if (argRaw && argRaw.startsWith('abrirulissesapi://')) {
    try {
        const filial = new URL(argRaw).searchParams.get('filial');
        if (filial) process.env.FILTRO_FILIAL = filial;
    } catch { /* URL malformada — ignora, roda todas as filiais */ }
    process.argv.splice(2, 1); // tira a URL crua pra não confundir o parsing normal de argv em executarSomenteUlissesApi()
}

// Imports dinâmicos, DEPOIS do chdir — imports estáticos (`import ... from`)
// são içados e rodam antes de qualquer código deste arquivo, o que
// executaria dotenv/config (e leria mercurio.js) ANTES do chdir acima.
const { default: dotenv } = await import('dotenv');
dotenv.config();
const { executarSomenteUlissesApi } = await import('./mercurio.js');

executarSomenteUlissesApi().catch(e => { console.error('[ulisses-api-local] Erro fatal:', e); process.exit(1); });

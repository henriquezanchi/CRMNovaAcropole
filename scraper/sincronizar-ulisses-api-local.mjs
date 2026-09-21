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
import 'dotenv/config';
import { executarSomenteUlissesApi } from './mercurio.js';

executarSomenteUlissesApi().catch(e => { console.error('[ulisses-api-local] Erro fatal:', e); process.exit(1); });

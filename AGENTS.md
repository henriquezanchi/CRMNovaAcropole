# AGENTS.md — CRM Nova Acrópole (guia de entrada para agentes)

Este arquivo é o ponto de partida para qualquer agente de código (Codex etc.)
neste repositório. Ele diz **o que o sistema é, onde cada peça mora e quais
regras não podem ser quebradas**. O histórico completo — cada decisão, cada bug
real e por que foi corrigido do jeito que foi — está em **`CLAUDE.md`** (muito
longo; consulte por busca de palavra-chave, não leia inteiro de uma vez).

Idioma do projeto: **português** (código, comentários, nomes de função, commits).

---

## 1. O que é

CRM interno, multi-filial, da escola de filosofia **Nova Acrópole** (Goiânia e
região), operado por uma agência de SDR. Serve para prospectar e resgatar
leads, convidar para eventos (palestras, aulas experimentais, Abertura de
Turma), conversar pelo WhatsApp oficial e medir matrículas para cobrança da
agência.

Filiais ativas: Goiânia - Jardim América, Goiânia - Setor Oeste, Goiânia -
Garavelo, Goiânia II, Barra do Garças/MT.

Usuários: time de SDR/agência e voluntários das escolas. Não é site público.

## 2. Onde as coisas estão

| O quê | Onde |
|---|---|
| Código-fonte (editar aqui) | `G:\Meu Drive\01 - Negócios e Projetos\Zanchi AudioVisual\Aletheia Arquitetura Educacional\CRM\crm-agencia-na` (pasta do Google Drive) |
| Repositório | `https://github.com/henriquezanchi/CRMNovaAcropole` — branch `main` |
| Site publicado | Vercel, `https://crm-nova-acropole-5dv3.vercel.app/` — site estático, sem build; push na `main` publica |
| Banco / backend | Supabase, projeto `eovgljcowblwoxmobeno` (Postgres + Edge Functions em Deno + Storage + pg_cron) |
| Cópia para RODAR o scraper | `C:\Scrapper` (clone git separado em disco local, com `node_modules` e Playwright) |
| Dev local | Live Server do VS Code em `127.0.0.1:5500` |

**Por que existem duas cópias:** `G:\` é um drive em streaming do Google Drive.
`npm install` e Playwright não funcionam nele (arquivos de 0 byte, `EBADF`).
Edite sempre em `G:\`; para rodar algo de `scraper/`, sincronize com
`C:\Scrapper` (commit + push aqui, `git pull` lá). Esquecer essa sincronização
já causou bug real em produção.

## 3. Stack

- **Frontend:** HTML + CSS + JavaScript puro. **Sem framework, sem bundler, sem
  `package.json` na raiz.** Os arquivos de `js/` são `<script>` clássicos
  carregados em ordem pelo `index.html` e compartilham um único escopo global.
- **Bibliotecas via CDN apenas:** supabase-js 2, Papa Parse, JSZip, SheetJS.
- **Banco:** acessado direto do navegador com a chave *publishable* (já no
  `index.html`). Quase todas as tabelas têm RLS `using(true)` — acesso aberto
  por design.
- **Edge Functions** (`supabase/functions/`): tudo que precisa de segredo ou de
  receber webhook — WhatsApp (Meta Cloud API), chamadas à Anthropic, cofre de
  credenciais, sincronização com o Mercury.
- **Scraper** (`scraper/`, Node + Playwright): roda fora do Supabase, via GitHub
  Actions (`.github/workflows/scraper.yml`) ou localmente em `C:\Scrapper`.

## 4. Mapa do código

```
index.html            todas as abas, gaveta do lead e modais
css/style.css         todo o CSS; tokens de cor em :root
js/app.js             núcleo: Kanban, gaveta do lead, tags, filtros, relatórios (arquivo principal)
js/whatsapp.js        WhatsApp Unificado, chat da gaveta, convites em massa, Disparo Inteligente
js/importador.js      importação das planilhas Mercúrio/Ulisses -> leads + tags
js/eventos.js         Agenda de eventos e participantes
js/leads-a-tratar.js  duplicados, mesclagem, leads sem telefone
js/notificacoes.js    sino de notificações (10 gatilhos)
js/visao-geral.js     "Agenda do Dia" cruzando todas as filiais
js/tarefas.js         tarefas e equipes
js/acesso.js, js/usuarios.js     login nominal e permissão por módulo
js/log-atividade.js   auditoria append-only
js/relatorios-whatsapp.js, js/importar-conversa-whatsapp.js, js/matricula-importar.js
supabase/functions/   ~28 Edge Functions; código comum em _shared/
migracao_*.sql        migrações SQL soltas na raiz (sem ferramenta de migração)
scraper/              Playwright (Mercúrio legado, Ulisses) + cliente da API do Ulisses
tools/lint/verificar-globais.mjs   verificador de variáveis indefinidas, sem dependências
```

## 5. Integrações externas

- **Banco de consulta do Mercúrio (phpMyAdmin, atualizado toda noite):** fonte
  da conciliação de matrículas por turma, reingresso/recuperado, atraso de
  contribuição, membros e canal de origem. Edge Function `mercurio-db-sincronizar`
  (cron 03:00 Brasília, 1x/dia — a base só atualiza ~23h), cliente em `_shared/phpmyadmin.ts`. Contém ativos e inativos; a rotina financeira filtra `cad_situacao='ATI'` explicitamente.
  Ver seção própria no CLAUDE.md.
- **Mercury (API nova do Mercúrio, sistema acadêmico):** REST com Bearer `mrc_...`.
  Fonte de alunos ativos/inativos, nível, data de ingresso e dossiê. Sincronizada
  pela Edge Function `mercury-sincronizar` (1 cron por filial, 03:10 a 03:30).
  Chave em `.env.local` (git-ignorado) e no secret `MERCURY_API_KEY` do Supabase.
- **Mercúrio legado:** scraper Playwright (`scraper/mercurio.js`) **desligado em
  2026-10-18** — tudo que ele fazia passou pro banco de consulta e pra API do
  Mercury (ver tabela no CLAUDE.md, "Scraper antigo do Mercúrio DESLIGADO").
- **Ulisses (inscrições em eventos):** API oficial OAuth2. O Cloudflare deles
  **bloqueia IP de datacenter, inclusive GitHub Actions**, então tudo do Ulisses
  roda na máquina do usuário (`C:\Scrapper`, Tarefas Agendadas do Windows).
- **WhatsApp:** Meta Cloud API oficial; envio por `whatsapp-send`, recebimento
  por `whatsapp-webhook`. Fora da janela de 24h só sai template aprovado
  (lista em `TEMPLATES_WHATSAPP`, `js/whatsapp.js`).
- **Anthropic:** sugestões de resposta, classificação de convite, diagnóstico,
  resumo. Chamada centralizada em `supabase/functions/_shared/anthropic.ts`,
  com cache de prompt e log de tokens em `ia_uso_tokens`.

## 6. Regras que não podem ser quebradas

1. **Não introduzir framework, build step nem `package.json` na raiz.** A Vercel
   publica o projeto como estático porque não existe `package.json`; criar um
   pode derrubar o site.
2. **`pessoaIdentificador` é a chave de tudo** em `leads_inscricoes` (texto, único).
   Comparações `gte`/`lt` nele são lexicográficas, não numéricas.
3. **Paginação sempre com `.order('pessoaIdentificador')`**, e qualquer consulta
   que possa passar de 1000 linhas precisa paginar: o PostgREST trunca em 1000
   sem avisar. Esse limite já causou vários bugs silenciosos.
4. **Upsert em lote: todas as linhas com exatamente as mesmas chaves.** O
   supabase-js preenche chave ausente com `null` e sobrescreve o valor real.
   Deduplique por `pessoaIdentificador` antes de enviar.
5. **Reimportar nunca apaga dado bom:** `funil_agencia`, `resumo_ia`, telefone e
   e-mail já gravados são preservados quando a fonte da vez não traz o dado.
6. **Filtrar `tags` (jsonb guardado como string) não funciona com `.ilike()`.**
   Use uma função SQL chamada por `.rpc()`, com `(tags #>> '{}')::jsonb`.
7. **IA não decide quem é contatado nem inventa fato.** Seleção e ranking são
   regra fixa (SQL/JS); a IA só redige. A única exceção autônoma deliberada é
   `reengajar-janela-fechando`.
8. **Envio em massa no WhatsApp: 1 por vez, com pausa** (`calcularPausaEnvioMassa`).
   Rajada simultânea já gerou aviso de violação de política da Meta.
9. **Ação disparada por webhook da Meta precisa ser idempotente.** A Meta
   reentrega eventos; um comando sem trava já mandou a mesma mensagem 5 vezes
   para leads reais. Use claim atômico (`UPDATE ... WHERE status='pendente'`).
10. **Chave de coluna do Kanban em seletor CSS sempre com `CSS.escape()`.**
11. **IDs sintéticos de lead** usam faixas reservadas (900M, 950M, 970M, 980M,
    985M, 990M, 996M) e sempre incluem a filial. Um contador sem filial já
    sobrescreveu leads de outra unidade.
12. Tabela `credenciais_scraper` é a única sem acesso público. Nunca expor
    segredo (`.env.local`, service role, tokens) no frontend nem em commit.

## 7. Como validar uma mudança

```bash
node --check js/<arquivo>.js
node tools/lint/verificar-globais.mjs     # pega ${variavel} indefinida em template literal
```

O linter não entende escopo de callback aninhado (`.map((b) => ...)`); revise
renomeações à mão. Não há suíte de testes automatizados nem Playwright
disponível em `G:\`. Teste contra o Supabase de produção com dados
descartáveis e apague depois; o lead de teste do dono é `pessoaIdentificador`
`904000019`.

Migrações: escrever `migracao_<nome>.sql` na raiz e aplicar com
`npx supabase db query --linked --file migracao_<nome>.sql`. Deploy de função:
`npx supabase functions deploy <nome>`. O CLI só existe via `npx`. As duas
ações mexem em produção — confirme com o usuário antes.

Commit: quando o usuário pedir commit, faça push em seguida. Não commitar
`scratch_protocolo_conversao.html` nem planilhas `.xlsx`.

## 8. Estado atual (2026-10-17)

**Funcionando em produção:** Kanban com colunas dinâmicas, importação
Mercúrio/Ulisses, tags automáticas (Ativo/Inativo, nível, Lead Forte 1-3,
Trilha/Jornada, Contato Recente), Agenda de eventos com origem
Ulisses/CRM, WhatsApp Unificado multi-filial (anexos, áudio, reações,
respostas, encaminhar, fixar/arquivar, respostas rápidas), convites em massa
(link wa.me, API, janela aberta, Disparo Inteligente do Dia com cota
proporcional), sugestão de resposta por IA, Resumo Diário no WhatsApp do admin
com comando "SIM", relatório de Comissão do SDR com Excel de cobrança, login
nominal por módulo, log de auditoria, lixeira e remoção LGPD.

**Em aberto:**
- Template `retomar_contato_livre` adicionado em `js/whatsapp.js` e **ainda não
  commitado**; precisa ser aprovado na Meta antes de funcionar.
- `mercury-sincronizar` sem agendamento; backfill de dossiê avança 30 pessoas
  por filial por rodada.
- Receita real do Mercury (`/branches/{id}/movements`) validada, sem tela.
- Conciliação de matrículas por turma: construída sobre o banco do Mercúrio
  (Relatórios). Outubro: GYN2 12/12, GAR 7/7, SO 7/7, JA 0/9 (turma de
  outubro do JA ainda não cadastrada no Mercúrio). Falta saber o significado
  dos códigos de "como conheceu a escola".
- Lacunas da API do Mercury a pedir ao responsável (Gabriel): data de abertura
  da turma em `/classes`, data de reingresso (`reentry` sempre vazio),
  `receipts` vazio, `contribution-plan` nulo, falta de `/branches`.
- Nada no fluxo de UI foi testado clicando de verdade nas últimas rodadas;
  validações foram por chamada direta à API e leitura de código.

## 9. Perfil de quem decide

O dono do projeto (Henrique) não é programador. Ele descreve o problema de
negócio, às vezes com print. Explique em linguagem simples, pergunte antes de
ações destrutivas ou que mexam em produção, e diga com clareza o que foi e o
que não foi testado.

- **Cobrança mensal (2026-10-18):** Edge Function `cobranca-mensal` (cron
  09:00, só age no dia 10 ou próximo dia útil) gera rascunho por filial a
  partir dos ciclos de abertura de turma (`ciclos_turma`, cadastrados por
  filial em Relatórios) e manda o resumo pro WhatsApp do admin; o usuário
  revisa e fecha no CRM (`js/cobranca-ciclos.js`). Detalhes no CLAUDE.md.

## Auditoria nacional de cadastros (19/10/2026)

A view nacional do Mercúrio agora contém ATI e INA. A sincronização financeira deve filtrar `cad_situacao='ATI'`. A auditoria compara ambos; ausência não significa inativo. Painel em Cadastros e detalhes em `docs/AUDITORIA-BASE-CRM.md`. Mesclagens usam `mesclar_leads_preservando_vinculos`, com backup privado, aliases e reconsulta de ativos apenas dos sobreviventes. Não voltar ao antigo update/delete sem transferência de vínculos.

## Integridade dos contatos e IDs sintéticos (19/10/2026)

Ver `docs/RECUPERACAO-CONTATOS.md`. Não fabricar DDD por escola, nem usar posição da lista como identidade. O importador usa IDs estáveis e confere colisões globalmente antes de gravar. `Contato em conferência` bloqueia envios; `Histórico em conferência` bloqueia auto mesclagem. Não remover essas sinalizações para conseguir executar uma campanha. Fonte recente mínima e backups ficam preservados nas tabelas de auditoria; eventos separados não comprovam participação. Status da rede exige contato e nome compatíveis, não basta telefone/e-mail de uma família.

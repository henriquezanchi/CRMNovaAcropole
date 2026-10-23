# Continuidade — aberturas de turma, secretarias e avaliação de interessados

Atualizado em 23/10/2026. Solicitante: Henrique. Documento para continuidade com Claude/Codex. Não contém senhas, tokens nem links pessoais de acesso.

## Objetivo autorizado e decisões

Implementar no BPO uma área completa ligada à Secretaria de Abertura de Turma: planejamento do primeiro dia de aula, ciclo de palestras culturais anteriores, calendário, metas, orçamento, tarefas, docentes, substituições, interessados do Ulisses via CRM, matrículas Mercúrio e relatórios. Criar Rede de Secretarias com administração nacional/regional/local, materiais, avisos, reuniões, ideias e planos. Compartilhar aprendizados agregados entre filiais, sem ranking desmotivador.

Aulas: uma vez por semana, 120 minutos, dois titulares. Disponibilidade deve ser declarada/confirmada e válida por período, nunca inferida de agenda vazia. Comparar alternativas considerando docentes/substitutos, ocupação, escalas, eventos, procura conhecida, dia da semana e mês do ano.

**Correção explícita do usuário:** abandonar completamente Lead Forte. A experiência real não confirmou propensão dos contatos. Retirar tags/heurísticas antigas de prioridades, notificações, importação e WhatsApp. Não transformar inscrição no Ulisses em presença, interesse ou intenção de matrícula. Preservar dados brutos e backups.

Novo modelo: interesse declarado, adequação à abertura/horário e próxima ação, sem score ou probabilidade. Ausência de dado = a confirmar. Registrar acontecimentos com data, fonte, natureza e responsável; snapshots imutáveis/versionados antes do resultado; ações de atendimento e desfechos; aprender comparando avaliações e matrículas confirmadas, sem confundir atenção recebida com efeito do modelo. Pedido canônico de não contato tem prioridade absoluta, inclusive tag legada.

O usuário pede economia de tokens: não reexplorar o repositório inteiro nem repetir discussões. Continuar deste documento.

## Repositórios e estado de trabalho

- BPO: `/workspace/BPO-eventos`, GitHub `henriquezanchi/BPO`, produção `portal-na-one.vercel.app`, branch remota `master`; branch local `melhorar-compartilhamento-eventos`. Base antes deste trabalho: `56ad7c2` (Play).
- CRM: `/workspace/CRM-cobranca`, GitHub `henriquezanchi/CRMNovaAcropole`, produção `crm-nova-acropole-5dv3.vercel.app`, remoto `main`; local `atualizar-cobranca-membros`. Base: `cf4844d`.
- Não tocar alterações antigas de `/workspace/CRMNovaAcropole` nem outros worktrees.
- Este trabalho está nos arquivos novos/modificados destes dois diretórios. Consulte `git status` e o bloco de publicação no fim antes de agir.

## Implementação BPO

- `prisma/schema.prisma`: AberturaTurma (inclui mercurioTurmaId), AberturaRegistro append-only na aplicação, ProfessorDisponibilidade, SecretariaEscala, AberturaConfig, AberturaCrmCache, SecretariaMandato, SecretariaPublicacao, SecretariaLeitura.
- Migração `prisma/migrations/20261023020000_aberturas_secretarias/migration.sql`: **já aplicada em produção**; RLS e revogação anon/authenticated das nove tabelas; constraints de duração/capacidade; RPC privada de cofre. Registro em `_prisma_migrations` foi solicitado; verificar conclusão no banco. Não rodar CREATE TABLE outra vez.
- Página `/voluntario/aberturas`, componentes `src/components/aberturas/`: sete abas Resumo, Planejamento, Ciclo cultural, Interessados, Investimentos, Equipe e horários, Aprendizados. Formulários de abertura, tarefas, palestras, sinais, snapshots, despesas, resultados e aprendizado; edição/revogação das disponibilidades/escalas; tabela de aprendizagem por estados.
- `src/lib/actions/aberturas-actions.ts`: autorização em cada action, revisão concorrente, bloqueio transacional de duas turmas planejadas disputando sala/docentes, datas/valores validados. Ao registrar sinal, congela avaliação e tenta transmitir ao CRM; falha mantém registro local e mostra aviso. Resultado requer turma acadêmica exata, pessoa e data confirmadas; coortes presenciais são observação local explícita.
- `src/lib/aberturas/permissoes.ts`: direção/secretaria responsável/mandato de Abertura; estados e escolas por interseção. Membro precisa estar ativo.
- `src/lib/aberturas/planejador.ts`: motor puro de horários; intervalos semiabertos, todas as ocorrências na janela até um ano, indisponibilidade, suplentes, ocupação e funções voluntárias. Alternativa de dia/horário exige confirmar titulares.
- `src/lib/aberturas/comparacao.ts`: adapta agendas e resumo acadêmico, eventos visíveis à filial, outras aberturas e escalas; não reserva automaticamente substitutos indisponíveis; falta de agenda vira pendência. Histórico de mês do ano agrega anos diferentes. Sinais de disponibilidade valem apenas para o contexto de horário registrado.
- `src/lib/aberturas/avaliacao.ts`: usa motor compartilhado; consulta CRM antes de congelar; preferência canônica vence sinal velho; falha da consulta manda conferir preferência antes de contato; snapshot posterior à matrícula não vira previsão.
- `src/lib/aberturas/sincronizacao.ts`: envia snapshots locais idempotentemente em lotes, atualiza cache e incorpora matrículas da turma exata entre 90 dias antes e 30 dias depois da primeira aula; IDs estáveis evitam duplicar. Não escreve no Mercúrio.
- `src/app/api/cron/aberturas/route.ts` + `vercel.json`: diário às 09:15 UTC (06:15 Brasília), CRON_SECRET/timingSafeEqual. Só filiais com aberturas planejadas/em curso/concluídas recentes. Rascunhos usam botão manual. Sem envio de mensagens.
- `src/lib/aberturas-data.ts`: DTO por filial, sem credenciais; previews por lead/abertura; relatórios e agregados.
- `src/lib/aberturas/relatorios.ts`: despesas previstas/realizadas, matrícula única, custo, conversão com vínculo explícito, coortes observadas e snapshots anteriores. Validação das avaliações: janela inicial de 30 dias após primeira aula; só classifica ausência quando abertura concluída e base cobre o período. Pendências não viram fracassos.
- `src/lib/aberturas/experiencias.ts`: padrões de ciclo cultural/capacidade com opt-in, pelo menos três aberturas, dez interessados, duas escolas e base completa; sem nomes/contatos/texto livre e sem alegar causalidade.
- `src/lib/calendario-filial.ts`: inclui ciclos/aberturas planejadas; eventos externos agora respeitam política de alcance da filial.
- `src/lib/secretarias-rede/{regras,acesso,dados}.ts`, `secretarias-rede-actions.ts`, componentes e `/voluntario/secretarias`: biblioteca/versionamento/confirmação de leitura, mandatos e escalas. Administração nacional geral atribui nacional; titular nacional da secretaria administra regionais; direção administra locais nas escolas chefiadas. Não pode editar/revogar mandato superior. Território é interseção de UFs/escolas. Materiais HTTPS, sem executar HTML.
- Navegação: `src/lib/area-trabalho.ts`, `src/components/trabalho/nav-trabalho.tsx`.
- Manual de operação: `docs/ABERTURAS-TURMAS.md`.

## Implementação CRM

- `js/propensao-modelo.js`: motor puro UMD compartilhado, versão atual **1.0.2**. Cópia BPO `src/lib/aberturas/propensao-modelo.js` deve ficar byte a byte igual; verificar SHA-256. API `avaliar({sinais,abertura,agora,versao,preferenciaContato})`.
- Sinais: interesse_declarado, disponibilidade_confirmada, presenca_palestra, outra_atividade, resposta_atendimento, pedido_matricula, nao_contatar, acao_realizada, resultado_atendimento. Disponibilidade exige aberturaId + contextoHorario (diaSemana/inicioMinuto); mudar horário exige reconfirmar. Interesse permitido: a_confirmar/conhecer/participar/inscrever/depois/nao. Preferência canônica bloqueada vence sinais antigos. Futuros são ignorados.
- `js/propensao-crm.js`: adaptador de acompanhamento declarado/carimbado, resumo sem ranking; tag legada de não contato também bloqueia.
- `js/acompanhamento-modelo.js`, `js/acompanhamento.js`: preservam carimbos separados de intenção e preferência; editar contato não redata interesse.
- `js/importador.js`: sem geração Lead Forte/Jornada/Retorno por contagem; novas tags factuais.
- `js/app.js`, `visao-geral.js`, `tarefas.js`, `whatsapp.js`, `notificacoes.js`, `leads-a-tratar.js`, `index.html`: retirados ranking/ordenamento/modal/gatilho antigos; inscrições são contexto a conferir; consultas frescas de preferência antes dos contatos. Todas as demais funções de deduplicação e atendimento devem ser preservadas.
- `migracao_propensao_crm.sql`: **aplicada**, com backup privado das tags antigas; tabelas privadas append-only de avaliações, acontecimentos, ações e resultados; RPC restrita de preferência atômica sob lock, sem re-datar intenção. Sem data confiável, não revoga bloqueio legado por replay. Reaplicação é idempotente.
- `migracao_propensao_tags_estado.sql`: **aplicada**, backup e backfill idempotente de Interesse a confirmar / Interesse declarado / Interesse declarado: não / Não contatar; parser privado seguro preserva fontes inválidas; não cria adequação global. Teste SQL `tests/propensao-tags-estado.sql` passou contra helpers sem gravações (ROLLBACK).
- `supabase/functions/bpo-aberturas/index.ts`: ponte GET/POST com verify_jwt=true + papel service_role. Filial usa `mercurio_unidade` exata ativa; sem fuzzy por nome. GET retorna leads, sinais, preferência canônica/tag, matrículas ativas/inativas e avaliações; baseAtualizadaEm vem da fonte acadêmica, sincronizadoEm separado. POST guarda snapshots enviados sem recalcular cronologia, valida filial/lead, idempotência por fingerprint, opt-out canônico antes dos appends.
- `supabase/functions/_shared/preferencia-contato.ts`, `whatsapp-send/index.ts`, `ia-recomendar-contatos/index.ts`: respeitam bloqueio canônico e tag legada no servidor; recomendação IA não pode inferir intenção/presença de inscrição. Não foi enviada mensagem de teste nem campanha.
- `docs/PROPENSAO-CRM-BPO.md`: contrato detalhado.

## Infraestrutura aplicada e verificada

- BPO Supabase `lefahgczkonbqcppyftg`; CRM `eovgljcowblwoxmobeno`.
- Chave CRM guardada em Vault BPO, nome `aberturas_crm_service_key`; função `public.aberturas_crm_chave()` só servidor/service_role. Não exportar chave ou colocar em `.env` público.
- Helpers temporários `/tmp/bpo-sql.py`, `/tmp/crm-sql.py`, `/tmp/crm-deploy.py` usam Management API e credenciais configuradas. Não imprimir ambientes ou segredos.
- Ponte CRM foi publicada e GET Barra do Garças retornou 878 leads e 121 matrículas, base **17/10/2026**. Não confundir sincronização recente com base atualizada.
- Deploys feitos durante trabalho: bpo-aberturas (versão 2 até última confirmação), whatsapp-send 40 e ia-recomendar-contatos 14. Houve correções posteriores em leitura de tag legada/contextoHorario: **republicar versões finais antes de declarar concluído**.
- Hidratação inicial dos caches das filiais exatas em execução por `/tmp/hidratar-aberturas.py`. Conferir resultado; consulta isolada funcionou. Não cadastrar pessoas/filiais fictícias.
- RLS verificado: tabelas novas não são legíveis por anon/authenticated, RPC de preferência não é pública. Teste transacional de abertura + constraint de 120 minutos passou com ROLLBACK, sem resíduos.

## Verificações

- CRM: suíte completa **122/122 passou** na última rodada. Dependência de teste PGlite instalada em `/tmp/crm-test-deps` e symlink temporário `/workspace/CRM-cobranca/node_modules/@electric-sql/pglite`; não commitar dependências, não criar package.json na raiz CRM. Remover symlink temporário após testes.
- BPO: testes de planejador/relatórios/secretarias passaram (19 na rodada anterior); experiência agregada tem um teste extra passando. Rodar novamente todos os arquivos novos após últimas correções.
- TypeScript e ESLint direcionado passaram nas rodadas anteriores; build Next passou antes das últimas correções. Repetir build final depois de remover fixture local.
- Playwright: **14 verificações de abas** (sete em desktop e sete em 390px), zero erros JS e sem overflow com moldura equivalente à real. A fixture local `src/app/verificacao-aberturas-local/` foi removida depois; **não publicar rota de teste**. Dev local port3013 ainda pode estar rodando. Não foi executado fluxo autenticado real de edição em produção.
- Linter heurístico CRM acusa três suspeitas conhecidas de escopo de callback/template; revisar `/tmp/crm-globais.log`, não confundir com parser. Checks Node passaram.

## Próximos passos exatos para fechar

1. Conferir `git status` de ambos; garantir ausência de fixture de teste, arquivos de exportação/segredos e dependências temporárias no commit.
2. Executar testes novos BPO, TypeScript, ESLint e build final. CRM full tests já passaram; repetir apenas se mudar código.
3. Conferir migração registrada e cache inicial; republicar versões finais das três Edge Functions citadas.
4. Commit/push BPO em `master` e CRM em `main`; publicações anteriores já foram autorizadas no histórico e implantação faz parte do pedido atual.
5. Verificar produção: rotas privadas redirecionam usuário sem sessão; cron sem segredo rejeita; ponte sem serviço rejeita. Não entrar como alunos nem disparar mensagens para testar.
6. Atualizar este bloco com hashes/status finais e informar ao usuário os caminhos dos painéis. Dados para disponibilidade, responsáveis e planos reais precisam ser cadastrados pela escola; não inventar dados de planejamento.

## Limites conhecidos a preservar

- Não há previsão estatística validada: é avaliação explicável por fatos, com medição para aprender.
- Histórico antigo de inscrição não pode ser convertido em presença/interesse retroativamente.
- Falta de alimentação/identidade acadêmica/agenda é pendência. Sem vínculo exato de turma, não atribuir matrícula à abertura.
- Resultados da rede só aparecem quando houver amostras reais suficientes e autorização das filiais.
- Administradores regionais/nacionais por secretaria precisam ser nomeados por administrador autorizado; não inferir cargos a partir de nomes ou estados.
- Documentos são publicados por link HTTPS; não há upload arbitrário de arquivos neste incremento. Planos/encaminhamentos estão na biblioteca e tarefas da abertura. Não há nova automação de WhatsApp nem geração por IA paga.

## Fechamento da sessão — estado mais recente

- Build final BPO passou; 20 testes novos BPO passaram; suíte CRM completa passou 122/122.
- Fixture visual removida e servidor local encerrado; 14 abas desktop/mobile verificadas sem erro JS nem overflow.
- Migração BPO registrada em `_prisma_migrations`; ambas migrações CRM aplicadas, teste SQL de tags passou sem resíduos.
- Edge Functions finais publicadas: `bpo-aberturas` v3, `whatsapp-send` v41, `ia-recomendar-contatos` v15.
- Caches iniciais: quatro filiais preparados; Jardim América (`JAM`) ficou pendente na ponte e precisa diagnóstico. A interface preserva estado pendente/permite repetir; não inventar dados nem ampliar acesso para contornar.
- Dependência temporária PGlite/symlink removidos do CRM após os testes.
- Próxima ação: commits/push dos dois projetos e confirmar a publicação Vercel. Atualizar abaixo com os hashes.

### Publicação e correção final

- Código principal enviado: BPO `eca25db` (integrou também os documentos enviados pelo Claude), CRM `71f0d56`.
- Produção confirmou rota cron nova rejeitando chamada sem segredo (401) e novo motor CRM disponível (200).
- Jardim América foi consultado com sucesso: 10.605 interessados, fonte 17/10. O cache grande foi gravado pela API REST privada, evitando limite do SQL de gerenciamento. **Agora os cinco caches iniciais estão preparados; a pendência JAM anterior está resolvida.**
- Lista de interessados recebeu busca e paginação de 50 cartões para suportar esse volume.
- Para o Claude: começar por este documento; nenhum segredo precisa ser copiado da conversa. Documentação de operação e contrato estão nos arquivos indicados.

### Escopo adicional da conversa ainda a desenvolver

As sugestões amplas também aprovadas incluíam uma jornada individual de acolhimento, central geral de solicitações internas, passagem de função assistida e uma página Minha escola consolidando todas as áreas. **Não foram construídos novos módulos dedicados a essas quatro sugestões nesta rodada**; verificar os recursos existentes antes de expandir. Biblioteca aceita links HTTPS, ainda não upload binário próprio. Reuniões/planos são publicações e tarefas; não há novo sistema de videoconferência nem disparos externos. O núcleo de abertura/secretarias/avaliação está implementado, mas não afirmar que todas as sugestões de experiência do membro já foram concluídas.

Últimos commits enviados: BPO `2e1970b`, CRM `b028ead`. A última alteração funcional foi paginação/busca; build passou. Produção do núcleo foi verificada; a publicação Vercel desse último patch não foi acompanhada até o status final.

# Avaliação explicável por abertura

O motor puro fica em `js/propensao-modelo.js` e é copiado sem alterações para `src/lib/aberturas/propensao-modelo.js` no BPO. A interface é `PropensaoModelo.avaliar({ sinais, abertura, agora, versao })`. O resultado mantém `interesse.estado` separado de `adequacaoTurma.estado`, registra ação e fundamentos com fonte, data e responsável e não calcula score, probabilidade ou ranking. Inscrição em atividade, presença e ausência de resposta não viram interesse.

Sinais aceitos: `interesse_declarado`, `disponibilidade_confirmada`, `presenca_palestra`, `outra_atividade`, `resposta_atendimento`, `pedido_matricula`, `nao_contatar`, `acao_realizada` e `resultado_atendimento`. Cada acontecimento precisa de `occurredAt` ISO, `origem`, `responsavel`, `natureza` (`declarado`, `observado` ou `interpretado`) e `aberturaId`; disponibilidade e matrícula ficam vinculadas a IDs exatos. Só declaração explícita `nao_contatar=false` revoga um bloqueio anterior.

## Ponte privada

`GET /functions/v1/bpo-aberturas?filial=JAM` lê uma filial por `filiais.mercurio_unidade` exato. `POST /functions/v1/bpo-aberturas` salva fatos e snapshots já avaliados pelo BPO. O gateway exige JWT e a função exige `role=service_role`; a chave fica apenas no servidor BPO. O CRM e o navegador da escola não chamam essa função.

O GET retorna `{ versao, filial, baseAtualizadaEm, sincronizadoEm, leads, matriculas, aberturas, avaliacoes, acontecimentos, acoes, resultados }`. `baseAtualizadaEm` vem de `relatorio_matriculas_mensais.fonte_data` e pode ser `null`; `sincronizadoEm` é apenas o horário do processo. Leads expõem ID, nome, sinais, interesse, adequação da última abertura, data da avaliação e flag `naoContatar`. Matrículas incluem registros ativos e inativos. O vínculo de lead usa `pessoa_identificador` exato ou `matricula_mercurio` exata; a abertura só vem de resultado explícito `matriculou` validado no Mercúrio.

O POST recebe `{ filial, aberturaId, abertura, avaliacoes }`. Cada avaliação contém `{ leadId, sinais, snapshot }`. `aberturaId` é string de até 100 caracteres; abertura contém `id`, `diaSemana`, `inicioMinuto` e `primeiraAula` ISO ou `null`. `sinais` traz apenas acontecimentos locais à abertura para append; `snapshot.sinais` pode preservar o contexto global, inclusive sinais de outras aberturas. Snapshot precisa trazer versões, `avaliadoEm`, estados, `proximaAcao`, `fundamentos` e booleano `preResultado`. A ponte persiste esse snapshot sem recalcular interesse nem cronologia. Repetir o mesmo lead no lote é válido; repetição idêntica é idempotente por abertura, lead, sinais e instante do snapshot.

Uma declaração válida de não contato chama a RPC restrita `propensao_atualizar_nao_contatar`, que compara datas sob lock e atualiza `acompanhamento.contato`, carimbo e responsável específicos da preferência, além da tag `Não contatar`, preservando o restante do cadastro. A revogação explícita e mais recente remove a tag. Resultado `sem_interesse` não altera autorização de contato. Tabelas de avaliações, acontecimentos, ações e resultados têm RLS sem acesso público e bloqueio de update/delete.

## Integração e verificação

O BPO deve copiar o motor puro mantendo `VERSAO_MOTOR` alinhada. A Edge Function usa `verify_jwt=true` em `supabase/config.toml`. Aplicar manualmente `migracao_propensao_crm.sql` depois da revisão de schema. Testes locais: `node --test tests/propensao-modelo.test.mjs tests/propensao-crm.test.mjs`.

Para refletir os novos estados na base já importada, aplicar `migracao_propensao_tags_estado.sql` após o schema de propensão e executar `tests/propensao-tags-estado.sql` em um banco de teste. O backfill mantém cópia privada das tags anteriores, preserva fontes em formato inválido sem alterá-las e não cria tag global de adequação de turma.

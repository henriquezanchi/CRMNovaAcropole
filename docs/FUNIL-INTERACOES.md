# Do contato à matrícula

Em **Resultados → Do contato à matrícula**, escolha o período e a visão (todas as filiais ou a filial atual). O cálculo consulta toda a base no banco, sem depender dos cards carregados.

## Atualização automática

Não há validação humana obrigatória. Cada mensagem recebida ou enviada, e mudanças efetivas de conteúdo ou status, enfileiram novamente a conversa. O trabalhador `analisar-funil-conversas` roda a cada minuto no servidor, mesmo com o CRM fechado, e considera **todo o histórico disponível**, inclusive conversas importadas como contexto. Conversas sem respostas são verificadas por regra, sem gasto com modelo. Conversas com respostas passam por análise de contexto, com categorias fixas e citações literais. Nenhuma análise envia mensagens, cria tarefas ou autoriza campanhas.

A tela atualiza enquanto Resultados está aberto. O intervalo de um minuto é de início das rodadas: uma fila grande, falha do provedor ou novas interações durante uma análise podem aumentar o prazo. O último resultado permanece visível, com indicação de atualização pendente. Se a pessoa desistir ou recusar informações após aceitar, a nova análise pode reduzir os indicadores de aceitação/intenção. O fato histórico de ter dado uma resposta humana válida continua registrado. Inscrições, presenças e matrículas oficiais não são apagadas por uma recusa posterior.

O processamento usa trava por conversa e versão. Uma análise iniciada antes de uma nova interação não pode sobrescrever o resultado atualizado. Falhas são registradas e tentadas novamente; JSON truncado não vira resultado negativo. Cada versão concluída fica no log de atividade com resultado anterior e novo. As evidências podem ser consultadas em **Ver evidências da análise automática**, sem precisar confirmar nada.

## Critérios

- **Mensagens enviadas:** somente saídas aceitas pelo WhatsApp oficial, com identificador do provedor. Falhas, mensagens substituídas por reenvio, cliques em wa.me e conversas importadas ficam fora do volume oficial.
- **Pessoas:** cada identificador conta uma vez por filial e etapa. No total, o mesmo identificador atendido em duas filiais conta uma vez. As porcentagens das etapas usam pessoas contatadas como base; a porcentagem dos envios mostra sua participação no volume exibido.
- **Responderam:** qualquer entrada oficial posterior ao primeiro envio no período, mesmo antes de a análise distinguir bot, mídia ilegível e resposta humana.
- **Resposta válida:** resposta humana compreensível e pertinente, inclusive cumprimento e recusa. Menu e resposta automática ficam fora. Áudio sem transcrição, figurinhas e mídia sem texto suficiente ficam inconclusivos; o sistema não afirma ter ouvido ou visto conteúdos indisponíveis.
- **Aceitaram continuar:** proposta claramente aceita ou pergunta pertinente sobre evento/curso que permita responder. Gostar dos conteúdos, agradecer e dizer bom dia não bastam. O indicador reflete a decisão explícita mais recente; não é consentimento jurídico nem autorização para campanhas futuras.
- **Intenção de inscrição:** declaração clara de que pretende preencher inscrição, formulário ou link. Dizer que vai ao evento não basta. Relatar inscrição já feita também não é intenção futura nem inscrição oficial comprovada.
- **Inscrição:** registro oficial do Ulisses (vínculo de origem Ulisses ou histórico importado com nome e data exatos) em evento ligado a um convite comprovável ou à intenção identificada. Um RSVP não comprova inscrição. O importador corrige a origem de vínculos preexistentes quando encontra inscrição oficial, na próxima sincronização.
- **Presença:** `compareceu=true` no evento identificado, com data entre o convite e hoje. Não infere presença de confirmação de interesse.
- **Matrícula:** vínculo e data oficiais na base nacional `mercurio_alunos`, ou data anteriormente conferida no Mercúrio. Matrícula manual no Kanban não basta. Inclui reingresso conforme data efetiva da fonte; não calcula comissão.

O período seleciona a coorte contatada. Os resultados são observados até a consulta; a aceitação e intenção refletem a decisão mais recente conhecida. Não se trata de atribuição causal: a base local do Ulisses não guarda a data original da inscrição, que pode ser anterior ao convite. Ausência de vínculo comprovável limita as etapas de inscrição/presença e não significa necessariamente ausência de resultado.

## Segurança e operação

A chave `FUNIL_ANALISE_TOKEN` existe somente nos secrets da função e no Vault (`funil_analise_token`), gerada no provisionamento, sem aparecer no navegador ou no repositório. O trabalhador rejeita chamadas sem essa chave. As funções de claim/finalização só podem ser executadas pelo serviço; a função que agenda chamadas não é pública. As tabelas de análise têm política de leitura para o acesso existente do CRM e não têm política de escrita pública. As conversas são tratadas como dados não confiáveis, não como instruções para a IA. O modelo nunca fornece inscrição, presença ou matrícula oficial.

Migrações, nesta ordem: `migracao_funil_interacoes_objetivo.sql` (histórica), `migracao_funil_automatico.sql`, `migracao_relatorio_funil_automatico.sql`, `migracao_agendamento_funil_automatico.sql`. A antiga revisão manual não alimenta mais o cálculo; seus registros históricos são preservados. Implantação da função deve incluir `index.ts` e `criterios.mjs`. A função usa o secret Anthropic já existente do CRM e registra consumo em `ia_uso_tokens`.

Validação: `PGLITE_MODULE=<módulo instalado> node --test tests/*.test.mjs`; `node tests/browser-funil-interacoes.mjs`. Os testes usam serviços simulados e rede externa bloqueada, sem mensagens reais. A primeira leitura do histórico usa o provedor de análise já configurado e grava apenas medição e auditoria.

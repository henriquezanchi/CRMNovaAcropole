# Atualização operacional — 17/10/2026

Implementação local em CRMNovaAcropole. As orientações do usuário prevalecem sobre documentos anteriores e material do Claude. Não altera preços, comissões ou cobrança. Não envia mensagens, cadastra alunos em sistemas externos ou publica conteúdo automaticamente.

## Disponível no código

- Na ficha do contato: relação com a escola, origem, forma de entrada, intenção, preferência de contato, experiência relatada, responsável e próximo passo com prazo.
- Campos separados para não equiparar contato Instagram espontâneo à prospecção ativa, nem simpatia à decisão de matrícula. Origem conhecida exige confirmação antes de correção.
- No Kanban: “Quem precisa de atenção?”, consulta paginada de toda a escola, filtros e prioridade determinística. Contatos na lixeira são excluídos. Respostas e datas combinadas têm precedência sobre campanhas; não há envio pela fila.
- Na agenda: “Talvez / sem confirmação” distinto de confirmação; orientação para presença desconhecida e matrícula sem pagamento comprovado. Participantes carregados integralmente em páginas e dados pessoais buscados em pequenos lotes, sem lista parcial em caso de erro.
- Na agenda: planejamento de texto/roteiro de conteúdo por atividade, responsável, situação, destino do convite e link da publicação manual. Uma ficha de planejamento por evento nesta versão, sem biblioteca de imagens ou calendário de múltiplas peças. Não representa aprovação institucional autenticada.
- Proteção de atualização concorrente nos registros de acompanhamento e planejamento: uma sessão não substitui silenciosamente o trabalho salvo por outra.
- Na função whatsapp-send: preferência conferida no servidor antes de envio. Pedido de não contato bloqueia envio identificado, exceto reação. Templates e campanhas exigem preferência conferida e interesse compatível; compromissos individuais pendentes/futuros e pausas excluem campanha. Registros antigos sem preferência preenchida não entram automaticamente em campanhas.
- Envio de templates em lote passa a um destinatário por vez, preservando a pausa existente.

O login nominal legado e suas permissões visuais permanecem. Não se deve anunciar autorização segura por escola ou auditoria de identidade forte: as políticas existentes são amplas e precisam de um projeto de correção com identidade validada no servidor. Esta atualização não amplia políticas, não guarda documentos/tokens e não promete resolver essa limitação.

## Banco e publicação

Migração aditiva: `migracao_acompanhamento_conversao.sql`. Acrescenta JSON de acompanhamento em leads, JSON de planejamento em eventos e opção “talvez” em evento_leads. Não muda valores já registrados nem permissões. Foi testada duas vezes no mesmo banco em memória para verificar repetibilidade e preservação dos registros.

Antes de disponibilizar, conferir backup e esquema real (inclusive constraint de resposta do convite), aplicar a migração, publicar whatsapp-send com seu utilitário novo e publicar os arquivos estáticos. A função nova depende da coluna; publicá-la antes da migração bloqueia a consulta do lead. O frontend antigo não conhece “talvez”; coordenar sua publicação antes de começar a usar a opção. Confirmar as preferências da equipe e dos contatos antes de retomar campanhas, pois registros sem conferência passam a ser bloqueados. Não preencher “permitido” em massa sem evidência.

Sem a migração, o acompanhamento na ficha aparece desativado e as novas consultas mostram indisponibilidade, preservando o restante da operação. O envio antigo só será alterado após publicação da função. Mensagens não identificadas por lead e canais/rotinas externas a whatsapp-send não foram cobertos; não alegar bloqueio universal. Preferências precisam ser respeitadas também nos processos humanos.

Não houve aplicação no banco compartilhado, deploy da função, commit, push ou alteração no ambiente publicado.

## Validação

- `node --check` nos scripts alterados.
- `node --test tests/*.test.mjs`: regras de prioridade, contato, intenção, validação e conferência no servidor.
- `node tests/browser-acompanhamento.mjs`: componentes reais com backend em memória, rede externa bloqueada e telas de 320, 414 e 1365 px. Exercita gravação, conflito, rascunho de conteúdo, falha de consulta e ausência de rolagem horizontal nos componentes. Não é teste do banco, da página completa ou de Safari físico.
- A migração foi executada e reexecutada em PGlite, preservando registros e validando JSON/“talvez”.
- `node tools/lint/verificar-globais.mjs` aponta três suspeitas em trechos preexistentes (callbacks de relatórios e busca WhatsApp). Nenhuma nova suspeita nos módulos adicionados. Esse verificador é heurístico, não uma garantia de tipagem.

O navegador de teste usa Playwright instalado no checkout BPO deste ambiente e Chromium em `/usr/bin/chromium`. Não foi criado package.json na raiz nem alterada a publicação estática.

## Próximas integrações, sem simular conclusão

- Confirmar matrículas e primeiras contribuições consultando fontes oficiais, considerando atraso de atualização. Nenhuma integração de escrita Mercúrio/Mercury foi inventada.
- Inscrição assistida e envio protegido de ficha dependem de autorização institucional de tratamento e autenticação/armazenamento adequados; não habilitados pelo desenho atual de acesso público.
- Aprovação editorial por escola, anexos e publicação/atendimento Instagram pela API oficial precisam de autorização segura e configuração própria; não implementados como se o WhatsApp existente concedesse esses acessos.
- Regras comerciais, preço de prospecção ativa e remuneração de inscrição assistida permanecem na proposta, sem alteração automática do sistema.

## Continuação — conferência de aberturas e inscrições

- No modal de participantes, resumo de confirmados, “talvez”, presentes e presenças ainda não conferidas. Filtros por situação e busca por nome/telefone/identificador, com busca indiferente a acentos.
- Filtro de presentes sem matrícula informada ajuda a encontrar quem precisa de retorno. Não interpreta ausência de matrícula no sistema como recusa.
- “Selecionar todos” considera somente o filtro visível. Troca de filtro limpa seleção; se um registro sair do filtro após atualização, sai também da seleção. Ações em massa usam os identificadores capturados no início, não uma seleção que pode mudar durante a gravação.
- Falhas ao registrar resposta/presença restauram a exibição do último valor conhecido. Presença desconhecida continua diferente de falta.
- A ficha do contato passa a acompanhar inscrição solicitada, dados pendentes, espera de registro e cadastro conferido. Conferência exige fonte, referência e data; não equivale a primeira contribuição recebida nem executa cadastro externo. A fila destaca inscrições pendentes e a proteção de campanhas evita abordá-las como se fossem contatos novos.
- Os campos adicionais usam o JSON da migração já preparada, sem nova tabela ou integração externa. Políticas de acesso legadas continuam sendo uma pendência anterior à expansão com documentos ou credenciais.
- Validação ampliada: 13 testes de regras e carregamento; componentes no Chromium em 320, 414 e 1365 px, incluindo filtro, seleção visível e retirada de seleção quando um registro sai do filtro. Sintaxe e diff verificados. O verificador heurístico de globais mantém as três suspeitas preexistentes já descritas.

## Continuação — rotina diária e apoio às conversas

- A fila oferece busca por nome, identificação e responsável; filtro “somente meus atendimentos”; filtros de inscrições pendentes e contatos sem responsável.
- O resumo da escola mostra retornos/pedidos de atenção, inscrições em acompanhamento, responsáveis faltantes e preferências a conferir. As categorias podem se sobrepor e não representam pagamentos ou conversões comprovadas. Dados antigos são limpos durante atualização ou troca de escola.
- A ficha inclui apoio para o próximo contato, baseado no último registro salvo. Não gera convite com data ou local desconhecidos, não incentiva contato após recusa/pausa e orienta conferir o sistema antes de perguntar sobre cadastro ao interessado. Texto pode ser copiado para revisão, sem envio automático.
- “Meus atendimentos” usa o responsável informado e o login nominal existente, sem se apresentar como controle de acesso seguro. Correção da autenticação legada continua pendente.
- Validação ampliada para 18 testes, mais componentes no Chromium em 320, 414 e 1365 px. Inclui busca, filtro do responsável, sugestão de conversa e testes anteriores de gravação/conflito/falhas. O verificador heurístico mantém três suspeitas preexistentes.

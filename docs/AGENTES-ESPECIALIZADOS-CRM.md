# Agentes especializados do atendimento

Implementação de 19/10/2026. Usa a infraestrutura Anthropic e os agendamentos já existentes do CRM; não cria agentes externos nem outro serviço de WhatsApp.

## Funcionamento

1. As consultas SQL selecionam a última mensagem recebida que ainda precisa de sugestão. Respeitam filial, cadastro fora da lixeira e a configuração de IA da conversa/escola. A rotina de convites roda a cada 15 minutos; a geral, cinco minutos depois. Cada execução processa até oito candidatas, preservando os intervalos existentes.
2. O agente de qualificação lê todas as mensagens disponíveis daquela pessoa naquela filial, em páginas de mil, até a mensagem de origem. Classifica o pedido atual em categorias fixas e cita uma mensagem textual de entrada. A citação precisa existir literalmente na fonte. Fala da escola e mídia não transcrita não servem de evidência do contato. Falha de leitura, formato ou provedor permite nova tentativa; não vira desinteresse.
3. O coordenador aplica restrições registradas e escolhe o especialista: qualificação inicial, informações, eventos/inscrições, pós-evento, matrícula, antigos alunos ou atendimento de aluno. Identidade/histórico em conferência, pedido de não contato, pausa, retorno futuro e conferência interna suspendem a redação de contato. A decisão não libera campanhas nem remove bloqueios.
4. O especialista recebe o histórico completo e os dados reais já consultados pelo fluxo existente. Sua missão é adicionada às instruções do redator. Continua preparando um rascunho, sem executar reserva, matrícula, lançamento financeiro, transferência para equipe ou envio. Na rotina de convite, um pedido de outra etapa não confirma nem recusa o evento antigo.
5. O registro é atômico e exclusivo entre as duas rotinas. Se houver mensagem mais nova ou outro rascunho para a mesma origem, a publicação é recusada. A qualificação e a escolha do agente ficam em `agente_ia` junto ao rascunho. Contém versão, origem, filial, número de mensagens, data, missão, restrição e evidência. Pedido explícito de não contato reconhecido pela qualificação acrescenta a tag de bloqueio, preservando as demais.
6. WhatsApp e Agenda mostram agente, missão, motivo e evidência. O atendente continua revisando e clicando para enviar. O servidor revalida origem, filial, status, novas mensagens e restrições antes de enviar um rascunho identificado pelo frontend. Mensagens reais não são enviadas pelos agentes. Os indicadores oficiais de inscrição, presença e matrícula permanecem baseados nas fontes próprias.

## Limites concretos

A seleção continua usando as janelas existentes: duas horas para sugestões gerais e três para convites. Este trabalho não reprocessa toda a base antiga nem renova rascunhos históricos. Conversas maiores que 180 mil caracteres de JSON são recusadas integralmente, sem truncamento, e exigem tratamento posterior. Áudios sem transcrição continuam sem interpretação. A verificação literal da evidência impede citação inventada, mas a classificação semântica ainda depende do modelo.

O contexto cadastral/eventos é o do fluxo existente. O especialista não ganhou permissão de escrever em sistemas externos. O uso de tokens fica em `ia_uso_tokens`, com `agente-qualificacao-crm` e `agente-crm-<etapa>`; em geral há uma chamada de qualificação e outra de redação. Bloqueios já cadastrados evitam ambas.

## Implantação e verificação

Migração aditiva: `migracao_agentes_especializados_crm.sql`. Acrescenta JSON às duas tabelas existentes, mantém RLS habilitada, cria a RPC privada `registrar_rascunho_agente` (somente `service_role`) e ajusta as consultas de candidatas. Não apaga dados.

Publicar `sugerir-resposta-whatsapp`, `classificar-resposta-convite` e a proteção em `whatsapp-send`, com o módulo compartilhado `agentes-crm.ts` e `agentes-crm.mjs` e `rascunho-agente.mjs`. A validação JWT existente continua habilitada. Publicar o frontend estático depois da migração. Não há segredo novo no navegador.

Testes específicos: `tests/agentes-crm*.test.mjs`, com provedor e banco simulados, teste SQL em PGlite e `tests/browser-agentes-crm.mjs` (390 e 1365 px). Validam paginação, escopo da filial, evidências inválidas, limites, bloqueios, falhas técnicas, encaminhamento de matrícula fora de convite antigo, exclusividade dos rascunhos e HTML escapado. Testes não enviam mensagens reais.

Implantação em 19/10: migração aplicada e conferida (duas colunas, duas tabelas com RLS, RPC sem execução anônima). Funções ativas: sugestões v41, convites v36, envio v38, todas com JWT habilitado. Suíte completa: 77 testes aprovados. Navegador: especialistas e interesse em matrícula, 390 e 1365 px. Na conferência após a implantação não havia mensagens elegíveis nas janelas atuais; a geração com provedor real ficará para as próximas respostas. Não foi enviado WhatsApp para testar.

# Do contato à matrícula

Em **Resultados → Do contato à matrícula**, escolha o período de envio e a visão (todas as filiais ou a filial atual). O relatório consulta toda a base no banco, sem depender da paginação do Kanban.

- Volume de mensagens: somente saídas aceitas pelo WhatsApp oficial, com identificador do provedor. Falhas, mensagens substituídas por reenvio, cliques em wa.me e conversas importadas ficam fora.
- Pessoas: identificador único por filial; no total, o mesmo identificador conta uma vez mesmo que atendido em duas filiais. As etapas mostram volume e percentual das pessoas contatadas. A porcentagem dos envios mostra a participação no volume exibido.
- Respostas recebidas: qualquer entrada oficial posterior ao primeiro envio no período. Respostas válidas, autorização para continuar e intenção explícita de inscrição exigem conferência humana. Recusa humana compreensível conta como válida, mas não como aceitação. Sugestões pendentes da IA não são fatos.
- Inscrição: registro oficial do Ulisses no evento ligado a um convite enviado ou à intenção revisada. Um RSVP não comprova inscrição. O importador agora também corrige a origem de vínculos preexistentes quando encontra a inscrição oficial. Isso ocorre na próxima sincronização; nenhum histórico foi presumido ou reclassificado em massa.
- Presença: `compareceu=true` no evento vinculado, com data entre o convite e hoje. Não infere presença da confirmação de interesse.
- Matrícula: vínculo e data oficiais na base nacional `mercurio_alunos`, ou data anteriormente conferida no Mercúrio. Matrícula manual no Kanban não basta. Inclui reingresso conforme a data efetiva da fonte; não é cálculo de comissão.

O período seleciona a coorte de pessoas contatadas, e os resultados são observados até o momento da consulta. Não é atribuição causal: não há data original de inscrição no histórico local do Ulisses. Um registro de inscrição ligado ao evento pode ter sido feito antes do convite. Etapas são fatos independentes; ausência de revisão ou de vínculo não equivale a desinteresse.

## Conferência da equipe

Abra **Conferir respostas e melhorar a medição**, carregue as respostas, consulte o último envio e a conversa completa quando necessário. Selecione o que a resposta comprova. Intenção de inscrição exige identificar o evento. Salvar não envia mensagens. Cada alteração gera registro em `log_atividade`, com classificação anterior, nova classificação e responsável nominal. A opção de rever classificações permite corrigir uma revisão.

Convites feitos pelos dois fluxos oficiais (template e janela aberta) passam a vincular a mensagem ao evento após envio bem-sucedido. Falha nesse vínculo não marca o envio como falho e nunca dispara reenvio. Convites históricos sem vínculo não são adivinhados; a intenção revisada com evento permite estabelecer evidência explícita.

## Limites e validação

O acesso segue o modelo nominal e as políticas de leitura existentes do CRM; o nome do revisor é registro operacional, não autenticação criptográfica. Tabelas novas permitem leitura pelas políticas existentes, e escrita somente pelas funções com validação; revisão mantém histórico na auditoria append-only.

Migração: `migracao_funil_interacoes_objetivo.sql`. Testes SQL opcionais com PGlite (`PGLITE_MODULE` aponta para o módulo instalado); nenhuma dependência de runtime ou build adicionada à raiz. Testes cobrem mais de mil pessoas, duplicações, falhas, importados, revisão, intenção versus inscrição, presença e matrícula oficial. Browser: `node tests/browser-funil-interacoes.mjs`, com serviços simulados e rede externa bloqueada, sem envio real.

# Como acompanhar quem está mais próximo da matrícula

Em **Atendimento**, escolha **Quem está mais próximo da matrícula?**. O botão consulta a escola inteira, com todas as páginas, sem alterar o funil ou enviar mensagens.

A visão “Mais próximos” reúne, nesta ordem:

1. **Inscrição em andamento:** a pessoa pediu inscrição ou existem dados/registro pendentes. Confira o que falta internamente.
2. **Quer se inscrever:** intenção registrada pela equipe. Ajude a concluir os próximos passos.
3. **Visitou e relatou boa experiência:** sinal favorável, ainda sem decisão de matrícula. Ouça se deseja continuar e quais dúvidas ficaram.

Os demais filtros mostram quem quer participar, quer conhecer, ainda precisa ser qualificado, pediu pausa/não contato, já está indicado como aluno ou teve cadastro conferido. As contagens referem-se à escola inteira; a busca e “Somente meus atendimentos” refinam a lista, que exibe até 100 resultados por vez.

Cada cartão informa o sinal, seu motivo, o cuidado sugerido, a condição de atendimento, o responsável e a data combinada. Sinal de interesse não libera contato automaticamente. Uma pessoa pode querer se inscrever e ter retorno combinado para outra data. Cadastro conferido não comprova pagamento.

Na ficha, em **Acolhimento e próximo passo**, registre a intenção declarada, relação com a escola, experiência relatada, preferência de contato, andamento da inscrição, responsável e retorno. Resuma no contexto a fala que sustenta a intenção, sem informações íntimas. Ao salvar, os sinais no painel e no Kanban são atualizados.

Os rótulos antigos “Lead Forte”, número de tags, origem Ulisses, posição RSVP e atraso de atendimento não são usados como prova de intenção. Não há percentual de chance nem classificação por IA. Se o campo ainda não foi preenchido, aparece como interesse a confirmar; não se presume desinteresse.

## Verificação

- `node --test tests/*.test.mjs`
- `node tests/browser-interesse-matricula.mjs`: interface real, 390 e 1365 px, 1201 contatos fictícios, paginação, intenção, pausa, contagens e busca além dos 100 visíveis.
- `node tests/browser-acompanhamento.mjs`: formulário, persistência, conflitos e erros, em 320, 414 e 1365 px.

## Rotina diária e qualificação rápida

O botão **Organizar atendimentos de hoje** usa a escola inteira e separa retornos atrasados, combinados para hoje, pedidos sem data e conferências internas. O dia é calculado no fuso do navegador do atendente. Retornos futuros ficam em filtro separado; um compromisso para mais tarde hoje informa que é necessário aguardar o horário. A classificação usa os registros da equipe; não afirma que uma mensagem do WhatsApp está sem resposta.

Na ficha, os cinco campos essenciais ficam à vista: intenção, preferência de contato, próximo passo, responsável e data. “Visita, origem, cadastro e apoio à escola” abre os demais dados, que continuam sendo preservados no mesmo salvamento com controle de versão. As sugestões de abertura para antigos alunos e contatos do Ulisses começam pelo acolhimento, sem pedir uma decisão de retorno ou matrícula na primeira mensagem.

## Frente de trabalho sugerida (19/10/2026)

Os cartões e a ficha exibem uma frente, um objetivo e um próximo passo sugerido, definidos por regras a partir do acompanhamento e das evidências automáticas já disponíveis: qualificação inicial, informações iniciais, evento, apoio à matrícula, pós-visita, antigo aluno, acolhimento de aluno ou conferência com a escola. Contato/histórico em conferência, não contato e pausa prevalecem sobre os sinais de interesse. A indicação não atribui equipe, cria agenda, altera dados nem libera envio. Não substitui a qualificação automática completa do histórico; esta versão aproveita os sinais que o analisador atual já produz.

Validação específica: `node --test tests/trabalho-especializado.test.mjs tests/proximidade-matricula.test.mjs tests/rotina-atendimento.test.mjs tests/atendimento-diario.test.mjs` e `node tests/browser-interesse-matricula.mjs` (390 e 1365 px, dados fictícios).

A qualificação com especialistas dos novos rascunhos do WhatsApp está descrita em [AGENTES-ESPECIALIZADOS-CRM.md](AGENTES-ESPECIALIZADOS-CRM.md). A frente sugerida por regras desta tela e a escolha do redator são recursos distintos.

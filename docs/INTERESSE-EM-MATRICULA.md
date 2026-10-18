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

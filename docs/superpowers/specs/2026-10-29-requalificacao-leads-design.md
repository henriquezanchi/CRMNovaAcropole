# Requalificação dos leads: quatro perguntas, uma fonte cada

Data: 29/10/2026. Aprovado pelo Henrique depois de ver "Ativo" e "Interesse a confirmar" no mesmo card e inativos recentes marcados como ativos.

## Problema

Sete camadas diziam coisas sobre o mesmo lead, escritas por rotinas diferentes, e as etiquetas só se acumulavam:

- importação;
- API do Mercury;
- mesclagem;
- três rotinas de IA;
- a equipe;
- o Kanban;
- a propensão calculada na tela.

A etiqueta "Ativo" vinha da API do Mercury, que considerava ativas pessoas que o banco do Mercúrio já não considerava. Em Jardim América eram 541 etiquetas contra 306 alunos ativos de fato.

## Modelo

Cada pergunta tem uma única fonte.

1. **Relação com a escola.** Fonte: o banco do Mercúrio (VIEW `cadastro`, que traz ATI e INA, com `cad_baixa`, `cad_cod_baixa` e `cad_motivo_baixa`).
   - **"Ativo: <filial>"** quando a pessoa está ativa hoje, na própria filial ou em outra. A outra filial é encontrada por e-mail igual, ou por telefone igual com o mesmo primeiro nome. O transferido para o Círculo de Amigos (código 29) conta como ativo.
   - **"Inativo"**, acompanhado de:
     - **"Saída: <categoria>"**:
       - Pretende voltar: código 21.
       - Vida e agenda: códigos 2, 3, 4, 10, 11, 12, 13, 14, 26, 27, 28.
       - Saúde: código 6.
       - Insatisfeito: códigos 1, 5, 16, 18, 19, 20, 22, 24.
       - Não contatar: códigos 15, 23, 25.
       - Mudou de cidade: código 9.
       - Sem informação: os demais.
     - **Faixa de tempo:** "Saída recente" (menos de 90 dias), "Janela de resgate" (de 90 dias a 2 anos) ou "Saída antiga".
     - **"Inativo reaproximando"**, quando a pessoa se inscreveu ou confirmou um evento depois de sair, nos últimos 180 dias.
   - **Nada**, quando a pessoa nunca foi aluna.
   - **Aluno ativo é reservado:** sai do funil, das filas de atendimento, dos indicadores, dos disparos em massa, dos alertas e de toda leitura de conversa pela IA. Fica só para divulgação de evento, feita individualmente, e para o aniversário.
2. **Pode contatar.** Fontes:
   - a equipe;
   - o pedido explícito da pessoa: frases fixas detectadas no recebimento do WhatsApp, sem IA, para qualquer lead, que viram "Não Contatar";
   - as categorias de saída "Não contatar" e "Mudou de cidade", que também viram "Não Contatar".
3. **Momento.** É a coluna do Kanban (`crm_kanban_alvos`) e vale só para quem não é aluno ativo.
4. **Fatos.** Eventos, presença e respostas no WhatsApp viram **"Temperatura: Quente / Morna / Fria"**, só para quem não é aluno ativo:
   - **Quente:** evento futuro, presença nos últimos 30 dias ou resposta nos últimos 14 dias.
   - **Morna:** evento nos últimos 180 dias ou resposta nos últimos 90 dias.
   - **Fria:** o resto.

## Como funciona

- `mercurio-db-sincronizar` lê ativos e inativos e grava `mercurio_pessoas`. Liga cada inativo a um lead que já existe, por matrícula, pelo id sintético ou pelo nome único na filial (com telefone batendo quando há); nunca cria lead para inativo. Ao fim de cada filial, chama `crm_requalificar_leads(filial)`.
- `crm_requalificar_leads()` recalcula do zero as etiquetas dessas famílias (`crm_tag_qualificacao_mercurio`). Etiquetas livres da equipe, Recuperado, nível, Trilha e Não Contatar ficam intactas. Também grava `motivo_saida` e `data_saida`. Roda também às 06:30, depois da importação do Ulisses.
- `crm_eh_ativo()` lê a etiqueta "Ativo: <filial>", e é a regra única usada pelo Kanban e pelas filas da IA.
- A importação nunca altera essas etiquetas: mantém as que o lead já tinha.
- Saíram "Contribuição em Atraso" (etiqueta e cartão), "Interesse a confirmar" ou "declarado", Jornada, Lead Forte, "Retorno: Só 1 Evento", "Conversa: X" e "Convite: X". As exceções são "Conversa: Mudou de Cidade", "Convite: Não Pode Ir" e "Convite: Sem Interesse", que continuam sendo sinais de exclusão.
- A API do Mercury está pausada.

## Fora deste trabalho

- **Cadastros duplicados:** mesclar os que hoje ficaram sem matrícula ligada fica com "Leads a Tratar" e com a especificação de identidade entre filiais.
- **Rotinas de IA:** sugestão de resposta e classificação de convite ainda gravam "Conversa: X" e "Convite: X"; a requalificação noturna remove essas etiquetas.

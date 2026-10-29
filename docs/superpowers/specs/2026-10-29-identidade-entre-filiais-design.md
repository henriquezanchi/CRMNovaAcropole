# Mesma pessoa em várias filiais: identidade por e-mail e trava de conversa

Data: 29/10/2026. Pedido do Henrique, depois de o Célio confirmar que o e-mail é único no Ulisses.

## Objetivo

A mesma pessoa às vezes está cadastrada em mais de uma filial. Hoje dois SDRs podem falar com ela ao mesmo tempo, e a mesma pessoa pode estar duplicada dentro de uma filial. O objetivo é:

1. Encontrar os e-mails repetidos em toda a base, inclusive entre filiais.
2. **Mesma filial:** com o mesmo e-mail, telefone e nome compatível, mesclar direto, como já se faz hoje.
3. **Filiais diferentes:** com o mesmo e-mail, telefone e nome compatível, **não mesclar**. Os cadastros ficam ligados como a mesma pessoa, cada um na sua filial, e cada cadastro ganha uma tag "Também em: <filial>" para cada outra filial onde a pessoa está.
4. Quando um SDR conversa com essa pessoa por uma filial, a outra filial fica **travada** para envio. A trava cai depois de **15 dias sem nenhuma mensagem**, de nenhum dos lados.
5. Os grupos que não batem em tudo vão para a revisão manual que já existe.

O critério de sucesso é que nenhum lead receba mensagem de duas filiais ao mesmo tempo, e que nenhuma filial perca seu Kanban, histórico de eventos ou importação do Ulisses.

## Por que ligar em vez de mesclar entre filiais

Kanban, conversas, qualificação da IA, importação do Ulisses e alunos do Mercúrio são vistos por filial. Mesclar entre filiais obrigaria a escolher uma filial e mover tudo para lá, e a importação do Ulisses da outra filial pararia de atualizar a pessoa. Ligar mantém cada filial inteira e resolve o risco real, que é dois SDRs falando com a mesma pessoa. Também é o mesmo modelo do Ulisses (uma pessoa, várias filiais), o que facilita uma integração futura.

## Peças

### 1. Identidade (banco)

- Nova coluna `leads_inscricoes.identidade_id uuid` (nula para quem não tem cadastro em outra filial), com índice.
- Todos os membros de uma identidade compartilham o mesmo `identidade_id`.
- Cada membro ganha uma tag **"Também em: <filial>"** para cada **outra** filial da identidade, nunca a própria. Exemplo: o cadastro do Jardim América ganha "Também em: Setor Oeste", e o do Setor Oeste ganha "Também em: Jardim América". O nome da filial perde o prefixo "Goiânia - " ("Goiânia II" fica igual). As tags são recalculadas a partir dos membros atuais sempre que alguém entra ou sai da identidade, então nunca ficam desatualizadas. A importação de planilhas preserva essas tags, como qualquer tag fora do sistema.
- Nova família de tag "Filiais" em `FAMILIAS_TAG` (`/^Também em: /`), com cor própria, para o card mostrar de longe em quais outras filiais a pessoa está.
- Um cadastro mesclado depois (`crm_leads_mesclados`) passa o `identidade_id` para o cadastro que ficou.

### 2. Varredura por e-mail (`crm_varrer_emails_repetidos(p_aplicar boolean)`)

Função SQL `security definer`, só para o service role. Simulação quando `p_aplicar=false`.

1. Agrupa os leads ativos (fora da lixeira) por `email_seguro_mesclagem("pessoaEmail")`.
2. **Dentro de cada filial**, se dois ou mais membros têm o mesmo e-mail, abre um caso em `auditoria_crm_pendencias` com o motivo "E-mail repetido na mesma filial (no Ulisses o e-mail é único)". Não duplica um caso pendente com os mesmos `pessoas_ids` nem reabre um caso descartado. A mesclagem automática que já roda a cada 2 minutos (`processar_mesclagens_inteligentes`) mescla esses casos quando a regra `nome_telefone_email` passa. A regra não muda.
3. **Entre filiais**, depois das mesclagens da mesma filial, liga automaticamente quando todos os membros do grupo:
   - têm o mesmo telefone (`telefone_seguro_mesclagem`, sem nulos);
   - têm nomes compatíveis dois a dois (`nomes_seguros_mesclagem`);
   - não têm matrículas diferentes no Mercúrio nem datas de nascimento diferentes;
   - não têm a tag "Contato em conferência" ou "Histórico em conferência";
   - não compartilham telefone ou e-mail com outra pessoa de nome incompatível;
   - não estão num caso descartado pela equipe.
4. Os grupos entre filiais que não passam abrem um caso com o motivo "E-mail repetido em filiais diferentes: confirmar se é a mesma pessoa".
5. Devolve as contagens e a lista: ligados, casos abertos e motivos de recusa.

Agendamento: uma vez por dia (06:20 Brasília), depois das importações da madrugada. A primeira execução é manual, em simulação, revisada pelo Henrique antes de aplicar.

### 3. Ligar à mão (tela de revisão)

Os casos entre filiais aparecem na tela de auditoria (`js/auditoria-base.js`, função `auditar-base-crm`) com o botão **"É a mesma pessoa: ligar"**. O botão chama uma RPC (`crm_ligar_identidade(p_ids text[])`) que confere se as filiais são distintas e se nenhum membro está na lixeira, atribui o `identidade_id`, recalcula as tags "Também em:" e marca o caso como resolvido. Não mescla nem apaga nada. O botão de descartar continua como hoje.

### 4. Trava de conversa (`crm_trava_identidade(p_pessoa text)`)

Calculada na hora, sem estado guardado, para nunca ficar desatualizada:

- Sem `identidade_id`, devolve "livre".
- Com `identidade_id`, procura a mensagem mais recente (qualquer direção, sem contar as ocultas) entre todos os membros. Se ela tem menos de 15 dias e pertence a **outro** membro, devolve:
  - `travado=true`;
  - a filial e o cadastro donos da conversa;
  - o atendente da última mensagem nossa;
  - `libera_em`: data da última mensagem + 15 dias.
- Senão, devolve "livre".

Quem usa a trava:

- **`whatsapp-send`:** para um lead travado, recusa qualquer envio exceto reação, com `erro: 'conversa_em_outra_filial'` e uma mensagem com filial, atendente e data de liberação.
- **Disparos em massa** (`filtrarExclusaoInteligenteWpp`): exclui os travados, com o motivo "Em conversa pela filial X".
- **Gaveta do lead e chat:** uma faixa "Em conversa pela filial X, com Fulano, até DD/MM", com a caixa de texto desabilitada.
- **Card no Kanban:** as tags "Também em: <filial>" e, quando travado, o selo "Em conversa por X".

### 5. Mensagem recebida (`whatsapp-webhook`)

Quando o telefone casa com dois ou mais cadastros e **todos** têm o mesmo `identidade_id`, a mensagem vai, nesta ordem:

1. para o dono da trava;
2. senão, para o cadastro que recebeu nossa última mensagem (regra que já existe);
3. senão, para o cadastro com a conversa mais recente;
4. senão, para o cadastro que é aluno ativo no Mercúrio;
5. senão, para o mais antigo.

Isso tira essas pessoas de "Não Identificados". Candidatos de identidades diferentes continuam como hoje: ambíguo, sem adivinhar.

## O que não muda

- A mesclagem da mesma filial e suas proteções (backup, redirecionamento de IDs, vínculos preservados).
- As importações de cada filial, que continuam atualizando cada cadastro.
- A trava não vale para mensagens recebidas: a pessoa sempre pode escrever, e a mensagem entra pela regra do item 5.

## Erros e casos de borda

- **Pessoa nova numa terceira filial:** a varredura do dia seguinte a liga à identidade existente, se as regras passarem.
- **Membros com telefones diferentes depois de ligados** (alguém editou um deles): a ligação continua. A trava usa a identidade, não o telefone.
- **Ligação errada:** um botão "Desligar" na gaveta remove o membro da identidade, recalcula as tags "Também em:" de todos os membros e grava no log. Nada é apagado.
- **Falha na trava** (erro de consulta): `whatsapp-send` bloqueia o envio de modelos, que é o lado seguro, e libera respostas dentro da janela de 24h. A conversa não pode ficar presa por erro técnico.

## Testes

- **SQL, numa transação com rollback no banco real:**
  - a varredura em simulação não altera nada;
  - grupo da mesma filial vira caso;
  - grupo entre filiais com tudo batendo é ligado;
  - telefone diferente vira caso;
  - nome incompatível vira caso;
  - caso descartado não é reaberto.
- **Trava:**
  - mensagem em A há 3 dias trava B;
  - mensagem há 16 dias libera;
  - mensagem do próprio membro não trava ele mesmo.
- **`whatsapp-send`:** recusa com `conversa_em_outra_filial` e libera reação.
- **Webhook:** roteamento entre membros da mesma identidade, usando a função de escolha extraída e testada à parte.
- **Tela:** lint e `node --check`. A conferência no navegador fica para o uso real, porque não há Playwright neste ambiente.

## Fora do escopo

- Mesclar cadastros de filiais diferentes num só.
- Planejamento diário das 250 mensagens: é o projeto seguinte e vai usar a trava.
- Integração ou migração para o código do Ulisses: projeto próprio, depois de ler o código.

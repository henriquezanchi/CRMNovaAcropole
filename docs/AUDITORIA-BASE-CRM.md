# Conferência nacional dos cadastros

Em 19/10/2026 foram conferidos os 15.081 leads do CRM contra 53.081 registros do Mercúrio nacional (7.935 ATI e 45.146 INA), por consulta SQL somente leitura, sem scraper.

Resultado: 4.204 correspondências fortes, com 2.564 correções de tags e 1.640 já corretas; 10.384 sem correspondência confirmada e 493 identidades a conferir. Ausência na fonte ou coincidência apenas de nome não gera inativação. O histórico anterior e posterior fica em `auditoria_crm_resultados`; a fonte mínima fica em tabela privada.

## Conferir os casos

Abra **Cadastros → Auditoria da situação e duplicidades**. Escolha escola ou todas, busque pelo nome/identificação e selecione somente os registros da mesma pessoa. Use **Comparar e mesclar selecionados** para escolher os dados finais. Grupos familiares e contatos compartilhados não devem ser mesclados. Há 2.242 indícios de duplicidade, além das 493 identidades; os grupos podem se sobrepor. Nenhum grupo atendeu à regra vigente de mesclagem automática nesta rodada.

A regra automática exige mesma filial, mesmo telefone normalizado e nomes compatíveis em todos os pares; matrículas oficiais diferentes impedem a automação. Nome semelhante sozinho é apenas indício. Casos descartados são registrados, sem exclusão de cadastros.

A mesclagem é transacional: preserva mensagens, vínculos de eventos, presenças, tarefas e a preferência mais restritiva de contato. Mantém cópia privada dos registros originais. Identificadores antigos são redirecionados para evitar recriação nas importações.

## Depois de mesclar

Somente o cadastro sobrevivente entra na fila de nova consulta de ativos. O agendador verifica a fila a cada minuto; consulta `cad_situacao='ATI'` com os identificadores desse cadastro e exige identidade compatível. Não percorre novamente todos os leads. Se não houver confirmação entre os ativos, registra a ausência sem transformar o cadastro em inativo. O resultado aparece no mesmo painel após atualizar.

A sincronização financeira diária também filtra ATI explicitamente: a fonte nacional passou a conter ativos e inativos. A auditoria não envia mensagens e não modifica pagamentos.

## Operação

`tools/auditoria/planejar.mjs` recebe snapshots locais como argumentos, sem credenciais. O coletor protegido `auditar-base-crm` usa as credenciais já configuradas no servidor; a coleta completa precede qualquer aplicação de tags. Não guardar exports com dados pessoais no Git. As migrações separam leitura do painel e rotinas privilegiadas de coleta/aplicação/reconsulta.

Verificação: 50 testes automatizados passaram, incluindo mesclagem com preservação de vínculos, rollback, aliases, identidade e consulta restrita aos sobreviventes; painel testado em 390px e 1365px.

## Mesclagem por identidade oficial (implantada em 19/10/2026)

Implementação em `migracao_mesclagem_inteligente.sql`, aplicada em produção após o responsável autorizar “implante”. Simulação: 70 grupos candidatos, com sobreposição. Execução: **62 grupos mesclados, 62 backups, nenhuma falha**, com reconsulta dos sobreviventes na fila existente. Após autorização explícita do responsável, o agendamento permanente em `migracao_agendamento_mesclagem_inteligente.sql` foi ativado (job 29): até 100 grupos pendentes por rodada, a cada dois minutos, mesmo com o CRM fechado. As proteções de identidade e os backups permanecem obrigatórios.

Há dois caminhos novos, sempre na mesma filial e com nomes compatíveis em todos os pares:

- Telefone completo com DDD e e-mail iguais em todos os cadastros.
- Cada cadastro corresponde de forma única à mesma matrícula **e unidade** na fonte oficial recente, por matrícula explícita ou contato atual confirmado. Permite contatos diferentes entre os cadastros, como Tatiane Lagoa / Tatiane Barbosa Lagoa: o e-mail do primeiro confirma a ficha oficial e a matrícula do segundo aponta para essa mesma ficha. Não usa o título do caso ou a conclusão antiga da auditoria como prova.

O nome curto precisa ter primeiro nome e último sobrenome por extenso, e todos os seus termos devem aparecer em ordem no nome longo. Nome sozinho, apelido, erro aproximado ou somente primeiro nome não autorizam mesclagem. Matrículas divergentes, nascimento divergente, contato compartilhado com outra identidade (CRM ou fonte oficial), fonte ambígua, escolas diferentes, lixeira, decisão anterior de não mesclar e contato/histórico em conferência impedem a automação. Fonte oficial com mais de sete dias não autoriza o segundo caminho. A automação anterior por telefone continua existente; esta rotina trata os grupos pendentes da auditoria.

A nova rotina mantém o identificador real do Ulisses, o nome mais completo, contatos alternativos em notas, os históricos em união e a preferência mais restritiva. Usa a mesclagem transacional existente, com backup, aliases e transferência de vínculos; não transforma histórico em conferência em participação comprovada. Atualizações concorrentes são reavaliadas sob lock. Falha de um grupo desfaz suas alterações. A justificativa fica no log e nos casos que permanecem pendentes.

Simulação: `select processar_mesclagens_inteligentes(false,5000);` não mescla nem altera a fila. Execução: `select processar_mesclagens_inteligentes(true,100);`. A migração separada agenda lotes a cada dois minutos com rotação dos grupos pendentes, para não repetir apenas os primeiros recusados. Só o serviço pode executar as duas funções privilegiadas. A consulta de ativos existente continua restrita aos sobreviventes.

No exemplo Carlos Teles / Carlos Alberto Oliveira Teles, o cadastro sintético atualmente tem `Histórico em conferência`; a identidade provável não elimina essa pendência. A rotina mantém o bloqueio e informa o motivo no painel.

Na conferência completa da Tatiane, o e-mail do cadastro sintético também apareceu em Matheus Machado Liberato, matrícula 41245. A ligação de Tatiane à matrícula 42633 foi confirmada, mas o contato conflitante bloqueou a mesclagem automática nesta rodada. Não foi removida a proteção para forçar o exemplo.

Validação desta entrega: cinco arquivos de testes automatizados passaram (mesclagem nova/existente, importação, recuperação e identidade na rede), além do navegador em 390 e 1365 pixels. O teste isolado do planejador encontrou restrição de subprocessos no sandbox; o planejador não foi alterado. O linter global manteve três avisos preexistentes de escopo de callbacks em app.js/whatsapp.js.

O responsável autorizou explicitamente a publicação na `main` e o agendamento permanente. O commit com o painel foi enviado à `main`; os motivos da recusa automática aparecem nos casos pendentes da auditoria.

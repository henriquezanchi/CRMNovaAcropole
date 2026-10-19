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

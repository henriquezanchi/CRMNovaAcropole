# Investigação e recuperação de contatos — 19/10/2026

## Falhas identificadas

O importador fabricava o DDD quando a lista de inativos trazia somente o número local: 62 em geral e 66 em Barra do Garças. Nenhum dos dois é prova do DDD de uma pessoa.

Outra falha reproduz a mistura observada: os identificadores sintéticos de Ativos/Inativos dependiam da posição da pessoa na lista. Na filial de id 40, a faixa de inativos era `950000000 + 40000000 + posição`, resultando nos IDs `990000001…`. Quando a ordem ou a composição da lista mudava, o mesmo ID podia corresponder a outro nome. A importação parcial preservava telefone, e-mail e outros dados anteriores enquanto atualizava o nome. Isso permite misturar identidades e históricos. Os logs antigos não permitem atribuir cada registro a uma execução específica; o mecanismo foi identificado no código, não por suposição sobre quem o executou.

Também havia associação de status entre filiais apenas por telefone/e-mail. Contatos familiares ou incorretos podiam trazer o status de outra pessoa. Agora exige nome compatível; conflitos de status ficam sem decisão automática. A sincronização da rede não sobrescreve outra identidade pelo contato compartilhado e ignora contatos em conferência.

## O que foi verificado e corrigido

O snapshot do CRM tinha 15.079 leads após as duas mesclagens feitas pelo usuário. Foram identificados 722 contatos envolvidos em combinações de telefone/e-mail com nomes incompatíveis; isso inclui pessoas com contato compartilhado legítimo. A consulta recente conferiu 810 alvos: esses contatos, os registros da sequência suspeita e os de Barra do Garças com DDD 62. Não são 810 erros.

O banco nacional foi consultado somente para leitura. Foram incluídos os campos residenciais de telefone, que também contêm celulares completos e têm DDD explícito; a coleta anterior tinha somente os campos de celular, muitas vezes vazios.

Resultado aplicado:

- 28 cadastros com mistura comprovada tiveram telefone/e-mail recuperados; 13 também tiveram a escola corrigida.
- 19 outros cadastros tiveram somente o DDD corrigido, preservando o número local e a escola. Exigiu-se número coincidente e confirmação independente por matrícula ou e-mail.
- 40 vínculos de eventos e os históricos dos 28 cadastros recuperados ficaram preservados na auditoria, fora das listas de participação comprovada e da medição. Não foram promovidos a resultado do atendimento.
- 20 contatos suspeitos sem prova independente suficiente receberam `Contato em conferência`. Envios pela API, links de convite e inclusão em campanhas ficam bloqueados; não foram mesclados nem receberam um telefone presumido.
- Cinco outros casos de contatos compartilhados não foram alterados por falta de evidência de erro; dois candidatos a mudança de DDD não passaram pela validação. Ter o mesmo contato não basta para concluir que são duplicados.

Bárbara, Bruna e Marco dos exemplos tiveram os contatos recuperados. O DDD de Bárbara na fonte é 61; Bruna e Marco têm 66. Isso demonstra por que não se deve trocar todo 62 por 66.

Após corrigir os DDDs, seis grupos (13 registros) atenderam à regra automática e foram mesclados em seis cadastros, com backup e preservação de vínculos. Os sete IDs retirados passaram a redirecionar para os sobreviventes. Nenhum contato/histórico em conferência entrou nessa automação. A consulta posterior é restrita aos sobreviventes; também foi corrigida a leitura de respostas RPC vazias (204), que estava transformando conclusões bem-sucedidas em erro.

## Onde conferir

**Cadastros → Auditoria da situação e duplicidades → Conferir**:

- **Contatos recuperados / histórico em conferência**: mostra contato atual, escola, matrícula/unidade da fonte, dados anteriores e atividades preservadas como não comprovadas.
- **Contatos suspeitos a conferir**: os 20 casos mantidos sem correção automática, com correspondências possíveis da fonte.

Histórico ou contato em conferência impede a mesclagem automática. As possíveis duplicidades reais continuam no painel; a escolha manual de mesclar preserva vínculos e aciona a consulta de ativos somente do sobrevivente. A visualização da recuperação acompanha aliases de IDs antigos.

## Preservação e limites

Cada correção guarda o cadastro completo anterior e os vínculos originais em `auditoria_crm_backup`; antes/depois, fonte e históricos separados ficam em `auditoria_contatos_correcoes`. A coleta mínima recente fica em `auditoria_contatos_fontes`, privada, sem política pública. A rotina privilegiada verifica concorrência, fonte única, matrícula compatível e prova independente de contato de outra pessoa. Casos com conversa, tarefa ou cobrança vinculada não têm a escola ou o histórico alterados automaticamente. Nenhuma mensagem foi enviada nem cobrança modificada.

A recuperação não prova autoria exclusiva do atendimento nem presume que ausência na fonte significa inatividade. Informações duvidosas foram separadas, sem inventar inscrições, presenças ou matrículas. Cópias originais permitem revisão e recuperação dirigida; não restaurar uma tabela inteira por cima do trabalho posterior.

## Prevenção

IDs de novas linhas sintéticas são estáveis por origem, escola e identidade, sem índice de posição. Antes do upsert, o importador verifica IDs globalmente, inclusive matrícula e escola, e interrompe colisões de identidade. Número local sem DDD é preservado como incompleto e não gera chave de contato para cruzamento. Cruzamento de inativos por telefone exige DDD explícito, nome compatível e ausência de ambiguidade.

Verificação: 58 testes automatizados e painel em 390/1365 pixels. Nenhum envio real foi usado para testar o bloqueio.

## Continuidade encontrada nos registros do Claude

No CRM, a última entrega descrita em `CLAUDE.md` é a cobrança mensal por ciclos de turma. Foi testada com ciclos fictícios, mas os ciclos reais ainda precisam de datas fornecidas pelas escolas; não devem ser inventados.

No Portal, `docs/CONTINUIDADE-VOLUNTARIADO-DIARIOS.md` e `docs/ACHADOS-INFORME-E-DIARIOS.md` distinguem reuniões já implementadas de escalas, ED/Pré-ED, GDVE, diários/importação Firebase, informe e avaliação de instrutores ainda pendentes. O levantamento posterior já obteve a estrutura do informe. Isso é o estado documentado encontrado, não acesso à conversa privada do Claude nem prova do instante em que os tokens acabaram. O checkout antigo do Portal contém alterações locais de outros trabalhos e não foi sobrescrito.

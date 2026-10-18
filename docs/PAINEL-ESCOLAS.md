# Acompanhamento por escola

Página `escola.html`, separada do CRM e sem SDK ou credenciais administrativas no navegador. O link tem uma chave aleatória de 256 bits no fragmento da URL, não em parâmetros enviados ao servidor de arquivos. É um acesso compartilhado de consulta, não identificação pessoal do visitante. Quem tiver o link pode consultar; encaminhar somente aos responsáveis locais. Os links emitidos nesta implantação valem 90 dias. Não foram enviados a terceiros.

## O que aparece

- Pedidos explícitos de apoio registrados na ficha pela equipe.
- Inscrições solicitadas, dados pendentes ou aguardando registro.
- Confirmação de presença e presença a conferir, ou retorno após visita sem matrícula informada, em atividades da própria escola dentro da janela de 90 dias anteriores/seguintes.
- Nome, etapa, atividade, situação do convite/presença, próximo passo, responsável e pedido destinado à escola. Cadastro conferido não comprova contribuição recebida.

A ficha do CRM passa a ter “O que precisa de atenção da escola” e “Pedido visível no painel da escola”. As anotações internas, telefone/e-mail, documentos e histórico de conversas não são enviados por esse painel. Ao encerrar o pedido de apoio, selecionar “Sem pedido de apoio”; o texto não será exposto como solicitação ativa. Outras pendências ainda podem manter a pessoa no painel.

O painel é de leitura: não grava presença, não cadastra aluno nem permite ao visitante mudar escola. Busca e categorias consultam todos os resultados elegíveis no servidor; a paginação mostra 50 por vez. Os registros dependem da atualização da equipe e das fontes, sem promessa de tempo real.

## Acesso

`acompanhamento_links_escola` guarda somente hash das chaves, escola, validade e revogação. RLS habilitada, sem acesso anon/authenticated. A função SQL é executável somente por service_role. A Edge Function `painel-escola` valida a chave, calcula o hash e chama a consulta: a escola vem do vínculo no banco, nunca de parâmetro fornecido pelo visitante. A função tem verify_jwt=false deliberadamente e exige a chave própria; chave ausente, inválida, expirada ou revogada não autoriza consulta.

A página não tem ferramentas de análise nem recursos de terceiros, usa política de conteúdo restrita, referrer desativado e requisições sem cache. CORS aceita a origem publicada do CRM; isso é uma proteção complementar, não substitui a chave. Notas internas não devem ser copiadas no campo destinado à escola.

Os problemas preexistentes de autenticação/RLS do CRM legado não foram corrigidos por este módulo. O novo painel não herda esse login nem expõe a chave pública do SDK. Não prometer isolamento de toda a aplicação a partir dessa implementação.

## Administração

Emitir/rotacionar links somente com acesso administrativo. Nunca incluir chaves no repositório, páginas públicas de listagem ou logs. Os links emitidos foram guardados em arquivos locais privados em `/workspace/shared/painel-escolas`, fora do checkout publicado. O arquivo entregue ao administrador deve ser tratado como lista de acessos.

Para revogar, atualizar `revogado_em` do identificador correspondente em `acompanhamento_links_escola`. Para substituir, revogar o anterior, gerar outra chave criptográfica, gravar seu SHA-256 e enviar o novo endereço somente aos responsáveis autorizados. Excluir o hash do banco também invalida o link, mas a revogação preserva o registro administrativo.

## Validação

Testes SQL em banco isolado: escola A não recebe escola B, notas internas ausentes, chamada anônima/tabela privada negadas, expiração/revogação, migração repetível e busca em registros além da primeira página. Testes de página real no Chromium em 320, 414 e 1365 px: paginação, busca em 105 registros, HTML tratado como texto e ausência de consulta sem chave. Testes de corpo/hash em Node. Verificações em produção consultam apenas contagens/escola, sem registrar dados pessoais ou chaves nos logs.

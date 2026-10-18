# WhatsApp Unificado — experiência de atendimento

A caixa de entrada começa pelas conversas mais recentes. Em “Filtros e opções” ficam filial, ordenação, arquivadas, responsável e janela de atendimento. No celular, abrir uma conversa ocupa a área de mensagens; “Conversas” retorna à lista.

Rascunhos de texto são guardados separadamente por contato, somente na memória da aba. Recarregar a página encerra esses rascunhos. Anexos e gravações não são mantidos ao trocar de pessoa. Enter envia, Shift+Enter quebra linha. Falhas no envio de texto preservam a mensagem para nova tentativa. Abrir rapidamente outra conversa descarta o histórico que chegar atrasado. Atualizações de recebimento não puxam quem está lendo o histórico para o fim.

A lista consulta todas as páginas antes de aplicar os filtros, com busca de dados complementares em lotes. Erros na consulta principal mostram opção de tentar novamente, sem apresentar o resultado parcial como completo.

As restrições de contato e a janela oficial de 24 horas continuam valendo. Não há simulação de presença, digitação ou confirmação de leitura: esses estados dependem dos dados efetivamente disponíveis na integração.

## Validação

- `node --test tests/*.test.mjs`
- `node tests/browser-whatsapp-experiencia.mjs`: interface real em Chromium, 390 e 1365 px, backend fictício, sem envio real. Troca de contatos, rascunhos, quebra de linha, envio simulado com sucesso/falha e abertura concorrente.
- `node tests/browser-organizacao.mjs`: navegação e organização da interface.
- `node --check js/whatsapp.js`

Não equivale a validação em Safari/iPhone físico ou entrega real pela Meta.

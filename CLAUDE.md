# CRM Nova Acrópole — Contexto do Projeto

CRM customizado (Vanilla JS + Supabase) para gestão de prospecção/resgate de
leads da escola Nova Acrópole, multi-filial. Este arquivo existe pra qualquer
sessão do Claude Code neste projeto já começar com o contexto certo, sem
precisar reexplicar tudo de novo.

## Stack

- **Frontend:** HTML5, CSS3, JavaScript puro (Vanilla JS). Sem frameworks.
- **Backend/Banco:** Supabase (Postgres), acessado direto do navegador via
  `@supabase/supabase-js@2` (chave publishable). Sem servidor próprio de
  aplicação — as exceções são a integração com WhatsApp, a classificação
  de temas de evento por IA e o cofre de credenciais do futuro scraper de
  Ulisses/Mercúrio (ver seções próprias abaixo), que rodam em Supabase
  Edge Functions porque precisam guardar uma chave/token secreto (e, no
  caso do WhatsApp, receber webhooks), algo que não dá pra fazer só no
  navegador. O scraper em si (login automatizado no Ulisses/Mercúrio) vai
  precisar de MAIS uma exceção — algo fora do Supabase, capaz de rodar um
  navegador automatizado — ainda não implementado.
- **Ambiente:** Live Server (VS Code), roda em `127.0.0.1:5500`.
- **Parser de CSV:** Papa Parse (CDN), usado só no importador de planilhas.
- **Logo:** `img/logo-nova-acropole.png`, usado como favicon e no topbar
  (`<img class="topbar-logo">`, com `onerror` pra não quebrar o layout se o
  arquivo sumir).

## Estrutura de arquivos

```
index.html          → estrutura das 5 abas + gaveta do lead + modais (colunas, filiais, pontuação)
css/style.css        → todo o CSS (design tokens no :root, ver abaixo)
js/app.js            → toda a lógica do Kanban/CRM (esse é o arquivo principal)
js/importador.js     → módulo separado: importação das 3 planilhas → Supabase
js/whatsapp.js       → módulo separado: integração real com WhatsApp (Meta Cloud API)
js/eventos.js        → módulo separado: Agenda de Eventos (cadastro manual, por filial)
js/mapa-turmas.js    → módulo separado: Mapa de Turmas (grade semanal dia x horário por
                        filial, só leitura — alimentada pelo scraper do Mercúrio)
js/leads-a-tratar.js → módulo separado: "Leads a Tratar" (duplicados por telefone/nome + sem telefone)
js/matricula-importar.js → módulo separado: importar matrícula via texto colado da tela do
                        Mercúrio (lista avulsa OU tela de Turma completa, com Dia/Horário) —
                        botão na coluna de Matriculados do Kanban, sem IA, sem Edge Function,
                        tudo lido por regex no navegador
js/notificacoes.js  → módulo separado: Central de Notificações (sino no topbar) — Lead
                        Forte 1 novo, evento quase lotado, lembrete vencido, WhatsApp recebido,
                        sincronização automática travada
js/log-atividade.js  → módulo separado: Log de Atividade (auditoria durável, append-only —
                        mover lead, tags, mesclagem, exclusão, importação; tabela sem policy
                        de UPDATE/DELETE, nem o app consegue apagar uma linha já gravada)
js/importar-conversa-whatsapp.js → módulo separado: cola o .txt exportado de uma conversa de
                        WhatsApp feita fora do CRM (API bloqueada) e grava no histórico do
                        lead, via Edge Function whatsapp-importar-conversa
js/acesso.js         → login NOMINAL por conta (nome + senha), ver seção "Contas de Usuário" —
                        substituiu o antigo portão de senha única do time
js/usuarios.js       → módulo separado: tela "Gerenciar Usuários" (só admin) + aplicação da
                        permissão por módulo na sidebar, ver seção "Contas de Usuário"
js/visao-geral.js    → módulo separado: "Agenda do Dia — Todas as Filiais", bloco no topo da
                        aba Visão Geral/Dashboard que cruza TODAS as filiais de uma vez,
                        independente da filial selecionada — ver seção própria
scraper/             → login automatizado no Ulisses/Mercúrio via Playwright, roda fora do
                        Supabase (GitHub Actions, .github/workflows/scraper.yml) — ver seção
                        própria "Scraper Ulisses/Mercúrio"
img/logo-nova-acropole.png              → logo, usado no favicon e no topbar
supabase/functions/whatsapp-send/       → Edge Function: envia mensagem via Graph API
supabase/functions/whatsapp-webhook/    → Edge Function: recebe mensagens/status da Meta
supabase/functions/classificar-temas/   → Edge Function: classifica tema de evento por IA (Anthropic)
supabase/functions/gerenciar-credenciais/ → Edge Function: cifra e grava senha do Ulisses/Mercúrio
                                     (cofre do futuro scraper — só escrita, nunca lê de volta)
supabase/functions/whatsapp-importar-conversa/ → Edge Function: grava em lote uma conversa de
                                     WhatsApp importada de fora do CRM (mensagens_whatsapp não
                                     tem policy de INSERT pro público, só service_role)
supabase/functions/resumo-semanal-chefe/ → Edge Function: monta e manda pro chefe de filial o
                                     resumo agregado da semana (log_atividade dos últimos 7
                                     dias) — ver seção "Resumo Semanal pro Chefe"
migracao_filiais.sql              → já rodada (cria tabela filiais + coluna filial)
migracao_historico_eventos.sql    → já rodada (coluna historico_eventos + constraint UNIQUE)
migracao_whatsapp.sql             → tabela mensagens_whatsapp + view vw_wpp_conversas
                                     (rodar manualmente no SQL Editor antes de usar a
                                     integração — ver checklist na seção WhatsApp)
migracao_temas_eventos.sql        → tabela temas_eventos (cache de temas classificados por IA;
                                     rodar manualmente antes de importar — ver seção própria)
migracao_motivo_saida.sql         → coluna motivo_saida em leads_inscricoes (motivo de saída do ex-aluno)
migracao_pontuacao_lead_forte.sql → tabela config_pontuacao_lead_forte (critérios do nível
                                     1-3 de Lead Forte; rodar manualmente antes de importar)
migracao_tags_sugeridas.sql       → tabela tags_sugeridas (catálogo de tags compartilhado,
                                     editável em "Gerenciar Tags"; rodar manualmente)
migracao_tags_familia.sql         → coluna familia em tags_sugeridas (grupo editável
                                     manualmente; rodar manualmente, depois da acima)
migracao_lembrete_lead.sql        → colunas lembrete_em/lembrete_nota em leads_inscricoes
                                     (snooze/follow-up por lead; rodar manualmente)
migracao_data_saida.sql           → coluna data_saida em leads_inscricoes (data da baixa do
                                     ex-aluno, ao lado de motivo_saida; rodar manualmente)
migracao_eventos.sql              → tabela eventos (Agenda de Eventos, cadastro manual;
                                     rodar manualmente antes de usar a aba Agenda)
migracao_tipos_evento.sql         → tabela tipos_evento (catálogo editável de tipos de
                                     evento; rodar manualmente, depois da acima)
migracao_gate_lead_forte_1.sql    → coluna dias_gate_nivel_1 em config_pontuacao_lead_forte
                                     (trava de recência do Lead Forte 1; rodar manualmente)
migracao_duplicados.sql           → SUPERSEDIDA por migracao_leads_a_tratar.sql abaixo (a
                                     tabela criada por ela foi renomeada) — mantida só como
                                     histórico, não precisa rodar se ainda não rodou
migracao_leads_a_tratar.sql       → tabela leads_a_tratar (renomeia duplicados_leads se
                                     já existir; aba "Leads a Tratar" — rodar manualmente)
migracao_leads_a_tratar_pontuacao.sql → colunas pessoa_email/pontuacao em leads_a_tratar
                                     (critério "nome" com % de compatibilidade; rodar
                                     manualmente, depois da acima)
migracao_evento_leads.sql         → tabela evento_leads (vínculo lead <-> evento: resposta ao
                                     convite + comparecimento; rodar manualmente, depois de
                                     migracao_eventos.sql)
migracao_evento_data_limite.sql   → coluna data_limite_inscricao em eventos (evento fica
                                     "ativo" até essa data, não só até a própria data do
                                     evento — pensado pra Abertura de Turma; rodar manualmente,
                                     depois de migracao_eventos.sql)
migracao_abordagem_sugerida.sql   → coluna abordagem_sugerida em leads_inscricoes (bloco
                                     "Como Abordar" da gaveta, agora editável por lead; rodar
                                     manualmente)
migracao_evento_leads_matriculado.sql → coluna matriculado em evento_leads (3ª dimensão do
                                     modal de Participantes, além de resposta_convite/
                                     compareceu; rodar manualmente, depois de
                                     migracao_evento_leads.sql)
migracao_data_matricula.sql       → coluna data_matricula em leads_inscricoes (data da
                                     matrícula, usada nos Relatórios; rodar manualmente)
migracao_matricula_mercurio.sql   → coluna matricula_mercurio em leads_inscricoes + índice
                                     único por filial (número da matrícula no Mercúrio —
                                     evita reprocessar/duplicar entre prints de dias
                                     diferentes na importação via print; rodar manualmente)
migracao_eventos_multifilial.sql  → colunas imagem_url/descricao/grupo_evento_id/
                                     participantes_unificados em eventos (evento cadastrado
                                     pra várias filiais de uma vez; rodar manualmente,
                                     depois de migracao_eventos.sql)
migracao_leads_a_tratar_ignorados.sql → tabela leads_a_tratar_ignorados ("Ignorar" um
                                     grupo passa a ser permanente, sobrevive à próxima
                                     varredura; rodar manualmente)
migracao_trilhas_tipo_evento.sql  → SUPERSEDIDA por migracao_tipos_evento_trilha.sql
                                     abaixo (virou 2 colunas em tipos_evento, não uma
                                     tabela separada) — mantida só como histórico, não
                                     precisa rodar se ainda não rodou
migracao_tipos_evento_trilha.sql  → colunas trilha/palavras_chave em tipos_evento —
                                     classificação automática de tipo de evento E
                                     trilha de interesse (Filosófica/Desenvolvimento
                                     Pessoal/Artes) passam a ser 100% dirigidas por esse
                                     catálogo único, editável em "Gerenciar Tipos" na
                                     Agenda; base do sistema de follow-up "Trilhas +
                                     Jornada"; rodar manualmente, depois de
                                     migracao_tipos_evento.sql
migracao_sla_funil.sql            → coluna funil_agencia_atualizado_em em
                                     leads_inscricoes (quando o lead entrou na coluna
                                     atual) — base do SLA visual (borda vermelha em
                                     lead frio esquecido); rodar manualmente
migracao_motivo_perda.sql         → colunas motivo_perda/data_perda em
                                     leads_inscricoes (Motivos de Perda — mover um
                                     lead pra uma coluna "Perdido"/"Lixeira" exige
                                     dizer o porquê); rodar manualmente
migracao_vinculo_familiar.sql     → coluna grupo_familiar_id (uuid) em
                                     leads_inscricoes — Radar de Acompanhantes,
                                     agrupa N leads que se conhecem (cônjuge, amigos);
                                     rodar manualmente
migracao_credenciais_scraper.sql  → tabelas credenciais_scraper (cofre cifrado de
                                     senhas do Ulisses/Mercúrio, SEM acesso público —
                                     única exceção do projeto) e
                                     status_sincronizacao_automatica (log/alerta);
                                     base do "Login Automático", rodar manualmente
migracao_credenciais_scraper_leitura.sql → função ler_credencial_scraper() (decifra pro
                                     scraper ler, só service_role); rodar manualmente,
                                     depois da acima
migracao_credenciais_scraper_fix_pgcrypto.sql → corrige "pgp_sym_encrypt does not
                                     exist" (pgcrypto fica no schema "extensions" no
                                     Supabase, não "public"); rodar manualmente,
                                     depois das duas acima
migracao_credenciais_scraper_mercurio_http.sql → alarga a constraint de "sistema" em
                                     credenciais_scraper pra aceitar 'mercurio_http'
                                     (autenticação HTTP básica do Mercúrio, camada
                                     antes do Matrícula/Senha); rodar manualmente
migracao_credenciais_scraper_crm_acesso.sql → alarga a constraint de "sistema" em
                                     credenciais_scraper pra aceitar 'crm_acesso'
                                     (senha do portão de acesso do próprio CRM
                                     publicado, js/acesso.js — usada pelo scraper
                                     pra pilotar a tela de Importar, marco 3); rodar
                                     manualmente
migracao_data_nascimento.sql      → coluna data_nascimento em leads_inscricoes
                                     (Aniversariantes do Mês no Dashboard); rodar
                                     manualmente
migracao_filial_preposicao.sql    → coluna nome_com_preposicao em filiais (ex: "do
                                     Jardim América") — preenchimento automático da
                                     variável filial nos templates de WhatsApp;
                                     rodar manualmente
migracao_filial_whatsapp_chefe.sql → coluna whatsapp_chefe_numero em filiais —
                                     número (E.164) do chefe de filial/professor
                                     responsável, destinatário do aviso de
                                     aniversário de aluno Ativo e do resumo de lead
                                     sob demanda; rodar manualmente
migracao_turmas.sql               → tabela turmas (nome/dia/horário por filial) —
                                     base do Mapa de Turmas, sincronizada
                                     automaticamente pelo scraper do Mercúrio; rodar
                                     manualmente
migracao_filial_valor_mensalidade.sql → coluna valor_mensalidade em filiais — base do
                                     cálculo de receita/comissão de SDR no relatório
                                     "Matrículas por Mês"; rodar manualmente
migracao_log_atividade.sql        → tabela log_atividade (auditoria durável, append-only —
                                     só policy de SELECT/INSERT, sem UPDATE/DELETE, ver seção
                                     "Log de Atividade"); JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_whatsapp_importado.sql   → coluna importado_manualmente em mensagens_whatsapp (marca
                                     mensagem trazida de conversa feita fora do CRM, ver seção
                                     "Importar Conversa de WhatsApp"); JÁ RODADA nesta sessão
                                     via `supabase db query --linked`
migracao_agendamento_mercurio_pgcron.sql → habilita pg_cron/pg_net e cria o cron job que dispara
                                     o Mercúrio às 05:00 Brasília (substitui o schedule: do
                                     GitHub Actions, pouco confiável); JÁ RODADA nesta sessão
                                     via `supabase db query --linked`
migracao_filial_endereco.sql      → coluna endereco em filiais, mostrado na gaveta de qualquer
                                     lead daquela filial junto com valor_mensalidade; JÁ RODADA
                                     nesta sessão via `supabase db query --linked`
migracao_usuarios_crm.sql         → tabela usuarios_crm (login NOMINAL por conta, com permissão
                                     por módulo — substitui a senha única do portão de acesso;
                                     ver seção "Contas de Usuário"); JÁ RODADA nesta sessão via
                                     `supabase db query --linked` — já vem com um usuário admin
                                     inicial ("Henrique", senha temporária "trocar123")
migracao_whatsapp_atendente.sql   → coluna atendente_nome em mensagens_whatsapp (nome do usuário
                                     logado que enviou cada mensagem); JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_rpc_leads_agenda_geral.sql → função leads_agenda_geral_prioritarios() (RPC — filtra
                                     `tags` por conteúdo sem o PostgREST tropeçar no tipo jsonb;
                                     ver seção "Agenda do Dia"); JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_agendamento_resumo_semanal.sql → cron job que dispara o resumo semanal (agregado) pro
                                     chefe de cada filial toda segunda-feira 08:00 Brasília; JÁ
                                     RODADA nesta sessão via `supabase db query --linked`
```

## Banco de dados (Supabase)

Projeto: `eovgljcowblwoxmobeno.supabase.co` (chave publishable já embutida
no `index.html`, não precisa mexer).

### Tabela `leads_inscricoes`
Chave de update/upsert: **`pessoaIdentificador`** (tem constraint UNIQUE —
não usamos a coluna `id` genérica pra nada).

Colunas relevantes:
- `pessoaIdentificador`, `pessoaNome`, `pessoaTelefoneDDD`, `pessoaTelefoneNumero`, `pessoaEmail`
- `pessoaStatus`, `telemarketingStatus` (vêm da planilha de Inscrições/Ulisses)
- `eventoNome`, `eventoData` — strings com múltiplos valores separados por ` | ` (formato antigo, mantido por compatibilidade com a gaveta do lead)
- `historico_eventos` (jsonb) — formato novo e estruturado: `[{evento, data, tipo, tema}, ...]`
  (`tema` é opcional — só existe se a Edge Function `classificar-temas` já
  classificou aquele evento na hora da importação; ver seção própria)
- `tags` (jsonb, na prática guardado como string JSON) — ver seção Tags abaixo
- `funil_agencia` (texto) — em qual coluna do Kanban o lead está (chave dinâmica, ver `columnsConfig`)
- `resumo_ia` (texto) — resumo editável na gaveta do lead
- `filial` (texto) — qual unidade (ver tabela `filiais`)
- `motivo_saida` (texto, nullable) — motivo de saída do ex-aluno (coluna
  "Motivo" da planilha de Inativos), preenchido pelo importador.
- `data_saida` (texto, nullable) — data da baixa do ex-aluno (coluna "Data"
  da planilha de Inativos, guardada como texto igual `eventoData`, sem
  tentar validar/converter formato), preenchido pelo importador
  (`migracao_data_saida.sql` — rodar manualmente). Na gaveta do lead, o
  bloco "Saída (Inativo)" mostra motivo + data juntos pra qualquer lead com
  a tag `"Inativo"` (ou `"Ex-Aluno (Inativo)"`, nome antigo), mostrando
  "Não informado"/"Não informada" quando a coluna vier vazia
  (`abrirGaveta()` em `js/app.js`) — a lógica é só de exibição, o banco
  continua guardando `null` quando não há motivo/data.
- `abordagem_sugerida` (texto, nullable) — bloco "Como Abordar" da gaveta,
  editável (`editarAbordagemSugerida()`/`salvarAbordagemSugerida()`,
  `js/app.js`, `migracao_abordagem_sugerida.sql`).
- `data_matricula` (date, nullable, `migracao_data_matricula.sql`) — data
  da matrícula, usada nos Relatórios. Alimentada por dois caminhos: marcar
  "Matriculado: Sim" num participante de evento (ver "Agenda de Eventos"
  abaixo) grava a data de hoje (só se ainda não tiver uma), e a importação
  de matrícula via print (ver seção própria) grava a data exata lida do
  print, na coluna "Ingresso" do Mercúrio.
- `matricula_mercurio` (integer, nullable, `migracao_matricula_mercurio.sql`,
  índice único por `filial`) — número da coluna "Matr." do Mercúrio,
  gravado pela importação de matrícula via print; é a chave de deduplicação
  entre prints de dias diferentes (ver seção própria).
- `funil_agencia_atualizado_em` (timestamptz, `migracao_sla_funil.sql`,
  default `now()`) — quando o lead entrou na coluna ATUAL do Kanban.
  Gravado por `moverLeadsParaColuna()`/`executarMovimentoParaColuna()`
  (`js/app.js`) toda vez que a coluna muda; a importação NUNCA inclui essa
  coluna no payload de upsert, então reimportar um lead existente não
  reseta o relógio. Base do **SLA visual** — ver seção própria.
- `motivo_perda`/`data_perda` (texto/date, nullable,
  `migracao_motivo_perda.sql`) — preenchidos por `registrarMotivoPerda()`
  quando um lead é movido pra uma coluna "Perdido"/"Lixeira". Ver seção
  "Motivos de Perda".
- `grupo_familiar_id` (uuid, nullable, `migracao_vinculo_familiar.sql`) —
  Radar de Acompanhantes. Ver seção própria.
- `data_nascimento` (date, nullable, `migracao_data_nascimento.sql`) —
  nenhuma das 3 planilhas traz esse dado hoje, então é preenchida
  manualmente no bloco "Contato" da gaveta (`salvarDataNascimentoLead()`,
  `js/app.js`) — pronta pra ser alimentada automaticamente no futuro se o
  scraper do Mercúrio (ver seção própria) conseguir extrair do CADASTRO.
  Alimenta o card **"Aniversariantes do Mês"** no Dashboard
  (`atualizarAniversariantes()`) — busca direta no banco (não é proxy,
  já que aniversário importa pra filial inteira), aniversariante de HOJE
  ganha o mesmo destaque festivo do feed de Matriculado/Recuperado
  (`.activity-item-festiva`) **e sempre aparece no TOPO da lista**
  (ordenação de 2 níveis: hoje primeiro, resto por dia crescente — antes
  era só cronológico, então o aniversariante de hoje podia ficar
  escondido no meio/fim da lista dependendo do dia do mês).

### Tabela `filiais`
`id`, `nome`, `ativo`, `ordem`. Hoje tem 3: Goiânia - Jardim América, Goiânia
- Setor Oeste, Goiânia - Garavelo. O seletor de filial no topo do CRM é
alimentado por essa tabela. `whatsapp_phone_number_id` (nullable) guarda o
número da Meta daquela filial — nulo = usa o secret padrão
`WHATSAPP_PHONE_NUMBER_ID_DEFAULT` (hoje só existe 1 número compartilhado).
**Cadastro/edição pelo próprio CRM**: botão de engrenagem ao lado do
seletor de filial no topbar abre "Gerenciar Filiais" (`abrirGerenciarFiliais()`
em `js/app.js`) — cria, renomeia, reordena e desativa filiais direto do
navegador (grava na hora no Supabase, diferente de "Gerenciar Colunas" que
é só `localStorage`). Desativar = `ativo=false`, não apaga nenhum lead.
`nome_com_preposicao` (nullable, `migracao_filial_preposicao.sql`) — forma
natural de falar o nome da filial (ex: `"do Jardim América"`, `"de Barra
do Garças"`), editável na mesma tela; alimenta o preenchimento automático
da variável `filial` nos templates de WhatsApp (ver seção própria).
`endereco` (nullable, `migracao_filial_endereco.sql`) — texto livre,
editável na mesma tela; junto com `valor_mensalidade` (já existente),
aparece na gaveta de QUALQUER lead daquela filial (bloco "Filial", dentro
de "Contato" — `abrirGaveta()`, `js/app.js`), pra responder "onde
fica?"/"qual o valor?" sem trocar de aba. Bloco some inteiro se a filial
não tiver nem endereço nem mensalidade cadastrados.

### Tabela `mensagens_whatsapp`
Histórico completo (enviado/recebido) da integração real de WhatsApp — ver
seção própria abaixo. `"pessoaIdentificador"` é nullable (mensagem de
número não identificado não pode se perder); `wa_message_id` é a chave de
deduplicação/casamento com atualizações de status vindas da Meta.

### Tabela `config_pontuacao_lead_forte`
Linha única (`id=1`) com os pesos usados pra graduar "Lead Forte" em nível
1-3 na importação — ver seção "Sistema de tags" e "Configurar critérios de
Lead Forte" (aba Importar). Editável pelo próprio CRM, sem precisar mexer
em código.

### Tabela `tags_sugeridas`
Catálogo de tags sugeridas pro SDR — `id`, `tag`, `ordem`, `familia`
(nullable). Compartilhada entre todo mundo que usa o CRM (diferente de
`columnsConfig`, que é só `localStorage`), gerenciável pelo botão
"Gerenciar Tags" no topo da aba CRM — dá pra editar o texto, mover entre
grupos (`Engajamento / SDR`/`Objeções`/`Interesses / Origem`/`Outras`) e
adicionar já escolhendo o grupo. Quando `familia` está preenchida, ela
VENCE a classificação automática por padrão de texto
(`mapaFamiliaManual` em `js/app.js`); tag sem `familia` continua caindo no
automático (`FAMILIAS_TAG`). Tags de sistema (Ativo/Inativo, níveis, Lead
Forte, Cadastro) não passam por essa tabela — não tem como "mover" essas
pelo Gerenciar Tags, só as do catálogo manual.

### Colunas `trilha`/`palavras_chave` em `tipos_evento`
Base do **sistema de follow-up** ("Trilhas de Interesse" + "Estágio da
Jornada" — ver seção própria abaixo), `migracao_tipos_evento_trilha.sql`.
**Não é mais uma tabela separada** (ver `migracao_trilhas_tipo_evento.sql`,
SUPERSEDIDA) — o usuário pediu explicitamente uma lista ÚNICA de tipos de
evento, editável só em "Gerenciar Tipos" na Agenda, que se reflita em
TODOS os lugares. Por isso essas 2 colunas vivem direto em `tipos_evento`
(o MESMO catálogo do cadastro manual de eventos):
- `trilha` (texto, nullable): `"Filosófica"`/`"Desenvolvimento Pessoal"`/
  `"Artes"`/`null`.
- `palavras_chave` (texto, nullable): lista separada por vírgula — se
  qualquer uma aparecer (case-insensitive) no NOME do evento vindo da
  planilha de Inscrições, aquele evento é classificado como este tipo em
  `historico_eventos[].tipo` na importação. **Substituiu o classificador
  hardcoded antigo** (`REGRAS_TIPO_EVENTO`, um array fixo de regex em
  `js/importador.js`) — agora é 100% dirigido por dados
  (`classificarTipoEvento()`/`carregarCatalogoTiposEvento()`), editável
  sem sessão de código nova. Um tipo sem `palavras_chave` nunca é
  atingido automaticamente (só existe pra cadastro manual na Agenda, ex:
  um tipo criado só pra uso interno) — é o caso de "Outro", sempre o
  fallback. Testados na ORDEM da coluna `ordem` do catálogo, primeira
  palavra-chave que bater vence.
- Editável pela tela "Gerenciar Tipos" (`abrirGerenciarTiposEvento()`/
  `renderizarListaTiposEventoModal()` em `js/eventos.js`) — cada linha
  ganhou um `<select>` de Trilha e um `<input>` de palavras-chave, além do
  nome/ordem/remover que já existiam. Sem a migração rodada, esses 2
  campos somem da tela (aviso próprio) e a importação cai no classificador
  antigo embutido (`REGRAS_TIPO_EVENTO_FALLBACK`) sem gerar tags de
  Trilha/Jornada — best-effort, nunca trava.
- A tela "Trilhas de Interesse" que existiu brevemente na aba Importar
  (tabela separada `trilhas_tipo_evento`, vocabulário próprio) foi
  **removida** por esse motivo — não reintroduzir, editar tudo em
  "Gerenciar Tipos".

### Tabela `credenciais_scraper` (+ `status_sincronizacao_automatica`)
`migracao_credenciais_scraper.sql`. Base do **"Login Automático"** — ver
seção própria no Importador. `credenciais_scraper` é a **ÚNICA tabela do
projeto que NÃO segue o padrão "acesso público"** do resto do app (RLS
`using(true) with check(true)`): tem RLS ligado e **nenhuma policy**, o
que nega acesso a `anon`/`authenticated` por padrão no Postgres — só o
`service_role` (Edge Functions, nunca a chave publishable do navegador)
enxerga essa tabela. Justificativa: aqui guardamos senha de sistemas de
terceiros (Ulisses de cada filial, Mercúrio), então não pode valer a
mesma regra de confiança total usada pra tags/filiais/eventos.
- `sistema` (`'ulisses'`/`'mercurio'`), `filial` (texto, `'GLOBAL'` fixo
  pro Mercúrio — 1 senha só, compartilhada), `usuario`, `senha_cifrada`
  (`bytea`, cifrado com `pgp_sym_encrypt()`/pgcrypto usando uma chave que
  só existe como secret da Edge Function, `CREDENCIAIS_SCRAPER_CHAVE` —
  nunca em texto puro, nunca no código).
- Só é ESCRITA, nunca lida de volta pelo frontend — a função Postgres
  `salvar_credencial_scraper()` (SECURITY DEFINER, `EXECUTE` restrito ao
  `service_role`) faz a cifragem; a view `status_credenciais_scraper`
  expõe só metadados (sistema/filial/usuario/`atualizado_em`), nunca a
  senha, pra tela "Login Automático" mostrar "configurado desde quando"
  sem precisar de acesso privilegiado.
- `status_sincronizacao_automatica` (essa sim, acesso público — não é
  sensível) é onde o FUTURO job de scraping (ainda não implementado, ver
  seção "Login Automático") grava cada tentativa (sucesso/falha +
  mensagem) — alimenta o gatilho 5 da Central de Notificações
  ("Sincronização travada").

## Conceitos importantes do app.js

- **Colunas do Kanban são dinâmicas**, configuráveis pelo usuário (botão
  "Gerenciar Colunas"), guardadas em `localStorage` (client-side, não no
  banco — cada navegador tem sua própria config de colunas hoje).
- **Gaveta de colunas**: cada coluna tem um botão pra ser "guardada"
  (`recolherColuna()`), some do board mas os leads dela continuam intactos
  — vira um chip com contagem numa barra acima do Kanban
  (`#colunasGaveta`/`montarGavetaColunas()`), clicar no chip restaura
  (`restaurarColuna()`). Estado em `colunasRecolhidas` (Set), também só
  `localStorage` (`crm_na_colunas_recolhidas`). Não deixa recolher a
  última coluna visível. **O número no chip fica vermelho
  (`.coluna-recolhida-count.tem-leads`) quando a coluna guardada tem 1+
  lead**, e cinza (padrão) quando está vazia — pensado pra chamar atenção
  de longe pra uma coluna esquecida com gente esperando dentro, sem
  precisar abrir a gaveta pra descobrir.
- **Paginação de `leadsAtuais` precisa de `ORDER BY` estável — bug real já
  corrigido**: `carregarLeads()` (e as outras 3 buscas paginadas do
  projeto: `processarPlanilhas()` em `js/importador.js`,
  `detectarLeadsATratar()` em `js/leads-a-tratar.js`,
  `carregarLeadsParaMatchMatricula()` em `js/matricula-importar.js`) usam
  `.range(inicio, fim)` pra paginar — sem um `.order()` antes disso, a
  ordem das linhas devolvidas pelo Postgres NÃO é garantida entre uma
  chamada e outra, especialmente com escritas concorrentes na tabela
  (mover um lead de coluna é um `UPDATE`, que pode realocar a posição
  física da linha). Isso causava exatamente o sintoma relatado pelo
  usuário: leads "sumindo" de colunas (inclusive Matriculados) sem padrão
  aparente, principalmente depois de mexer em outra coluna — na real,
  algumas linhas caíam num "buraco" entre uma janela de paginação e
  outra e nunca chegavam a ser buscadas pro navegador, enquanto uma busca
  direta (que não depende de paginação por offset) sempre as encontrava
  normalmente. Todas as 4 buscas agora ordenam por
  `.order('pessoaIdentificador', { ascending: true })` — chave estável e
  única, então a janela de cada página fica determinística independente
  de UPDATEs em outras colunas da mesma linha.
- **Sistema de tags:**
  - Três tags "de sistema", geradas pelo importador: `"Ativo"` (verde,
    `.tag-ativo` — aparece normalmente no Kanban, não é mais escondido:
    alunos ativos são uma fonte importante de indicação de novos alunos, o
    time precisa conseguir contatá-los), `"Inativo"` (âmbar, `.tag-exaluno`),
    `"Lead Forte N"` (dourado, `.tag-strong tag-strong-N`
    — veio em evento(s) mas nunca foi aluno; N é 1/2/3, 1 = mais propenso a
    matricular). **Cada grau do Lead Forte tem visual próprio**, não só o
    número: nível 1 é mais saturado/negrito e usa ícone de fogo, nível 2 é
    o dourado padrão com estrela cheia, nível 3 é apagado/cinza com estrela
    vazada — ver `.tag-strong-1/2/3` (`css/style.css`) e o trecho que monta
    o ícone em `renderizarCards()` (`js/app.js`).
  - **`"Recuperado"`** (verde-menta, `.tag-recuperado`, ícone de medalha,
    badge sempre visível igual as outras tags de sistema): marca quem
    **estava `"Inativo"` numa importação anterior e voltou como `"Ativo"`
    nesta importação** — rematrícula de verdade, detectada comparando as
    tags antigas do lead (antes do upsert) com as novas, dentro de
    `confirmarEnviarImportacao()` (`js/importador.js`). Só dá pra detectar
    a PARTIR do momento em que essa lógica existe — não há como reconstruir
    retroativamente quem foi recuperado antes disso só com a planilha do
    dia (ela não carrega histórico de status). Uma vez ganha, a tag **é
    permanente**: de propósito NÃO entra em `ehTagDeSistema()` (que decide
    o que é recalculado/descartado a cada reimportação), então sobrevive
    reimportações futuras pelo mesmo caminho das tags customizadas
    preservadas — mesmo que o lead saia de "Ativo" de novo depois, o selo
    de "já foi recuperado uma vez" fica. Alimenta o KPI "Resgates
    Efetivados" do Dashboard (ver bullet do `tab-dashboard` acima).
  - `"Ativo"`/`"Inativo"` eram `"Aluno Ativo"`/`"Ex-Aluno (Inativo)"` antes
    — nomes mais curtos, mesmo significado. Todo código que reconhece essas
    tags (badge, `FAMILIAS_TAG`, filtro rápido padrão, bloco de Motivo da
    Saída, KPI de resgate no Dashboard) checa os dois nomes, pra leads que
    ainda não passaram por uma reimportação desde a troca continuarem
    funcionando; o importador só GERA os nomes novos daqui pra frente. Ao
    checar essas tags no código, sempre comparar por ELEMENTO EXATO do
    array de tags já parseado (`parseTags(lead.tags).map(t=>t.trim())`),
    nunca `.includes()` na string JSON crua — "Ativo"/"Inativo" são curtos
    demais pra um `.includes()` de substring não correr risco de dar falso
    positivo com outra tag.
  - **Graduação do Lead Forte (1-3)**: calculada por pontos em
    `calcularNivelLeadForte()` (`js/importador.js`) — nº de eventos, nº de
    TIPOS distintos de evento (diversidade) e um bônus se o evento mais
    recente foi dentro de uma janela de dias. Os pesos e limiares **não
    estão no código**, ficam na tabela `config_pontuacao_lead_forte`
    (linha única, `id=1`) — editável pela tela "Critérios de Lead Forte"
    na aba Importar (`abrirConfigPontuacao()`/`salvarConfigPontuacao()`),
    de propósito, pra dar pra reajustar depois de analisar
    estatisticamente (via IA) o perfil de quem realmente converteu, sem
    precisar de uma sessão de código nova. Sem a migração rodada, cai num
    padrão embutido (`CONFIG_PONTUACAO_PADRAO`) e a importação não trava.
    **Nível 1 tem uma trava extra de recência** (`dias_gate_nivel_1`,
    `migracao_gate_lead_forte_1.sql`, padrão 30 dias): além de bater a
    pontuação mínima, precisa ter vindo em algum evento dentro dessa
    janela — senão cai pro nível 2, mesmo com pontuação de nível 1. É um
    campo separado de `pontos_evento_recente_dias` (que só dá um bônus de
    pontos, não barra nível nenhum) — os dois são editáveis
    independentemente na mesma tela.
  - **Nível de aluno/ex-aluno**, também gerado pelo importador a partir da
    coluna "Nivel" (Ativos) / "Ni" (Inativos): `TA` (Távola/Merlin,
    filosofia infantil), `JN` (Janos, adolescentes), `PP` (só o 1º mês,
    aluno novo ou saiu antes do 2º mês), `N1` (nível de entrada, mantido
    separado) e `Membro` (N2 a N7 unificados — já é membro estabelecido,
    o nível exato de 2 a 7 não muda a abordagem) — `classificarNivel()` em
    `js/importador.js`, badge roxo (`.tag-nivel`). Heurística por
    palavra-chave sobre texto normalizado; quem não bate com nenhuma regra
    fica sem essa tag (não inventa valor errado) — conferir a coluna Tags
    na prévia da importação antes de confirmar o envio.
  - **Sistema de follow-up — Trilhas de Interesse e Estágio da Jornada**
    (`calcularTagsTrilhaEJornada()`, `js/importador.js`, chamada dentro de
    `montarRegistroLead()`): a escola oferece atividades de 3 grandes
    interesses além do curso de filosofia em si (palestras/leitura/etc. da
    própria filosofia, cursos pagos de desenvolvimento pessoal como
    oratória/técnica de estudo, e oficinas de artes como pintura/canto/
    dança) — esse sistema mapeia a relação de cada lead com a escola pra
    conduzir a jornada até a matrícula, mesmo de quem chegou por uma
    atividade "de entrada" sem interesse declarado em filosofia ainda.
    - **`"Trilha: X"`** (badge ciano, `.tag-jornada`, família "Jornada"):
      uma tag por trilha distinta (`"Filosófica"`/`"Desenvolvimento
      Pessoal"`/`"Artes"`) que o lead já frequentou — pode acumular mais
      de uma. Calculada cruzando cada `historico_eventos[].tipo` do lead
      contra a coluna `trilha` do catálogo `tipos_evento` (ver seção do
      banco acima) — o TIPO em si já vem do MESMO catálogo
      (`palavras_chave`, `classificarTipoEvento()`), então editar
      "Gerenciar Tipos" na Agenda muda os dois de uma vez.
    - **`"Jornada: X"`**, só pra quem **NÃO** é `"Ativo"`/`"Inativo"`
      (aluno atual ou ex-aluno já tem sinal de sobra nas tags de sistema;
      a Jornada existe pra priorizar quem ainda é só prospecto):
      `"Descoberta"` (só passou por trilhas fora da Filosófica — nunca
      teve contato direto com filosofia), `"Interesse Emergente"` (já
      veio em algo da trilha Filosófica, mas o Lead Forte não é 1 nem 2),
      `"Engajado"` (trilha Filosófica + Lead Forte 1 ou 2 — sinal forte
      de propensão a matricular). Quem nunca apareceu em nenhum evento
      classificado numa trilha fica sem tag de Jornada (não força um
      estágio sem sinal nenhum).
    - Tanto `Trilha:` quanto `Jornada:` são recalculadas do zero a cada
      reimportação (`ehTagDeSistema()`), já que dependem só de
      `historico_eventos` (que só cresce) — sempre reflete o estado mais
      atual, sem risco de acumular tag antiga/divergente.
    - Alimenta o relatório **"Jornada da Base"** (aba Relatórios,
      `renderizarRelatorioJornadaBase()` em `js/app.js`) — funil visual
      contando quantos leads estão em cada estágio (Descoberta →
      Interesse Emergente → Engajado → Matriculado, + Em Recuperação).
    - **"Verdadeiros" Leads Fortes**: card no Dashboard "Jornada até a
      Matrícula" (`renderizarResumoJornada()`/`filtrarPorJornada()`,
      mesmo padrão clicável do card "Lead Forte por Nível" logo acima —
      clicar em qualquer estágio já filtra o CRM por aquela tag via
      `quickFilterTag()`) mostra Descoberta/Interesse Emergente/Engajado
      lado a lado. A ideia: Lead Forte puro conta QUALQUER evento (inclui
      quem só foi numa Oficina de Artes, sem nenhum interesse declarado em
      filosofia); `"Jornada: Engajado"` é mais específico — trilha
      Filosófica confirmada + Lead Forte 1 ou 2 — e é o alvo certo pra
      **começar os contatos por ele**, priorizando cobertura da filosofia
      sobre volume bruto de eventos.
    - `"Jornada: Engajado"` entra em `FILTROS_RAPIDOS_PADRAO` (Filtro
      Rápido do Kanban), no lugar de mais um filtro genérico — é a lista
      de contato prioritária. `"Jornada: Interesse Emergente"` fica
      disponível pelo card do Dashboard acima ou pelo filtro de coluna
      normal — é o alvo de NUTRIÇÃO (já mostrou interesse em filosofia,
      mas ainda não está "quente"), ação diferente de "ligar agora".
  - **`"Inscrito: Abertura de Turma"`** (azul saturado, `.tag-inscrito-turma`,
    negrito — mesmo peso visual de "Perdido"/"Ligar Hoje", é um AVISO
    acionável, não uma classificação neutra): pedido direto do usuário
    depois de um SDR ligar oferecendo matrícula pra alguém que JÁ tinha
    se inscrito numa abertura de turma futura, sem saber
    (`calcularTagInscricaoAberturaTurma()`, `js/importador.js`, chamada
    dentro de `montarRegistroLead()`). Olha `historico_eventos` por
    qualquer evento com `tipo === 'Abertura de Turma'` (catálogo de
    `tipos_evento`, mesma classificação de sempre) cuja data ainda não
    passou — recalculada do zero a cada reimportação (só depende de
    `historico_eventos`, mesmo grupo de preservação de "Trilha" na
    importação PARCIAL: precisa do ULISSES pra recalcular, é preservada
    quando a rodada é só-Mercúrio). Aparece pra QUALQUER lead com essa
    inscrição futura, independente de ser Ativo/Inativo/Lead Forte —
    diferente de "Jornada", que exclui Ativo/Inativo de propósito.
  - **Tags de Cadastro** (`"Sem Telefone"`/`"Sem E-mail"`, laranja
    `.tag-warning`, família "Cadastro"): geradas automaticamente por
    `montarRegistroLead()` (`js/importador.js`) quando o lead não tem
    aquele dado — só o caso negativo/acionável ganha badge. Telefone e
    e-mail são editáveis direto na gaveta do lead (bloco "Contato", salva
    sozinho a cada `onchange` — `salvarTelefoneLead()`/`salvarEmailLead()`
    em `js/app.js`), e preencher/apagar o campo já ajusta essas duas tags
    na hora, sem esperar a próxima importação.
  - **Casamento Ativos/Inativos ↔ Inscrições por TELEFONE, além de nome**:
    o cruzamento principal continua por nome normalizado (heurística, não
    garantia), mas se o nome não bater — típico de erro de digitação numa
    das planilhas — o importador tenta casar pelo telefone também, só pra
    Inativos (Ativos não tem coluna de telefone na planilha). Normaliza o
    número removendo o 9º dígito de celular antes de comparar
    (`normalizarTelefoneParaChave()`), pra "com 9" e "sem 9" caírem na
    mesma chave. O log mostra quantos foram casados assim.
  - **Fusão de duplicatas dentro da própria planilha de Inscrições**: às
    vezes o Ulisses tem a MESMA pessoa cadastrada com dois
    `pessoaIdentificador` diferentes (cadastro duplicado do lado deles) —
    sem tratar isso, viravam 2 leads separados no CRM com nome e telefone
    idênticos, cada um só com uma fatia do histórico de eventos. O
    importador funde esses casos automaticamente (`processarPlanilhas()`,
    passo 2.1) quando nome normalizado E telefone batem exatamente — nome
    sozinho não é confiança suficiente. Une o histórico de eventos dos
    dois (sem duplicar evento+data repetido) num único lead; o log mostra
    quantas fusões aconteceram.
  - **Catálogo de tags sugeridas pro SDR** — vive na tabela `tags_sugeridas`
    (compartilhada entre navegadores/time, editável pelo botão "Gerenciar
    Tags" no topo da aba CRM: `abrirGerenciarTags()` em `js/app.js`),
    carregada uma vez em `carregarTagsSugeridas()` pro array `TAGS_SUGERIDAS`
    (só strings, não mais objeto fixo no código). Aparecem como autocomplete
    (`<datalist>`) no formulário de nova tag da gaveta
    (`abrirFormNovaTag()`/`confirmarNovaTag()`) e também "enriquecem" o
    dropdown de filtro de cada coluna desde o primeiro uso. A cor do badge
    (`classeVisualTag()`) é decidida por PADRÃO de texto, não por pertencer
    ao catálogo nem por nenhuma coluna de "família" no banco — então uma
    tag customizada parecida (ex: `"Objeção: Saúde"`) já ganha a cor certa
    (`.tag-warning` amarelo/laranja pra objeções, `.tag-error` vermelho
    pra engajamento problemático, `.tag-success` azul pra interesse/origem).
  - Tags customizadas (adicionadas manualmente pelo time, do catálogo ou
    não) convivem com as de sistema e são preservadas quando o importador
    roda de novo.
  - **"Ativo"/"Inativo" aparecem como sugestão no formulário de nova tag**
    da gaveta (`TAGS_SISTEMA_SUGERIDAS_MANUALMENTE` em `js/app.js`, união
    com `TAGS_SUGERIDAS` só na hora de montar o `<datalist>`) — de
    propósito NÃO vivem na tabela `tags_sugeridas` nem aparecem em
    "Gerenciar Tags" (são protegidas, comparadas por texto exato em vários
    lugares do código). Serve pra corrigir na mão um caso que a importação
    deixou passar (o cruzamento é por nome/telefone normalizado, é
    heurística, não garantia — ver seção do Importador). `confirmarNovaTag()`
    bloqueia tag duplicada no mesmo lead e trata "Ativo"/"Inativo" como
    mutuamente exclusivos: adicionar um remove o outro automaticamente
    (inclusive os nomes antigos "Aluno Ativo"/"Ex-Aluno (Inativo)").
- **Ordenação do quadro** (`#sortSelect`, topo da aba CRM) tem, além de
  nome A-Z/Z-A: "Mais Tags Primeiro" (`tags_desc`), "Lead Forte" (nível 1
  primeiro), "Nível de Aluno" (segue a progressão TA → JN → PP → N1 →
  Membro) e "Prioridade de Contato" (`prioridade`, composto: Lead Forte →
  quantidade de tags → nome, pensado como "quem ligar primeiro hoje").
  Funções `rankLeadForte()`/`rankNivelAluno()`/`contarTags()` em
  `js/app.js`, usadas dentro de `renderizarCards()`.
- **Filtros avançados são POR COLUNA**, não mais um painel global — cada
  coluna do Kanban tem seu próprio botão "Filtros" (dropdown com tags,
  evento, intervalo de data, telefone/e-mail — **não tem mais Status nem
  Telemarketing**, ver bullet próprio abaixo), estado em
  `filtrosColuna[chaveDaColuna]`. **Tags dentro do filtro de uma
  coluna são combinatórias em E** (precisa ter todas as marcadas, não
  qualquer uma) — `aplicarFiltroVisualColuna()` em `js/app.js`. Além da
  lista de inclusão, cada coluna tem uma segunda lista **"Excluir" (filter
  out)** — `filtro.tagsExcluidas`, chips vermelhos quando ativos
  (`.col-filter-exclude-list`), marcada por `toggleFiltroColunaChipExcluir()`:
  esconde qualquer lead que tenha PELO MENOS UMA das tags marcadas ali,
  independente do que passou no filtro de inclusão — útil pra, dentro de
  uma coluna já filtrada por algo, tirar uma "situação" indesejada
  específica (ex: já filtrei por "Lead Forte 1" mas quero esconder quem já
  está com "No-Show"). Fica FLAT (sem agrupar por família, diferente da
  lista de inclusão) — geralmente só 1-2 tags por vez. As tags do dropdown
  de inclusão aparecem **agrupadas por família** (Sistema, Nível, Cadastro,
  Engajamento / SDR, Objeções, Interesses / Origem, Outras —
  `montarChipsTagsAgrupados()`, mesma fonte de classificação
  `FAMILIAS_TAG`/`identificarFamiliaTag()` usada pela cor do badge — o
  regex de "Nível" também reconhece `N2`-`N7` direto, formato antigo de
  antes do esquema TA/JN/PP/N1/Membro existir, só pra classificar
  corretamente tags que ainda não passaram por uma reimportação). A busca
  de texto por coluna é separada e continua consultando o banco inteiro
  (não só o que já foi carregado no navegador) via `processarBuscaColuna()`
  — importante pra colunas com muitos milhares de leads (ex: "Frios").
- **Filtro Rápido dinâmico** (`#filtrosRapidosContainer`, `renderizarFiltrosRapidos()`):
  mostra até 5 tags — toda ativação de tag num filtro de coluna
  (`toggleFiltroColunaChip`) ou clique num filtro rápido (`quickFilterTag`)
  conta um uso (`registrarUsoFiltroTag()`), persistido em `localStorage`
  (`crm_na_uso_filtros_tags`, por navegador, sobrevive a fechar/reabrir o
  navegador — não é compartilhado entre o time). Enquanto o uso real ainda
  não preenche as 5 vagas, completa com `FILTROS_RAPIDOS_PADRAO` (`"Lead
  Forte 1"`, `"Jornada: Engajado"`, `"Ativo"`, `"Inativo"`, `"Indicação de
  Aluno"`) — some sozinho assim que o uso de verdade cobrir as 5 vagas.
  Cada botão usa a mesma cor de família do badge da tag
  (`classeVisualTag()`, classe `.filtro-rapido-btn`) em vez de um chip
  genérico, pra reconhecer/clicar sem precisar ler o texto.
- **Status e Telemarketing**: `telemarketingStatus` foi descontinuado da
  interface por completo (a coluna continua existindo em
  `leads_inscricoes`/vindo da planilha, só não aparece mais em lugar
  nenhum do CRM). `pessoaStatus` saiu do filtro por coluna e passou a
  aparecer na gaveta do lead (bloco "Status", só quando o lead tem um
  valor preenchido) — pensado como "vale a pena entrar em contato ou não"
  ao abrir um lead específico. O texto exibido passa por
  `formatarTextoPadrao()` (Title Case, preposições comuns em minúsculo,
  troca `_` por espaço antes de tudo — o Ulisses manda alguns valores tipo
  `"Pode_me_contactar"`) pra ficar no mesmo padrão de escrita das tags,
  mesmo vindo com formatação inconsistente da planilha — é só exibição, o
  valor salvo no banco não muda.
- **Seleção em massa + mover entre colunas**: cada card tem um checkbox
  (`.lead-select`, canto superior direito) e cada coluna tem um botão
  "Selecionar visíveis" que marca/desmarca todos os cards que passam no
  filtro atual daquela coluna — útil pra, por exemplo, filtrar uma coluna
  pela tag "WhatsApp Inválido" e mover todo mundo de uma vez pra uma coluna
  "Atualizar Cadastro". A seleção pode juntar cards de colunas diferentes.
  Duas formas de mover a seleção, as duas passando por
  `moverLeadsParaColuna(ids, novaColuna)` (update otimista + 1 request em
  lote via `.in('pessoaIdentificador', ids)`, com rollback local se o
  Supabase falhar):
  1. Barra fixa no rodapé (`#bulkActionBar`, só aparece com ≥1
     selecionado) com `<select>` de coluna destino + botão "Mover"
     (`moverSelecionadosParaColuna()`).
  2. **Arrastar 1 card já move a seleção inteira** — `soltar()` detecta se
     o card arrastado faz parte de uma seleção com >1 item; se não fizer
     parte (ou a seleção tiver só ele), move só esse card normalmente.
  Toda movimentação (1 card ou em massa, por botão ou arrastando) mostra
  uma barra "Desfazer" por 5s (`#undoBar`/`mostrarUndoMovimento()`/
  `desfazerUltimoMovimento()`), que reverte cada lead pro
  `funil_agencia` anterior.
  A mesma barra `#bulkActionBar` também tem **edição de tags em massa**
  (`aplicarTagEmMassa('add'|'remove')`) — diferente de mover (1 payload
  igual pra todo mundo), cada lead pode já ter um conjunto de tags
  diferente, então o array final é calculado por lead e enviado como 1
  update por lead em paralelo (`Promise.all`), sem barra de desfazer (não
  pedido).
  **`moverLeadsParaColuna()` virou um portão**: só decide se a coluna de
  destino é "Perdido"/"Lixeira" (`ehColunaPerdido()` — ver "Motivos de
  Perda" abaixo) e, se for, abre o modal de motivo em vez de mover
  na hora; quem faz a movimentação de verdade (update otimista, undo,
  `funil_agencia_atualizado_em`) é `executarMovimentoParaColuna()`, uma
  função nova que tem o corpo que antes vivia direto em
  `moverLeadsParaColuna()`.
- **SLA de atendimento** (`SLA_HORAS_COLUNA_FRIA`, hoje 2h): lead ainda na
  PRIMEIRA coluna do funil (frio, nunca abordado) há mais tempo que isso
  desde a última troca de coluna ganha borda vermelha
  (`.lead-card-sla-vencido`, calculado em `renderizarCards()`) — bate o
  olho sem precisar abrir a ficha. Usa `funil_agencia_atualizado_em`
  (`migracao_sla_funil.sql`), gravado por `executarMovimentoParaColuna()`
  toda vez que a coluna muda; sem a migração rodada (coluna `null` pra
  leads antigos), não marca nada. Um `setInterval` de 3 minutos no fim de
  `js/app.js` refresca o Kanban só pra atualizar essa borda mesmo com o
  quadro parado (sem essa interação, a borda só apareceria na próxima vez
  que algo disparasse `renderizarCards()` de qualquer jeito).
- **Motivos de Perda** (`MOTIVOS_PERDA`, `ehColunaPerdido()`,
  `migracao_motivo_perda.sql`): mover 1+ leads pra qualquer coluna com
  "perdid" ou "lixeira" no nome/chave (mesma heurística por substring já
  usada pra Matriculados/Ativos/Recontato) abre o modal
  `#modalMotivoPerda` ANTES de completar a movimentação — cancelar não
  move nada; confirmar chama `executarMovimentoParaColuna()` e depois
  `registrarMotivoPerda()`, que grava `motivo_perda`/`data_perda` +
  aplica a tag de sistema `"Perdido"` (badge vermelho, sempre visível,
  igual Ativo/Inativo/Recuperado). Bloco "Motivo da Perda" na gaveta
  (dentro de "Histórico", ao lado de "Saída (Inativo)") só aparece pra
  quem tem a tag. Alimenta o relatório **"Motivos de Perda"** na aba
  Relatórios (`renderizarRelatorioMotivosPerda()`) — funil por motivo,
  proxy sobre `leadsAtuais`.
- **Follow-up "soneca"**: lead com `lembrete_em` no FUTURO simplesmente
  não é desenhado na sua coluna (`renderizarCards()`, guarda contado em
  `sonecaPorColuna`) até o dia marcado — um chip "N em soneca" aparece no
  cabeçalho da coluna (`#soneca-${key}`) e clicar nele
  (`toggleSonecaColuna()`) revela temporariamente (estado só em memória,
  `colunasSonecaRevelada`, não persiste — é uma espiada rápida, não uma
  preferência). Quando o lembrete vence (hoje ou atrasado), o card sobe
  pro TOPO da coluna (array `htmlPorColuna[key].urgente`, concatenado
  antes de `.normal` — independe de qual seja o modo de ordenação
  escolhido) e ganha a tag visível `"Ligar Hoje"` (`.tag-ligar-hoje`),
  além do sino que já existia no nome do card.
- **Radar de Acompanhantes** (vínculo familiar): grupo de N leads que se
  conhecem (cônjuge, amigos, quem veio junto) — implementado com UMA
  coluna (`grupo_familiar_id`, uuid, `migracao_vinculo_familiar.sql`) em
  vez de tabela própria, mesmo padrão de `eventos.grupo_evento_id`; um
  lead pertence a no máximo 1 grupo. Gaveta "Vínculo Familiar" na ficha do
  lead (entre "Contato" e "Histórico"): lista os outros membros do grupo
  (busca por `grupo_familiar_id`, com botão pra remover cada um) e um
  botão "Vincular a outro lead" que abre uma busca por nome/telefone
  (`buscarLeadParaVinculoFamiliar()`, mesmo padrão de `.or().ilike()` da
  busca global) — `vincularLeadFamiliar()` cria um `grupo_familiar_id`
  novo (`crypto.randomUUID()`) se nenhum dos dois já tinha grupo, entra no
  grupo já existente se só um tinha, ou pede confirmação se os dois já
  tinham grupos DIFERENTES (move só a pessoa buscada pro grupo do lead
  atual — fundir os dois grupos inteiros não é feito automaticamente).
  Ícone de link (`.vinculo-badge-icon`) no card avisa que o lead tem
  vínculo, sem contar quantos (proxy).
- **Arrastar-e-soltar genérico pra listas de "Gerenciar X"**
  (`iniciarArrastoLista()`/`soltarNaLista()`/`REORDENADORES_LISTA` em
  `js/app.js`): Gerenciar Colunas, Gerenciar Filiais, Gerenciar Tipos de
  Evento (`js/eventos.js`) e Gerenciar Tags reordenam arrastando a linha
  (ícone `fa-grip-vertical`) em vez dos antigos botões de mover pra cima/
  baixo — pedido explícito do usuário ("toda movimentação de item deve
  ser arrastar e soltar"). Cada tela registra sua função de persistência
  em `REORDENADORES_LISTA[contexto]`; pra listas do Supabase (Filiais,
  Tipos de Evento, Tags — todas com coluna `ordem`), reaproveitam
  `reordenarESalvarOrdem(tabela, cache, idOrigem, idDestino, aoTerminar)`,
  que tira o item de origem, insere na posição do destino, e regrava
  `ordem` sequencial (0..N) pra TODOS os itens de uma vez (mais robusto
  que só trocar 2 valores adjacentes, já que arrastar pode soltar longe
  da posição original). Colunas do Kanban são `localStorage`, não
  Supabase, então têm sua própria função de reordenar (`splice` local +
  `salvarColunasLocal()`).
- **Busca global** (`#globalSearchInput`, topo da aba CRM, ao lado do
  seletor de ordenação): diferente da busca por coluna
  (`processarBuscaColuna`), pesquisa em TODAS as colunas de uma vez, direto
  no banco (`processarBuscaGlobal()`), com debounce de 250ms. Mostra um
  dropdown (`#globalSearchResults`) com nome + coluna atual + telefone de
  cada resultado; clicar chama `abrirResultadoBuscaGlobal(id)`, que garante
  que o lead esteja em `leadsAtuais` (buscando do banco se ainda não tiver
  sido paginado) antes de abrir a gaveta.
- **Exportar leads para CSV** (botão na aba Relatórios,
  `exportarLeadsCSV()`): exporta `leadsAtuais` (os já carregados no
  navegador — mesma limitação documentada nos KPIs do Dashboard, não é o
  banco inteiro se ainda houver "Carregar Mais" pendente). BOM UTF-8 no
  início do arquivo pra abrir com acentuação correta no Excel.
- **Ficha do lead (gaveta) organizada em gavetas colapsáveis**: os 7 blocos
  da ficha (Eventos/Como Abordar/Resumo da Conversa/Lembrete/Tags/Contato/
  Histórico, nessa ordem) são `<div class="drawer-gaveta">` clicáveis
  (`toggleGavetaLead(secao)`, `js/app.js`), não mais sempre abertos. Estado
  fica em `gavetaLeadAberta` (objeto simples, chaves = nome da seção) e é
  recalculado do ZERO a cada `abrirGaveta(id)` — não persiste entre leads
  nem entre sessões, de propósito (é sobre reduzir poluição visual ao abrir
  a ficha, não uma preferência duradoura). Padrão: tudo fechado, **exceto
  "Contato"**, que abre sozinho quando falta telefone (DDD ou número) ou
  e-mail — pra chamar atenção pra um cadastro incompleto sem precisar
  clicar em nada. Botões de ação no cabeçalho de cada gaveta (Convidar/
  Editar/Nova Tag) usam `event.stopPropagation()` pra não disparar o
  toggle, e força a gaveta a abrir (`gavetaLeadAberta.x = true;
  aplicarEstadoGavetasLead();`) antes de mostrar o formulário — senão a
  ação ficaria escondida atrás de uma gaveta fechada. "Status" (Ulisses)
  mora dentro da gaveta "Contato" e "Saída (Inativo)" mora dentro de
  "Histórico" — não são gavetas próprias, só sub-blocos condicionais
  (`display:none` quando não aplicável) dentro delas, como já eram antes.
- **"Como Abordar" agora é editável por lead** (`abordagem_sugerida` em
  `leads_inscricoes`, `migracao_abordagem_sugerida.sql` — rodar
  manualmente): antes era um texto fixo no HTML, igual pra todo mundo e
  sem salvar em lugar nenhum. Segue o mesmo padrão de edição do "Resumo da
  Conversa (IA)" — botão "Editar" troca a caixa por um `<textarea>` +
  "Salvar no Banco" (`editarAbordagemSugerida()`/`salvarAbordagemSugerida()`,
  `js/app.js`).
- **Lembrete de follow-up (snooze)**: bloco "Lembrete de Follow-up" na
  gaveta do lead (data + nota curta), `salvarLembreteLead()`/
  `limparLembreteLead()`, colunas `lembrete_em`/`lembrete_nota` em
  `leads_inscricoes` (`migracao_lembrete_lead.sql` — rodar manualmente).
  Um único lembrete ATIVO por lead, sem tabela/histórico separado, de
  propósito (complexidade desnecessária pro caso de uso atual). Lead com
  lembrete vencido hoje ou atrasado ganha um sininho no card
  (`.lembrete-badge-icon`, `renderizarCards()`) e aparece no card
  "Lembretes de Hoje / Atrasados" do Dashboard
  (`atualizarLembretesPendentes()`) — esse painel consulta o Supabase
  direto (não só `leadsAtuais`), diferente dos KPIs proxy do Dashboard,
  porque um follow-up atrasado precisa aparecer mesmo se o lead não estiver
  entre os já paginados.
- **Validação de formato de telefone** em `salvarTelefoneLead()`: DDD
  precisa ter exatamente 2 dígitos, telefone precisa ter 8 ou 9 dígitos —
  só valida quando o campo tem algo preenchido (campo vazio continua sendo
  um estado válido, "sem telefone"). Não confirma que o número é WhatsApp
  de verdade (isso depende da integração com a Meta Cloud API já
  existente, ver seção própria abaixo) — é só uma checagem de formato.
- **Correção automática de provedor de e-mail digitado errado** em
  `salvarEmailLead()` — `sugerirCorrecaoEmail()` compara o domínio digitado
  com uma lista de provedores comuns (`DOMINIOS_EMAIL_COMUNS`: gmail,
  hotmail, outlook, yahoo, icloud, bol.com.br, uol.com.br etc.) por
  distância de Levenshtein (`distanciaLevenshtein()`); se estiver a 1-2
  caracteres de um provedor conhecido (ex: "gmial.com") mas não idêntico,
  avisa com `alert()` qual vai ser a correção e já aplica antes de salvar.
  Domínio com menos de 5 caracteres não entra nessa checagem (evita
  arriscar "corrigir" um domínio corporativo pequeno de verdade só por
  coincidência de distância). Não mexe em nada durante a importação — só
  na edição manual do e-mail na gaveta do lead.
- **Marcar telefone/e-mail como inválido** (botões `.icon-btn.danger` ao
  lado de cada campo, gaveta "Contato"): pra quando se descobre DEPOIS —
  tipicamente numa conversa de WhatsApp — que um contato está errado.
  `marcarTelefoneInvalido()`/`marcarEmailInvalido()` (`js/app.js`) limpam o
  campo (o dado inválido É removido do cadastro, não fica escondido) E
  adicionam a tag de sistema-ish `"Telefone Inválido"`/`"E-mail Inválido"`
  — diferente de "Sem Telefone"/"Sem E-mail" (que só descreve o estado
  atual do campo, sem dizer o motivo), essa tag explica O PORQUÊ do campo
  estar vazio. Reaproveitam `salvarTelefoneLead()`/`salvarEmailLead()` pra
  não duplicar a sincronização da tag "Sem Telefone"/"Sem E-mail" nem a
  gravação no banco. A tag cai na família "Engajamento / SDR" (vermelho,
  `.tag-error`) pelo padrão de texto `inv[áa]lido` em `FAMILIAS_TAG`, mesmo
  padrão que já colore `"WhatsApp Inválido"` (tag customizada, catálogo).
- **7 abas** (sidebar, controladas por `switchModule(tabId, title, subtitle)`):
  1. `tab-dashboard` — KPIs e feed de atividades. **KPIs são métricas-proxy
     calculadas em cima dos leads já carregados no navegador** (não é uma
     contagem exata do banco inteiro), documentado no próprio código.
     "Taxa de Resposta" e "Resgates Efetivados" tratam como **"coluna
     fria"** (ainda não trabalhada) tanto a primeira coluna do funil
     quanto `COLUNA_SEM_WHATSAPP` ("Sem Whatsapp", ver `js/app.js`) — sem
     isso, lead que só caiu ali por falta de telefone (não por ter sido
     efetivamente trabalhado) inflava as duas métricas. Mesmo critério em
     `atualizarRelatorios()` (aba Relatórios, etapa "Engajamento" do funil).
     **"Resgates Efetivados" prioriza a tag `"Recuperado"`** (ver bullet
     próprio na seção de tags abaixo) — confirma rematrícula de verdade via
     reimportação, não só "saiu de uma coluna fria". Quem ainda não tem essa
     tag (nunca passou por uma reimportação desde que ela existe) cai no
     critério antigo como fallback: `"Inativo"` que já saiu de coluna fria —
     mais fraco (só indica "foi trabalhado", não confirma rematrícula), mas
     evita zerar o KPI de uma hora pra outra pra base antiga.
     Também tem um card **"Lead Forte por Nível"** (`renderizarResumoLeadForte()`)
     contando quantos leads de cada nível (1/2/3) tem na filial — mesma
     lógica de proxy dos outros KPIs (`leadsAtuais`), reaproveita as cores
     de `.tag-strong-1/2/3` pra ficar visualmente consistente com o badge
     do card no Kanban. Ao lado, o card **"Jornada até a Matrícula"**
     (`renderizarResumoJornada()`/`filtrarPorJornada()`) — os "verdadeiros"
     Leads Fortes, ver bullet "Sistema de follow-up" na seção de tags.
     Tem também o card **"Follow-up de Eventos"** (`atualizarFollowupEventos()`)
     — DIRETO no banco, não proxy (mesmo motivo de
     `atualizarLembretesPendentes()`/`atualizarAniversariantes()` logo
     abaixo: um evento chegando precisa aparecer mesmo que o lead ainda
     não tenha sido paginado pro navegador): lista quem está vinculado
     (`evento_leads`) a um evento da filial atual que AINDA NÃO PASSOU
     (mesma noção de "vale a pena" de `dataEfetivaLimite()`,
     `js/eventos.js` — usa `data` OU `data_limite_inscricao`, o que for
     mais tarde), pra lembrar o time de confirmar presença antes do
     evento acontecer. Mistura `resposta_convite = 'confirmado'`
     ("confirmaram que iriam") e `'pendente'` ("se inscreveram" mas ainda
     não confirmaram) — `'recusado'` fica de fora, não precisa de
     follow-up; confirmado aparece primeiro na lista (badge verde vs.
     âmbar, reaproveita `CLASSES_RESPOSTA_CONVITE`/`ROTULOS_RESPOSTA_CONVITE`
     já definidos em `js/eventos.js`). Alimentado por `evento_leads`
     (criado manualmente no modal de Participantes/gaveta do lead, ver
     "Agenda de Eventos" — não tem parser automático de "a pessoa
     respondeu 'sim' no WhatsApp", isso continua exigindo alguém marcar
     `resposta_convite = 'confirmado'` na tela).
  2. `tab-crm` — o Kanban em si (aba principal, 100% funcional).
  3. `tab-agenda` — Agenda de Eventos (cadastro manual de atividades por
     filial). Ver seção "Agenda de Eventos" abaixo.
  4. `tab-whatsapp` — integração real com a Meta Cloud API (não é mais
     mockada). Ver seção "Integração com WhatsApp" abaixo pra detalhes de
     arquitetura, schema e o que falta configurar do lado da Meta.
  5. `tab-relatorios` — funil de conversão (**calculado com dados reais**
     das colunas do Kanban, mas ainda um proxy sobre `leadsAtuais`) + 3
     relatórios adicionados depois: **Conversão por Tema de Evento**
     (`renderizarRelatorioTemasEvento()` — proxy sobre `leadsAtuais`, cruza
     `historico_eventos[].tema`, classificado por IA na importação, com
     `data_matricula` preenchida ou não, pra saber a taxa de conversão de
     cada tema), **Matrículas por Mês** (`renderizarRelatorioMatriculasPorMes()`
     — busca DIRETA no banco, paginada com `ORDER BY` estável, agrupando
     `data_matricula` por `AAAA-MM`; não é proxy, cobre a filial inteira) e
     **Comparação entre Filiais** (`renderizarRelatorioComparacaoFiliais()`
     — o único relatório que olha TODAS as filiais de uma vez, usando
     `count: 'exact', head: true` do PostgREST pra pegar totais sem baixar
     linha nenhuma: total de leads e quantos têm `data_matricula`
     preenchida, por filial), e **Jornada da Base**
     (`renderizarRelatorioJornadaBase()` — proxy sobre `leadsAtuais`,
     mesmo funil visual do topo da aba, distribui a base nos estágios do
     sistema de follow-up: Descoberta/Interesse Emergente/Engajado/
     Matriculado/Em Recuperação — ver bullet "Sistema de follow-up" na
     seção de tags acima). Os 4 são chamados de dentro de
     `atualizarRelatorios()`, junto com o funil.
  6. `tab-leads-tratar` — Leads a Tratar (duplicados por telefone/nome +
     sem telefone). Ver seção "Leads a Tratar" abaixo.
  7. `tab-importar` — o importador de planilhas (ver seção abaixo).

## Importador de Planilhas (`js/importador.js`)

Cruza 3 CSVs (Ativos, Inativos, Inscrições) e gera os leads com tags.
Decisões já tomadas (não precisam ser reabertas, a menos que o usuário peça):

- **Importação PARCIAL — as 3 planilhas não precisam vir juntas.** Mercúrio
  (Ativos/Inativos, hoje 100% automático via scraper) e Ulisses (Inscrições,
  sempre manual — Cloudflare bloqueia IP de datacenter, ver seção do
  scraper) andam em ritmos DIFERENTES na prática; exigir os 3 arquivos ao
  mesmo tempo forçava esperar o mais lento. `processarPlanilhas()` agora só
  exige 1+ arquivo, e guarda o que faltou em `resultadoImportacao.modoImportacao`
  (`{temAtivos, temInativos, temInscricoes, temMercurio, temUlisses}` —
  `temMercurio = temAtivos || temInativos`). **A parte delicada é NÃO
  apagar dado bom de quem já existe no CRM só porque a planilha desta vez
  não trouxe aquela informação** — resolvido em `confirmarEnviarImportacao()`
  campo a campo, por FONTE de dado:
  - **"Status"** (`ehTagStatusMercurio()`: Ativo/Inativo/Nível TA-JN-PP-N1-
    Membro + `"Lead Forte N"` + `"Jornada: X"`) é um grupo ATÔMICO — decidido
    de uma vez pelo if/else do passo 3 de `processarPlanilhas()` — que só é
    confiável com dado do MERCÚRIO. `"Lead Forte N"` é literalmente o
    fallback de "não bateu em Ativos/Inativos" e `"Jornada: X"` só é
    calculada pra quem NÃO é Ativo/Inativo, então os dois entram no MESMO
    grupo que Ativo/Inativo/Nível, não no grupo do Ulisses (**bug real
    pego ao vivo escrevendo o teste de integração**: a 1ª versão só
    preservava Ativo/Inativo/Nível e deixava "Lead Forte"/"Jornada" livres
    pra recalcular — resultado, uma importação só-Ulisses de um lead que já
    era "Ativo" ganhava TAMBÉM a tag "Lead Forte N" por cima, já que sem
    Mercúrio nesta rodada `mapaAtivos`/`mapaInativos` ficam vazios e todo
    mundo cai no fallback). Sem Ativos/Inativos nesta rodada
    (`!temMercurio`), o grupo "status" inteiro que já existia é PRESERVADO
    como estava (removido de `tagsNovas`, tags antigas do banco
    reaplicadas).
  - **"Trilha"** (`ehTagTrilha()`: `"Trilha: X"`) só depende de
    `historico_eventos`/tipo de evento — não do status Ativo/Inativo/Lead
    Forte — então só precisa do ULISSES, independente do Mercúrio.
  - Telefone/e-mail/status/eventos (`historico_eventos`) também vêm do
    ULISSES. Sem Inscrições nesta rodada (`!temUlisses`), esses campos e a
    tag Trilha são PRESERVADOS do valor já gravado no banco em vez de
    sobrescritos com o objeto "sem correspondência" (que vem vazio, já que
    Ativos/Inativos não têm e-mail/histórico de evento) — sem isso, uma
    importação só-Mercúrio apagaria telefone/e-mail/eventos de quem já
    tinha esse dado via uma importação Ulisses anterior. O grupo "status"
    não precisa de tratamento especial nesta metade — o passo 3 (única
    fonte de "Lead Forte"/"Jornada") só roda com Ulisses presente, então
    nunca aparece fresco pra atropelar nada aqui.
  - **Testado ao vivo, 3 rodadas em sequência contra o Supabase real**
    (filial descartável, apagada no fim): completa → confirma o
    comportamento de sempre; só-Mercúrio (reimportando com Nível
    diferente, Inativo removido do arquivo) → confirma que telefone/
    e-mail/histórico de quem já existia sobrevivem intactos e que quem
    sumiu do arquivo simplesmente não é tocado (não apagado); só-Ulisses
    (mesma pessoa, sem Ativos/Inativos) → confirma que "Ativo" sobrevive
    sem virar "Lead Forte", e que telefone/e-mail/eventos SÃO atualizados
    (porque desta vez o Ulisses está presente).
  - **Bug real #2, pego escrevendo o teste do dia a dia (2026-09-10)**:
    "Ativos sem correspondência"/"Inativos sem correspondência" (passo 4/5
    de `processarPlanilhas()`) só sabem dizer "não bateu em NENHUMA linha
    de Inscrições NESTA RODADA" — numa importação só-Mercúrio (sem
    Inscrições), isso vale pra TODO Ativo/Inativo, mesmo quem já existe no
    CRM de uma importação anterior COM Inscrições. Sem correção, cada
    rodada só-Mercúrio criava um lead DUPLICADO com ID sintético novo pra
    essa pessoa, e o lead original nunca recebia a tag Ativo/Inativo/
    Nível — **era exatamente o sintoma relatado pelo usuário** ("pessoas
    ativas ou inativas não marcadas com tags adequadas"). Corrigido em
    `confirmarEnviarImportacao()`: antes de montar `registrosFinais`, todo
    lead com ID SINTÉTICO (`pessoaIdentificador` ≥
    `BASE_ID_ATIVOS_SEM_INSCRICAO`) é comparado por nome normalizado
    contra os leads JÁ EXISTENTES nesta filial — se houver exatamente 1
    candidato sem dono ainda (nome duplicado/homônimo = ambíguo demais,
    não redireciona), o `pessoaIdentificador` sintético é substituído pelo
    ID real do lead existente ANTES do resto do merge rodar — assim o
    upsert atualiza o lead certo em vez de criar um novo. Testado ao vivo:
    reimportar só-Mercúrio pra alguém que já existia (criado numa rodada
    anterior com Inscrições) agora atualiza `tags`/`funil_agencia` do
    MESMO `pessoaIdentificador`, sem duplicar.
  - **Consequência direta**: com o bug corrigido, ficou seguro ligar a
    importação de Ativos/Inativos no job DIÁRIO automático do scraper —
    ver `importarNoCrm()` dentro de `main()` em `scraper/mercurio.js`
    (seção do scraper) e "Inscrito: Abertura de Turma" logo abaixo.
  - `"Sem Telefone"`/`"Sem E-mail"` são recalculadas por ÚLTIMO, sempre em
    cima do valor FINAL de telefone/e-mail (já com a preservação acima
    aplicada) — nunca em cima do dado transiente da planilha parcial,
    senão o badge ficaria errado toda vez que o telefone/e-mail real veio
    preservado do banco em vez desta importação.
  - O aviso de **"lead sumiu da planilha"** (bullet próprio logo abaixo)
    também é ESCOPADO por modo: numa importação só-Mercúrio, só considera
    "sumido" quem já era Ativo/Inativo (não dispara pra prospectos Lead
    Forte, que nunca estiveram em Ativos/Inativos mesmo); numa importação
    só-Ulisses, ignora quem só existe por causa do Mercúrio (IDs sintéticos
    ≥ `BASE_ID_ATIVOS_SEM_INSCRICAO` = 900000000) — sem isso, TODA
    importação parcial "acharia" que metade da base sumiu, um falso-alarme
    constante que destruiria a confiança no aviso.
  - A tela (`index.html`, cards de Ativos/Inativos/Inscrições na aba
    Importar) não tem mais nenhum `required` — sempre foi possível técnica
    e visualmente subir só 1 ou 2 arquivos, só a checagem em JS que
    bloqueava.
  - **`scraper/importar-no-crm.js`** (`importarNoCrm()`) segue o mesmo
    princípio: `caminhoAtivos`/`caminhoInativos`/`caminhoInscricoes` agora
    podem vir `null` individualmente — só faz upload dos `<input>` que têm
    caminho, o resto do fluxo (Processar → prévia → Confirmar) é idêntico.
    Ainda não tem uma chamada automática dentro de `mercurio.js`/`main()`
    (permanece uma função reutilizável, chamada manualmente ou por um
    orquestrador futuro — ver marco 3 na seção do scraper) — mas já está
    pronta pra quando isso for encadeado, sem esperar o Ulisses.
- **Cruzamento é só por nome normalizado** (maiúsculo, sem acento, espaços
  colapsados) — as planilhas de Ativos/Inativos não têm nenhum ID em comum
  com a de Inscrições. É uma heurística, não uma garantia.
- **Encoding:** Ativos e Inativos vêm em `ISO-8859-1` (export do Excel);
  Inscrições vem em `UTF-8` (export do Ulisses).
- Ativos sem correspondência nas Inscrições **são cadastrados mesmo sem
  telefone/e-mail** (decisão do usuário).
- Inativos sem correspondência nas Inscrições **são cadastrados com o
  telefone da própria planilha de Inativos** (viram alvo de resgate).
- IDs sintéticos (pra quem não tem `pessoaIdentificador` real, vindo de
  Ativos/Inativos sem match): faixas numéricas altas (900000000+ e
  950000000+) pra nunca colidir com IDs reais do Ulisses.
- **Reimportar é seguro:** o envio faz upsert por `pessoaIdentificador` e
  preserva `funil_agencia` e `resumo_ia` de leads que já existem (só
  atualiza dados vindos da planilha + tags de sistema).
- **Alerta de "lead sumiu da planilha"** (`confirmarEnviarImportacao()`,
  `js/importador.js`): compara os `pessoaIdentificador` que já existiam
  nessa filial (a mesma consulta que já era feita pra preservar
  `funil_agencia`/`resumo_ia`, só que agora também traz `pessoaNome`) contra
  o conjunto de IDs desta importação — quem existia antes e não aparece em
  NENHUMA das 3 planilhas desta vez entra num aviso no log (nome de cada
  um, até 30). É só informativo, não muda tag nem coluna de ninguém
  sozinho — pode ser aluno que trancou/saiu sem o time perceber, ou só
  caiu da planilha por engano de quem exportou do lado de fora; quem decide
  o que fazer é o time, revendo a lista. Não precisa de migração nova —
  reaproveita uma consulta que já existia.
- **Leads novos sem telefone vão pra primeira coluna do funil, igual todo
  mundo** — decisão revertida depois de um tempo em produção: antes iam
  pra uma coluna "Sem Whatsapp" separada (segregados do fluxo normal de
  prospecção), mas agora ficam no fluxo normal e passam a aparecer também
  na aba "Leads a Tratar" (critério "sem telefone" — ver seção própria
  abaixo), que roda automaticamente ao final de toda importação. A coluna
  "Sem Whatsapp" **não é mais criada** pelo importador — só continua
  existindo (e sendo tratada como "coluna fria" nos KPIs do Dashboard/
  Relatórios) pra quem já tinha leads presos lá de antes dessa mudança
  (`COLUNA_SEM_WHATSAPP`, `js/app.js` — ver bullet do `tab-dashboard`
  acima).
- Classificação de **tipo de evento** (Palestra, Workshop, Oficina, Curso,
  Mostra/Aula Experimental, Clube do Livro, Filosofilme, Café Cultural,
  Outro) é por palavra-chave no nome do evento — heurística simples, pode
  errar em nomes fora do padrão.
- Classificação de **tema de evento** (ex: "Estoicismo", "Mitologia") é por
  IA, não por palavra-chave — ver seção própria "Classificação de temas de
  evento por IA" abaixo. É best-effort: se a Edge Function não estiver
  configurada ainda, a importação segue normalmente sem tema.
- **Zona de Perigo** (final da aba Importar): apaga todos os leads de uma
  filial antes de reimportar do zero. Confirmação = digitar o nome exato
  da filial (sem senha, decisão do usuário) + um `confirm()` nativo do
  navegador como rede de segurança extra. Funções em `js/app.js`:
  `atualizarContagemExclusao()`, `verificarTextoConfirmacaoExclusao()`,
  `excluirLeadsDaFilial()`.
- **Auditoria da Importação** (`renderizarAuditoriaImportacao()`,
  `resgatarLinhaAuditoria()`): seção nova na prévia, abaixo da tabela de
  leads prontos, listando linhas das 3 planilhas que a importação IGNORA
  por faltar um dado-chave — Inscrições sem `pessoaIdentificador` (linha
  descartada por completo hoje, mas o nome/telefone/e-mail/evento
  continuam na planilha), e Ativos/Inativos sem `Nome`. Coletado em
  `auditoriaImportacao` dentro de `processarPlanilhas()` (`{linha, ...}`,
  `linha` = número na planilha original, cabeçalho = linha 1) e anexado a
  `resultadoImportacao.auditoria` — só informativo até o usuário agir.
  - **"Resgatar como lead"** (só pras linhas de Inscrições que têm nome —
    `resgatavel: true`): reproduz o MESMO cruzamento do passo 3
    (Ativo/Inativo/Lead Forte, usando `mapaAtivos`/`mapaInativos`/
    `configPontuacao`, também anexados a `resultadoImportacao` só pra essa
    finalidade) pra essa única linha, e empilha o lead resultado direto em
    `resultadoImportacao.leads` — como nada foi enviado ao Supabase ainda
    nesse ponto, o lead resgatado já sai incluso no próximo "Confirmar e
    Enviar", sem precisar de uma chamada separada ao banco. ID sintético
    em faixa própria (`BASE_ID_AUDITORIA_RESGATADA = 980000000`, distinta
    de `BASE_ID_ATIVOS_SEM_INSCRICAO`/`BASE_ID_INATIVOS_SEM_INSCRICAO` e
    da faixa `990000000+` de `js/matricula-importar.js`).
  - Ativos/Inativos sem nome só mostram a contagem + números de linha
    (não dá pra criar um lead identificável sem nome nenhum) — o usuário
    confere na planilha original.
- **Login Automático (Ulisses/Mercúrio)** — cofre de credenciais
  (`abrirCredenciaisScraper()`, `js/importador.js`;
  `migracao_credenciais_scraper.sql`; ver tabela `credenciais_scraper` na
  seção do banco acima): tela onde o usuário grava a senha do Ulisses de
  cada filial + a senha (única) do Mercúrio. A senha nunca fica em texto
  puro nem é lida de volta — o frontend chama a Edge Function
  `gerenciar-credenciais` (`supabase/functions/gerenciar-credenciais/`,
  mantém verificação de JWT padrão), que só ESCREVE, via a função Postgres
  `salvar_credencial_scraper()` (cifra com `pgcrypto`, `EXECUTE` restrito
  ao `service_role`). Secret esperado: `CREDENCIAIS_SCRAPER_CHAVE` (uma
  passphrase qualquer, setar com `supabase secrets set`, nunca no
  código). **Isto é só o cofre — a automação que efetivamente loga no
  Ulisses/Mercúrio e puxa os dados sozinha (scraping) é um projeto à
  parte, ainda NÃO implementado**: precisaria rodar fora do Supabase (um
  navegador automatizado tipo Playwright não cabe numa Edge Function
  Deno), então fica fora do "sem servidor próprio" de propósito até essa
  peça existir. Enquanto isso, a importação por planilha continua sendo o
  caminho principal — não foi removida nem depreciada. Quando o scraper
  existir, cada tentativa dele grava 1 linha em
  `status_sincronizacao_automatica` (sucesso/falha + mensagem), que
  alimenta o gatilho 5 da Central de Notificações
  (`verificarNotificacoesSincronizacao()`, `js/notificacoes.js`) — avisa
  se a última tentativa falhou ou está mais velha que
  `HORAS_LIMITE_SEM_SYNC` (26h, folga sobre um job diário). Sem nenhuma
  linha ainda (scraper nunca rodou), o gatilho fica em silêncio.

## Agenda de Eventos (`js/eventos.js`)

MVP de calendário de atividades por filial — o esforço que o CRM existe
pra converter (leads → público presente nas atividades). Cadastro **manual**
de propósito: nem o site institucional de cada filial nem o Ulisses têm API
externa conhecida, então não dá pra puxar isso automaticamente ainda (ver
decisão registrada na conversa sobre integrações — Mercúrio/Ulisses são
sistemas fechados).

- **Tabela `eventos`** (`migracao_eventos.sql` — rodar manualmente),
  compartilhada entre navegadores/time, mesmo modelo de acesso de
  `filiais`/`tags_sugeridas` (RLS `using(true) with check(true)`, sem
  login): `filial`, `nome`, `tipo` (texto livre, ver catálogo abaixo),
  `data` (date), `hora` (time, opcional), `ingresso` (texto livre —
  "Gratuito", "R$ 20,00" etc.), `capacidade` (int, opcional — em branco =
  sem limite), `ativo` (desativar tira da agenda sem apagar, mesmo padrão
  de retenção de `filiais`/colunas).
- **Catálogo de tipos de evento editável** — tabela `tipos_evento`
  (`migracao_tipos_evento.sql`, rodar depois de `migracao_eventos.sql`),
  compartilhada, mesmo padrão de `tags_sugeridas`: editável pelo botão
  "Gerenciar Tipos" na aba Agenda (`abrirGerenciarTiposEvento()` em
  `js/eventos.js`) — renomear, reordenar, adicionar, remover. Popula o
  `<select>` do modal de Evento (`montarSelectTipoEvento()`); a lista
  embutida no código (`TIPOS_EVENTO`, só usada se a migração ainda não
  rodou) tem Palestra, Workshop, Oficina, Curso, Aula Inaugural, Leitura
  Comentada, Filosofilme, Café Cultural, Abertura de Turma, Outro. É um
  catálogo GLOBAL (não por filial); renomear um tipo aqui não muda
  retroativamente o texto já gravado em eventos existentes (mesma lógica
  de `tags_sugeridas`: o texto fica congelado no momento do cadastro).
  **É a MESMA lista usada pela classificação automática de tipo de evento
  na importação de planilhas** (colunas `trilha`/`palavras_chave`,
  `migracao_tipos_evento_trilha.sql` — ver seção do banco acima e "Sistema
  de follow-up" na seção de tags) — decisão revertida depois de um tempo
  em produção: antes eram 2 catálogos INDEPENDENTES com vocabulários só
  parecidos (um hardcoded em `js/importador.js`, outro editável aqui), o
  usuário achou confuso e pediu uma lista única; agora editar/renomear um
  tipo em "Gerenciar Tipos" já vale pra importação a partir da próxima
  rodada, sem precisar mexer em 2 lugares.
- **Aba `tab-agenda`**, entre CRM e WhatsApp na sidebar. Lista os eventos
  da filial atual (`carregarEventos()`), ordenados por data — por padrão só
  eventos futuros; botão "Mostrar passados" (`toggleEventosPassados()`)
  revela o histórico. Cadastro/edição num modal (`#modalEvento`,
  `abrirFormEvento()`/`salvarEvento()`/`desativarEventoAtual()`).
- **Data limite de inscrição (`data_limite_inscricao`, opcional,
  `migracao_evento_data_limite.sql` — rodar manualmente, depois de
  `migracao_eventos.sql`)**: pensado pra "Abertura de Turma" — a turma dura
  cerca de 6 meses a partir da data do evento, então não faz sentido o
  evento virar "passado" (sumir da lista padrão, ficar indisponível pra
  convidar leads) no dia seguinte à data marcada. `dataEfetivaLimite(evento)`
  (`js/eventos.js`) retorna `data_limite_inscricao` quando preenchida,
  senão cai na própria `data` — usada tanto pro filtro/estilo de "passado"
  em `renderizarListaEventos()` quanto pra decidir quais eventos aparecem
  no `<select>` de "Convidar" na gaveta do lead
  (`abrirFormConvidarEventoNaGaveta()`). Campo de UI opcional no modal de
  Evento, com validação simples (não pode ser antes da própria data do
  evento); em branco, o comportamento é idêntico ao de antes (evento vira
  "passado" no dia seguinte à sua própria data).
- **Eventos multi-filial** (`migracao_eventos_multifilial.sql` — rodar
  manualmente, depois de `migracao_eventos.sql`): pensado pro "ciclo de
  abertura de turma unificada" — a divulgação (Instagram etc.) é feita
  pra um grupo de escolas da mesma região como se fosse UM evento só, mas
  cada escola tem sua própria data/vagas. Continua **1 linha de `eventos`
  por filial** (não virou uma tabela de "instâncias" separada) — várias
  linhas só passam a compartilhar o mesmo `grupo_evento_id` (texto livre,
  gerado com `crypto.randomUUID()` no navegador) pra indicar que são a
  "mesma" campanha. Evento de filial única continua funcionando igual,
  com `grupo_evento_id = null`.
  - **Criação**: checkbox "Cadastrar para várias filiais" no modal de
    Novo Evento (`toggleMultiFilialEvento()`) troca o bloco único de
    Data/Hora/Capacidade por um checklist de todas as filiais ativas
    (`renderizarChecklistFiliaisEvento()`, usa `filiaisDisponiveis` já
    carregado por `carregarFiliais()` em `js/app.js`) — cada filial
    marcada tem sua própria Data/Hora/Capacidade; Nome/Tipo/Imagem/
    Descrição/Ingresso são compartilhados entre todas. `salvarEvento()`
    faz 1 `insert()` em lote com todas as linhas do grupo. **Só existe na
    criação** — editar um evento que já existe (`eventoEditandoId`
    preenchido) sempre mexe só na linha daquela filial, mesmo que ela
    tenha `grupo_evento_id` (um aviso aparece no modal avisando disso); não
    tem "editar todas as filiais do grupo de uma vez" (limitação conhecida,
    de propósito — evita a complexidade de manter campos compartilhados em
    sincronia entre N linhas).
  - **`imagem_url`/`descricao`** (texto livre, ambos opcionais, iguais em
    espírito aos campos "Imagem"/"Descrição" do Ulisses): `imagem_url` é
    só uma URL colada (sem upload — sem Supabase Storage configurado,
    mantém o projeto sem servidor próprio de aplicação), mostrada como
    thumbnail no card (`<img onerror>` esconde sozinha se o link quebrar).
    Existem em QUALQUER evento, não só multi-filial.
  - **`participantes_unificados`** (boolean, default `false` = lista
    separada por filial — comportamento recomendado/padrão): controla se
    o modal de Participantes de um evento do grupo enxerga só os leads da
    própria filial (`false`, como sempre foi) ou TODOS os leads de TODAS
    as filiais do grupo (`true`) — nesse caso a busca pra vincular
    (`buscarLeadParaParticipante()`) e o resumo agregado do card
    (`carregarResumoParticipantes()`) passam a considerar os `evento_id`
    e filiais de todos os "irmãos" do grupo (1 query extra pra resolver
    quem são, via `grupo_evento_id`), não só o evento clicado. Vincular um
    lead a partir de qualquer filial do grupo já é o suficiente pra ele
    aparecer no resumo de todas as outras (a query de leitura sempre
    inclui todos os `evento_id` do grupo). Título do modal de Participantes
    ganha "(todas as filiais do grupo)" quando unificado, pra deixar claro
    o escopo.
- **"Confirmados" (barra de vagas) prioriza o RSVP real do modal de
  Participantes** — `resumo.confirmados` (contagem de `resposta_convite
  === 'confirmado'` em `evento_leads`, ver `participantesResumoPorEvento`
  abaixo) sobre o proxy antigo `contarConfirmadosEvento()`, que cruza nome
  (normalizado, mesmo estilo de `normalizarNomeImport()` do importador) +
  data do evento contra o `historico_eventos` de cada lead já carregado em
  `leadsAtuais`. O proxy antigo só reagia depois que o evento já tinha sido
  reimportado numa planilha futura — nunca refletia uma confirmação feita
  ANTES do evento acontecer, que é exatamente quando a barra de vagas mais
  importa (planejamento de capacidade). Eventos que nunca usaram o modal de
  Participantes (`resumo` vazio) continuam com o proxy antigo, pra não
  perder a informação de importações antigas. Barra de vagas fica vermelha
  quando `confirmados >= capacidade`.
- **Vínculo automático a partir do histórico (Ulisses)**
  (`vincularEventoLeadsAutomaticamente()`, `js/importador.js`, chamada no
  fim de `confirmarEnviarImportacao()`, depois do upsert de leads): pedido
  do usuário depois de um caso real (SDR ligou oferecendo matrícula pra
  quem já tinha se inscrito numa Abertura de Turma, sem que a Agenda
  mostrasse isso em lugar nenhum). Cruza `historico_eventos` de cada lead
  importado contra `eventos` da MESMA filial por `nome normalizado + data
  exata (AAAA-MM-DD)` — os dois precisam bater (evita casar com o evento
  errado, tipo o mesmo nome de palestra repetido em anos diferentes).
  Quando bate, cria a linha em `evento_leads` com `resposta_convite =
  'confirmado'` (inscrever-se no Ulisses já é intenção real, mais forte
  que "convite pendente"). **Nunca sobrescreve uma linha que já existe**
  — usa `upsert(..., {onConflict: 'evento_id,pessoaIdentificador',
  ignoreDuplicates: true})`, que só CRIA linha nova, então uma resposta
  editada na mão (ex: o time ligou e a pessoa disse que não vai mais,
  marcou "recusado") nunca é revertida por uma reimportação futura.
  Best-effort (erro aqui não trava a importação). Testado ao vivo:
  lead novo inscrito ganha vínculo automático "confirmado"; um vínculo
  "recusado" já existente pro mesmo evento continua "recusado" depois de
  reimportar a mesma pessoa.
- **Sem fetch a cada re-render**: `renderizarListaEventos()` só redesenha
  com o que já está em `eventosAtuais` (cache local) — é chamada de dentro
  de `sincronizarAbaAtiva()` toda vez que `renderizarCards()` roda (que é
  bem frequente), pra manter "Confirmados" em dia sem bater no Supabase a
  cada movimentação de lead. Quem de fato busca do banco é
  `carregarEventos()`, chamada só ao abrir a aba (`switchModule()`) e ao
  trocar de filial (`trocarFilial()`).
- **Não integrado com relatórios ainda** — é a próxima etapa natural
  (funil por evento/tema no Dashboard ou Relatórios), mas não faz parte
  deste MVP.
- **Participantes do evento (`evento_leads`, `migracao_evento_leads.sql`
  — rodar manualmente, depois de `migracao_eventos.sql`)**: associação
  EXPLÍCITA entre lead e evento — diferente de "Confirmados"
  (`contarConfirmadosEvento()`, que é uma inferência por cruzamento de
  nome+data contra `historico_eventos`, útil sobretudo DEPOIS que o evento
  já rolou e a planilha já foi importada), isso é uma lista editável na
  mão de quem está sendo TRABALHADO para aquele evento, com 3 campos por
  vínculo: `resposta_convite` (`pendente`/`confirmado`/`recusado`),
  `compareceu` (`true`/`false`/`null` — null = ainda não se sabe) e `nota`
  (livre, não tem campo de UI ainda, só a coluna existe). Botão de ícone
  de pessoas em cada card da Agenda (`abrirParticipantesEvento()`,
  `js/eventos.js`) abre o modal `#modalParticipantesEvento`: busca de lead
  por nome/telefone restrita à filial atual (mesmo padrão de
  `processarBuscaGlobal()`) pra vincular, e por vínculo já existente dá
  pra mudar resposta/comparecimento (`<select>`, salva no `onchange`) ou
  remover o vínculo (não apaga o lead, só a linha de `evento_leads`).
  Clicar no nome do participante abre a gaveta dele E leva até o card no
  Kanban (`abrirResultadoBuscaGlobal()`, `js/app.js` — mesma função da
  busca global).
  **Resumo agregado no próprio card do evento** (`participantesResumoPorEvento`,
  um `Map` evento_id → contagens): 1 única query pra TODOS os eventos da
  filial ao carregar a agenda (`carregarResumoParticipantes()`, dentro de
  `carregarEventos()`), não 1 por card — mostra "N leads vinculados · X
  confirmados · Y recusados · Z pendentes" e, só em eventos já passados,
  também quantos compareceram. Atualizado de novo (só pra aquele evento)
  ao fechar o modal de Participantes, sem precisar recarregar a agenda
  inteira.
- **Ações em massa no modal de Participantes**: checkbox por linha
  (`.participante-select`) + "Selecionar todos" no topo da lista
  (`participantesSelecionados`, um `Set` de ids de `evento_leads`, estado
  local do modal — não persiste, zera toda vez que o modal abre). Uma
  barra fixa no rodapé do modal (`#participantesBulkBar`, só aparece com
  ≥1 selecionado) tem 2 `<select>` — "Marcar resposta como..." e "Marcar
  comparecimento como..." — que aplicam a mudança a todos os selecionados
  de uma vez (`aplicarRespostaEmMassaParticipantes()`/
  `aplicarCompareceuEmMassaParticipantes()`, 1 update via
  `.in('id', ids)`) — e um botão "Remover selecionados"
  (`removerParticipantesEmMassa()`, com `confirm()` antes, já que desfaz o
  vínculo de vários de uma vez). Mesmo espírito da seleção em massa do
  Kanban, mas é um Set separado, escopado só ao modal aberto.
- **"Matriculado" é uma 3ª dimensão de acompanhamento** (coluna
  `matriculado` em `evento_leads`, `migracao_evento_leads_matriculado.sql`
  — rodar depois de `migracao_evento_leads.sql`), além de
  `resposta_convite` (RSVP) e `compareceu` (presença) — pensado
  especialmente pra "Abertura de Turma", mas disponível em qualquer
  evento. **Marcar "Matriculado: Sim" não é só informativo** — dispara
  `efetivarMatriculasEmMassa(pessoaIds)` (`js/eventos.js`), que (1) move o
  lead pra coluna de Matriculados (mesma heurística já usada no
  Dashboard/Relatórios: primeira coluna cujo nome contém "matricul",
  reaproveitando `moverLeadsParaColuna()` de `js/app.js` — já ganha de
  graça o update otimista + barra de desfazer) e (2) grava `data_matricula`
  = hoje, só se o lead ainda não tiver uma (não sobrescreve uma data mais
  precisa vinda da importação por print). Disponível como `<select>` por
  linha no modal de Participantes E como ação em massa
  (`aplicarMatriculadoEmMassaParticipantes()`, mesmo padrão dos outros 2
  campos) — os dois casos convergem pra `efetivarMatriculasEmMassa()`, que
  recebe uma lista de ids e já otimiza pra 1 chamada em lote. Se nenhuma
  coluna do Kanban tiver "matricul" no nome, a ação avisa e não faz nada
  (não inventa uma coluna de destino sozinha).
- **"Confirmado mas não compareceu" também é rastreado e move o lead pra
  recontato** — `resumo.naoCompareceuConfirmados` (`carregarResumoParticipantes()`)
  conta quem tem `resposta_convite === 'confirmado'` E `compareceu ===
  false`, mostrado no card do evento. Marcar "Compareceu: Não" (linha
  individual ou em massa) pra alguém que estava confirmado dispara
  `moverLeadsParaRecontato(pessoaIds)`, que busca uma coluna do Kanban com
  "Recontato" ou "Não Compareceu" no nome (`encontrarColunaRecontato()` —
  mesma heurística por substring de "Matriculados", nunca cria a coluna
  sozinha, só avisa no console se não achar) e move os leads pra lá via
  `moverLeadsParaColuna()`. Pensado especialmente pra Abertura de Turma:
  confirmou vir na turma mas não apareceu é um sinal forte de que precisa
  de um novo contato, não só ficar perdido dentro do evento já encerrado.
- **Eventos aparecem na gaveta do lead, e dá pra convidar por lá também**
  (bloco "Eventos (Convites)", entre "Histórico Escolar" e o fim da ficha
  — `index.html`): mesma tabela `evento_leads`, só que pela ótica do lead
  em vez da ótica do evento. `carregarEventosDoLead(id)`
  (`js/eventos.js`, chamada de dentro de `abrirGaveta()` em `js/app.js`)
  busca com `select('*, eventos(nome, data, hora)')` — usa o relacionamento
  de chave estrangeira do Postgres pra trazer o nome/data do evento
  embutido, sem precisar de uma segunda query. Cada linha mostra a resposta
  ao convite (badge reaproveitando as cores já existentes de
  `.tag-ativo`/`.tag-warning`/`.tag-error` — confirmado/pendente/recusado)
  e o comparecimento, com botão pra desvincular. Botão "Convidar" abre um
  `<select>` (`abrirFormConvidarEventoNaGaveta()`) populado a partir de
  `eventosAtuais` (já carregado — a agenda da filial é buscada no login e
  a cada troca de filial, não só ao abrir a aba, ver bullet de
  `carregarEventos()` acima) filtrado pra esconder eventos em que o lead
  já está vinculado; confirmar cria a linha em `evento_leads` com
  `resposta_convite` padrão `'pendente'` e atualiza tanto a lista da
  gaveta quanto o resumo agregado do card do evento na Agenda.

## Importar Matrícula (`js/matricula-importar.js`)

Pensado originalmente pra registrar matrícula em lote a partir do texto
copiado da tela "Aluno => Matricular" do Mercúrio, sem digitar nada
manualmente — **o botão que abria essa tela saiu do Kanban** (ver
"Botão removido do Kanban" logo abaixo); a lógica/modal continuam
existindo e funcionais, só que hoje só são acionados pelo scraper.

**Botão removido do Kanban**: agora que existe o disparo do Mercúrio sob
demanda ("Sincronização Automática" na aba Importar, ver seção do
scraper) e a varredura diária às 5h já detecta matrícula nova sozinha
(`processarMatriculasRecentesTurmas()`, `scraper/mercurio.js`), colar o
texto manualmente na coluna de Matriculados deixou de ser o caminho
principal. O botão `.col-import-matricula-btn` que ficava no cabeçalho
da coluna (mostrado quando o nome/chave continha "matricul",
`renderizarColunas()`, `js/app.js`) foi trocado por um texto
informativo clicável (`.col-matricula-info`, ícone de "i", CSS
próprio — não é mais um botão de ação, é só um lembrete + atalho) que
leva direto pra aba Importar. **A função `abrirImportarMatricula(colKey)`
e todo o modal (`#modalImportarMatricula`) continuam existindo
intactos** em `js/matricula-importar.js` — só o gatilho por clique
sumiu do Kanban; quem ainda abre esse fluxo é o SCRAPER (ver abaixo),
chamando a função direto via `page.evaluate()`.
- `scraper/importar-matricula-no-crm.js` (`importarMatriculaViaTexto()`)
  dependia do elemento `.col-import-matricula-btn` pra abrir o modal por
  clique — quebrou quando o botão saiu da tela. Corrigido chamando
  `abrirImportarMatricula(col.key)` direto via `page.evaluate()`, achando
  a coluna certa com a MESMA heurística por substring "matricul" (lendo
  `columnsConfig`, variável `let` top-level de `js/app.js` — não vira
  propriedade de `window`, mas continua acessível como identificador
  solto dentro do `page.evaluate()`, mesmo princípio de o console do
  DevTools enxergar variáveis top-level da página). Testado ao vivo
  (Playwright contra o CRM servido localmente): botão sumiu, span novo
  apareceu, e o `page.evaluate()` abriu o modal (`#modalImportarMatricula.open`)
  normalmente.

**Sem IA e sem Edge Function de propósito** — havia uma versão anterior
que também aceitava print (imagem) via Anthropic (Edge Function
`importar-matricula-print`), removida a pedido do usuário depois de avaliar
o custo: mesmo o modo texto tendo sido criado como alternativa "mais
barata", ainda dependia de IA/crédito pago. A tela "Aluno => Matricular" do
Mercúrio é uma tabela HTML comum — selecionar e copiar (Ctrl+C) gera um
texto tabulado bem estruturado (1 linha por aluno, células separadas por
tabulação), estruturado o bastante pra ler por **regex puro, sem IA
nenhuma**. Zero custo, zero dependência de secret.

- **Fluxo**: (1) na tela do Mercúrio, selecionar a tabela inteira
  (incluindo o cabeçalho) e copiar; (2) colar no modal
  `#modalImportarMatricula`; (3) "Processar" chama `parseTextoMatricula()`
  (100% local): separa cada linha por `\t` (com fallback pra múltiplos
  espaços, caso o "colar" não preserve tabulação de verdade), descarta a
  linha de cabeçalho sozinho (a 1ª coluna, "Matr.", não é um número) e
  ignora os campos extras que sobram no fim da linha (os 3 links da coluna
  "Funções" — Transferir/Promover/Dar Baixa — viram células separadas ao
  copiar, mas não são usados; só os índices 0/1/3/5 importam: matrícula,
  nome, ingresso, fone). Testado contra um export real da tela; (4) o
  frontend busca TODOS os leads da filial (paginado 1000 em 1000, mesmo
  padrão de exatidão de `detectarLeadsATratar()`) e casa cada linha lida
  com um lead existente; (5) uma tela de revisão mostra o resultado do
  casamento de cada linha ANTES de aplicar qualquer coisa; (6) "Confirmar"
  aplica em lote.
- **Casamento por linha** (`resolverLinhaMatricula()`), em ordem de
  confiança:
  1. **Já importado antes** (`matricula_mercurio` já gravado nesta filial
     com o mesmo número da coluna "Matr.") — a linha é ignorada
     automaticamente, sem contar como incluída. É assim que a
     **duplicidade entre textos colados de dias diferentes** é resolvida:
     colar de novo a mesma tabela (ou uma nova que inclui gente já
     processada antes) não duplica nem reprocessa ninguém.
  2. **Telefone idêntico** (`normalizarTelefoneParaChave()`, já usado em
     `js/importador.js`/Leads a Tratar) — alta confiança, inclui
     automaticamente.
  3. **Nome normalizado idêntico E único** (`normalizarNomeImport()`) — se
     mais de um lead da filial tiver o mesmo nome normalizado (homônimos),
     NÃO escolhe sozinho, cai em "sem_match" pra revisão manual.
  4. **Sem correspondência** — a linha de revisão mostra uma busca (local,
     sobre os leads já carregados da filial, sem nova query) pra vincular
     manualmente, ou um botão "Cadastrar como novo lead" pro caso raro de
     alguém que nunca foi lead antes.
- **Tela de revisão**: cada linha tem um checkbox (marcado por padrão só
  quando já tem um lead resolvido — automático ou manual), mostra se o
  telefone do CRM diverge do telefone lido no texto colado (e que vai ser
  atualizado — "atualizar o telefone quando necessário" acontece aqui,
  sempre em favor do que veio do Mercúrio) e um botão "Ignorar" por linha
  pra excluir da leva sem precisar desmarcar.
- **Confirmar aplica em lote, não 1 request por lead sempre que possível**:
  leads existentes levam 1 `update()` cada (o payload — telefone, data,
  matrícula — difere por linha, mesmo padrão de `aplicarTagEmMassa()` em
  `js/app.js`), rodados em paralelo (`Promise.all`); leads novos (o caso
  raro do item 4 acima) entram num único `insert()` em lote, com IDs
  sintéticos numa faixa (`990000000+`) deliberadamente separada da usada
  pelo importador de planilhas (`900000000+`/`950000000+`,
  `js/importador.js`), pra nunca colidir. Cada lead processado grava
  `funil_agencia` = a coluna que tinha o botão, `matricula_mercurio` = o
  número lido, e `data_matricula` = a data "Ingresso" (convertida de
  `DD/MM/AAAA` pra `AAAA-MM-DD` sem passar por `Date`/fuso horário,
  `dataBRParaISO()`) — ou hoje, se a data não vier ou não for legível.
- **Relatório final em popup ao concluir** (`mostrarRelatorioMatricula()`,
  `#modalRelatorioMatricula`): lista quem foi matriculado com sucesso e
  quais linhas do texto colado ficaram de fora (nunca resolvidas, ou
  explicitamente ignoradas — "duplicado" não entra aqui, já era esperado).
  Pra cada "não localizado", `sugerirLeadParecido()` calcula uma sugestão
  por semelhança de nome (cobertura de tokens contra todos os leads da
  filial já carregados em `leadsMatriculaCache` — versão bem mais simples
  do critério "nome" de Leads a Tratar, só o suficiente pra uma sugestão,
  não um matching automático) e, se passar de 60%, mostra "'Fulano' é o
  lead 'Ciclano'? [Sim, vincular e matricular] [Não é]" — aceitar chama
  `aplicarLinhaMatricula()` (a mesma função usada no lote principal) pra
  essa UMA linha e já atualiza o relatório na hora, sem fechar o popup.
- **Também aceita o texto da tela de TURMA** (Mercúrio: Turmas → escolher a
  turma → selecionar desde "ALTERAR INFORMAÇÕES DE TURMAS" até o final da
  tabela de alunos), não só a lista avulsa "Aluno => Matricular". A tela de
  Turma é mais rica porque lista TODOS os alunos atuais daquela turma
  (não só quem acabou de entrar) e traz cabeçalho com Turma/Dia/Horário —
  `parseTextoMatricula()` já ignora essas seções extras sozinho (só bate a
  regex de linha-de-aluno), e `parseMetadadosTurma()` procura a linha com
  "Turma:" separadamente pra extrair esses 3 dados (cada célula já vem no
  formato "Rótulo: Valor", ex: "Dia: TERÇA" — só separar por tabulação e
  por `:` dentro de cada célula). Se o texto colado for só a lista avulsa
  (sem essa linha), `metadadosTurmaAtual` fica `null` e o comportamento é
  idêntico ao de antes — nenhuma tag nova, nenhuma mudança de coluna por
  "já ativo".
  - **Tags de Turma/Dia/Horário**: quando há metadados de turma, cada lead
    vinculado (existente ou novo) recebe as tags `"Turma: {nome}"`, `"Dia:
    {dia}"` (passa por `formatarTextoPadrao()` pro mesmo padrão de
    Title Case do resto do app) e `"Horário: {hora}"`. `mesclarTagsComTurma()`
    SUBSTITUI (não duplica) essas 3 tags a cada importação — se o lead
    trocar de turma/horário depois, a tag antiga não fica grudada.
  - **"Matrícula nova" vs "já é aluno ativo"** (`ehMatriculaRecente()`):
    como a tela de Turma lista o Ingresso de TODOS os alunos (podendo ser
    de anos atrás), tratar todo mundo como "matrícula nova" inflaria
    Matriculados com veteranos. Ingresso a até 90 dias de hoje = matrícula
    nova (`funil_agencia` = a coluna que tinha o botão, comportamento de
    sempre); mais antigo que isso = já é aluno ativo, e vai pra uma coluna
    com "ativo" no nome/chave (`encontrarColunaAtivosMatricula()` — mesma
    heurística por substring de "Matriculados"/"Recontato", exclui
    "Inativo" explicitamente pra não bater à toa; nunca cria a coluna
    sozinha). **Se não existir coluna de Ativos, o lead simplesmente NÃO
    tem o `funil_agencia` alterado** (fica onde já estava) — só pro caso de
    lead NOVO (nunca visto antes) é que precisa cair em algum lugar, aí usa
    Matriculados como último recurso. `matricula_mercurio`/`data_matricula`
    (com a data real de Ingresso, não hoje) e as tags de turma são
    gravados independente da coluna de destino. A tela de revisão marca
    cada linha antiga com o badge "Já ativo (não é matrícula nova)", e um
    aviso explica pra onde essas linhas vão antes de confirmar — esse
    aviso aparece sempre que existir PELO MENOS 1 linha antiga, mesmo sem
    cabeçalho de turma (texto colado só da lista avulsa "Aluno =>
    Matricular" também passa por essa mesma checagem de data; é um aviso
    separado do de Turma/Dia/Horário, que só aparece quando o cabeçalho de
    turma foi reconhecido). O relatório final repete esse aviso pós-fato
    (quantos "já ativo" foram processados e se a coluna Ativos existia ou
    não) — como o Matr. já fica gravado depois do primeiro processamento,
    colar a MESMA lista de novo não adianta pra corrigir a coluna (a linha
    vira "duplicado" e é ignorada); nesse caso o jeito é arrastar o card
    manualmente depois de criar a coluna "Ativos".

## Log de Atividade (`js/log-atividade.js`)

Registro **append-only** das ações mais importantes feitas no CRM —
pedido do usuário como rede de segurança pro time começar a usar o CRM
pra trabalho de verdade enquanto o código ainda muda muito de uma sessão
pra outra: mesmo que um bug futuro no front-end apague/corrompa alguma
coisa na tela, o que foi feito continua registrado, fora do alcance de
qualquer mudança de código.

- **Tabela `log_atividade`** (`migracao_log_atividade.sql` — **já rodada
  nesta sessão**, via `supabase db query --linked`, ver nota sobre essa
  capacidade no fim desta seção): `criado_em`, `filial`, `acao` (slug),
  `autor` (nome do atendente, mesmo `localStorage` do WhatsApp — lido
  DIRETO pela chave `'crm_na_nome_atendente'`, nunca chamando
  `obterNomeAtendente()`, que dispara um `prompt()` na 1ª vez; logar em
  segundo plano não pode interromper ninguém com uma pergunta),
  `pessoa_ids` (jsonb, array), `detalhes` (jsonb, payload livre por tipo
  de ação).
  - **A garantia real de "não vai se perder" está na RLS**: diferente de
    toda outra tabela do projeto (`for all using(true) with check(true)`,
    acesso total), esta tabela só tem policies de `SELECT` e `INSERT` —
    **não existe policy de `UPDATE` nem `DELETE`**. Sem policy pra essas
    operações, o Postgres simplesmente não enxerga nenhuma linha
    "atualizável"/"apagável" via RLS (não lança erro — a cláusula WHERE
    não encontra nada, 0 linhas afetadas, silenciosamente). Testado ao
    vivo: um `UPDATE`/`DELETE` disparado pelo próprio `supabaseClient`
    (chave publishable, a mesma do navegador) não altera nem remove a
    linha. Uma vez gravada, uma linha é permanente — nem um bug futuro no
    app, nem ninguém mexendo direto pela chave publishable, consegue
    apagar o rastro.
- **`registrarLogAtividade(acao, {pessoaIds, detalhes, filial})`**
  (`js/log-atividade.js`, carregado ANTES de `app.js`/demais módulos no
  `index.html` já que é chamada de dentro deles): best-effort de
  propósito — nunca usa `await` antes de disparar, sempre com `.catch`/
  `.then` tratando erro só com `console.warn`, porque uma falha ao gravar
  o log NUNCA pode impedir a ação real de completar (a mesma filosofia de
  `classificar-temas`/aniversariantes no scraper).
- **Onde já está ligado** (pontos centrais únicos, cobrem várias
  entradas de UI de uma vez — não é uma varredura de TODA ação possível
  do app, ver limitação conhecida abaixo):
  - `executarMovimentoParaColuna()` (`js/app.js`) — cobre mover 1 card,
    seleção em massa, arrastar-e-soltar, e as chamadas de
    `js/eventos.js` (`efetivarMatriculasEmMassa`/`moverLeadsParaRecontato`).
  - `registrarMotivoPerda()` (`js/app.js`) — Motivos de Perda.
  - `confirmarNovaTag()`/`removerTag()`/`aplicarTagEmMassa()` (`js/app.js`)
    — tag individual e em massa.
  - `excluirLeadsDaFilial()` (`js/app.js`, Zona de Perigo) — a ação mais
    destrutiva do app; loga a CONTAGEM de leads apagados (consultada
    ANTES do `delete()`, já que depois não sobra nada pra contar).
  - `confirmarMesclagem()` (`js/leads-a-tratar.js`) — cobre mesclagem
    automática (grupo detectado) e manual (seleção no Kanban), com
    `detalhes.origem` distinguindo as duas.
  - `confirmarEnviarImportacao()` (`js/importador.js`) — 1 linha de log
    por importação, com `modoImportacao`/resumo (ver seção "Importação
    PARCIAL" acima).
  - **Não coberto ainda** (limitação conhecida, não uma varredura
    exaustiva): edição de campos individuais da gaveta (telefone/e-mail/
    resumo_ia/abordagem_sugerida/lembrete/data_nascimento), cadastro/
    edição de eventos, vínculo familiar, envio de WhatsApp. Estender pra
    qualquer um desses é só mais uma chamada de `registrarLogAtividade()`
    no fim da função que já existe — mesmo padrão dos pontos acima.
- **Tela de consulta**: botão "Log de Atividade" na aba Relatórios
  (`abrirLogAtividade()`, `#modalLogAtividade`) — lista as últimas 200
  entradas da FILIAL ATUAL, mais recente primeiro, só leitura. Pensado
  como "o que aconteceu aqui" pra conferência rápida, não um relatório
  analítico com filtro/exportação.
- **Testado ao vivo** contra o Supabase real (filial descartável): mover
  lead grava `acao='mover_lead'` com `novaColuna`/`pessoa_ids` corretos,
  adicionar tag grava `acao='tag_adicionar'`, o modal renderiza as
  entradas, e a tentativa de `UPDATE`/`DELETE` pela chave publishable foi
  confirmada bloqueada (linha e conteúdo intactos depois).
- **Capacidade descoberta nesta sessão**: `supabase db query --linked
  --file arquivo.sql` (CLI via `npx supabase`, já autenticado/linkado
  neste ambiente) roda uma migração direto contra o projeto remoto, sem
  precisar do usuário colar no SQL Editor manualmente — foi assim que
  `migracao_log_atividade.sql` foi aplicada nesta sessão. As migrações
  ANTERIORES a esta continuam listadas como "rodar manualmente" no topo
  deste arquivo porque foram feitas antes dessa descoberta (não há como
  saber retroativamente se cada uma já rodou ou não sem checar o schema
  primeiro) — mas daqui pra frente, migração nova pode ser aplicada
  direto por aqui, perguntando antes por segurança (é uma alteração de
  schema no banco de produção).

## Contas de Usuário e Login Nominal (`js/acesso.js`, `js/usuarios.js`)

Pedido do usuário: "implementar acessos por usuário ao sistema... para que
eu possa escolher quais módulos cada usuário terá acesso, e no whatsapp
precisa aparecer o nome do usuário que está logado" — pensado pra liberar
o CRM pros voluntários das escolas (acompanhar conversas, escolher leads,
tratar informações), cada um só com os módulos que faz sentido pra ele.

- **Substituiu o portão de senha única** (`js/acesso.js` original) — em
  vez de UMA senha compartilhada pelo time inteiro, cada pessoa agora
  entra com NOME (escolhido num `<select>`, populado a partir de
  `usuarios_crm`) + senha PRÓPRIA.
- **MESMO MODELO DE SEGURANÇA de antes, documentado explicitamente no
  topo de `js/acesso.js`**: isto NÃO é proteção contra um atacante
  técnico determinado — a chave publishable do Supabase já dá acesso
  total a quem tiver o código-fonte, com ou sem login (e `usuarios_crm`
  segue o padrão de acesso público do resto do projeto, `using(true)`,
  então até o HASH da senha é visível por quem inspecionar as chamadas de
  rede). É só "manter gente honesta honesta" e dar IDENTIDADE a cada
  atendente — nunca foi vendido como mais que isso, nem antes nem agora.
  A senha nunca fica em texto puro, só o hash SHA-256
  (`usuarios_crm.senha_hash`, calculado no navegador).
- **Tabela `usuarios_crm`** (`migracao_usuarios_crm.sql`): `nome` (único),
  `senha_hash`, `modulos` (jsonb — array de `tab-id`'s liberados, ex:
  `["tab-crm","tab-whatsapp"]`), `eh_admin` (só admin vê/edita a tela de
  usuários), `ativo` (desativar em vez de apagar — preserva o nome como
  autor no `log_atividade`/histórico de WhatsApp já gravado). Já vem
  com 1 usuário admin inicial (`nome = 'Henrique'`, senha temporária
  `trocar123`, todos os módulos) pra ninguém ficar sem acesso na hora da
  troca — **trocar essa senha** pela tela "Gerenciar Usuários" assim que
  entrar a primeira vez.
- **`aplicarPermissoesModulosUsuario()`** (`js/usuarios.js`, chamada logo
  depois do login e no boot da página se já tinha sessão salva): esconde
  (`style.display='none'`) qualquer ícone da sidebar cujo `data-tab` não
  esteja na lista `modulos` do usuário — os `.tab-pane` em si não são
  tocados, só o ÍCONE de navegação; se a aba que estava aberta no momento
  não é permitida (login novo, ou a permissão mudou), pula sozinho pra
  primeira aba liberada. Também mostra/esconde o botão de engrenagem
  "Gerenciar Usuários" (`#btnGerenciarUsuarios`) conforme `eh_admin`.
- **Tela "Gerenciar Usuários"** (`abrirGerenciarUsuarios()`, só admin):
  cria conta nova (nome + senha, módulos padrão `tab-crm`+`tab-whatsapp`),
  marca/desmarca cada módulo por checkbox (salva a cada `onchange`, sem
  botão "Salvar" separado), alterna Admin/Ativo, reseta senha
  (`prompt()` + hash), exclui. Se a pessoa editar os PRÓPRIOS módulos
  (raro, mas possível se um admin se autoedita), a sessão local já é
  atualizada na hora (`localStorage`), sem precisar deslogar/logar de
  novo.
- **Nome do usuário aparece nas mensagens de WhatsApp** — `obterNomeAtendente()`
  (`js/whatsapp.js`) agora prioriza o usuário LOGADO (sem perguntar nada);
  o fluxo antigo (prompt salvo em `localStorage`, sem login) fica só como
  fallback de transição pra sessões que ainda não fizeram o login novo.
  A Edge Function `whatsapp-send` recebe um novo campo `atendenteNome` no
  corpo da chamada e grava em `mensagens_whatsapp.atendente_nome`
  (`migracao_whatsapp_atendente.sql`) — `htmlMensagemWpp()` mostra esse
  nome abaixo de cada mensagem de SAÍDA (mensagens de entrada/antigas não
  têm). O `autor` do `log_atividade` (ver seção acima) também passou a
  priorizar o usuário logado pela mesma lógica.
- **Bug real achado e corrigido enquanto isso era construído**: o botão
  "Salvar" do bloco "CRM Publicado" na tela "Login Automático" (aba
  Importar) SEMPRE retornava erro — a Edge Function `gerenciar-credenciais`
  nunca tinha sido atualizada pra aceitar `sistema = 'crm_acesso'` na
  validação (só aceitava `ulisses`/`mercurio`/`mercurio_http`), mesmo a
  constraint do BANCO já tendo sido alargada pra isso numa sessão
  anterior (`migracao_credenciais_scraper_crm_acesso.sql`). Corrigido —
  esse bloco também passou a exigir um campo de USUÁRIO (antes só tinha
  senha, já que o portão era senha única): é o NOME de uma conta em
  `usuarios_crm` dedicada ao scraper.
- **Conta dedicada pro scraper**: criada `usuarios_crm.nome = 'Scraper
  Automatico'` (admin, todos os módulos — evita qualquer surpresa de
  módulo faltando em alguma automação futura) e salva como credencial
  `crm_acesso` (usuario + senha) via a própria tela/Edge Function. Ajuste
  em `scraper/importar-no-crm.js` (`abrirCrmComAcesso()`): antes só
  preenchia a senha (`#acessoSenhaInput`); agora também SELECIONA o nome
  certo em `#acessoNomeInput` antes de preencher a senha e clicar
  "Entrar" — testado ao vivo (Playwright contra uma cópia local do CRM,
  usando a credencial real do cofre): login do scraper funciona
  normalmente com o novo fluxo nominal. `scraper/importar-matricula-no-crm.js`
  reaproveita a mesma `abrirCrmComAcesso()`, sem precisar de ajuste
  próprio.
- **Testado ao vivo**: login como admin mostra os 8 ícones + engrenagem
  de usuários; criar um usuário só com `tab-crm` e logar como ele mostra
  SÓ esse ícone, sem a engrenagem de usuários — confirmado por
  automação (Playwright).

## Agenda do Dia — Todas as Filiais (`js/visao-geral.js`)

Bloco no TOPO da aba "Visão Geral" (o nome que a própria sidebar já dá
pro `tab-dashboard` — ver `title="Visão Geral"` no ícone) — pedido do
usuário: "quero uma parte da 'visão geral' que junte todas as filiais,
com uma 'agenda' para o trabalho daquele dia, independente se a filial
está selecionada ou não". Diferente do resto do Dashboard (que é sempre
sobre a filial escolhida no topo), este bloco cruza TODAS as filiais de
uma vez — chamado por `atualizarAgendaGeral()`, disparada de dentro de
`switchModule()` sempre que a aba abre, e por um botão "Atualizar" manual
(é uma consulta pesada o bastante pra NÃO entrar no polling automático
de 3 minutos que o resto do Dashboard já tem).

5 seções, lado a lado num grid:

1. **Aniversariantes de Hoje** (todas as filiais) — mesma lógica de
   `atualizarAniversariantes()` (Dashboard por filial), só que sem o
   filtro de `filial` e só o dia de HOJE (não o mês inteiro, já que aqui
   é "agenda do dia").
2. **50 Leads Prioritários pra Contatar, no TOTAL** (não 50 por filial —
   uma lista ÚNICA "quem ligar primeiro hoje" cruzando todas as unidades).
   Critério, em ordem: (1) tem uma inscrição FUTURA numa Abertura de
   Turma (`historico_eventos[].tipo === 'Abertura de Turma'`, data ainda
   não passou) — ordenado pela data mais PRÓXIMA primeiro, é quem tem
   prazo real; (2) o resto, ordenado pelo funil de conversão: `rankLeadForte()`
   (Lead Forte 1 antes de 2 antes de 3) e depois `Jornada: Engajado` >
   `Interesse Emergente` > `Descoberta` (mesmas tags de sistema já
   calculadas na importação — ver "Sistema de follow-up" na seção de
   Tags). Exclui quem já está numa coluna de Matriculados (substring
   "matricul" no `funil_agencia`) — não precisa ser contatado pra isso.
   **Bug real achado testando ao vivo**: filtrar candidatos por conteúdo
   de `tags` (jsonb) direto via `.ilike()`/`.or()` do supabase-js dá
   `"operator does not exist: jsonb ~~* unknown"` — o PostgREST não
   aceita cast (`coluna::tipo`) nem solto nem dentro do filtro `or=(...)`.
   Resolvido com uma função SQL simples,
   `leads_agenda_geral_prioritarios()` (`migracao_rpc_leads_agenda_geral.sql`),
   chamada via `.rpc(...)` — faz o cast/`ilike` direto em SQL puro, sem
   essa limitação.
3. **WhatsApp Recente** — últimas 20 mensagens de `mensagens_whatsapp`,
   TODAS as filiais, mais recente primeiro (seta ↑/↓ pra saída/entrada).
4. **Instagram Recente** — **ainda NÃO existe integração com Instagram
   no CRM** (decisão registrada nesta sessão: só WhatsApp via Meta Cloud
   API está construído). Este bloco fica como um placeholder explicando
   isso, pronto pra receber mensagens de verdade quando essa integração
   for priorizada (mesmo modelo do WhatsApp — Edge Function própria +
   tabela própria + setup de app na Meta, que só o usuário consegue
   fazer). Não construído por decisão de escopo desta sessão, não por
   limitação técnica.
5. **Inscritos em Eventos Recentes — confirmar presença** — eventos de
   QUALQUER filial com `data` nos últimos 7 dias, cruzando `evento_leads`
   (resposta `confirmado`/`pendente`) e filtrando quem AINDA não teve o
   comparecimento marcado (`compareceu is null`) — é quem precisa da
   ligação "você veio? o que achou?" logo depois do evento.
- **Botão "Rodar Mercúrio Agora"** dentro do próprio cabeçalho do bloco —
  reaproveita `dispararMercurioAgora()` (`js/importador.js`, já existente
  desde a sessão anterior) sem nenhuma mudança; é o "botão pra acionar o
  scraper de dentro do CRM" que o usuário pediu ficar visível também
  aqui, não só na aba Importar.
- **Testado ao vivo** (Playwright, cópia local do CRM contra o Supabase
  real): as 5 seções renderizam sem erro; clicar em qualquer item chama
  `abrirResultadoBuscaGlobal()` (mesma função da busca global — funciona
  mesmo pra um lead de OUTRA filial além da selecionada no topbar, já que
  essa função busca por id direto, sem filtrar por `filialAtual`).

## Resumo Semanal pro Chefe (`supabase/functions/resumo-semanal-chefe/`)

Pedido do usuário: substituir/complementar o resumo individual (por
lead, `enviarResumoParaChefeFilial()`, ver seção WhatsApp abaixo) por um
resumo AGREGADO — "mandar o resumo do trabalho da semana, apontando
quais os leads foram contatados, e qual o resultado de cada contato".

- **Fonte dos dados: `log_atividade`** (auditoria durável já existente,
  ver seção própria acima) — não é gerado por IA, é um resumo BASEADO EM
  DADOS: junta todo `pessoa_ids` de entradas dos últimos 7 dias com
  `acao` em `mover_lead`/`tag_adicionar`/`tag_remover`/`tag_massa`/
  `mesclar_leads`, busca o nome + estado ATUAL (coluna do funil + tags)
  de cada lead único encontrado, e monta uma mensagem de texto simples
  (até 40 leads listados, o resto só contado). "Resultado do contato" =
  onde o lead está e quais tags tem HOJE — não é uma transcrição de
  conversa (isso viria de `mensagens_whatsapp`, mas cruzar as duas fontes
  numa análise mais rica de "sentimento por contato" ficou fora do
  escopo desta rodada — ver "Não construído" abaixo).
- **2 formas de disparar, mesma função**: `{ filial: "X" }` processa só
  essa filial (botão "Resumo Semanal pro Chefe" na aba Relatórios,
  `enviarResumoSemanalChefe()` em `js/app.js`, sempre a filial ATUAL);
  `{}` (sem `filial`) processa TODAS as filiais que têm
  `whatsapp_chefe_numero` configurado — é o modo usado pelo `pg_cron`
  semanal (`migracao_agendamento_resumo_semanal.sql`, toda SEGUNDA-FEIRA
  08:00 Brasília = 11:00 UTC, mesmo raciocínio de fuso de
  `migracao_agendamento_mercurio_pgcron.sql`).
- **Reaproveita `whatsapp-notificar-chefe-filial`** (já existente, resolve
  o número do chefe a partir da filial) via chamada SERVIDOR-A-SERVIDOR
  (`fetch` pra própria URL de functions, com `SUPABASE_SERVICE_ROLE_KEY`
  como Bearer) — evita duplicar a lógica de resolver telefone/enviar.
- **Testado ao vivo** contra produção, com uma filial descartável sem
  nenhuma atividade em `log_atividade` (`{"filial":"ZZZ_TESTE_..."}`) —
  confirma que o caminho "sem atividade nenhuma" responde
  `{ok:true, semAtividade:true}` sem tentar enviar nada. **Não testado
  o modo `{}` (todas as filiais)** de propósito — evita risco de mandar
  uma mensagem de verdade pro WhatsApp de um chefe real durante o teste
  (mesmo com o bloqueio atual da API da Meta reduzindo bastante esse
  risco, ver seção "Bloqueio da API do WhatsApp"); a lógica desse branch
  é só 1 `select` de filiais antes de cair no mesmo caminho já testado.
- **Não construído nesta rodada** (fora de escopo, registrado pra
  quando fizer sentido priorizar): cruzar o conteúdo real das conversas
  (`mensagens_whatsapp.corpo_texto`) pra um resumo por IA de "como foi
  cada contato" (positivo/negativo/objeção) — hoje o resumo é só
  factual (mudou de coluna, ganhou/perdeu tag).

## Central de Notificações (`js/notificacoes.js`)

Sino no topbar (`.notificacoes-wrapper`, ao lado do seletor de filial) —
avisa sobre coisas que merecem atenção sem precisar ficar checando o CRM
manualmente. **Tudo em memória** (`notificacoesAtuais`, array) — não
persiste no banco nem entre sessões/reloads, é um alerta do momento, não
um histórico de auditoria.

- **5 gatilhos**, cada um reaproveitando o máximo possível de dado/infra
  que já existe (lembretes e sincronização precisam de busca própria):
  1. **Lead Forte 1 novo** (`verificarNotificacoesLeadForte()`) — chamada
     de dentro de `renderizarCards()` (`js/app.js`), sem query extra
     (reaproveita `leadsAtuais`). Na 1ª vez que roda pra uma filial, só
     estabelece a base (todo Lead Forte 1 que já existia) SEM notificar —
     senão todos os já existentes dispararia notificação assim que a
     página abre; dali em diante, só quem aparece de novo (reimportação,
     ou um lead novo criado pelo importador de matrícula) notifica.
     Limitação conhecida: um Lead Forte 1 só carregado depois via
     "Carregar Mais" pode disparar 1 notificação "atrasada" nessa hora —
     efeito colateral aceitável da paginação.
  2. **Evento quase lotado** (`verificarNotificacoesEventoLotado()`) —
     chamada de dentro de `renderizarListaEventos()` (`js/eventos.js`),
     reaproveita `eventosAtuais`/`participantesResumoPorEvento` já
     carregados. Limiar de 90% da capacidade (`LIMIAR_EVENTO_QUASE_LOTADO`),
     notifica 1 vez por evento por sessão (`eventosQuaseLotadosNotificados`,
     Set).
  3. **Lembrete de follow-up vencido/de hoje** (`verificarNotificacoesLembretes()`)
     — único gatilho com busca PRÓPRIA no banco (os outros reaproveitam
     dado já carregado), porque precisa funcionar mesmo com a aba
     Dashboard fechada (`atualizarLembretesPendentes()` só roda com o
     Dashboard visível). Poll a cada 5 minutos (`setInterval` no fim do
     arquivo), mais 1 checagem imediata a cada troca de filial. Dedup por
     `pessoaId:data` (`lembretesJaNotificadosHoje`, Set) — diferente do
     Lead Forte, aqui a intenção é notificar sobre TODOS os lembretes
     vencidos já na 1ª checagem (é informação limitada, útil ver de cara
     o que precisa de atenção hoje).
  4. **Mensagem de WhatsApp recebida** (`iniciarNotificacoesWhatsAppGlobais()`)
     — canal Realtime PRÓPRIO (`wpp-notificacoes-{filial}`), diferente do
     canal que já existe dentro de `criarChatController()`
     (`js/whatsapp.js`), que só escuta enquanto aquele chat específico está
     aberto. Esse novo canal fica sempre ativo pra filial atual,
     independente de qual aba/lead está sendo visto — assim uma mensagem
     de um lead que não está com o chat aberto ainda notifica.
  5. **Sincronização automática travada** (`verificarNotificacoesSincronizacao()`)
     — busca própria em `status_sincronizacao_automatica` (ver "Login
     Automático" no Importador); avisa se a tentativa mais recente do
     Ulisses (da filial atual) ou do Mercúrio (global) falhou, ou se a
     última bem-sucedida está mais velha que `HORAS_LIMITE_SEM_SYNC`
     (26h). Sem nenhuma linha na tabela ainda (scraper não implementado/
     nunca rodou), fica em silêncio — não inventa alerta de uma automação
     que não existe. Poll a cada 30 minutos.
- **Reset por troca de filial**: `iniciarNotificacoesParaFilial()` —
  chamada de dentro de `carregarLeads()` (`js/app.js`) sempre que
  `resetar=true` (troca de filial ou carga inicial, nunca em "Carregar
  Mais") — reseta a baseline do Lead Forte, o Set de eventos já
  notificados, e reconecta o canal Realtime do WhatsApp pra filial nova
  (senão continuaria escutando a filial anterior).
- **Notificação nativa do navegador** (`Notification` do browser, além do
  badge/lista no sino): só dispara se a permissão já foi concedida — o
  pedido de permissão (`Notification.requestPermission()`) só acontece na
  1ª vez que a pessoa abre o painel do sino (gesto do usuário; a maioria
  dos navegadores bloqueia esse pedido se disparado sozinho, sem
  interação). Funciona com a aba em segundo plano, mas não com o
  navegador fechado (não tem service worker/push configurado — isso
  precisaria de infraestrutura própria de push, fora do escopo atual).
- Clicar numa notificação (`clicarNotificacao()`) marca como lida, fecha o
  painel, e executa a ação registrada (`aoClicar`) — geralmente
  `abrirResultadoBuscaGlobal()` (mesma função da busca global, abre a
  gaveta E leva até o card) ou `switchModule()` pra uma aba relevante.

## Leads a Tratar (`js/leads-a-tratar.js`)

Começou como só "Possíveis Duplicados" (telefone + nome parecido); depois
ganhou um 3º critério — leads sem telefone — substituindo a antiga coluna
"Sem Whatsapp" do Kanban como destino deles (ver bullet "Leads novos sem
telefone" na seção do Importador) — e depois um 4º, "mesmo e-mail". Quatro
critérios, em ordem de confiança:

1. **Telefone idêntico** (alta confiança): mesma chave normalizada de
   `normalizarTelefoneParaChave()` (`js/importador.js` — ignora o 9º
   dígito, então "com 9" e "sem 9" caem no mesmo grupo).
2. **E-mail idêntico** (alta confiança, mesmo peso que telefone): só
   entre quem não caiu no critério 1. Duas pessoas raramente compartilham
   o mesmo e-mail, então trata como evidência tão forte quanto telefone
   idêntico.
3. **Nome parecido, com pontuação de 0-100%** (menos confiável, mas
   sofisticado o suficiente pra ordenar por confiança — ver
   `pontuarSimilaridadeNomes()`): só entre quem não caiu nos critérios 1/2.
   Agrupa primeiro por PRIMEIRO NOME normalizado (bucket — comparar todo
   mundo com todo mundo é inviável em bases com milhares de leads); dentro
   do bucket, cada par ganha uma pontuação e só vira grupo acima de
   `LIMIAR_SCORE_NOME` (75% — começou em 55%, subiu depois de uso real
   mostrar volume alto de grupos sem relação nenhuma, tipo "Lucas Nunes"
   com sobrenomes diferentes, que fica em ~67% e agora fica de fora). A
   pontuação combina:
   - **Cobertura do nome mais curto** (sinal principal): quantas palavras
     do nome menor aparecem no nome maior, dividido pelo nº de palavras do
     nome menor — não raridade ponderada. Testado à mão contra casos reais
     que motivaram essa mudança: usar raridade como peso da cobertura
     tinha o efeito OPOSTO do esperado (sobrenomes baratíssimos tipo
     SILVA/SOUSA/LIMA "pesavam pouco" nos dois lados da fração e
     paradoxalmente inflavam a % de pares que não são duplicata — ex.:
     "LUCAS NUNES DA SILVA" batendo forte com "LUCAS NUNES LIMA"). Cobertura
     simples já separa bem os casos reais: "LEANDRA NEGRETTO" cobre 100% de
     "LEANDRA VALÉRIA SILVA NEGRETTO"; "LUCAS NUNES DA SILVA" cobre só 67%
     de "LUCAS NUNES LIMA" (SILVA≠LIMA não bate).
   - **Preposições excluídas dos tokens** (`STOPWORDS_NOME_LEADS_A_TRATAR`:
     DE/DA/DO/DOS/DAS/E) — não carregam sinal de identidade nenhum, sem
     isso contavam como "palavra em comum" à toa.
   - **Abreviação de nome** (`cobrirTokens()`): uma letra sozinha ("L")
     bate com qualquer palavra do outro nome que comece com ela ("LIMA"),
     valendo 60% de uma palavra inteira (`PESO_ABREVIACAO`) — cobre "MARCELA
     L PAULA" vs "MARCELA LIMA DE PAULA".
   - **Bônus de palavra rara** (`BONUS_PALAVRA_RARA`, +12): se pelo menos
     uma das palavras em comum aparece em poucos leads da própria filial
     (`LIMIAR_FREQ_RARA`, ≤3 — calculado na hora, sem lista externa de
     sobrenomes), reforça a confiança — um sobrenome raro em comum (tipo
     "NEGRETTO") é evidência mais forte que um comum.
   - **Bônus de telefone/e-mail PARECIDOS** (não idênticos — idênticos já
     formam grupo próprio antes de chegar aqui):
     `bonusTelefoneParecido()`/`bonusEmailParecido()`, usando
     `distanciaLevenshtein()` (`js/app.js`, mesma função da correção de
     provedor de e-mail) — até 2 caracteres de diferença ganha um bônus
     pequeno (+5 a +10), cobrindo erro de digitação num dos cadastros.
   - **Deliberadamente SEM usar telefone/e-mail DIFERENTES como
     desqualificador** — decisão explícita do usuário: um lead pode ter
     trocado de telefone, ou um dos dois cadastros pode ter erro de
     digitação, então "os dois têm telefone e são diferentes" não é
     evidência confiável de que são pessoas diferentes.
   - Grupos são **ordenados por pontuação, do mais provável pro menos
     provável** (`renderizarListaLeadsATratar()`) — pedido explícito de
     "ordenar pelo percentual de compatibilidade". O card mostra a %
     direto no rótulo (`rotuloGrupoLeadsATratar()`), ex: "Nome parecido —
     82% de compatibilidade".
   - **Limite estrutural conhecido**: sobrenomes coincidentemente
     compartilhados entre pessoas moderadamente comuns (ex: "Lucas Nunes"
     com sobrenomes finais diferentes) ainda podem pontuar razoavelmente
     alto — não tem como eliminar 100% dos falsos positivos só com nome,
     sem usar telefone/e-mail como desqualificador (rejeitado de
     propósito). A ordenação por % + "excluir individualmente" (ver
     abaixo) são as ferramentas pra lidar com isso, não a pontuação
     sozinha.
4. **Sem telefone**: qualquer lead sem telefone cadastrado, independente
   dos outros critérios (um lead pode aparecer aqui E também num grupo de
   nome — são preocupações diferentes). Cada lead vira seu próprio "grupo"
   de 1 membro.

- **Tabela `leads_a_tratar`** (`migracao_leads_a_tratar.sql` — rodar
  manualmente; renomeia `duplicados_leads` se você já tinha rodado
  `migracao_duplicados.sql` antes de virar "Leads a Tratar", ou cria do
  zero com o nome novo se não — depois rodar também
  `migracao_leads_a_tratar_pontuacao.sql`, que adiciona `pessoa_email` e
  `pontuacao`), 1 linha por lead-membro de um grupo (não 1 linha por par —
  dá conta de grupos com 3+ pessoas no mesmo telefone). Cada varredura
  **apaga e recria do zero** os grupos daquela filial — é sempre um
  retrato fresco, não um histórico acumulado. **"Ignorar" um grupo,
  porém, É PERSISTENTE** (`migracao_leads_a_tratar_ignorados.sql` — rodar
  manualmente): `ignorarGrupoLeadsATratar()` grava a decisão numa tabela
  separada (`leads_a_tratar_ignorados`, chave `filial + grupo`), e
  `detectarLeadsATratar()` consulta essa tabela ANTES de salvar, filtrando
  fora qualquer grupo já ignorado — então ele não reaparece sozinho na
  próxima varredura/reimportação. Seção colapsável "Grupos Ignorados" no
  fim da aba (só aparece se houver algum) lista o que está suprimido, com
  botão "Reconsiderar" (`reconsiderarGrupoIgnorado()`) que só remove a
  supressão — o grupo só volta a aparecer de fato na verificação seguinte,
  e só se ainda for uma correspondência válida (a base pode ter mudado
  desde então). **A chave do grupo "nome" precisou virar estável** pra
  isso funcionar — antes usava o índice do loop de agrupamento
  (`` `nome:${primeiro}:${i}` ``), que muda entre varreduras mesmo pro
  "mesmo" grupo conforme a base cresce/encolhe; agora é
  `` `nome:${primeiro}:${idsOrdenados}` `` (IDs dos membros, ordenados),
  estável enquanto a composição exata do grupo não mudar. Leads
  efetivamente **mesclados** não têm esse problema — como a mesclagem
  APAGA os leads não-sobreviventes de `leads_inscricoes`, não sobra par
  nenhum pra formar o grupo de novo na próxima varredura, então eles somem
  naturalmente, sem precisar de nenhum registro de "ignorar".
- **Roda automaticamente ao final de toda importação**
  (`confirmarEnviarImportacao()`, `js/importador.js`, chama
  `detectarLeadsATratar()` depois do upsert) — sobre a filial inteira, não
  só os leads que acabaram de entrar, já que um duplicado pode envolver
  um lead que já existia antes. Também disponível sob demanda pelo botão
  "Verificar Agora" na aba (`verificarLeadsATratarAgora()`).
- **Varredura busca TODOS os leads da filial no banco** (paginado 1000 em
  1000 — o PostgREST limita a 1000 linhas por página mesmo pedindo `limit`
  maior, lição aprendida diagnosticando esse mesmo limite noutro
  contexto), não só os já carregados no navegador — diferente da maioria
  das métricas-proxy do resto do app, aqui a exatidão importa mais que a
  velocidade.
- Clicar num lead do grupo abre a gaveta dele via `abrirResultadoBuscaGlobal()`
  (mesma função da busca global — já garante que o lead está carregado
  antes de abrir).
- **"Mesclar"** (`abrirModalMesclar()`/`confirmarMesclagem()`, só aparece
  pra grupos "telefone"/"email"/"nome" — "sem_telefone" nunca tem par pra
  mesclar): abre um modal listando os membros do grupo (nome, telefone,
  e-mail, nº de tags e de eventos, buscados na hora — o cache local só tem
  nome/telefone), a pessoa escolhe qual lead **sobrevive**. É uma
  incorporação de verdade, não "escolhe 1 e descarta o resto":
  - **Tags e `historico_eventos`**: união de TODOS os membros, sem
    duplicar (mesma lógica de "fusão de duplicatas" já usada em
    `processarPlanilhas()`, `js/importador.js`) — automático, sem pedir
    escolha (juntar duas listas não é conflito).
  - **Telefone e e-mail**: se só existir num membro, incorpora direto no
    sobrevivente. Se os membros tiverem **valores DIFERENTES** (ex: 2
    números de telefone distintos), `atualizarConflitosMesclagem()`
    mostra um seletor (`#mesclarConflitos`, recalculado via `onchange` toda
    vez que a pessoa troca quem é o sobrevivente) pra escolher qual dos
    dois manter — o cadastro só tem 1 campo de cada, não dá pra guardar os
    dois. **Terceira opção "Manter os dois"** (valor `__ambos__` no
    `<input type="radio">`, **marcada por padrão** — a decisão que
    realmente importa ao mesclar é QUEM sobrevive, pelo nome; qual
    telefone/e-mail exato "vence" é secundário e nem sempre dá pra saber):
    mantém o valor do sobrevivente (ou o 1º disponível entre os membros, se
    o sobrevivente não tiver nenhum) como o campo "oficial", e anota o(s)
    outro(s) como texto solto dentro do `resumo_ia` (ex: "Telefone
    alternativo (de FULANO): 66 999999999") — não inventa uma coluna nova
    pra guardar múltiplos telefones/e-mails, só garante que o dado não
    escolhido não é simplesmente perdido. A pessoa só precisa escolher um
    valor específico se quiser descartar de propósito um dos dois.
  - **`resumo_ia`**: concatena o texto de todos que tiverem algo escrito
    (separado por `---`), não descarta nenhuma anotação manual.
  - O modal mostra um preview ("serão incorporados automaticamente: N
    tag(s), N evento(s)...") antes de confirmar, pra deixar claro que é
    incorporação e não só exclusão.
  Os leads não escolhidos são **apagados permanentemente** de
  `leads_inscricoes` — ação irreversível, por isso passa por um
  `confirm()` nativo listando quantos serão apagados antes de executar.
- **Mesclar por iniciativa própria, não só por sugestão do sistema**:
  o Kanban já tinha seleção em massa por checkbox (`.lead-select` +
  barra `#bulkActionBar`, ver seção de tags/mover em massa) — um botão
  "Mesclar" nessa mesma barra (`iniciarMesclagemManual()`, `js/app.js`
  chama pra `js/leads-a-tratar.js`) deixa mesclar 2+ leads selecionados
  manualmente, mesmo que o sistema não os tenha sugerido (útil quando os
  nomes são bem diferentes pra bater no critério automático, mas o time
  sabe que é a mesma pessoa). `abrirModalMesclarManual(pessoaIds)` reusa
  TODO o resto do fluxo de mesclagem (conflitos de telefone/e-mail,
  incorporação de tags/eventos, "Manter os dois") — a única diferença é
  `grupoEmMesclagem` ficar `null` (não veio de um grupo detectado, então
  não há nada em `leads_a_tratar` pra limpar depois; `confirmarMesclagem()`
  já checa isso antes de tentar apagar).
- **Exclusão individual de um membro** (`removerMembroDoGrupo()`) — só
  aparece quando o grupo tem **3+ membros** (com 2, "Ignorar" o grupo já
  resolve o mesmo problema): tira só aquele lead específico do grupo (ele
  não é duplicado dos outros), sem mexer no resto — pensado pro caso de
  "apareceram 3 parecidos, mas só 2 são realmente a mesma pessoa". Se
  sobrar 1 membro só depois de remover, o grupo inteiro some da lista (não
  representa mais uma dupla suspeita).
- **Gavetas colapsáveis por critério** (`renderizarListaLeadsATratar()`):
  os grupos são organizados em 4 seções (Mesmo Telefone / Mesmo E-mail /
  Nome Parecido / Sem Telefone), cada uma com um cabeçalho clicável
  (`toggleSecaoLeadsATratar()`) que recolhe/expande e mostra um badge com
  o total de **ocorrências** (soma de leads envolvidos naquela seção, não
  nº de grupos — em "sem telefone" cada grupo já é 1 lead, então dá no
  mesmo; em telefone/nome soma todo mundo dentro de cada cluster). Estado
  de recolhido/expandido (`secoesRecolhidasLeadsATratar`, um `Set`) não
  persiste entre sessões de propósito — é só pra reduzir poluição visual
  durante a revisão, não uma preferência duradoura tipo a gaveta de
  colunas do Kanban.

## Integração com WhatsApp (Meta Cloud API)

Substituiu a antiga interface mockada de `tab-whatsapp`/`.drawer-chat`.
Provedor escolhido: **Meta WhatsApp Cloud API oficial** (não é Twilio, não é
gateway não-oficial tipo Z-API) — decisão tomada considerando que o caso de
uso principal do CRM é resgate de leads frios.

- **Backend:** Supabase Edge Functions (`supabase/functions/whatsapp-send`
  e `supabase/functions/whatsapp-webhook`), a única parte do projeto que
  não roda 100% no navegador — precisa disso pra guardar o token da Meta em
  segredo e validar a assinatura do webhook.
- **`whatsapp-send`**: chamada pelo frontend (`supabaseClient.functions.invoke`)
  pra enviar texto livre ou template. Resolve o `phone_number_id` pela
  filial do lead (`filiais.whatsapp_phone_number_id`, com fallback pro
  secret `WHATSAPP_PHONE_NUMBER_ID_DEFAULT`), chama a Graph API, grava o
  resultado em `mensagens_whatsapp` mesmo quando falha. Erro 131047 da Meta
  = janela de 24h fechada (a mensagem só pode ser reaberta com um template
  aprovado) — o frontend trata esse erro especificamente.
- **`whatsapp-webhook`**: endpoint público que a Meta chama (mensagens
  recebidas + status de entrega/leitura). Deployada com
  `--no-verify-jwt` (ver `supabase/config.toml`) porque a Meta não manda
  JWT, só `X-Hub-Signature-256` — validado manualmente no código. Casa o
  telefone de quem escreveu com um lead em `leads_inscricoes` testando as
  variantes com/sem o 9º dígito (`supabase/functions/_shared/telefone.ts`);
  sem match (ou com mais de um) grava a mensagem do mesmo jeito, só que com
  `pessoaIdentificador = null` — aparece na aba WhatsApp como "não
  identificado", vinculável manualmente ali mesmo.
- **Frontend (`js/whatsapp.js`)**: um único `criarChatController(...)`
  reaproveitado tanto pra aba unificada quanto pro chat da gaveta lateral do
  lead — carrega histórico de `mensagens_whatsapp` e escuta mudanças em
  tempo real via Supabase Realtime (por isso a tabela precisa estar em
  `alter publication supabase_realtime add table mensagens_whatsapp`, já
  na migração). A área de input troca sozinha entre "texto livre" e
  "seletor de template" dependendo se a última mensagem RECEBIDA do lead
  tem menos de 24h.
- **Visual dos balões parecido com o WhatsApp real** (`css/style.css`,
  2026-09-10, pedido explícito do usuário): "rabinho" triangular em cada
  balão (`::before`, cor combinando com o fundo — branco pro recebido,
  verde `--wpp-green` pro enviado), campo de texto em formato pill
  (`border-radius: 21px`, mesmo estilo da barra de busca do WhatsApp de
  verdade) em vez de caixa retangular. Fundo `#efeae2` (tom correto do
  papel de parede do WhatsApp) e cores de balão já estavam certas antes
  dessa mudança — só faltava o rabinho e o input.
- **Templates de mensagem** só existem depois de criados e aprovados no
  painel da Meta Business — a lista `TEMPLATES_WHATSAPP` no topo de
  `js/whatsapp.js` precisa ser preenchida (nome técnico exato + ordem das
  variáveis) conforme forem aprovados. Hoje tem 2: `contato_inicial`
  (3 variáveis: nome/atendente/palestra — pós-palestra) e
  `resgate_lead_evento` (1 variável: nome — resgate de lead frio
  genérico). **Editar o texto de um template aprovado exige submeter de
  novo pra Meta e esperar reaprovação** (não é instantâneo) — por isso,
  antes de pedir aprovação de um template novo, vale considerar deixá-lo
  bem genérico/com mais variáveis (parecido com o padrão de
  `CONVITE_EVENTO_NAO_ALUNO`/`CONVITE_EVENTO_ATIVO` abaixo, que são só
  texto livre preenchido no chat — sem aprovação nenhuma da Meta, mas só
  funcionam DENTRO da janela de 24h) em vez de um texto fixo e específico
  demais pra um cenário só.
- **Preenchimento automático das variáveis do template** —
  `tpl.variaveis` é uma lista de `{chave, label}`, não só texto: quando
  `chave` é `'nome'`/`'atendente'`/`'filial'`, `preencherValorAutomatico()`
  já entrega o campo preenchido (sempre editável depois, o SDR pode
  corrigir) em vez do SDR digitar toda vez:
  - `'nome'` → `primeiroNomeFormatado(lead.pessoaNome)` — só o primeiro
    nome, nunca em CAIXA ALTA (a planilha às vezes traz assim).
  - `'atendente'` → `obterNomeAtendente()`, sem mudança de comportamento
    (já perguntava uma vez e guardava em `localStorage`) — só o TEXTO do
    prompt mudou, agora orientando a pessoa a incluir o artigo se quiser
    (ex: "o Henrique") pra ler natural nos templates que embutem isso.
  - `'filial'` → `filiais.nome_com_preposicao` (`migracao_filial_preposicao.sql`,
    editável em "Gerenciar Filiais") da filial atual — ex: "do Jardim
    América". É propriedade da FILIAL (igual pra qualquer atendente que a
    mencionar), por isso fica no banco, não em `localStorage` como o nome
    do atendente. Sem configurar, cai no fallback `"de {nome da filial}"`
    (aproximação razoável, mas nem sempre gramaticalmente perfeita).
  - `chave: null` → sem fonte automática, campo fica em branco (ex: nome
    da palestra, motivo do contato) — só o `label` vira o placeholder.
- **Convite padrão pra QUALQUER evento** (botão "Convidar pra Evento" no
  cabeçalho do chat da gaveta do lead — começou só pra "Abertura de
  Turma", generalizado depois a pedido do usuário): clicar abre um
  `<select>` inline (`abrirSeletorConviteEvento()`, `js/whatsapp.js`) com
  os eventos ainda não "passados" da filial atual (`eventosAtuais`, mesmo
  critério `dataEfetivaLimite()` de `js/eventos.js`); escolher um e clicar
  "Gerar" (`confirmarConviteEvento()` → `enviarConviteEvento(evento)`)
  monta o texto final. Dois textos-base (`CONVITE_EVENTO_NAO_ALUNO`/
  `CONVITE_EVENTO_ATIVO`, editáveis livremente — são só um ponto de
  partida) conforme o lead ter a tag "Ativo"/"Aluno Ativo" ou não: pra
  quem não é aluno, convida pra conhecer o evento; pra quem já é aluno
  ativo, pede pra encaminhar o convite, indicar telefones de conhecidos,
  ou topar ser voluntário no dia do evento. O texto final leva:
  - `{nome}`: primeiro nome do lead.
  - `{atendente}`: nome de quem está mandando — perguntado uma vez
    (`obterNomeAtendente()`, `prompt()`) e guardado em `localStorage`
    (`crm_na_nome_atendente`, só neste navegador, já que o CRM não tem
    login); o lápis ao lado do botão (`alterarNomeAtendente()`) deixa
    trocar depois.
  - `{filial}`: `filialAtual`.
  - `{evento}`/`{quando}`: nome e data/hora do evento escolhido no seletor.
    **`{quando}` detecta evento "em andamento"**: se `evento.data` já
    passou mas o evento ainda aparece no seletor (só possível quando
    `data_limite_inscricao` vai além da própria data — hoje, só "Abertura
    de Turma" usa isso, ver `dataEfetivaLimite()`), convidar pra "vir no
    dia X" (já passado) seria um bug real — as aulas são semanais, a turma
    já começou mas continua matriculando. Nesse caso `{quando}` vira "as
    aulas são toda [dia da semana], e a próxima é dia DD/MM" em vez da
    data original, calculado por `proximaOcorrenciaMesmoDiaSemana()`
    (`js/whatsapp.js`) — pega o dia da semana do evento e acha a próxima
    ocorrência a partir de hoje (nunca "hoje" mesmo se bater, pra não
    arriscar convidar pra uma aula que já rolou mais cedo no mesmo dia).
  - `{interesses}`: as tags do lead que caem na família "Interesses /
    Origem" (mesma classificação de `identificarFamiliaTag()`/`FAMILIAS_TAG`
    usada pra colorir o badge da tag, `js/app.js`) — só essa família entra
    aqui, não qualquer tag (não faz sentido citar "Sem Telefone" ou "Lead
    Forte 1" como "interesse" num convite). Fica em branco (frase toda
    omitida) se o lead não tiver nenhuma tag dessa família.
  **Só preenche a caixa de texto do chat** (`chatDrawer.preencherTexto()`,
  método do controller de chat) — não envia sozinho, o SDR revisa e manda
  igual qualquer mensagem normal. Só funciona dentro da janela de 24h
  (mesma regra de sempre — fora dela não tem campo de texto livre pra
  preencher, só template aprovado); nesse caso mostra o texto num
  `alert()` pra copiar manualmente.

### Convite Compartilhável (foto real, pronta pra Status/Stories)

Pedido do usuário: mandar pro MEMBRO (aluno Ativo) uma mensagem com a
foto de verdade do evento (não um link) + legenda curta, pra ele
repassar no Status do WhatsApp ou nos Stories do Instagram — o WhatsApp
já tem um botão nativo de "compartilhar" em qualquer imagem recebida, não
precisamos reinventar isso, só entregar a foto certa na hora certa.

- **Botão "Compartilhar Foto"** (`#drawerConviteEventoBtnFoto`, ao lado de
  "Gerar Texto" no seletor de "Convidar pra Evento" já existente, gaveta
  do lead) — só aparece quando o evento escolhido tem `imagem_url`
  preenchida (`atualizarBotaoConviteFoto()`, chamado no `onchange` do
  `<select>` e ao abrir o seletor). Sem imagem cadastrada no evento, não
  tem o que compartilhar — segue só com "Gerar Texto" (fluxo de sempre).
- **`confirmarConviteComFoto()`** (`js/whatsapp.js`) monta uma legenda
  automática (`"📢 {evento} — {data}! Compartilhe no seu Status do
  WhatsApp ou nos Stories do Instagram..."`), pede confirmação (`confirm()`
  — diferente de "Gerar Texto", este botão ENVIA de verdade, não só
  preenche a caixa) e chama `whatsapp-send` com `{tipo: 'imagem',
  imagemUrl, caption}`.
- **`whatsapp-send` estendida** pra aceitar `tipo: 'imagem'` — monta
  `{type: "image", image: {link: imagemUrl, caption}}` pra Graph API. Usa
  **`link`, não upload de mídia** — a própria Meta busca a imagem nessa
  URL; o destinatário recebe uma mensagem de MÍDIA REAL (uma foto de
  verdade no chat), nunca um link de texto pra clicar — foi exatamente
  isso que o usuário pediu ("não deve ser compartilhado o link da imagem,
  e sim a imagem propriamente dita"). Mesma regra de sempre: só funciona
  dentro da janela de 24h (mensagem de mídia livre também é sujeita à
  janela, igual texto livre — só template aprovado escapa disso, e
  templates com imagem não estão configurados ainda).
- **`imagem_url` do evento** já existe (`eventos.imagem_url`,
  `migracao_eventos_multifilial.sql`) — alimentada automaticamente pelo
  scraper (`sincronizarCatalogoEventosNoCrm()`, captura do Ulisses) ou
  cadastrada na mão na Agenda. Nenhuma tabela/coluna nova precisou ser
  criada pra este recurso.
- **Renderização no chat**: como a resposta da Graph API não devolve a
  URL da imagem de volta, `whatsapp-send` guarda `{imagem_url}` dentro de
  `payload_bruto` (tanto no envio com sucesso quanto na falha) —
  `htmlMensagemWpp()` (`js/whatsapp.js`) lê `m.payload_bruto.imagem_url`
  pra desenhar um `<img>` de verdade acima da legenda, quando
  `m.tipo === 'imagem'`.
- **Testado ao vivo** (payload construído e enviado de verdade pra Graph
  API — recebeu o mesmo erro conhecido "API access blocked" do bloqueio
  atual, confirmando que o request chegou formatado corretamente; a
  linha gravada em `mensagens_whatsapp` tem `tipo='imagem'`,
  `payload_bruto.imagem_url` preservado, e a legenda em `corpo_texto`) e
  a renderização (`<img>`) foi confirmada visualmente com uma imagem de
  teste. **Ainda não testado com entrega real** — depende do
  desbloqueio da API (ver seção "Bloqueio da API do WhatsApp").
- **Só existe hoje pra 1 lead por vez**, a partir da gaveta (mesmo ponto
  de entrada de "Convidar pra Evento") — envio em massa pra vários
  membros de uma vez (ex: via seleção no Kanban) não foi construído,
  fica como extensão natural se o volume pedir.

### Setup pendente (só o usuário consegue fazer, fora do código)
Checklist completo: Business Manager → App tipo "Business" com produto
WhatsApp → número de teste ou verificado (anotar `phone_number_id` e WABA
ID) → System User com token permanente (não o temporário de 24h) → App
Secret → criar/submeter templates → depois do deploy das functions,
configurar a URL do webhook + Verify Token no painel do App. Secrets
esperados pela Edge Function: `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`,
`WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID_DEFAULT` (setados via
`supabase secrets set`, nunca no código).

## Classificação de temas de evento por IA

`historico_eventos` já classifica **tipo** de evento por palavra-chave (ver
seção do importador); **tema** (ex: "Estoicismo", "Mitologia", "Arte e
Cultura") é diferente — não dá pra fazer por palavra-chave de forma
confiável, então é classificado por IA (Anthropic, modelo
`claude-haiku-4-5-20251001`) numa Edge Function nova,
`supabase/functions/classificar-temas`.

- **Cache compartilhado**: tabela `temas_eventos` (`migracao_temas_eventos.sql`)
  guarda `evento_nome_normalizado → tema`. Um evento só passa pela IA UMA
  VEZ, mesmo em filiais/importações diferentes — depois disso é só
  reaproveitado. Isso mantém custo baixo e evita o mesmo tipo de evento
  ganhando nomes de tema diferentes entre uma importação e outra.
- **Fluxo no importador** (`js/importador.js`, `classificarTemasEventos()`,
  chamada dentro de `processarPlanilhas()` antes de montar os leads finais):
  coleta os nomes de evento únicos do lote, busca o que já está em cache,
  manda pra Edge Function só o que faltou (em lotes de `LOTE_TEMAS_IA` = 60
  nomes por chamada, pra não estourar o prompt), aplica o `tema` retornado
  em cada entrada de `historico_eventos`.
- **Best-effort**: se a Edge Function falhar por qualquer motivo (não
  deployada ainda, `ANTHROPIC_API_KEY` não configurada, erro de rede), a
  importação grava um aviso no log e segue normalmente **sem tema** — isso
  nunca trava a importação.
- Secret esperado: `ANTHROPIC_API_KEY` (setado via `supabase secrets set`,
  nunca no código). Deploy: `supabase functions deploy classificar-temas`
  (mantém a verificação de JWT padrão — só o próprio frontend chama essa
  function, diferente do webhook do WhatsApp).

## Scraper Ulisses/Mercúrio (login automatizado) — `scraper/`

Terceira exceção ao "sem servidor próprio" (junto com WhatsApp e
classificar-temas), mas fora do Supabase — um navegador automatizado
(Playwright) não cabe numa Edge Function Deno. Roda via **GitHub Actions**
(`.github/workflows/scraper.yml`), não junto com o resto do deploy do
CRM. Objetivo: substituir a exportação manual de planilha por login
automatizado direto no Ulisses (Inscrições) e no Mercúrio (Ativos/
Inativos) — a importação por planilha **continua existindo** como
alternativa/fallback, de propósito (se a interface desses sistemas mudar
e a automação quebrar, cair pra planilha manual não pode ficar
bloqueado).

- **Credenciais**: nunca ficam no repositório nem em GitHub Secrets —
  o scraper lê do cofre já existente no Supabase
  (`credenciais_scraper`/`ler_credencial_scraper()`,
  `migracao_credenciais_scraper_leitura.sql`) usando
  `SUPABASE_SERVICE_ROLE_KEY` (essa sim é um GitHub Secret, junto com
  `CREDENCIAIS_SCRAPER_CHAVE` — as mesmas 2 variáveis que a Edge Function
  `gerenciar-credenciais` usa do lado do Supabase). Único ponto de
  verdade das senhas continua sendo o cofre — GitHub Actions só tem a
  CHAVE pra abrir o cofre, não uma cópia da senha.
- **Ulisses** (`scraper/ulisses.js`): login via **Auth0** (Universal
  Login padrão em `acropolebrasil.us.auth0.com`, e-mail + senha, 1 conta
  por filial). Depois de logado, o app (SPA, rota `#/evento`) tem um menu
  **"Exportar CSV"** — ainda não implementado (marco 2), só o login está
  pronto. Itera por todas as filiais ativas (tabela `filiais` do
  Supabase, `select` público de sempre).
  - 🛑 **BLOQUEADO no GitHub Actions, confirmado por print real (3º
    teste)**: não é o Auth0 quem barra, é o **Cloudflare** na frente do
    próprio `acropolebrasil.com.br` — toda tentativa de `goto(URL_LOGIN)`
    a partir do IP de datacenter do GitHub Actions cai na tela "Performing
    security verification" / "Verify you are human" (challenge do
    Cloudflare) antes de sequer chegar no formulário de login, e nunca sai
    dali sozinha. **Não é um bug de seletor/timing pra corrigir no
    código** — é uma proteção deliberada contra tráfego automatizado de
    datacenter, e não é algo que se deva tentar contornar
    programaticamente. Por isso o passo do Ulisses foi **pausado no
    workflow** (`if: false` em `.github/workflows/scraper.yml`) — Auth0
    propriamente dito nunca chegou a ser testado (o Cloudflare barra antes
    disso).
  - ✅ **Solução escolhida: modo local/assistido** (`scraper/ulisses-local.js`,
    decisão de 2026-09-06) — em vez de tentar contornar o Cloudflare ou
    montar um runner self-hosted permanente, esse script roda direto na
    máquina do usuário (`npm run ulisses-local`, dentro de `scraper/`),
    com o Chromium em modo **visível** (`headless: false`). Como o acesso
    parte do IP residencial/normal do usuário (não mais datacenter), o
    Cloudflare tende a nem aparecer — e se aparecer, quem resolve o
    desafio e faz login (e-mail + senha do Ulisses daquela filial) é o
    próprio usuário, à mão, numa janela real. O script **não tenta
    preencher nem clicar em NADA da tela de login** (diferente do modo
    automático) — só espera (`aguardarLoginManual()`, timeout de 5 min) o
    sinal de que o login deu certo (menu "Exportar CSV" visível, mesmo
    sinal que `loginUlisses()` já usa) e AÍ assume sozinho, reaproveitando
    100% das mesmas funções de exportação de `ulisses.js`
    (`exportarCsvInscricoes`/`exportarCatalogoEventos`/
    `exportarComparecimento`, exportadas desse arquivo especificamente pra
    esse reuso) — uma janela abre por vez, uma pra cada filial ativa.
    Credenciais lidas do mesmo cofre (`lerCredencial('ulisses', filial)`)
    só pra MOSTRAR o e-mail cadastrado no terminal como dica (não preenche
    nada) — login sem credencial salva no cofre também funciona, só sem a
    dica. Precisa de `scraper/.env` (nunca commitado, veja
    `scraper/.env.example`) com as mesmas 3 variáveis dos Secrets do
    GitHub Actions, carregadas via pacote `dotenv` (só usado por esse
    arquivo — `ulisses.js`/`mercurio.js`, que rodam só no CI, continuam
    lendo direto de `process.env`, sem depender de `.env`). `ulisses.js`
    ganhou uma guarda (`if (process.argv[1] === fileURLToPath(import.meta.url))`)
    em volta do próprio `main()`, pra ele não rodar sozinho (com login
    100% automático, sempre barrado) quando `ulisses-local.js` importa
    suas funções de exportação.
- **Mercúrio** (`scraper/mercurio.js`): **DUAS camadas de login**,
  descobertas testando de verdade (não estavam visíveis no print inicial):
  1. Autenticação HTTP básica do navegador (pop-up cinza nativo) — uma
     credencial ÚNICA compartilhada por TODOS os usuários, que muda 1x
     por ano. Fica salva no navegador de quem usa no dia a dia (por isso
     passa despercebida), mas o Playwright (sessão nova) precisa dela.
     Guardada como `sistema = 'mercurio_http'`
     (`migracao_credenciais_scraper_mercurio_http.sql`, que também
     alarga a constraint de `sistema` em `credenciais_scraper`) — aplicada
     via `context.newContext({ httpCredentials: {...} })` do Playwright,
     ANTES de navegar pra página de login em si.
  2. A tela de Matrícula + Senha propriamente dita (formulário simples,
     PHP puro) — **1 login só cobre várias filiais** de uma vez
     (confirmado por print: a tela pós-login lista as funções autorizadas
     por filial pra aquela matrícula), por isso essa credencial é salva
     com `filial = 'GLOBAL'` (mesmo padrão do cofre).
  Navegação mapeada por descrição/print do usuário (ainda NÃO testada de
  verdade): `ger_frame.php` (pós-login) lista um link "CADASTRO" por
  filial (1 login cobre várias); clicar entra em `uni_frame.php`, que tem
  um menu lateral persistente com "Ativos"/"Inativos"/"Turmas"/etc — a URL
  não muda entre cliques no menu, o que sugere fortemente um `<frameset>`
  clássico (mesmo padrão de nome de arquivo `_frame.php` usado em toda a
  navegação, INCLUSIVE a tela de login em si — foi exatamente isso que
  causou o timeout de 30s do 3º teste real, corrigido buscando o campo de
  Matrícula tanto na página principal quanto em qualquer frame filho,
  função `acharContextoComTexto()`). Ativos tem colunas N./Matr./Nome/
  Nivel/Dia/Turma (sem telefone nem data de ingresso — isso só existe
  dentro do detalhe de cada Turma, ainda não capturado); Inativos tem
  Nome/Telefones/Ni/Data/Motivo, que bate 1:1 com o formato já esperado
  pelo importador manual.
- **Tela "Login Automático" no CRM** (aba Importar) tem 3 blocos: a
  autenticação HTTP do Mercúrio (usuário+senha do pop-up), o
  Matrícula+Senha do Mercúrio (usuário = matrícula), e e-mail+senha do
  Ulisses por filial (usuário = e-mail de login via Auth0) — os 3 têm
  campo de usuário desde a correção feita depois do primeiro teste real
  (antes só existiam campos de senha, um bug descoberto ao rodar o
  scraper pela 1ª vez).
- **Rodar em Node 22+ no workflow** (`node-version` em
  `.github/workflows/scraper.yml`) — o cliente `@supabase/supabase-js`
  cria um `RealtimeClient` internamente mesmo sem usar Realtime, e isso
  quebra em Node < 22 por falta de `WebSocket` nativo ("Node.js 20
  detected without native WebSocket support") — descoberto no primeiro
  teste real do workflow.
- **Ambiente pra RODAR o scraper (não só editar código) — `G:\` é um drive
  virtual do Google Drive (streaming), não disco local de verdade, e
  `npm install`/Playwright não são confiáveis lá** (confirmado em teste
  real: `node_modules` ficou com arquivos de 0 byte mesmo depois de
  reinstalar, `npm install` solta uma enxurrada de
  `TAR_ENTRY_ERROR`/`EBADF` durante a extração — o driver do Google Drive
  não aguenta a escrita rápida de milhares de arquivos pequenos, e nem
  aceita criar um Junction/symlink apontando pra fora dele, "Função
  incorreta"). O usuário mantém um clone git separado em **`C:\Scrapper`**
  (disco local de verdade, `node_modules` íntegro) só pra RODAR
  (`npm run ulisses-local`/`npm run mercurio`) — o código-fonte
  continua sendo editado normalmente aqui em `G:\...\crm-agencia-na`
  (é o repositório com o remote `origin`); antes de rodar algo em
  `C:\Scrapper` depois de editar `scraper/*.js`, copie os arquivos
  alterados pra lá (`cp`/`robocopy`) ou dê um `git pull` lá depois de
  commitar+pushar daqui. `scraper/exports/`/`scraper/debug/` só existem
  na cópia que rodou (hoje, `C:\Scrapper`), não aqui.
- **Status por marco**:
  1. ✅ Login automatizado nos dois sistemas (confirma sessão autenticada,
     grava sucesso/falha em `status_sincronizacao_automatica` — ver
     Central de Notificações).
  2. 🟡 Exportar os dados — **Ulisses E Mercúrio testados de verdade**
     (Ulisses: 1º teste real completo, 2026-09-06/07, filial Garavelo,
     modo local/assistido; Mercúrio: 1º teste real completo, 2026-09-07,
     headless, as 4 filiais, ver bullet próprio abaixo). Falta só
     Fotografias/enriquecimento do Mercúrio (adiado de propósito) — o
     resto de "exportar" está feito dos dois lados.

     **Ulisses** (com 2 das 3 exportações precisando de correção depois
     do 1º teste):
     - `exportarCsvInscricoes()`: clique único em "Exportar CSV" no menu
       do topo, sem formulário/seletor de evento no meio **(testado e
       confirmado)** — baixa direto o CSV de Inscrições por filial, no
       formato exato que o importador manual espera.
     - `exportarCatalogoEventos()`: tela "Links" (home pós-login,
       `#/evento`) → aba "Ativo" → clica em cada card da lista (achado
       pela data DD/MM/AAAA no texto) e lê por RÓTULO os campos do
       formulário à direita (Título, Tipo link, Imagem, Subtítulo,
       Informação, Descrição). **2ª rodada de correção, confirmada por
       dado real em produção**: a mitigação anterior (espera fixa de
       600ms depois do painel abrir) não bastou — 2 eventos DIFERENTES
       ("Workshop de Oratória" 19/09 e "Bushido, o código de hora dos
       samurais" 26/09) foram sincronizados no CRM com o MESMO nome
       "Workshop de Oratória", porque Título/Imagem/Subtítulo do 2º
       evento ainda estavam com o valor do card ANTERIOR nesse instante
       — só a Descrição já tinha atualizado. Isso inverte o palpite
       anterior (achava que Descrição/Informação eram as mais lentas).
       Corrigido pra sempre validar o Título contra o texto do PRÓPRIO
       card (fonte confiável, já visível na lista antes do clique) —
       espera ativa em loop (até 6s) até `getByLabel(/título/i)` bater
       com o texto do card, só então lê os outros campos (mais uma folga
       curta de 300ms). Se nunca bater, loga aviso e segue mesmo assim
       (não trava a exportação). O evento errado já sincronizado (id=4,
       Garavelo) foi corrigido manualmente direto no banco nesta sessão
       (nome + descrição; `imagem_url` foi zerada por decisão do usuário,
       já que não tínhamos a imagem certa do Bushido à mão) — quem
       rodar o scraper de novo a partir de agora não deve reproduzir o
       bug, mas duplicatas antigas de OUTRAS filiais/eventos anteriores a
       essa correção podem precisar da mesma limpeza manual se existirem.
       **Também passou a ler Hora/Capacidade** (print real mostrou que o
       painel de detalhes tem uma 2ª aba, "Eventos" — ao lado de "Link",
       onde ficam os campos já lidos — com 1 linha por filial do Ulisses,
       cada uma com seu próprio Data/Hora e "Qtd. Vagas"; é o equivalente,
       do lado do Ulisses, do nosso conceito de evento multi-filial). A
       função `lerDataHoraEVagas()` clica na aba "Eventos", acha a(s)
       linha(s) com o checkbox MARCADO (a(s) filial(is) que essa conta usa)
       e lê Data/Hora + Qtd. Vagas dos `<input>` daquela linha, depois
       volta pra aba "Link" antes do próximo card do loop (senão a
       espera por "Título" do próximo card nunca bateria — ela só existe
       na aba "Link"). Alimenta as colunas `hora`/`capacidade` de
       `eventos`, que antes ficavam sempre em branco na sincronização
       automática. **Ainda NÃO testado de verdade** (escrito só com print
       de tela) — mesmo estágio inicial que as outras funções deste
       arquivo já passaram; se a leitura vier vazia/errada, mandar o HTML
       real da aba "Eventos" (Inspecionar no checkbox marcado + a linha
       `<tr>` toda) resolve rápido.
     - `exportarComparecimento()`: "Pré-inscrições" → "Recepção" (navega
       direto pra `#/recepcao` — o clique no menu nunca chegava lá de
       verdade, o hover é que abre o submenu, não o clique). **1º teste
       real confirmou BUG SÉRIO** (das 6439 linhas exportadas em
       Garavelo/522 eventos, 71% eram lixo — nome = "- Selecione um
       evento -", e-mail/telefone de OUTRA pessoa) — causa raiz achada
       depois que o usuário mandou o HTML real (Angular): (1) cada
       contato tem **1 checkbox "Compareceu" POR EVENTO que já
       participou** (`ng-repeat="emailEvento in contato.emailEventos"`),
       só o do evento selecionado agora fica visível (`ng-show`), os
       outros continuam no DOM só escondidos — o código antigo lia TODOS
       os checkboxes da página, inclusive os escondidos de outro evento
       da mesma pessoa; (2) nome/e-mail/telefone tinham célula própria
       (`td.ng-binding` na mesma `<tr ng-repeat="contato in emails">`) —
       a heurística antiga de "subir pelo ancestral até achar um texto
       com @" quebrava sempre que o contato não tinha e-mail cadastrado
       (nesse caso a própria linha não tem nenhum "@", então a subida ia
       longe demais e pegava texto de outra seção da página, inclusive o
       `<select>` de eventos — daí o "- Selecione um evento -" como
       nome). **Reescrito com seletores por atributo Angular**
       (`tr[ng-repeat="contato in emails"]`, `input[type="checkbox"]:visible`
       dentro da linha, `span[ng-show="contato.email"]`/`"contato.telefone"`)
       em vez de heurística de texto — mais robusto, mas **ainda NÃO
       testado de novo contra o site real** depois dessa reescrita (só
       validado contra o HTML que o usuário mandou, não rodado de
       verdade ainda). **Filtrado pros últimos 3 anos** (decisão do
       usuário) — o `<select>` lista TODO o histórico do Ulisses (os 522
       eventos do teste real acima são prova disso), e processar cada um
       (selecionar + esperar + ler todas as linhas de participantes)
       gerava um JSON enorme pra praticamente nenhum ganho; evento sem
       data no texto da opção (raro) fica de fora do corte, mantido.
       **Comparecimento NÃO é 100% confiável** mesmo depois de corrigido
       (a recepção marca na mão no dia, às vezes esquece) — vale
       considerar perguntar ao lead antes de confiar cegamente num "não
       compareceu". "Relatórios" no menu do topo só tem estatística
       agregada, não lista de leads — não serve pra isso.
     - **`sincronizarCatalogoEventosNoCrm(filial)`, NOVA, testada de
       verdade (2 eventos criados de verdade em Garavelo)**: depois de
       `exportarCatalogoEventos()` gerar o JSON, essa função já grava cada
       evento FUTURO direto na tabela `eventos` do CRM — sem passo manual
       nenhum, o scraper já tem acesso `service_role` ao Supabase pra
       isso (mesmo cliente usado pras credenciais/status de
       sincronização). Casa por `(filial, nome, data)` — reexecutar o
       scraper ATUALIZA um evento já importado (corrige imagem/descrição)
       em vez de duplicar, então o bug de descrição acima se autocorrige
       sozinho assim que o scraper rodar de novo com a correção. `tipo`
       é classificado pela MESMA tabela `tipos_evento`/`palavras_chave`
       de "Gerenciar Tipos" (pequena duplicação deliberada — só um
       lookup de palavra-chave, baixo risco de divergir da lógica de
       `classificarTipoEvento()` em `js/importador.js`); tipo de evento
       sem palavra-chave configurada fica em branco, sem inventar
       "Outro" (usuário classifica na Agenda se quiser). Não captura
       `hora` (o card do Ulisses não expõe isso como campo separado — o
       texto de Subtítulo/Informação, concatenado dentro de `descricao`,
       costuma trazer o horário em texto livre) nem
       `data_limite_inscricao` (fica null, editável na Agenda). Chamada
       como uma etapa a mais dentro de `processarFilial()`/
       `processarFilialLocal()`, entre `catalogo-eventos` e
       `comparecimento` — roda independente das outras (mesmo padrão de
       isolamento de falha).
     - Cada uma das etapas roda independente dentro de `processarFilial()`
       — uma falhar não impede as outras, e cada etapa que falha gera seu
       PRÓPRIO print de erro (`debug/ulisses-<etapa>-<filial>.png`), mais
       fácil de diagnosticar que 1 só genérico por filial.
     - **Mercúrio**: `exportarAtivosEInativos()` — **1º teste real completo
       e bem-sucedido (2026-09-07, headless, direto de `C:\Scrapper`, sem
       bloqueio tipo Cloudflare)**, depois de 2 rodadas de correção
       usando HTML/estrutura real (não mais só print):
       - `listarLinksCadastro()` tinha um bug real: subia só 1 `<td>` a
         partir do link "CADASTRO" pra achar o nome da filial — essa é a
         própria célula do link, então "o nome da filial" lido era
         sempre a palavra "CADASTRO" de novo (as 4 filiais saíram
         rotuladas igual, no 1º teste). Corrigido subindo até a
         `<table class="menu">` que envolve o link e lendo o
         `<a class="menu_tit">` dela (elemento IRMÃO, com o nome real —
         ex: `"GOIÂNIA UNIVERSITARIO: BARRA DO GARÇAS"`).
       - `exportarAtivosEInativos()` usava "Turma" como texto-âncora pra
         confirmar que chegou na tabela de Ativos — mas "Turmas" também é
         um item fixo do menu lateral (sempre visível em qualquer tela
         dentro de "CADASTRO"), então o código "achava" a tela certa
         antes mesmo da navegação de verdade acontecer, e a leitura caía
         sempre na tela de contato padrão (erro "Nenhuma tabela
         encontrada", confirmado por print real). Corrigido usando os
         NOMES FIXOS dos frames do site (confirmado ao vivo via
         Playwright: `"principal"` = conteúdo, `"indice"` = menu lateral
         dentro de uma filial) — `esperarFrame()`, nova, espera o frame
         certo chegar numa URL esperada, não mais por texto.
       - **Descoberta nova**: a tela de Inativos só mostra "RECENTES" por
         padrão (bem poucas linhas) — tem um `<select name="cmbData">`
         com opção `"TODOS"` que traz o histórico completo (a pedido do
         usuário, que já sabia desse passo manual); escolher a opção
         resubmete o formulário sozinho (`onchange="this.form.submit()"`).
       - Resultado do teste real (Ativos/Inativos das 4 filiais, todas
         com nome certo): CSVs gerados sem erro, colunas certas
         (`Matr;Nome;Nivel;Dia;Turma` / `Nome;Telefones;Ni;Data;Motivo`),
         encoding ISO-8859-1 correto (acentos ok), Inativos com histórico
         completo de verdade (ex: 2455 linhas em Jardim América, não só
         os "recentes"). `status_sincronizacao_automatica` já registrou
         `sucesso: true` pra essa rodada.
       - `listarLinksCadastro()` descobre TODOS os links "CADASTRO" da
         tela pós-login, um por filial, sem tentar casar com
         `filiais.nome` do Supabase — processa cada um sob o rótulo que o
         próprio Mercúrio usa (é só pra nomear os arquivos de forma
         reconhecível pra quem for importar na mão depois; a decisão de
         "ligar direto no CRM sem passo manual" pro lado do Mercúrio,
         equivalente ao que `sincronizarCatalogoEventosNoCrm()`/
         `sincronizarComparecimentoNoCrm()` já fazem pro Ulisses, é o
         marco 3, ainda pendente — ver abaixo).
       - Fotografias (Relatórios → Fotografias) e enriquecimento de
         telefone/ingresso via Turmas e aniversário via Aniversariantes
         (incluindo Inativos) ficaram de fora de propósito, priorizados
         depois de Ativos/Inativos — a primeira (Fotografias) também
         exige Supabase Storage (infra nova), deliberadamente adiada
         ("Deixa pra depois").
     - **Ideia estratégica maior, registrada mas NÃO iniciada**: o evento
       no Ulisses já linka pra uma tela de inscrição própria — dá pra
       imaginar integrar um gateway de pagamento (ex: PagSeguro) nessa
       inscrição e, no limite, substituir a tela do Ulisses pela nossa
       própria (ganhando spread da taxa do gateway). Isso seria um
       PRODUTO NOVO (site público de inscrição + pagamento), não uma
       extensão do scraper — fora do escopo atual, mas vale uma conversa
       de planejamento própria quando fizer sentido priorizar.
  3. ✅ **Concluído e testado de verdade (2026-09-07)** — decisão tomada:
     opção (b), Playwright pilota o CRM PUBLICADO como um usuário faria,
     em vez de reimplementar em Node a lógica de cruzamento/tags/Lead
     Forte que já existe em `js/importador.js` (evita duas versões da
     mesma lógica divergirem). Novo módulo `scraper/importar-no-crm.js`:
     - `abrirCrmComAcesso(page)`: abre a URL publicada e passa pelo
       portão de senha (`js/acesso.js`) se aparecer (sessão nova do
       Playwright nunca tem nada em `localStorage` ainda) — lê a senha do
       cofre (`credenciais_scraper`, novo `sistema='crm_acesso'`, senha
       única/compartilhada, sem usuário — `migracao_credenciais_scraper_crm_acesso.sql`,
       campo próprio em "Login Automático").
     - `importarNoCrm(page, filial, { caminhoAtivos, caminhoInativos,
       caminhoInscricoes })`: navega até a aba Importar, escolhe a filial
       de destino, sobe os 3 CSVs (`setInputFiles`), clica em "Processar",
       espera a prévia (sinal de que `processarPlanilhas()` terminou —
       pode demorar de verdade), clica em "Confirmar e Enviar", espera o
       log final (`Concluído!`/`Erro`) e devolve o log completo.
     - **2 bugs reais achados e corrigidos testando ao vivo contra o site
       publicado** (não só a lógica do scraper — também um bug real no
       próprio `index.html`):
       1. `carregarFiliais()` (assíncrona) era chamada no `DOMContentLoaded`
          sem `await` antes de `popularFilialImportacao()` — as duas
          corriam em paralelo, e o fallback desta última (busca própria
          se `filiaisDisponiveis` ainda não tiver itens) podia terminar
          DEPOIS e sobrescrever a seleção de filial já feita. O script
          conseguia selecionar a filial certa e ela voltava sozinha pro
          padrão um instante depois. Corrigido com `await` no `index.html`
          (afeta também humanos, embora bem mais raro) + uma checagem
          defensiva no scraper (reseleciona até estabilizar).
       2. `getByRole('button', { name: /Processar/ })` ficava travado
          (timeout, sem erro nenhum que desse pra diagnosticar sem abrir
          o DOM cru) porque existe um SEGUNDO botão "Processar" na
          página, escondido dentro do modal de Importar Matrícula via
          print (`js/matricula-importar.js`, fechado/disabled) — mesmo só
          1 dos 2 estando de fato visível. Corrigido usando seletor por
          atributo `onclick` exato (`processarPlanilhas()`/
          `confirmarEnviarImportacao()`/`tentarAcesso()`), sem
          ambiguidade nenhuma — mesma lição de `mercurio.js` preferir
          seletor estrutural a heurística de texto/role.
     - **Teste real completo, produção de verdade** (não dado fake): os 3
       CSVs já exportados nesta sessão (Ativos/Inativos do Mercúrio +
       Inscrições do Ulisses, filial Barra do Garças/MT, que já tinha 893
       leads reais no banco) foram importados via automação — log final:
       "893 leads enviados", cruzamento/Lead Forte/Jornada calculados
       certinho, e o aviso de "lead sumiu da planilha" (feature já
       existente) disparou corretamente pra 2 pessoas. Confirmado no
       banco: 895 leads na filial depois (893 atualizados + 2 novos).
     - ✅ **Ativos/Inativos do Mercúrio agora são importados no CRM
       AUTOMATICAMENTE todo dia** (2026-09-10, dentro de `main()` em
       `scraper/mercurio.js`, logo depois de `resolverFilialCrm()` e
       ANTES da varredura de turmas): chama `importarNoCrm(pageCrm,
       filialCrm, {caminhoAtivos, caminhoInativos, caminhoInscricoes:
       null})` — importação PARCIAL, só Mercúrio (ver seção do
       Importador). Antes disso, o job diário só EXPORTAVA o CSV pro
       disco (útil pra importação manual), mas nunca atualizava tag
       Ativo/Inativo/Nível de ninguém no CRM sozinho — essa lacuna era a
       causa raiz de leads ficarem com a classificação desatualizada até
       alguém reimportar manualmente pela aba Importar (sintoma relatado
       pelo usuário: "pessoas ativas ou inativas não marcadas com tags
       adequadas"). Só ficou seguro ligar isso depois do bug #2 de
       duplicidade ser corrigido (ver seção do Importador, "Bug real #2").
       Falha nesta etapa é isolada (não impede aniversariantes/turmas de
       rodar) e registra print de erro em `debug/mercurio-importar-crm-*.png`.
       **Ainda não testado contra o Mercúrio de produção de verdade**
       (só a função `importarNoCrm()` em si já foi testada, ver seção do
       Importador) — a próxima execução real do job (agendada ou pelo
       botão "Rodar Mercúrio agora") vai validar isso; Ulisses continua
       de fora deste encadeamento (sempre manual).
  4. ✅ **Agendamento do Mercúrio, via `pg_cron` do Supabase** (05:00 em
     Brasília todo dia) — só a parte do Mercúrio, que já roda 100%
     headless sem bloqueio nenhum. O Ulisses **nunca** vai ter
     agendamento automático (decisão consciente — ver Cloudflare acima);
     continua exigindo `npm run ulisses-local` manual numa máquina de
     confiança (usuário decidiu manter fixo, não abrir mão de segurança
     só pra rodar de qualquer PC — ver justificativa na seção "Lembrete
     de importação do Ulisses" logo abaixo).
     - **Não é mais o `schedule:` do GitHub Actions** (removido de
       `.github/workflows/scraper.yml` em 2026-09-10) — comprovadamente
       pouco confiável no plano gratuito: confirmado via API do GitHub
       (`GET /repos/.../actions/workflows/scraper.yml/runs`, não
       suposição) que o disparo `schedule` de 2 dias seguidos aconteceu
       ~4h40 ATRASADO (08:00 UTC esperado, ~12:40-12:47 UTC de verdade), e
       num 3º dia simplesmente NÃO disparou até o usuário acionar
       manualmente. Não era bug de fuso — o cron `0 8 * * *` (08:00 UTC =
       05:00 Brasília, fixo desde que o Brasil parou de observar horário
       de verão em 2019) sempre esteve matematicamente certo; o problema é
       o `schedule:` do Actions ser "melhor esforço", sem SLA de horário
       nenhum, principalmente pra contas sem plano pago.
     - **Solução**: `migracao_agendamento_mercurio_pgcron.sql` habilita as
       extensions `pg_cron`/`pg_net` (já rodada nesta sessão via `supabase
       db query --linked`) e cria o job `disparar-scraper-mercurio-diario`
       (`cron.schedule(...)`, `0 8 * * *`) que chama `net.http_post()`
       direto pra Edge Function **`scraper-disparar`** (a mesma que o
       botão "Rodar Mercúrio agora" já usa) — o agendador do Postgres
       roda DENTRO da infraestrutura do próprio Supabase, sem depender da
       fila compartilhada de runners gratuitos do GitHub pra disparar no
       horário certo (o trabalho pesado — abrir navegador, fazer scraping
       — continua rodando no GitHub Actions via `workflow_dispatch`, só o
       GATILHO de horário mudou de lugar). Usa a chave publishable (já
       pública, embutida no `index.html`) no header `Authorization` — só
       precisa ser um JWT válido pra passar da verificação padrão da
       function, não precisa ser a service role.
     - **Diagnóstico rápido pra checar se rodou** (não precisa entrar no
       GitHub): `select * from cron.job;` (agendamento ativo?),
       `select * from cron.job_run_details order by start_time desc
       limit 10;` (últimas execuções do cron job em si, sucesso/erro da
       CHAMADA HTTP), e a consulta de sempre em
       `status_sincronizacao_automatica` (resultado REAL do scraper,
       gravado por `mercurio.js` depois que o GitHub Actions terminou de
       rodar) — as duas junto respondem "o cron disparou?" e "o scraper
       terminou bem?" separadamente.
  5. ✅ **Disparo sob demanda do Mercúrio, direto do CRM** — botão
     "Sincronização Automática" na aba Importar (`abrirSincronizacaoScraper()`,
     `js/importador.js`; `#modalSincronizacaoScraper` em `index.html`), pra
     não esperar até às 5h quando o time quer dados frescos NA HORA. O CRM
     (navegador, chave publishable) não pode disparar um GitHub Actions
     diretamente — precisa de um token que nunca pode chegar ao navegador —
     então existe uma Edge Function nova, **`scraper-disparar`**
     (`supabase/functions/scraper-disparar/`, **já deployada**), que chama a
     API REST do GitHub (`workflow_dispatch` em
     `.github/workflows/scraper.yml`) usando um Personal Access Token
     guardado como secret (`GITHUB_TOKEN_DISPATCH` — nome próprio, pra não
     confundir com o `GITHUB_TOKEN` automático que o Actions já usa em outro
     contexto). O botão "Rodar Mercúrio agora" (`dispararMercurioAgora()`)
     grava o timestamp de ANTES do disparo, chama a function, e faz *poll*
     em `status_sincronizacao_automatica` a cada 15s (até 20min) comparando
     `executado_em` — assim que uma linha mais nova que o timestamp aparecer,
     mostra sucesso/falha na tela em vez de deixar a pessoa adivinhando se
     ainda está rodando. Só dispara o Mercúrio (o Ulisses fica sempre `if:
     false` no workflow, ver Cloudflare acima — disparar o workflow inteiro
     só roda a parte que já é 100% automática mesmo).
     - **Setup**: `supabase functions deploy scraper-disparar` (CLI já
       linkado ao projeto nesta sessão, deploy já feito); falta só criar um
       GitHub Personal Access Token de *fine-grained* (github.com → foto de
       perfil → Settings → Developer settings → Fine-grained tokens →
       Generate new token → repositório `CRMNovaAcropole` → em
       "Permissions", `Actions: Read and write`) e rodar
       `supabase secrets set GITHUB_TOKEN_DISPATCH=<token>` — **isso só o
       usuário consegue fazer** (criar o token exige login/2FA da conta
       GitHub dele, não dá pra gerar por fora). Sem o secret configurado, o
       botão mostra o erro claro `GITHUB_TOKEN_DISPATCH não configurado`
       (a function já checa isso antes de tentar chamar o GitHub).

### Lembrete de importação do Ulisses (WhatsApp pro admin)

Como o Ulisses nunca roda sozinho, o risco real é ESQUECER de rodar —
por isso o job diário do Mercúrio (que já roda sozinho) manda um WhatsApp
de lembrete pro admin em 2 situações, calculadas em `verificarLembreteImportacaoUlisses()`
(`scraper/mercurio.js`, chamada no fim de `main()`, best-effort — erro
aqui nunca derruba o resto do job):
- **Existe algum evento (qualquer filial) com data de ontem, hoje ou
  amanhã** → marcado como lembrete IMPORTANTE (é quando presença/
  matrícula frescas mais importam) — lista os eventos na mensagem.
- **É segunda-feira** (mesmo sem evento por perto) → checagem semanal de
  rotina, pra não deixar a base ficar desatualizada por muito tempo.
- Data "hoje" calculada no fuso de Brasília (`Intl.DateTimeFormat` com
  `timeZone: 'America/Sao_Paulo'`) — importante porque o GitHub Actions
  roda em UTC por padrão.

**Nova Edge Function `lembrete-scraper`** (`supabase/functions/lembrete-scraper/`):
manda a mensagem pra um número FIXO (secret `WHATSAPP_NUMERO_ADMIN`, nunca
hardcoded), reaproveitando os MESMOS secrets já configurados da integração
de WhatsApp (`WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID_DEFAULT`) — sem
duplicar nada. Diferente de `whatsapp-send` (sempre busca telefone de um
LEAD), esta manda pra um número que não é lead nenhum. **Setup pendente**
(só o usuário consegue fazer): `supabase functions deploy lembrete-scraper`
+ `supabase secrets set WHATSAPP_NUMERO_ADMIN=5562991729783` (mantém
verificação de JWT padrão — só o scraper, com `SERVICE_ROLE_KEY`, chama).

**Limitação conhecida, documentada no código da function**: WhatsApp só
aceita texto livre se o destinatário tiver mandado mensagem pro número
comercial nas últimas 24h — fora da janela, só TEMPLATE aprovado
funciona. Ainda não existe um template pra esse lembrete; até lá, a
entrega em dias sem interação recente não é garantida (erro 131047,
logado mas não visível pro admin — a mensagem simplesmente não chega).
Recomendação: criar e aprovar um template dedicado na Meta assim que o
bloqueio de API (ver abaixo) for resolvido, senão o lembrete pros "dias
que não posso falhar" pode falhar silenciosamente bem nesses dias.

**Cofre não usado aqui de propósito**: diferente de Ulisses/Mercúrio, o
número do admin fica em secret de Edge Function (não em
`credenciais_scraper`) porque não é uma senha de login — é só um
destinatário fixo, sem necessidade de cifragem.

**Decisão registrada (não construir por enquanto)**: o usuário cogitou um
botão DENTRO do CRM publicado pra acionar o Ulisses remotamente, ou até
baixar o scraper pra rodar em qualquer computador — as duas ideias
esbarram no mesmo problema: a chave `service_role` do Supabase (usada
pelo scraper pra ler o cofre de credenciais) precisaria "viajar" até um
navegador ou computador não-confiável, o que anula a única tabela do
projeto blindada contra acesso público (`credenciais_scraper`, sem RLS
pública de propósito). Decisão do usuário: manter o modelo atual
(`C:\Scrapper`, ou replicar o mesmo setup manual em outra máquina de
confiança se precisar) em vez de investir numa ponte seguro-o-suficiente
(token temporário via Edge Function) — reavaliar só se isso virar
dor real no dia a dia.

### Avisos por WhatsApp pro chefe de filial

Duas situações mandam mensagem pro WhatsApp do **chefe de filial/professor
responsável** (não um lead, não o admin do scraper) — número em
`filiais.whatsapp_chefe_numero` (`migracao_filial_whatsapp_chefe.sql`,
E.164 sem "+", editável em "Gerenciar Filiais"). As duas passam pela MESMA
Edge Function nova, **`whatsapp-notificar-chefe-filial`**: recebe só
`{ filial, texto }` — o número do chefe é resolvido NO SERVIDOR a partir
da filial, nunca exposto ao navegador; sem número configurado pra aquela
filial, devolve erro claro (`chefe_sem_numero`) em vez de falhar
silenciosamente. Reaproveita os mesmos secrets já existentes
(`WHATSAPP_TOKEN`), e resolve `phone_number_id` pela filial (com
fallback pro padrão), igual `whatsapp-send`.

- **Aviso de aniversário de aluno Ativo** (`verificarAniversariosAtivosHoje()`,
  `scraper/mercurio.js`, chamada a cada filial logo depois de
  `sincronizarAniversariantesNoCrm()` no job diário automático): busca
  leads da filial com `data_nascimento` de hoje E tag `"Ativo"`/`"Aluno
  Ativo"` (só quem já é aluno de verdade — não qualquer lead com data
  cadastrada) e manda 1 mensagem por aniversariante. Best-effort, erro
  aqui nunca derruba o resto do job do Mercúrio.
- **"Enviar pro Chefe" na gaveta do lead** (`enviarResumoParaChefeFilial()`,
  `js/app.js`, botão ao lado de "Editar" no bloco "Resumo da Conversa
  (IA)"): pedido explícito do time de SDR — avisar o chefe sobre um lead
  específico que merece mais atenção. De propósito **não gera nada novo
  por IA** ("de forma simples") — só manda o texto que já está no campo
  `resumo_ia` daquele lead, com um `confirm()` antes de disparar (é uma
  mensagem de verdade pro chefe, não uma prévia). Sem resumo escrito
  ainda, avisa pra preencher primeiro em vez de mandar vazio.
- Chamada pelo navegador (chave publishable) OU pelo scraper
  (`SERVICE_ROLE_KEY`) — mantém verificação de JWT padrão, os dois já
  mandam um Bearer válido.

## Mapa de Turmas (`js/mapa-turmas.js`, aba nova)

Grade semanal (dia x horário) de turmas por filial, só leitura — sem
cadastro manual de propósito, é um espelho do Mercúrio. Fonte: tabela
`turmas` (`migracao_turmas.sql`, `filial`+`nome` único), sincronizada
automaticamente por `processarMatriculasRecentesTurmas()`
(`scraper/mercurio.js`) — a mesma varredura que já visita cada turma
procurando matrícula recente agora TAMBÉM grava dia/horário de TODA
turma visitada ali (upsert), tenha matrícula nova ou não.

- Colunas = dias da semana que têm pelo menos 1 turma, na ordem
  Segunda→Domingo; linhas = todo horário distinto observado (ordena
  certo como string "HH:MM"). Célula vazia = "horário livre", destacada
  em verde — é o objetivo principal da tela (achar espaço pra abrir
  turma nova).
- **Bug real corrigido num teste visual**: a normalização de dia da
  semana removia acento (`normalizarDiaSemana()`) mas a lista de
  referência (`ORDEM_DIAS_SEMANA`) continuava acentuada — "Terça" nunca
  batia e caía fora de ordem, no fim da grade. Corrigido removendo a
  normalização de acento (o Mercúrio já manda "TERÇA"/"SÁBADO"
  corretamente acentuados; comparar acentuado-com-acentuado é mais
  confiável que uma normalização pela metade).

## Matrículas por Mês — agora com receita e comissão de SDR

`renderizarRelatorioMatriculasPorMes()` (aba Relatórios) ganhou um
`<select>` de mês (padrão: o mais recente com matrícula) e 3 KPIs pro
mês escolhido: quantidade de matrículas, receita (matrículas x
`filiais.valor_mensalidade`, nova coluna —
`migracao_filial_valor_mensalidade.sql`, editável em "Gerenciar
Filiais") e comissão do SDR (30% da receita). **Receita aqui é só a
contribuição do 1º mês de cada matrícula NOVA daquele mês** — não a
mensalidade recorrente de toda a base já matriculada; é a mesma base
usada pra calcular a comissão. Sem `valor_mensalidade` configurado, os
2 últimos KPIs mostram "—" com um aviso, mas a contagem de matrículas
continua funcionando normalmente. O gráfico de barras com todos os
meses (já existente) continua embaixo, inalterado.

## Login Automático — Ulisses removido do cofre

A pedido do usuário: como o login do Ulisses é **sempre** manual
(Cloudflare), guardar e-mail/senha no cofre nunca serviu pra mais que
uma dica no terminal (`ulisses-local.js` já lê o cofre só pra ISSO,
nunca preenche nada sozinho) — os campos de Ulisses foram removidos da
tela "Login Automático" (`renderizarCredenciaisScraper()`,
`js/importador.js`), com uma nota explicando o motivo. Mercúrio e o
portão de acesso do CRM continuam lá normalmente (esses sim são
automatizados). Backend/cofre não foram tocados — credencial de Ulisses
já salva antes continua existindo e servindo de dica, só não dá mais
pra SALVAR uma nova pela tela.

## "Botão" de acionar o Ulisses — decisão final

Um botão de verdade no CRM publicado não consegue abrir uma janela de
navegador no PC de quem clica (é um site na nuvem) — por isso, em vez
disso, existe `scraper/Importar Ulisses.bat`: atalho de duplo-clique
(roda `npm run ulisses-local`, todas as filiais) na máquina de confiança
(`C:\Scrapper`), com uma pausa no final pra dar tempo de ler o resumo.
Copiar esse `.bat` pra área de trabalho (atalho) é o mais perto que dá
de um "botão" sem abrir mão do modelo de segurança já decidido (chave
`service_role` nunca sai de máquina de confiança — ver seção do
lembrete de importação acima).

## WhatsApp Unificado — de qual filial é cada conversa?

Conversas **identificadas** já eram implicitamente da filial atual
(`filialAtual`, mesmo filtro do resto do app) — agora cada uma também
mostra um selo com o nome da filial, pra não depender só do seletor do
topbar. Conversas **NÃO identificadas** (webhook não achou nenhum lead
com aquele telefone) **não têm filial nenhuma pra mostrar** — o
`filial` da mensagem fica `null` nesse caso (confirmado no código do
webhook, `supabase/functions/whatsapp-webhook/index.ts`), e isso é
inerente a ter só 1 número de WhatsApp compartilhado por todas as
filiais hoje (não dá pra saber de qual escola veio antes de vincular a
um lead). Adicionada uma nota explicando isso na seção "Não
identificados" da lista de conversas, pra não dar a falsa impressão de
que elas pertencem à filial selecionada no momento.

## Bloqueio da API do WhatsApp (Meta) — investigado 2026-09-07

Toda mensagem de saída desde 2026-09-05 22:21 (e antes, 19:23) falha com
`{"code":200,"type":"OAuthException","message":"API access blocked."}` —
**diferente** do erro 131047 (janela de 24h fechada, normal/esperado, e
que também aparece nos logs ANTES disso, confirmando que a integração
funcionava). Investigação (consultando `mensagens_whatsapp` direto):
- Só 11 mensagens no total, quase todas de teste do próprio usuário pro
  próprio número (5562991729783) — volume baixíssimo, não bate com
  "spam" ou envio em massa disparando um filtro da Meta.
- O bloqueio apareceu num intervalo de ~18h SEM nenhuma mensagem sendo
  mandada (entre 01:10 e 19:23 do dia 05/09) — não foi uma mensagem
  específica que "estourou" nada.
- **Teoria mais provável (do próprio usuário, consistente com a
  investigação)**: divergência entre o telefone cadastrado na Receita
  Federal (documentos enviados pra verificação da empresa na Meta) e o
  telefone atual — a Meta pode ter rodado uma verificação nesse meio-tempo
  e restringido o acesso à API por causa disso, não por comportamento de
  uso.
- **Não é algo que dê pra resolver por código** — precisa checar
  business.facebook.com (avisos/notificações da Business Manager),
  developers.facebook.com/apps (status do app), e o WhatsApp Manager
  (status/"quality rating" do número). Provavelmente vai exigir corrigir
  o telefone/documento da verificação de empresa e pedir nova revisão.
- Bloqueia tudo que depende de WhatsApp: convites de evento, resgate de
  lead frio, e o lembrete de importação do Ulisses (seção acima) — ainda
  assim, o código do lembrete foi escrito e já fica pronto pra funcionar
  assim que o bloqueio for resolvido.

## Importar Conversa de WhatsApp (feita fora do CRM)

Enquanto a API do Meta está bloqueada (seção acima), o time continua
atendendo pelo WhatsApp de verdade, fora do CRM — esse recurso traz essas
conversas de volta pro histórico do lead, sem precisar digitar mensagem
por mensagem na mão. Botão "Importar Conversa" no cabeçalho do chat da
GAVETA do lead (`abrirImportarConversaWpp()`, `js/importar-conversa-whatsapp.js`)
— de propósito só ali (não na aba WhatsApp unificada): a filial e o lead
já estão fixos pelo simples fato de a gaveta estar aberta, então não
precisa de um seletor de filial/busca de lead separado.

- **Formato de entrada, confirmado contra um export real** (pedido ao
  usuário antes de escrever qualquer parser, mesmo princípio já usado pro
  HTML do Ulisses/Mercúrio — nunca adivinhar formato de sistema externo):
  menu da conversa → Exportar conversa → **Sem mídia** → `.txt` com 1
  linha por mensagem, `DD/MM/AAAA HH:MM - Remetente: texto` (SEM vírgula
  entre data e hora, SEM segundos — formato pode variar em outro
  aparelho/idioma, ainda não testado). Mensagens de SISTEMA (aviso de
  criptografia etc.) não têm o padrão "Nome: texto" e são ignoradas
  automaticamente. Mensagens multi-parágrafo (texto colado com quebras de
  linha) são reconhecidas por CONTINUAÇÃO — qualquer linha que não comece
  com o timestamp é concatenada na mensagem anterior. `<Mídia oculta>`
  (mídia não incluída no export) entra como texto literal mesmo — sem
  fingir que tem uma imagem/áudio de verdade ali.
- **`parseTextoConversaWhatsApp(texto)`** (`js/importar-conversa-whatsapp.js`)
  é 100% local/síncrono, sem chamada de rede — devolve os textos JÁ
  concatenados e aparados. Se achar mais de 2 remetentes distintos, avisa
  que parece ser conversa em GRUPO (só funciona 1-a-1) e bloqueia a
  importação.
- **"Quem é quem" (direção de cada mensagem)**: depois de processar, um
  rádio deixa marcar qual dos até-2 remetentes distintos é VOCÊ
  (atendente) — o outro nome vira "o lead" (`direcao: 'entrada'`), o
  marcado vira "atendente" (`direcao: 'saida'`). Pré-marcado por PALPITE
  (o remetente cujo primeiro nome bate com o primeiro nome do lead já
  aberto na gaveta vira "não-atendente" automaticamente), mas sempre
  exige confirmação visual antes de importar — nunca decide sozinho.
  Uma prévia (primeiras/últimas mensagens, com setas de direção) atualiza
  em tempo real se o rádio for trocado.
- **Grava via Edge Function nova, `whatsapp-importar-conversa`** (não
  direto do navegador): `mensagens_whatsapp` **não tem policy de INSERT
  pro público** (só service_role escreve, ver `migracao_whatsapp.sql`) —
  testado ao vivo que um INSERT direto pela chave publishable é
  bloqueado pela RLS, então essa function segue o MESMO padrão de
  `whatsapp-send`/`whatsapp-webhook`: recebe só `{pessoaIdentificador,
  mensagens: [{direcao, texto, timestamp}]}`, resolve telefone/filial do
  lead NO SERVIDOR (nunca confia no que vier do navegador). Cada mensagem
  grava `importado_manualmente = true` (`migracao_whatsapp_importado.sql`)
  — a ÚNICA diferença de schema entre uma mensagem importada e uma real
  da API. Timestamp: como o `.txt` só tem HH:MM (sem segundos), o
  navegador soma um deslocamento de alguns ms por índice global antes de
  mandar (`Date` normaliza overflow de ms sozinho) — só pra garantir ordem
  cronológica estável entre mensagens do MESMO minuto, sem inventar
  segundo nenhum de verdade.
- **Badge visível no chat** (`htmlMensagemWpp()`, `js/whatsapp.js`): toda
  mensagem com `importado_manualmente = true` ganha um ícone pequeno
  (`fa-file-import`, título "Importada de uma conversa feita fora do
  CRM") ao lado do horário — pra NUNCA confundir com uma mensagem enviada/
  recebida de verdade pela API (importante justamente porque a API está
  bloqueada agora; sem essa distinção visual, uma mensagem "enviada" com
  sucesso apareceria igual a um envio real que na verdade está falhando
  silenciosamente hoje). O chat da gaveta já enxerga as linhas novas pelo
  MESMO canal Realtime que já existia (`criarChatController()`,
  `js/whatsapp.js, filtro por pessoaIdentificador`) — nenhum reload manual
  precisou ser escrito.
- **Testado ao vivo, ponta a ponta, contra o Supabase real** (filial/lead
  descartáveis): parser confirmado contra o export de verdade que o
  usuário mandou (25 mensagens, aviso de criptografia ignorado, mensagem
  de 6 parágrafos concatenada certa, `<Mídia oculta>` atribuída ao
  remetente certo); fluxo completo pela UI (abrir gaveta → Importar
  Conversa → colar → Processar → confirmar quem é o atendente →
  Confirmar Importação) grava as linhas certas (direção, texto, telefone
  resolvido do lead, filial, ordem cronológica sem empate); badge aparece
  no HTML renderizado do chat. **Achado no teste**: `mensagens_whatsapp`
  também não tem policy de DELETE pro público (só INSERT/SELECT/UPDATE
  parcial, ver `migracao_whatsapp.sql`) — limpeza de dado de teste nessa
  tabela precisa passar por acesso privilegiado (`supabase db query
  --linked`), a chave publishable não consegue apagar uma linha ali de
  jeito nenhum (mesma garantia de "não se perde" documentada pra
  `log_atividade`, só que não foi de propósito nesta tabela — é
  consequência de nunca ter existido policy de escrita pública alguma).
- **Limitação conhecida, de propósito**: só cobre conversa 1-a-1, e só o
  formato de export confirmado (o de outro aparelho/idioma pode precisar
  de ajuste no regex de `RE_INICIO_LINHA_WPP` se aparecer um formato
  diferente — não adivinhar, pedir uma amostra real primeiro, mesmo
  principio de sempre). Entrada só pela gaveta do lead — não existe (ainda)
  um fluxo pra "colei uma conversa mas não sei de qual lead é", que
  precisaria de um seletor de filial + busca de lead por nome/telefone
  (ideia registrada, não construída).

## Publicação/Deploy — CRM público (Vercel) + portão de acesso

O CRM sempre rodou só localmente (Live Server, `127.0.0.1:5500`) — passou
a ter uma publicação pública (Vercel, escolha do usuário — Netlify também
serviria, é só HTML/CSS/JS estático, sem build) porque o scraper (marco 3
acima, opção b) precisa conseguir abrir o CRM de fora da rede local.

- **`js/acesso.js`** — portão de senha ÚNICA compartilhada pelo time
  (não é um sistema de login de verdade, sem usuários individuais):
  necessário porque, sem ele, publicar o CRM numa URL pública deixaria
  qualquer pessoa com o link ver/editar todos os leads (o app não tem
  autenticação nenhuma — a chave publishable do Supabase já garante
  acesso total a quem tiver o HTML, publicado ou não). Overlay de tela
  cheia (`#acessoOverlay` em `index.html`) até a senha certa ser digitada;
  fica salvo em `localStorage` depois disso (não pede de novo no mesmo
  navegador). A senha certa NUNCA fica em texto puro no código — só o
  hash SHA-256 dela (`SENHA_ACESSO_HASH`); instrução de como gerar o hash
  está comentada no topo do arquivo. **Não é proteção contra um atacante
  determinado** (a chave publishable já fica visível vendo o código-fonte,
  com ou sem esse portão) — é só pra impedir que alguém ache o link à toa.
- Repositório Git local iniciado nesta sessão (antes não existia nenhum)
  — necessário tanto pra publicar via Vercel quanto pro GitHub Actions do
  scraper rodar.

## Convenções de código

- Comentários e nomes de função em português, no mesmo estilo do resto do
  código (ex: `renderizarCards`, `aplicarFiltroVisualColuna`).
- Sempre validar sintaxe (`node --check arquivo.js`) depois de editar.
- Não introduzir frameworks — o projeto é intencionalmente Vanilla JS.
- CSS usa variáveis em `:root` (`--na-green`, `--na-green-dark`, `--na-gold`
  etc.) — reaproveitar esses tokens em vez de cores soltas.
- **Chave de coluna (`col.key`) dentro de um seletor CSS sempre precisa de
  `CSS.escape()`** — ex: `` `#${CSS.escape('col-' + key)}` ``, nunca
  `` `#col-${key}` `` direto. As chaves de coluna geradas por
  `gerarChaveColuna()` já são só `[A-Z0-9_]`, mas a coluna "Sem Whatsapp"
  (criada automaticamente pelo importador quando falta telefone) usa o
  nome com espaço como chave — sem escapar, o espaço vira combinador
  descendente pro CSS e a busca simplesmente não encontra a coluna (bug já
  corrigido em `atualizarContadores()`, `aplicarFiltroVisualColuna()` e
  `toggleSelecionarTodosColuna()`, mas vale lembrar em qualquer código novo
  que monte um seletor `#col-...`).

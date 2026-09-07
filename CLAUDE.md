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
js/leads-a-tratar.js → módulo separado: "Leads a Tratar" (duplicados por telefone/nome + sem telefone)
js/matricula-importar.js → módulo separado: importar matrícula via texto colado da tela do
                        Mercúrio (lista avulsa OU tela de Turma completa, com Dia/Horário) —
                        botão na coluna de Matriculados do Kanban, sem IA, sem Edge Function,
                        tudo lido por regex no navegador
js/notificacoes.js  → módulo separado: Central de Notificações (sino no topbar) — Lead
                        Forte 1 novo, evento quase lotado, lembrete vencido, WhatsApp recebido,
                        sincronização automática travada
js/acesso.js         → portão de senha única do time (ver seção "Publicação/Deploy")
scraper/             → login automatizado no Ulisses/Mercúrio via Playwright, roda fora do
                        Supabase (GitHub Actions, .github/workflows/scraper.yml) — ver seção
                        própria "Scraper Ulisses/Mercúrio"
img/logo-nova-acropole.png              → logo, usado no favicon e no topbar
supabase/functions/whatsapp-send/       → Edge Function: envia mensagem via Graph API
supabase/functions/whatsapp-webhook/    → Edge Function: recebe mensagens/status da Meta
supabase/functions/classificar-temas/   → Edge Function: classifica tema de evento por IA (Anthropic)
supabase/functions/gerenciar-credenciais/ → Edge Function: cifra e grava senha do Ulisses/Mercúrio
                                     (cofre do futuro scraper — só escrita, nunca lê de volta)
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
migracao_data_nascimento.sql      → coluna data_nascimento em leads_inscricoes
                                     (Aniversariantes do Mês no Dashboard); rodar
                                     manualmente
migracao_filial_preposicao.sql    → coluna nome_com_preposicao em filiais (ex: "do
                                     Jardim América") — preenchimento automático da
                                     variável filial nos templates de WhatsApp;
                                     rodar manualmente
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
  (`.activity-item-festiva`).

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

Botão "Importar Matrícula" (`.col-import-matricula-btn`), mostrado só no
cabeçalho da coluna do Kanban cujo nome/chave contém "matricul"
(`renderizarColunas()`, `js/app.js`) — não existe se o time nunca renomear
uma coluna pra incluir essa palavra. Pensado pra registrar matrícula em
lote a partir do texto copiado da tela "Aluno => Matricular" do Mercúrio,
sem digitar nada manualmente.

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
  2. 🟡 Exportar os dados — **Ulisses testado de verdade (1º teste real
     completo, 2026-09-06/07, filial Garavelo, modo local/assistido)**,
     com 2 das 3 exportações precisando de correção depois do teste:
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
     - `exportarComparecimento()`: "Pré-inscrições" → "Recepção" (navega
       direto pra `#/recepcao` — o clique no menu nunca chegava lá de
       verdade, o hover é que abre o submenu, não o clique). **Testado de
       verdade — BUG SÉRIO CONFIRMADO, não corrigido ainda**: das 6439
       linhas exportadas num teste real (Garavelo, 522 eventos), **71%
       são lixo** (nome = "- Selecione um evento -", e-mail/telefone de
       OUTRA pessoa que não tem nada a ver com a linha). O seletor que
       sobe pelos ancestrais do checkbox até achar um texto com "@"
       (`ancestor::*[contains(., "@")][1]`) está subindo longe demais em
       boa parte dos casos — o padrão dos dados sugere 1+ checkbox por
       evento fora da linha real de cada participante (talvez um
       checkbox de cabeçalho/"selecionar todos", ou uma 2ª coluna de
       checkbox que não fica dentro da própria linha da pessoa — não dá
       pra saber sem ver o HTML de verdade). **Bloqueado até o usuário
       mandar o HTML real de 1 linha de participante da tela de Recepção**
       (DevTools → Inspecionar no checkbox de "Compareceu" → Copy →
       Copy outerHTML, incluindo uns 2 níveis de ancestral) — mais um
       palpite não vale a pena depois desse índice de erro.
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
     - **Mercúrio**: `exportarAtivosEInativos()` escrita (login corrigido
       pra buscar em frames — ver acima; descobre TODOS os links
       "CADASTRO" da tela pós-login via `listarLinksCadastro()`, um por
       filial, sem tentar casar com `filiais.nome` do Supabase — processa
       cada um sob o rótulo que o próprio Mercúrio usa; gera
       `mercurio-ativos-<filial>.csv`/`mercurio-inativos-<filial>.csv` no
       mesmo layout de colunas que o importador manual já espera,
       encoding ISO-8859-1). **Ainda NÃO testada de verdade** — mapeada só
       por descrição/print do usuário, mesmo estágio em que
       `exportarCatalogoEventos()`/`exportarComparecimento()` do Ulisses
       estavam antes do 1º teste real. Fotografias (Relatórios →
       Fotografias) e enriquecimento de telefone/ingresso via Turmas e
       aniversário via Aniversariantes (incluindo Inativos) ficaram de
       fora de propósito, priorizados depois de Ativos/Inativos — a
       primeira (Fotografias) também exige Supabase Storage (infra nova),
       deliberadamente adiada ("Deixa pra depois").
     - **Ideia estratégica maior, registrada mas NÃO iniciada**: o evento
       no Ulisses já linka pra uma tela de inscrição própria — dá pra
       imaginar integrar um gateway de pagamento (ex: PagSeguro) nessa
       inscrição e, no limite, substituir a tela do Ulisses pela nossa
       própria (ganhando spread da taxa do gateway). Isso seria um
       PRODUTO NOVO (site público de inscrição + pagamento), não uma
       extensão do scraper — fora do escopo atual, mas vale uma conversa
       de planejamento própria quando fizer sentido priorizar.
  3. ⬜ Decisão de arquitetura pendente pra ligar os dados exportados de
     volta no CRM: ou (a) reimplementar em Node a lógica de cruzamento/
     tags/Lead Forte que já existe em `js/importador.js` (risco: duas
     versões da mesma lógica podem divergir), ou (b) o próprio Playwright
     abre o CRM publicado (ver seção "Publicação/Deploy" abaixo) e pilota
     a tela de Importar como um usuário faria (`setInputFiles()` nos
     inputs de arquivo + clicar Processar/Confirmar) — reaproveita 100%
     da lógica existente, sem duplicar nada. Direção provável: (b).
  4. ⬜ Agendamento (`schedule:` no workflow — hoje só `workflow_dispatch`,
     disparo manual, até os marcos acima estarem validados).

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

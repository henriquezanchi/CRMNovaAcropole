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
js/relatorios-whatsapp.js → módulo separado: 3 relatórios de WhatsApp (SLA de 1ª resposta,
                        desempenho por atendente, volume por período) + "Resumo do Trabalho"
                        na tela, todos na aba Relatórios — ver "Segunda rodada de incrementos"
js/tarefas.js        → módulo separado: aba "Tarefas" (quem faz o quê, até quando) +
                        "Gerenciar Equipes" — responsável de uma tarefa é um usuário OU uma
                        equipe, e o status sincroniza nos 2 sentidos com a coluna do Kanban
                        do(s) lead(s) vinculado(s) — ver seção própria
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
supabase/functions/ia-diagnostico-saude/ → Edge Function: detecta erro de importação/
                                     sincronização por regra fixa e usa a Anthropic API só
                                     pra ESCREVER o resumo/ação em português — ver seção
                                     "Diagnóstico de Saúde (IA) e Recomendações de Contato (IA)"
supabase/functions/ia-recomendar-contatos/ → Edge Function: recebe leads já priorizados por
                                     regra fixa (js/tarefas.js) e escreve, por lead, motivo +
                                     sugestão de abordagem humanizada — mesma seção acima
supabase/functions/ia-sugerir-resumo/ → Edge Function: complementa (ou sugere do zero) o
                                     Resumo/Anotações do lead a partir das últimas mensagens
                                     de WhatsApp — nunca salva sozinho; ver seção "Segunda
                                     rodada de incrementos"
supabase/functions/classificar-resposta-convite/ → Edge Function: classifica resposta de
                                     convite de evento por IA (categoria fixa + texto
                                     sugerido), chamada por cron; ver seção "Classificação
                                     de Respostas de Convite (IA)"
supabase/functions/sugerir-resposta-whatsapp/ → Edge Function: sugere resposta por IA pra
                                     QUALQUER lead que respondeu no WhatsApp (não só convite
                                     de evento), chamada por cron; ver seção "Sugestão de
                                     resposta por IA no WhatsApp"
supabase/functions/whatsapp-backfill-midia/ → Edge Function de manutenção pontual (não é
                                     cron): baixa mídia de áudio/imagem/documento recebidos
                                     ANTES de baixarEArmazenarMidiaRecebida() existir; ver
                                     seção "Áudio recebido pelo WhatsApp toca de verdade"
supabase/functions/_shared/midia.ts → baixarEArmazenarMidiaRecebida() — baixa mídia recebida
                                     da Graph API e re-hospeda no bucket whatsapp-midia;
                                     compartilhada entre whatsapp-webhook e
                                     whatsapp-backfill-midia
supabase/functions/_shared/anthropic.ts → chamarClaude() — chamada centralizada à Anthropic
                                     API (cache de prompt via blocoCacheavel/blocoDinamico +
                                     log real de uso em ia_uso_tokens); ver seção "Custo da
                                     Anthropic API — visibilidade real + cache de prompt"
supabase/functions/whatsapp-marcar-lido/ → Edge Function: marca uma mensagem recebida como
                                     lida na Meta (✓✓ azul do lado do lead) — endpoint próprio
                                     da Graph API, chamada ao abrir uma conversa; ver seção
                                     "Vídeo/figurinha/localização, leitura ativa..."
supabase/functions/whatsapp-reenviar-falhas/ → Edge Function: reenvia automaticamente (cron
                                     3h) mensagens que falharam por motivo TEMPORÁRIO (fatura
                                     em aberto/limite de taxa) — nunca número sem WhatsApp de
                                     verdade; ver seção "Reenvio automático de falhas"
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
migracao_turmas.sql               → tabela turmas (nome/dia/horário por filial),
                                     sincronizada automaticamente pelo scraper do
                                     Mercúrio (sem tela própria no CRM desde
                                     2026-09-21, ver seção "Mapa de Turmas —
                                     REMOVIDO"); rodar manualmente
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
migracao_whatsapp_importacao_lote.sql → telefone_whatsapp deixa de ser NOT NULL +
                                     nome_bruto_importado + lote_importacao_id em
                                     mensagens_whatsapp (base da Importação em Lote de
                                     Conversas, .zip); JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
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
migracao_rpc_aniversariantes.sql  → função aniversariantes_por_mes() — filtra por mês/filial
                                     direto no banco, corrige truncamento silencioso do limite
                                     de 1000 linhas do PostgREST (ver seção "Agenda do Dia");
                                     ganhou como_prefere_ser_chamado 2026-09-28 (nome do botão
                                     "Enviar" de aniversário); JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_lead_cidade_uf.sql       → colunas cidade/uf/telefone_alternativo em leads_inscricoes —
                                     capturadas pelo scraper do Mercúrio na tela ENDEREÇOS da
                                     ficha do aluno, só no Modo Completo (ver seção "Scraper
                                     Ulisses/Mercúrio — reformulação do Mercúrio"); JÁ RODADA
                                     nesta sessão via `supabase db query --linked`
migracao_lixeira_lead.sql         → coluna lixeira_em em leads_inscricoes + função
                                     limpar_lixeira_leads_vencidos() + cron job diário (apaga
                                     quem está na lixeira há 30+ dias; ver "Lixeira de Leads");
                                     JÁ RODADA nesta sessão via `supabase db query --linked`
migracao_link_inscricao_evento.sql → coluna link_inscricao em eventos (URL pública de
                                     inscrição, editável no modal de Evento da Agenda) — vira
                                     {linkInscricao} nas mensagens de convite via WhatsApp; JÁ
                                     RODADA nesta sessão via `supabase db query --linked`
migracao_modelos_mensagem_whatsapp.sql → tabela modelos_mensagem_whatsapp (modelos de convite
                                     editáveis pelo CRM, "Gerenciar Mensagens" — ver seção
                                     "Convites em massa via wa.me"), já vem com 3 modelos
                                     (seed); JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_lgpd_remocao_contato.sql → tabelas contatos_removidos_lgpd (bloqueia reimportação
                                     futura de quem pediu remoção) e fila_desativacao_ulisses
                                     (tarefa pendente processada pela rodada semanal do
                                     scraper — ver seção "Remoção a Pedido do Lead (LGPD)");
                                     JÁ RODADA nesta sessão via `supabase db query --linked`
migracao_como_prefere_ser_chamado.sql → coluna como_prefere_ser_chamado em leads_inscricoes
                                     (editável na gaveta, tem prioridade sobre o primeiro
                                     nome em qualquer {nome} automático de convite); JÁ
                                     RODADA nesta sessão via `supabase db query --linked`
migracao_rpc_leads_ativos_inativos.sql → função leads_ativos_inativos_da_filial() — usada
                                     por carregarAtivosInativosSemPaginacao() (js/app.js)
                                     pra pré-carregar tags Ativo/Inativo fora da paginação
                                     principal (mesmo problema/solução de Matriculados); JÁ
                                     RODADA nesta sessão via `supabase db query --linked`
migracao_rede_ativos_inativos.sql → tabela pessoas_ativas_rede (status Ativo/Inativo
                                     independente de filial, alimentada pelo scraper do
                                     Mercúrio — ver seção "Rede de Ativos/Inativos"); JÁ
                                     RODADA nesta sessão via `supabase db query --linked`
migracao_credenciais_scraper_ulisses_api.sql → alarga a constraint de "sistema" em
                                     credenciais_scraper pra aceitar 'ulisses_api'
                                     (client_id/client_secret da API oficial do Ulisses,
                                     OAuth2 Client Credentials — ver seção "API oficial do
                                     Ulisses"); JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_equipes.sql              → tabela equipes (Agência/Voluntários, seed inicial) +
                                     coluna equipe_id em usuarios_crm — base do módulo de
                                     Tarefas, rodar ANTES de migracao_tarefas.sql; JÁ RODADA
                                     nesta sessão via `supabase db query --linked`
migracao_tarefas.sql              → tabelas tarefas + tarefa_leads (N:N — 1 tarefa pode ter
                                     vários leads, status de conclusão por lead dentro da
                                     tarefa) — ver seção "Tarefas e Equipes"; JÁ RODADA nesta
                                     sessão via `supabase db query --linked`
migracao_evento_leads_origem.sql  → coluna origem ('ulisses'/'crm') em evento_leads —
                                     distingue inscrição REAL (casada a partir do Ulisses)
                                     de pendência/convite criado por nós no CRM; ver seção
                                     "Origem dos vínculos evento_leads"; JÁ RODADA nesta
                                     sessão via `supabase db query --linked` (+ backfill
                                     rodado à parte, script descartável)
migracao_diagnosticos_ia.sql      → tabela diagnosticos_ia (log do "Diagnóstico de Saúde
                                     (IA)") + RPCs contagem_status_mercurio_por_filial()/
                                     eventos_proximos_sem_inscricao_ulisses(); ver seção
                                     "Diagnóstico de Saúde (IA) e Recomendações de Contato
                                     (IA)"; JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_storage_whatsapp_midia.sql → bucket de Supabase Storage `whatsapp-midia` (público)
                                     + policy — anexo livre de foto/documento no chat do
                                     WhatsApp (enviarComAnexo(), js/whatsapp.js); 1ª vez que
                                     o projeto usa Storage; ver seção "WhatsApp Unificado —
                                     de verdade cross-filial"; JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_whatsapp_reacoes.sql     → coluna reacoes (jsonb) em mensagens_whatsapp — reagir
                                     com emoji a uma mensagem, igual o WhatsApp real; ver
                                     seção "Reações com emoji nas mensagens"; JÁ RODADA
                                     nesta sessão via `supabase db query --linked`
migracao_leads_a_tratar_tags.sql  → coluna pessoa_tags (snapshot) em leads_a_tratar — mostra
                                     as tags de cada membro no card do grupo, antes de
                                     mesclar (ver seção "Leads a Tratar"); JÁ RODADA nesta
                                     sessão via `supabase db query --linked`
migracao_rpc_leads_por_tag.sql    → função leads_por_tag_filial() — "Convidar em Massa" por
                                     segmento/tag, sem precisar selecionar no Kanban antes
                                     (ver seção "Convites em Massa via API"); JÁ RODADA nesta
                                     sessão via `supabase db query --linked`
migracao_classificacao_respostas_convite.sql → tabela classificacoes_resposta_convite +
                                     função mensagens_candidatas_classificacao_convite() —
                                     classificação de resposta de convite por IA (ver seção
                                     própria); JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_agendamento_classificacao_respostas.sql → cron job que roda
                                     classificar-resposta-convite a cada 15 min; JÁ RODADA
                                     nesta sessão via `supabase db query --linked`
migracao_sugestao_resposta_ia.sql → coluna ia_sugestao_resposta_habilitada em filiais +
                                     ia_sugestao_resposta em leads_inscricoes (toggles) +
                                     tabela sugestoes_resposta_wpp; ver seção "Sugestão de
                                     resposta por IA no WhatsApp"; JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_rpc_candidatas_sugestao_resposta.sql → função
                                     mensagens_candidatas_sugestao_resposta(), rodar depois
                                     da migração acima; JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_agendamento_sugestao_resposta.sql → cron job que roda
                                     sugerir-resposta-whatsapp a cada 15 min; JÁ RODADA nesta
                                     sessão via `supabase db query --linked`
migracao_whatsapp_reenvio_automatico.sql → colunas tentativas_reenvio/
                                     ultima_tentativa_reenvio_em em mensagens_whatsapp + novo
                                     valor 'reenviada' no check de wa_status; ver seção
                                     "Reenvio automático de falhas"; JÁ RODADA nesta sessão
                                     via `supabase db query --linked`
migracao_rpc_falhas_retriaveis.sql → função mensagens_falhas_retriaveis(), rodar depois da
                                     migração acima; JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_agendamento_reenvio_falhas.sql → cron job que roda whatsapp-reenviar-falhas a cada
                                     3h; JÁ RODADA nesta sessão via `supabase db query --linked`
migracao_rpc_duplicados_entre_filiais.sql → função duplicados_entre_filiais() — mesmo
                                     telefone em 2+ filiais diferentes, seção "Duplicados
                                     Entre Filiais" em Leads a Tratar; JÁ RODADA nesta sessão
                                     via `supabase db query --linked`
migracao_whatsapp_pin_arquivar_ocultar.sql → colunas wpp_fixado/wpp_arquivado em
                                     leads_inscricoes + oculta_em em mensagens_whatsapp
                                     (+ policy de UPDATE nova) — pin/arquivar conversa e
                                     ocultar mensagem enviada, ver seção "WhatsApp — últimos
                                     itens de paridade com o app real"; JÁ RODADA nesta sessão
                                     via `supabase db query --linked`
migracao_whatsapp_snooze_fila_ultimo_contato.sql → colunas wpp_silenciado_ate/
                                     wpp_atendente_responsavel/ultimo_contato_em em
                                     leads_inscricoes — silenciar conversa, fila de
                                     distribuição automática e "último contato"; ver seção
                                     "Segunda rodada de incrementos"; JÁ RODADA nesta sessão
                                     via `supabase db query --linked`
migracao_respostas_rapidas_whatsapp.sql → tabela respostas_rapidas_whatsapp (canned
                                     responses, com seed de 3 modelos); JÁ RODADA nesta
                                     sessão via `supabase db query --linked`
migracao_mencoes_resumo.sql       → tabela mencoes_resumo (@menção de usuário no
                                     Resumo/Anotações do lead); JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_auto_arquivar_conversas_whatsapp.sql → função
                                     arquivar_conversas_whatsapp_inativas() + cron job diário
                                     (08:30 Brasília); JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_rpc_relatorios_whatsapp.sql → funções sla_primeira_resposta_whatsapp()/
                                     desempenho_atendentes_whatsapp()/
                                     volume_whatsapp_por_periodo() — 3 relatórios novos na
                                     aba Relatórios; JÁ RODADA nesta sessão via
                                     `supabase db query --linked`
migracao_evento_id_ulisses.sql    → coluna evento_id_ulisses em eventos — resolve
                                     comparecimento via API oficial do Ulisses (antes só
                                     Playwright/ulisses-local.js); ver seção "Comparecimento
                                     via API do Ulisses — RESOLVIDO"; JÁ RODADA nesta sessão
                                     via `supabase db query --linked`
```

## Ferramentas locais (fora do site publicado)

```
tools/lint/verificar-globais.mjs  → verificador estático sem dependências (npm install não
                                     funciona neste drive) — pega variável indefinida dentro
                                     de template literals (${nome}); ver seção "'O que pode
                                     melhorar' — rodada de dívida técnica". Roda com
                                     `node tools/lint/verificar-globais.mjs`, sem instalar nada.
                                     Pasta ISOLADA de propósito — nunca um package.json na
                                     raiz do repo (mudaria a detecção zero-config do Vercel).
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
- `como_prefere_ser_chamado` (text, nullable, `migracao_como_prefere_ser_chamado.sql`
  — pedido do usuário 2026-09-17): "para pessoas que não gostam de ser
  chamadas por um dos nomes, ou outra situação similar" (nome social,
  apelido etc.). Editável no topo do bloco "Contato" da gaveta
  (`salvarComoPrefereSerChamadoLead()`, `js/app.js`) — quando preenchido,
  também aparece direto no CABEÇALHO da gaveta (`"Fulano (chamar de
  'X')"`), sem precisar abrir "Contato" pra descobrir antes de ligar/
  mandar mensagem. Tem PRIORIDADE sobre o primeiro nome em qualquer
  `{nome}` automático — `nomeParaChamar(lead)` (`js/app.js`, usada por
  `preencherValorAutomatico()`/`montarTextoConviteEvento()`/
  `confirmarConviteComFoto()` em `js/whatsapp.js`) devolve o valor deste
  campo quando preenchido, senão cai no primeiro nome de sempre
  (`primeiroNomeFormatado()`). Vazio = comportamento idêntico ao de
  antes.

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
  `colunasPadrao()` (`js/app.js`) só vale pra board NOVO (localStorage
  vazio) — mudar essa lista NÃO aparece sozinha em quem já tem colunas
  salvas; pra adicionar numa conta que já usa o CRM, é sempre manual
  ("Gerenciar Colunas" → "+ Nova Coluna"). 5ª coluna padrão,
  **"Truncados"** (pedido do usuário, 2026-09-15): pra lead que nunca foi
  um prospecto válido de verdade (mudou de cidade, respondeu com
  grosseria, é aluno/prospecto de OUTRA escola/franquia) — diferente de
  "Perdido" (que significa "tentamos vender e não deu certo"), essa é
  fora de escopo desde o início. De propósito NÃO entra na heurística de
  `ehColunaPerdido()` (não pede motivo estruturado — "Preço"/"Horário" não
  fazem sentido aqui), é só uma coluna de arquivo.
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
- **Matriculados recém-criado podia ficar invisível em QUALQUER coluna —
  bug real relatado pelo usuário (2026-09-10), raiz diferente do bug
  acima**: como a paginação principal de `carregarLeads()` busca TODOS os
  leads da filial ordenados só por `pessoaIdentificador` (sem filtrar por
  coluna), um lead recém-matriculado cujo id "tardio" nessa ordenação (ex:
  id sintético alto, ou um id do Ulisses maior que o de leads mais
  antigos) simplesmente não estava dentro da janela já carregada em
  `leadsAtuais` — e como o botão "Carregar Mais" só existe na PRIMEIRA
  coluna (hoje "Frios"), o usuário precisava clicar "Carregar Mais" ali
  (nada a ver com Matriculados) só pra essa página adicional trazer, de
  quebra, o lead que faltava em Matriculados. Buscar por nome funcionava
  (`processarBuscaGlobal()`/`processarBuscaColuna()` batem direto no
  banco, sem depender do que já foi paginado) — mas exige já saber o nome,
  não ajuda a DESCOBRIR quem matriculou recentemente. Corrigido
  originalmente só pra "Matriculados" (`carregarMatriculadosSemPaginacao()`,
  achada por substring `matricul`) — **generalizada pra QUALQUER coluna em
  2026-09-18**, depois do usuário reportar o MESMO sintoma numa 3ª coluna
  ("Em Abordagem": só 3 de 8 leads apareciam, e clicar "Carregar Mais" em
  Frios — sem nada a ver com Abordagem — revelava mais alguns; o usuário
  descreveu como "a coluna Em Abordagem está atrelada à coluna Frios",
  mas não é um vínculo entre colunas, é a MESMA paginação global que
  afeta o Kanban inteiro, só que a maioria dos leads "novos" cai mesmo em
  Frios). Trocado por `carregarColunasSecundariasSemPaginacao()`: sempre
  que a filial é (re)carregada (`resetar=true`), busca TODA coluna que
  NÃO seja a 1ª do funil (`validKeys.slice(1)`, paginado 1000 em 1000 por
  coluna) inteira de uma vez, fora da paginação principal — qualquer
  coluna que não seja a 1ª é, por definição, gente já trabalhada (bem
  menos volume que o funil inteiro), então buscar todas de cara é seguro.
  Só a 1ª coluna (o "balde" de leads nunca trabalhados, tipicamente
  "Frios") continua paginada de verdade. A paginação principal deduplica
  por `pessoaIdentificador` antes de concatenar, pra não desenhar o mesmo
  lead 2x quando a janela normal alcança alguém que já tinha sido
  pré-carregado assim.
- **Tags "Ativo"/"Inativo" invisíveis em filiais grandes — MESMA classe do
  bug acima, achado pelo usuário (2026-09-18)**: as tags existem no banco
  (confirmado consultando direto o Supabase), mas nunca chegavam a
  carregar no Kanban — esses leads costumam ter ID SINTÉTICO
  (`900000000+`/`950000000+`, "Ativos/Inativos sem correspondência em
  Inscrições", ver `js/importador.js`), que sorta sempre no FINAL da
  ordenação ascendente por `pessoaIdentificador` usada pela paginação
  principal — atrás de QUALQUER lead com ID real do Ulisses. Confirmado em
  produção: em "Goiânia - Setor Oeste", 925 leads têm ID menor que a faixa
  sintética (carregam primeiro) contra só 174 Ativo/Inativo, todos
  sintéticos — com a página padrão de 500, nenhum deles chegava a
  aparecer, mesmo depois de recarregar a página inteira. Corrigido com o
  mesmo remédio de Matriculados: `carregarAtivosInativosSemPaginacao()`
  (`js/app.js`), chamada também dentro do bloco `if (resetar)` de
  `carregarLeads()`, busca TODOS os leads com a tag `"Ativo"` ou
  `"Inativo"` da filial de uma vez, fora da paginação principal (e
  também paginada em 1000 — o PostgREST trunca em 1000 linhas mesmo numa
  função, e filiais como Jardim América têm 2700+ Ativo/Inativo juntos).
  **Diferente de Matriculados, não dá pra filtrar por `funil_agencia`
  (coluna simples) — precisa filtrar por CONTEÚDO de `tags` (jsonb), e
  `.ilike()`/`.or()` do supabase-js direto numa coluna jsonb já deu
  `"operator does not exist: jsonb ~~* unknown"` antes (mesmo motivo de
  `leads_agenda_geral_prioritarios()`)** — por isso existe a função SQL
  `leads_ativos_inativos_da_filial(p_filial)` (`migracao_rpc_leads_ativos_inativos.sql`),
  chamada via `.rpc(...)`, que faz o cast/containment (`(tags #>> '{}')::jsonb
  @> '["Ativo"]'::jsonb`) direto em SQL — a mesma técnica usada nesta
  sessão pra auditar as tags de Setor Oeste, e que funciona tanto se
  `tags` já for um array jsonb de verdade quanto no formato real observado
  em produção (string jsonb contendo o JSON). Testado ao vivo: a função
  devolveu exatamente 174 linhas pra Setor Oeste (80 Ativo + 94 Inativo,
  bate com a contagem já confirmada por SQL direto).
- **Rede de Ativos/Inativos (independente de filial)** — pedido do
  usuário (2026-09-18): "uma aluna ativa do Jardim América participou de
  uma palestra no Setor Oeste e entrou no Ulisses de lá... não deveria
  importar que não é a mesma escola". O 2º lead dela (o de Setor Oeste)
  nunca ganha a tag `"Ativo"` local — o Mercúrio de Setor Oeste não a
  conhece como aluna dele — mesmo sendo a MESMA pessoa, aluna de verdade
  da rede. Resolvido com uma tabela GLOBAL,
  `pessoas_ativas_rede` (`migracao_rede_ativos_inativos.sql`):
  - **Alimentada por** `sincronizarRedeAtivosInativos(filialCrm)`
    (`scraper/mercurio.js`, exportada), chamada como ÚLTIMA etapa do
    processamento de cada filial (depois de Turmas, que já preencheu
    telefone de quem ainda não tinha) — reaproveita a MESMA RPC
    `leads_ativos_inativos_da_filial()` já usada pra corrigir a paginação
    (ver bullet acima). Casada só por **telefone/e-mail normalizados**,
    NUNCA por nome (homônimo entre filiais diferentes é risco real demais
    sem um identificador forte). Upsert manual em JS (busca linha
    existente por telefone OU e-mail batendo, atualiza se achar, cria se
    não) — não dá pra expressar "único por telefone OU e-mail" numa
    constraint simples do Postgres.
  - **Consultada pelo CRM** — `carregarRedeAtivosInativos()` (`js/app.js`,
    chamada 1x no `DOMContentLoaded`, tabela pequena pra rede inteira)
    monta 2 `Map`s (por telefone/por e-mail); `renderizarCards()` usa
    `buscarStatusRedeAtivosInativos(lead)` pra decidir se mostra um badge
    **PRÓPRIO** (pedido explícito do usuário: rotulado, não o mesmo badge
    "Ativo"/"Inativo" normal) — `"Ativo (Jardim América)"`/`"Inativo (X)"`,
    reaproveitando as cores `.tag-ativo`/`.tag-exaluno` + ícone de prédio
    (`fa-building-circle-check`). Só aparece quando o lead NÃO já tem a
    tag local (senão duplicaria o badge de quem já é Ativo/Inativo na
    própria filial) e quando a filial da rede é DIFERENTE da filial do
    lead (senão seria redundante).
  - **Testado ao vivo**: RPC + upsert confirmados rodando contra Setor
    Oeste (175 pessoas sincronizadas). Ainda não confirmado visualmente
    no navegador com um caso real de cross-filial (precisa de alguém que
    bata por telefone/e-mail em 2 filiais ao mesmo tempo pra ver o badge
    na tela) — a próxima vez que a rodada completa do scraper rodar nas 5
    filiais, e alguém encontrar um caso assim navegando o CRM, confirma
    ponta a ponta.
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
    coluna "Nivel" (Ativos) / "Ni" (Inativos): `Merlin` (Távola/Correntinha
    — as 2 turmas do "programa complementar" convergem pro mesmo programa
    de filosofia infantil), `CA` (Círculo de Amigos — complementar também,
    mas categoria própria, não vira "Merlin"), `JN` (Janos, adolescentes),
    `PP` (só o 1º mês, aluno novo ou saiu antes do 2º mês), `N1` (nível de
    entrada, mantido separado) e `Membro` (N2 a N7 unificados — já é
    membro estabelecido, o nível exato de 2 a 7 não muda a abordagem) —
    `classificarNivel()` em `js/importador.js`, badge roxo (`.tag-nivel`).
    Heurística por palavra-chave sobre texto normalizado; quem não bate
    com nenhuma regra fica sem essa tag (não inventa valor errado) —
    conferir a coluna Tags na prévia da importação antes de confirmar o
    envio. **`TA` foi renomeado pra `Merlin`** (2026-09-10, pedido do
    usuário — "Merlin" é o nome real do programa de filosofia infantil,
    mais claro que a sigla interna do Mercúrio) e `CO` (Correntinha) foi
    dobrado na mesma categoria — tag antiga `"TA"` continua reconhecida
    pelo badge/filtro por compatibilidade (`FAMILIAS_TAG` em `js/app.js`),
    mas o importador só GERA `"Merlin"`/`"CA"` daqui pra frente.
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
    - **Limpeza pontual — "Lead Forte N"/"Jornada: X" sobrevivendo em
      quem já é Ativo/Inativo (2026-09-28, pedido do usuário: "faça uma
      varredura dos ativos e inativos, e remova tags inadequadas como
      lead forte se é ativo")**: por design, as duas só deveriam existir
      em quem NÃO é Ativo/Inativo (ver bullets acima) — mas um bug já
      corrigido nesta mesma sessão em rodadas anteriores ("1ª versão só
      preservava Ativo/Inativo/Nível e deixava Lead Forte/Jornada livres
      pra recalcular", ver seção "Importação PARCIAL" no Importador)
      deixou resíduo em produção: 84 leads (49 Garavelo, 26 Barra do
      Garças/MT, 5 Setor Oeste, 4 Jardim América) tinham AMBOS —
      "Ativo"/"Inativo" **e** "Lead Forte 1/2/3" e/ou "Jornada: X" ao
      mesmo tempo, incoerente com a lógica documentada. Rodada uma
      varredura pontual (SQL direto, `supabase db query --linked`, não
      pelo importador — é limpeza de dado já existente, não uma mudança
      de comportamento futuro) removendo só essas 2 famílias de tag de
      quem tem `"Ativo"`/`"Inativo"`/os nomes antigos, preservando todo o
      resto (Nível, Trilha, Sem Telefone/E-mail, etc.) — confirmado por
      SELECT antes (84 encontrados) e depois (0 restantes) da correção,
      e uma entrada em `log_atividade` por filial
      (`acao='limpeza_tags_ativo_inativo'`) com a lista de ids afetados.
      Um lead recém-recuperado (Ativo de novo) numa reimportação FUTURA
      já não sofre mais esse problema (bug de origem já corrigido antes
      desta varredura) — isto foi só o acerto do que já estava
      contaminado no banco.
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
  **Filtro por "Resumo da Conversa"** (pedido do usuário, 2026-09-15):
  seção própria no dropdown de Filtros — checkbox "Tem resumo preenchido"
  (`data-tem-resumo`, `1`/`0` conforme `resumo_ia` está vazio ou não) +
  campo de texto "Palavra-chave no resumo" (`data-resumo`, o texto do
  campo em minúsculo, comparado por `.includes()`) — os dois combináveis
  (ex: "tem resumo" + "escola" acha só quem tem anotação mencionando
  "escola"). Mesmo padrão dos outros filtros de campo (Evento/Telefone/
  E-mail): só aplica ao clicar "Aplicar"
  (`aplicarFiltroColunaCampos()`), roda 100% no navegador sobre os cards
  já renderizados (proxy — só verifica quem já foi carregado/paginado
  pra esta coluna, mesmo limite de sempre), não é uma busca no banco
  inteiro como `processarBuscaColuna()`.
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
  **Deseleciona sozinho ao mover** (pedido do usuário, 2026-09-15) —
  `executarMovimentoParaColuna()` (função única por baixo de QUALQUER
  movimentação — botão "Mover", arrastar-e-soltar, "Convidar (Link)"
  movendo pra Abordagem, confirmação de Motivo de Perda) tira os ids
  movidos de `cardsSelecionados` e atualiza a barra — não precisa mais
  desmarcar manualmente depois de mover.
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
- **Novo Lead Manual** (`abrirNovoLeadManual()`, botão "Novo Lead" no
  topo da aba CRM, 2026-09-10): cadastra um lead direto no CRM, sem vir de
  planilha/scraper nenhum (ex: alguém que ligou direto pra escola). Form
  simples (Nome, DDD+Telefone, E-mail) — ID sintético em faixa própria
  (`BASE_ID_LEAD_MANUAL = 985000000`, distinta de todas as outras já em
  uso: 900M/950M do importador, 980M da auditoria resgatada, 990M da
  matrícula via print). Ganha a tag de sistema **`"CRM"`**
  (`TAG_LEAD_MANUAL`, badge próprio `.tag-crm`) — **permanente**: bloqueada
  tanto pra adicionar à mão em outro lead (`confirmarNovaTag()`) quanto pra
  remover (`removerTag()`) — só some se o lead inteiro for apagado (Lixeira
  ou Zona de Perigo). Cai na primeira coluna do funil (`columnsConfig[0]`),
  mesmo destino de um lead novo vindo da importação.
- **Lixeira de Leads** (`abrirLixeira()`, botão "Lixeira" no topo da aba
  CRM + botão na barra de seleção em massa + ícone na gaveta do lead,
  2026-09-10): soft-delete com expiração automática — mover um lead pra lá
  (`moverParaLixeira()`) grava `lixeira_em = now()`
  (`migracao_lixeira_lead.sql`) sem apagar nada; o lead some do Kanban e
  das buscas (global/por coluna) na hora, mas fica visível/restaurável na
  tela "Lixeira" por **30 dias**. Depois disso, um **cron job dentro do
  próprio Postgres** (`limpar_lixeira_leads_vencidos()`, `pg_cron`, todo
  dia 09:00 Brasília — mesmo padrão já usado pro disparo diário do
  Mercúrio) apaga de vez sozinho, sem depender de ninguém abrir o CRM;
  registra 1 linha em `log_atividade` (`filial='GLOBAL'`,
  `acao='lixeira_expirada_apagada'`) só quando apaga alguém. Tela de
  Lixeira lista nome + "some em N dias" de cada lead trashed, com
  "Restaurar" (zera `lixeira_em`) e "Excluir Agora" (delete definitivo
  imediato, com confirmação). **Limitação conhecida, de propósito**: só a
  listagem principal do Kanban e as buscas excluem lead na lixeira —
  relatórios que consultam o banco DIRETO (RPCs da Agenda do Dia,
  Matrículas por Mês, Leads a Tratar) ainda podem contar um lead recém-
  jogado na lixeira até ele ser apagado de vez; aceitável por ora, mesmo
  nível de precisão "proxy" já documentado no resto do app.
- **Remoção a Pedido do Lead (LGPD)** (`abrirRemoverLeadLgpd()`, botão de
  usuário-cortado ao lado do ícone da Lixeira na gaveta do lead,
  `migracao_lgpd_remocao_contato.sql` — pedido do usuário 2026-09-17):
  diferente da Lixeira (reversível, 30 dias) e da Zona de Perigo (apaga a
  filial inteira), isto é "direito ao esquecimento" pontual — a própria
  pessoa pediu pra sair do cadastro. 3 efeitos, nesta ordem:
  1. Grava em `contatos_removidos_lgpd` (nome/telefone/e-mail
     normalizados, por filial) — consultada por
     `confirmarEnviarImportacao()` (`js/importador.js`) ANTES de enviar
     qualquer lead ao Supabase: quem bate (telefone/e-mail normalizado, ou
     nome normalizado quando a remoção foi salva sem contato — mesma
     hierarquia de confiança de "Leads a Tratar") é PULADO e contado num
     aviso no log — nunca mais recriado sozinho numa reimportação futura
     do Ulisses/Mercúrio.
  2. Enfileira em `fila_desativacao_ulisses` (`status='pendente'`,
     nome + telefone pra busca) — o Ulisses tem sua PRÓPRIA ação de
     desativar contato (ver abaixo), mas só dá pra automatizar em modo
     ASSISTIDO (mesma limitação de sempre — Cloudflare barra acesso 100%
     automático); em vez de abrir um Chromium na hora, a tarefa fica
     pendente e é processada sozinha na PRÓXIMA rodada de
     `npm run ulisses-local` daquela filial.
  3. Apaga a linha de `leads_inscricoes` de vez (sem Lixeira — é
     definitivo, por isso o `confirm()` é bem explícito sobre as 3
     consequências antes de agir).
  - **Lado do Ulisses** (`processarFilaDesativacaoUlisses()`,
    `scraper/ulisses.js`, chamada como última etapa de
    `processarFilialLocal()` em `scraper/ulisses-local.js` — já dentro da
    mesma sessão logada, sem navegação/login extra): a tela real é
    `#/telemarketing` (HTML confirmado pelo usuário) — cada contato tem um
    link vermelho "Desativar contato" (`ng-click="naoPertube(contato)"`)
    que liga `contato.desativado` + `contato.motivo = 'Não Pertube'` — é
    uma flag do CONTATO (não da inscrição/evento específico). A função usa
    a caixa "Busca geral por nome, email, telefone e evento e observação"
    (`page.getByPlaceholder(/busca geral/i)`) — tenta primeiro por
    TELEFONE, só cai pro NOME se o telefone não achar nada — e só clica em
    "Desativar contato" quando a busca acha **exatamente 1** contato ATIVO
    (`a:visible` — filtra quem já foi desativado antes, o link deles já
    não existe mais visível, vira o label "Não pertube"). Best-effort,
    nunca arrisca a pessoa errada: 0 encontrado vira `nao_encontrado`, 2+
    batendo vira `ambiguo` (nenhum é clicado), e cada tentativa grava
    `status`/`observacao`/`processado_em` na própria linha da fila, pra dar
    pra auditar depois quem foi de fato desativado. **Limitação aceita, não
    confirmada**: não sabemos com certeza se essa busca enxerga contatos de
    QUALQUER evento ou só do evento selecionado no combo do topo — se
    sobrar gente "não encontrado" com frequência, pode ser esse o motivo
    (revisar manualmente pela tela normal do Ulisses nesse caso).
  - **Log de Atividade**: `acao='remocao_lgpd'` grava `nome`/`telefone`
    direto em `detalhes` (não confia em resolver por `pessoa_ids` depois —
    o lead já foi apagado quando alguém for ler o log, a resolução normal
    acharia "não encontrado").
  - **Ainda NÃO testado ao vivo** contra o Ulisses real (a automação da
    tela `#/telemarketing` foi escrita a partir do HTML real mandado pelo
    usuário, mas nunca clicada de verdade em produção) — a próxima rodada
    de `ulisses-local.js` com 1+ item pendente na fila valida.
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
  - **Bug real GRAVÍSSIMO, caso INVERSO deste (2026-09-14, confirmado em
    produção rodando o Ulisses do Garavelo de verdade)**: o bloco acima só
    tratava "lead sintético novo → existente" — nunca a direção oposta,
    "lead com ID REAL do Ulisses → um lead SINTÉTICO que já existia" (ex:
    alguém já era Ativo/Inativo pelo Mercúrio, sem telefone/e-mail do
    Ulisses ainda, e essa importação trouxe o registro REAL dela do
    Ulisses pela 1ª vez). Sem cobrir essa direção, cada pessoa nessa
    situação virava um par duplicado — confirmado 182 pares assim numa
    ÚNICA importação (Garavelo, depois de rodar o Ulisses pela 1ª vez
    numa filial que já tinha meses de Mercúrio Modo Completo acumulado).
    **Corrigido** com um 2º bloco simétrico, logo depois do primeiro:
    mesma trava de confiança (só redireciona com EXATAMENTE 1 candidato),
    mas os candidatos ficam restritos a quem JÁ É sintético (nunca
    redireciona pra um lead que já tinha `pessoaIdentificador` real —
    mesclar 2 cadastros reais do Ulisses é um risco diferente, fora
    do escopo deste fix). **Os 182 pares já existentes no Garavelo
    continuam lá** (esse fix só previne NOVOS casos dali pra frente) —
    decisão do usuário: corrigir a causa raiz primeiro, decidir depois
    se/como mesclar os que já existem (individualmente via "Leads a
    Tratar", ou uma mesclagem em lote ainda não construída).
  - **Consequência direta**: com o bug corrigido, ficou seguro ligar a
    importação de Ativos/Inativos no job DIÁRIO automático do scraper —
    ver `importarNoCrm()` dentro de `main()` em `scraper/mercurio.js`
    (seção do scraper) e "Inscrito: Abertura de Turma" logo abaixo.
  - **Bug real #3 (2026-09-10, achado em produção)**: mesmo com o bug #2
    corrigido, a importação automática travou de verdade em 2 filiais
    (Barra do Garças/MT e Goiânia - Garavelo) com o erro do Postgres
    `"ON CONFLICT DO UPDATE command cannot affect row a second time"` —
    significa que o LOTE enviado ao `.upsert()` tinha 2+ linhas com o
    MESMO `pessoaIdentificador` (o Postgres recusa o lote INTEIRO nesse
    caso, não só a linha repetida). Investigação extensa (replicando a
    lógica de redirecionamento em Node contra os CSVs reais exportados
    daquela rodada, via artifact do GitHub Actions, e contra um dump dos
    leads existentes) não conseguiu isolar 100% a origem exata do
    duplicado com o snapshot do banco já um pouco adiante no tempo — mas
    achou evidência de que a filial já tem leads DUPLICADOS de antes
    desta sessão (ex: "CELSO JESUS MORAIS" existe 3x com
    `pessoaIdentificador` diferentes em Barra do Garças — resíduo do Bug
    #2 de quando ele ainda não existia, cada rodada só-Mercúrio antiga
    criando um sintético novo). O redirecionamento por nome corretamente
    SE RECUSA a redirecionar quando há homônimo ambíguo (>1 candidato),
    então esse resíduo específico não é redirecionado — mas não dá pra
    garantir que outro padrão parecido não gere 2 redirecionamentos pro
    MESMO alvo em condições de dado ainda não replicadas. **Resolvido com
    uma rede de segurança, não uma correção pontual**: antes do
    `.upsert()`, `registrosFinais` passa por um `Map` por
    `pessoaIdentificador` (fica só 1 registro por id, o último) — se
    houver qualquer duplicado, um aviso aparece no log em vez da
    importação INTEIRA falhar. Não elimina o problema de origem (leads
    duplicados antigos ainda precisam de uma limpeza manual/mesclagem via
    "Leads a Tratar" em algum momento), mas garante que 1 duplicado
    nunca mais trava a importação de uma filial inteira.
  - **Bug real #6, GRAVÍSSIMO (2026-09-17) — mesma classe do Bug #3, mas
    contra o banco, não dentro do lote**: a rede de segurança de
    `matricula_mercurio` acima só dedupa duplicado DENTRO do próprio lote
    desta importação — nunca contra o que JÁ EXISTE no banco. Quando o
    Mercúrio reaproveita um número de "Matr." (aluno antigo saiu, outro
    entrou depois com o MESMO número) e o lead antigo ainda guarda esse
    `matricula_mercurio` no CRM, o upsert do lead novo com a mesma
    matrícula colide com a constraint única (`uq_leads_matricula_mercurio`)
    — e como é 1 único `.upsert()` em lote, isso derruba o LOTE INTEIRO
    (confirmado em produção, lendo os logs reais do GitHub Actions: "Erro
    no lote 0–500: duplicate key value violates unique constraint
    'uq_leads_matricula_mercurio'" — Jardim América, 2713 leads, e
    Garavelo, 92 leads, TODO DIA em que 1 caso desses aparecer, sem
    NENHUM Ativo/Inativo sendo atualizado pra essas 2 filiais enquanto
    isso). Foi a causa real de "as outras escolas estão sem leads
    ativos/inativos marcados" — as tags não somem, ficam desatualizadas
    porque a importação diária falha silenciosamente (GitHub Actions
    mostra ✅ verde mesmo assim, o erro só aparece dentro do log do
    passo). **Corrigido**: `confirmarEnviarImportacao()` agora cruza
    `registrosDedupe` contra `existentes` (já buscado no topo da função,
    já trazia `matricula_mercurio`) — se uma matrícula do lote atual já
    pertence a um `pessoaIdentificador` DIFERENTE no banco, libera essa
    matrícula do lado ANTIGO (`update matricula_mercurio = null`) ANTES
    do upsert do lote, com aviso no log de quantas foram "realocadas".
    Corrige o bloqueio de origem pra sempre — não só esta rodada.
    **Ainda não testado ao vivo** (corrigido a partir da leitura do log
    real, não reproduzido isoladamente) — a próxima reimportação de
    Jardim América/Garavelo confirma.
  - **Bug real #4, GRAVÍSSIMO (2026-09-10) — CAUSA RAIZ do Bug #3 e de
    vários sintomas relatados pelo usuário**: `exportarAtivosEInativos()`/
    `exportarAniversariantes()`/`processarMatriculasRecentesTurmas()`
    (`scraper/mercurio.js`) recebiam um `indice` numérico (posição do link
    "CADASTRO" daquela filial na tela `ger_funcao.php`) capturado UMA VEZ,
    antes do laço de `main()` percorrer as 4 filiais — mas a página
    recarrega essa mesma tela várias vezes entre uma filial e outra
    (`page.goto(URL_FUNCOES, ...)`). Nada garante que a ORDEM dos links
    seja estável entre um carregamento e outro — e não é: confirmado lendo
    `log_atividade` (as mesmíssimas contagens — "171 enviados, 77 ativos,
    94 ex-aluno" — batendo tanto pra "Goiânia - Setor Oeste" quanto pra
    "Barra do Garças/MT" no mesmo dia, em rodadas diferentes). Resultado:
    o scraper às vezes lia os dados REAIS de uma filial mas importava
    tudo no CRM sob o NOME de outra. Como o Mercúrio Ativos-sem-
    correspondência gera um `pessoaIdentificador` SINTÉTICO (900000000+)
    quando não acha a pessoa já cadastrada NAQUELA filial (nunca sobrescreve
    o registro real da pessoa, que continua correto na filial de verdade)
    — o efeito prático não foi "corromper" os leads certos, foi CRIAR
    LEADS FANTASMAS/duplicados: gente de uma filial aparecendo (com id
    sintético, sem telefone/e-mail) na Kanban de outra. Explica: alunos
    Ativos de Setor Oeste aparecendo em Barra do Garças; muito
    provavelmente também explica os "leads duplicados antigos" do Bug #3
    acima (ex: "CELSO JESUS MORAIS" 3x) — mesmo mecanismo, rodadas
    anteriores a esta sessão. **Corrigido**: as 3 funções agora recebem só
    o `label` (nunca mais um índice que atravessa reloads) e resolvem o
    índice ATUAL chamando `listarLinksCadastro()` de novo bem ali, no
    MESMO carregamento de página onde vão clicar — sem navegação alguma
    entre "descobrir o índice" e "usar o índice", não tem como desalinhar.
    Não foi possível testar contra o Mercúrio real (não temos acesso;
    o bug só se manifesta entre múltiplas filiais/reloads reais) — a
    próxima rodada do job diário valida.
  - **Bug real #5, GRAVÍSSIMO (2026-09-11) — raiz DIFERENTE do Bug #4
    acima, mesma classe de sintoma (dados de uma filial contaminando
    outra)**: `BASE_ID_ATIVOS_SEM_INSCRICAO + idxAtivo`/
    `BASE_ID_INATIVOS_SEM_INSCRICAO + idxInativo` (`js/importador.js`) —
    o índice sequencial (`idxAtivo`/`idxInativo`, 1, 2, 3...) usado pra
    montar o `pessoaIdentificador` sintético de quem está em Ativos/
    Inativos mas não bate com Inscrições — **não tinha NENHUMA referência
    à filial**. A 1ª pessoa "sem correspondência" de QUALQUER filial
    sempre virava `900000001`, a 2ª `900000002`, etc. — o MESMO número,
    em filiais diferentes. Como o envio faz `upsert` por
    `pessoaIdentificador` (chave única GLOBAL da tabela, não por filial —
    ver topo deste arquivo), a filial que importa DEPOIS sobrescreve
    silenciosamente os leads da filial que importou ANTES, sem erro
    nenhum. **Confirmado em produção**: a 1ª importação completa do
    Garavelo (92 pessoas, ids `900000001-32`/`950000001-60`) sobrescreveu
    92 leads de Barra do Garças/MT que já ocupavam exatamente esses
    mesmos ids — usuário reportou "sumiram os leads de Barra do Garças" e
    identificou sozinho que a contagem batia exatamente com o total
    importado do Garavelo. Diferente do Bug #4 (que criava DUPLICATAS
    fantasmas, preservando o registro original intacto na filial certa),
    este aqui **sobrescreve e perde** o conteúdo original — a linha
    continua existindo (mesmo `pessoaIdentificador`), só passa a
    representar outra pessoa, de outra filial. **Corrigido** com
    `offsetSinteticoFilial(filialDestino)`: reserva 1.000.000 de ids por
    filial dentro de cada faixa (900M/950M), baseado em `filiais.id`
    (inteiro pequeno e ESTÁVEL — nunca reciclado pelo Postgres mesmo se a
    filial for desativada; bem mais seguro que a posição na lista
    carregada, que o usuário pode reordenar em "Gerenciar Filiais" a
    qualquer momento). Mesmo fix aplicado em `resgatarLinhaAuditoria()`
    (`BASE_ID_AUDITORIA_RESGATADA + indice`, mesmo risco). **Recuperação**:
    como o Mercúrio continua com os dados corretos (nada foi perdido do
    lado de LÁ), bastou reimportar a filial afetada depois do fix —
    qualquer edição MANUAL feita no CRM especificamente nos 92 leads
    atingidos (tag customizada, resumo_ia, funil_agencia movido à mão)
    antes da colisão não é recuperável por reimportação (Mercúrio não
    carrega isso), mas o risco real disso ali era baixo (filial ainda em
    fase de teste). **Lição pra qualquer id sintético futuro**: nunca
    basear em um contador que reseta a cada importação sem misturar
    alguma referência estável à filial — `js/matricula-importar.js`
    (faixa `990000000+`) usa um sorteio aleatório num range de 9 milhões
    em vez de um contador sequencial, o que reduz (mas não elimina) o
    mesmo risco — ver comentário próprio nesse arquivo, ainda não
    corrigido, risco considerado baixo pela raridade do caminho ("novo
    lead" dentro da importação de matrícula via print) e por já usar
    randomização em vez de um contador previsível.
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
- **Ordenação com "Mostrar Passados" — pedido do usuário (2026-09-10)**:
  antes, `renderizarListaEventos()` ordenava TUDO (futuro + passado, com
  "Mostrar Passados" ligado) num único `.sort()` ascendente — abrir a
  lista completa mostrava o evento mais ANTIGO da filial no topo, exigindo
  rolar a lista toda pra achar algo recente. Corrigido separando em 2
  blocos: futuros continuam ascendentes (o mais próximo primeiro — "o que
  vem a seguir"), passados agora descendentes (o mais recente primeiro,
  descendo pros mais antigos) — concatenados como `[...futuros,
  ...passados]`, então a lista sempre abre com o que é mais relevante
  AGORA (o próximo evento a acontecer) e, rolando, cai no passado mais
  recente antes do mais antigo.
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
  **Pedido do usuário (2026-09-14)**: gaveta "Eventos" agora abre por
  padrão (`gavetaLeadAberta.eventos = true` em `abrirGaveta()`,
  `js/app.js` — mesmo padrão de "Tags") e `carregarEventosDoLead()`
  reordena a lista (futuros primeiro, mais próximo no topo; depois
  passados, mais recente primeiro — mesmo critério de
  `renderizarListaEventos()` na Agenda), com um badge "Futuro"
  (`.tag-jornada`) em cada item ainda por vir — antes a lista só seguia
  `criado_em`, podia esconder um evento futuro relevante embaixo de
  vários passados.

## Importar Matrícula (`js/matricula-importar.js`)

Pensado originalmente pra registrar matrícula em lote a partir do texto
copiado da tela "Aluno => Matricular" do Mercúrio, sem digitar nada
manualmente — **o botão que abria essa tela saiu do Kanban** (ver
"Botão removido do Kanban" logo abaixo); a lógica/modal continuam
existindo e funcionais, só que hoje só são acionados pelo scraper.

**Botão removido do Kanban**: agora que existe o disparo do Mercúrio sob
demanda ("Sincronização Automática" na aba Importar, ver seção do
scraper) e a varredura diária às 5h já detecta matrícula nova sozinha
(`processarTurmas()`, `scraper/mercurio.js` — renomeada de
`processarMatriculasRecentesTurmas()` em 2026-09-10, ver seção "Scraper
Ulisses/Mercúrio — reformulação do Mercúrio"), colar o
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
  - **Bug real relatado pelo usuário (2026-09-10): a entrada não dizia
    QUEM** — `mover_lead` mostrava só "1 lead(s) · novaColuna: Matriculados
    · colunasAnteriores: [Frios]", sem nome nenhum, inútil pra auditoria de
    verdade ("qual lead foi movido?"). Corrigido: `carregarLogAtividade()`
    resolve `pessoa_ids` -> nome em 1 query em lote
    (`resolverNomesLeadsLog()`) e `formatarDetalhesLog()` monta uma frase
    por tipo de `acao` em vez do dump genérico "chave: valor" — ex: "moveu
    **Fulano de Tal** de Frios para Matriculados". Cada nome é um link
    clicável (`renderizarNomesLog()`, chama `abrirResultadoBuscaGlobal()`)
    que abre o lead na hora; id sem nome resolvido (lead já apagado/
    mesclado desde então) mostra "lead #ID (não encontrado)" em vez de
    sumir. Ação em massa mostra só os 6 primeiros nomes + "e mais N"
    (`LIMITE_NOMES_LOG_ATIVIDADE`), pra não virar um bloco gigante numa
    edição de tag em 500 leads.
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
  `crm_acesso` (usuario + senha) via a própria tela/Edge Function.
  **Armadilha real**: a senha da conta em `usuarios_crm` e a senha
  guardada no cofre (`credenciais_scraper`, sistema `crm_acesso`) são 2
  lugares INDEPENDENTES — se alguém usar "Resetar Senha" (🔑) na linha
  "Scraper Automatico" dentro de "Gerenciar Usuários" sem também
  atualizar o cofre, o login do scraper passa a falhar (silenciosamente
  do ponto de vista do robô: o clique em "Entrar" simplesmente não some
  a tela, e `abrirCrmComAcesso()` estoura o timeout de 10s esperando o
  portão fechar) — foi exatamente o que aconteceu 2026-09-10 (achado lendo
  o log real do GitHub Actions: `locator.waitFor: Timeout 10000ms
  exceeded` nas 4 filiais). Se isso acontecer de novo: gere uma senha
  nova, grave em `usuarios_crm` (hash SHA-256) E no cofre (`gerenciar-credenciais`,
  `{sistema:'crm_acesso', usuario:'Scraper Automatico', senha:...}`) NA
  MESMA hora — nunca só um dos dois. Ajuste
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
- **Novo módulo adiciona um 9º ícone/aba** (`tab-tarefas`) — ver seção
  "Tarefas e Equipes" abaixo. **Armadilha real, já corrigida nesta
  sessão**: adicionar uma aba nova ao código NÃO a torna visível pra
  quem já tem conta — `modulos` é um array gravado no BANCO por usuário
  (`usuarios_crm.modulos`), só populado com os módulos que existiam no
  momento em que a conta foi criada/editada pela última vez. Sem
  atualizar isso manualmente, o próprio admin (`"Henrique"`) e a conta
  `"Scraper Automatico"` ficariam sem ver `tab-tarefas` mesmo sendo
  admin — corrigido adicionando `'tab-tarefas'` ao `modulos` dos dois
  direto no banco (mesmo remédio de sempre: "Gerenciar Usuários" →
  marcar o checkbox do módulo novo pra cada conta que precisar dele,
  incluindo contas que já existiam antes desta sessão).

## Tarefas e Equipes (`js/tarefas.js`)

Pedido do usuário (2026-09-21), parte de uma lista bem maior de ideias de
gestão de time (tarefas, metas, menções/comentários, resumo de trabalho,
espaço de comunicação interna, fluxograma de automação) — mapeadas e
priorizadas ANTES de codificar (ver decisões abaixo), com o usuário
confirmando explicitamente por onde comecei: **"Equipes → Tarefas"**,
deixando os outros pedidos (Metas, Menções/Comentários, Resumos na tela,
Fluxograma de automação "se X então Y") registrados como próximas etapas
naturais, ainda NÃO construídas.

- **Decisões confirmadas com o usuário antes de codificar** (evitou
  retrabalho — mudam a modelagem de dados por completo):
  1. Voluntário usa login NOMINAL COMPLETO (nome+senha), igual já existe
     em `usuarios_crm`/"Gerenciar Usuários" — não um cadastro mais leve
     sem senha. O master de cada escola cria a conta do próprio
     voluntário na mesma tela de sempre.
  2. Uma tarefa pode ter **VÁRIOS leads** (ex: "mandar mensagem pra
     estes 20 leads" = 1 tarefa só) — por isso existe `tarefa_leads`
     (N:N), com o status de conclusão **POR LEAD dentro da tarefa**, não
     1 status pra tarefa inteira (calculado na hora — "3/5 concluídos"
     — nunca guardado separado, pra nunca dessincronizar).
  3. O "fluxograma" pedido é um motor de regras visual ("se X, então
     Y") — o mais arriscado/complexo da lista, fica pra ÚLTIMO, depois
     de Tarefas já existir de verdade (não tem o que orquestrar antes
     disso).
- **Campo de observações no lead — já existe, sem precisar de nada
  novo**: `resumo_ia` ("Resumo da Conversa") e `abordagem_sugerida`
  ("Como Abordar") já são texto livre editável na gaveta hoje — o
  usuário perguntou se isso já existia antes de eu sugerir criar mais um
  campo.

### `equipes` (`migracao_equipes.sql`)

Tabela simples (`id`, `nome`, `ordem`), mesmo padrão de acesso público
de `tags_sugeridas`/`tipos_evento` — editável (criar/renomear/reordenar
por arrastar, remover) em **"Gerenciar Equipes"**
(`abrirGerenciarEquipes()`, botão dentro do modal "Gerenciar Usuários")
sem precisar de sessão de código nova pra uma 3ª equipe um dia. Seed
inicial: `"Agência"` (o time do próprio usuário, atravessa qualquer
filial) e `"Voluntários"` (cada escola cadastra os próprios). Cada
`usuarios_crm` pode ter um `equipe_id` (nullable — continua funcionando
sem isso preenchido), escolhido por um `<select>` na própria linha do
usuário em "Gerenciar Usuários". `equipeId`/`equipeNome` também entram
no objeto salvo em `localStorage` no login (`js/acesso.js`,
`tentarAcesso()`), prontos pra uso futuro (ex: pré-selecionar "minha
equipe" como responsável ao abrir "Nova Tarefa" — ainda não feito, mas o
dado já está disponível).

### `tarefas` + `tarefa_leads` (`migracao_tarefas.sql`)

- **`tarefas`**: `titulo`, `descricao`, `filial` (null = tarefa
  cross-filial, tipicamente da Agência — aparece na lista independente
  de qual filial está selecionada no topbar), `responsavel_usuario_id`
  OU `responsavel_equipe_id` (nunca os dois — a UI só mostra 1 `<select>`
  por vez, conforme o rádio "Pessoa"/"Equipe"/"Sem responsável"),
  `prazo` (date, opcional), `criado_por` (nome de quem criou, mesmo
  padrão de `log_atividade.autor`), `cancelada` (soft — "Cancelar
  Tarefa" no modal de edição só marca esse boolean, nunca apaga a linha
  nem os vínculos).
- **`coluna_gatilho_conclusao`/`coluna_ao_concluir`**: guardam a CHAVE
  crua da coluna do Kanban (`columnsConfig[].key`) — **mesma heurística
  de "guardar o texto e confiar" já usada em TODO o resto do app pra
  colunas** (Motivos de Perda, Matriculados, Recontato, Abordagem,
  Verificar Telefone — nunca existiu uma tabela de "colunas válidas" no
  servidor, colunas são 100% client-side/localStorage, ver bullet
  "Colunas do Kanban são dinâmicas" no topo deste arquivo). Se o usuário
  renomear/apagar a coluna depois de configurar isso numa tarefa, o
  vínculo só some de bater (fica órfão, sem erro) — nunca quebra nada.
- **`tarefa_leads`**: N:N (`tarefa_id`, `"pessoaIdentificador"` — texto,
  SEM FK, mesmo padrão de `evento_leads`), `concluida`/`concluida_em`/
  `concluida_via` (`'manual'` ou `'coluna'`, só informativo — pra saber
  COMO cada item foi concluído olhando a tela).
- **Sincronização BIDIRECIONAL com o Kanban** — o pedido central do
  usuário ("status pode mudar manualmente ou automaticamente quando
  mudamos o lead de coluna, e vice-versa"):
  1. **Mover lead → conclui tarefa**: `sincronizarTarefasAoMoverColuna(ids,
     novaColuna)` (`js/tarefas.js`), chamada de dentro de
     `executarMovimentoParaColuna()` (`js/app.js` — o ÚNICO ponto por
     onde QUALQUER movimentação passa, arrastar-e-soltar/botão "Mover"/
     ações em massa/etc., mesmo ponto único já usado por `log_atividade`)
     — best-effort, nunca impede a movimentação em si. Busca
     `tarefa_leads` ainda não concluídos desses leads, com o `join`
     embutido do PostgREST pra já trazer `tarefas.coluna_gatilho_conclusao`
     junto (`select('..., tarefas(coluna_gatilho_conclusao, cancelada)')`),
     e marca `concluida=true, concluida_via='coluna'` só quem bate com a
     coluna nova.
  2. **Concluir tarefa (manual) → move lead**: `alternarConclusaoTarefaLead()`,
     chamada pelo checkbox de cada lead dentro do modal de edição da
     tarefa — se a tarefa tiver `coluna_ao_concluir` configurada, chama
     `moverLeadsParaColuna([pessoaIdentificador], coluna)` (a MESMA
     função que arrastar-e-soltar/barra de seleção em massa já usam —
     ganha de graça a barra de "Desfazer", o registro em
     `funil_agencia_atualizado_em`/SLA visual, e até o modal de Motivo de
     Perda se a coluna configurada for uma coluna "Perdido").
- **Aba `tab-tarefas`** (9º ícone da sidebar): lista as tarefas
  ativas da filial atual + as cross-filial (`filial is null`), com
  checkbox "Ver de todas as filiais" pra remover esse filtro. Cada card
  mostra responsável, filial, prazo (borda vermelha se atrasada e ainda
  não 100% concluída — mesmo espírito visual do SLA de coluna fria),
  e "X/Y concluído(s)" — clicar abre o modal de edição completo.
- **Modal de Nova/Editar Tarefa**: busca de lead por nome/telefone
  reaproveitando o mesmo padrão de `.or().ilike()` já usado em Vínculo
  Familiar/Leads a Tratar — **sem filial escolhida (tarefa "Agência"),
  busca em TODAS as filiais de uma vez** (mesmo espírito cross-filial já
  usado na Importação em Lote de Conversas de WhatsApp), com a filial de
  cada resultado mostrada pra diferenciar homônimos. Leads NOVOS
  (adicionados nesta sessão do modal) só são de fato vinculados ao
  clicar "Salvar"; leads que JÁ faziam parte da tarefa (modo edição) têm
  o checkbox de conclusão direto na lista, sem precisar salvar de novo.
- **Testado ao vivo, ponta a ponta, em produção** (Playwright contra
  cópia local do CRM, Supabase real, filial Goiânia - Garavelo, leads
  reais revertidos pra coluna original depois do teste): confirmadas as
  DUAS direções da sincronização — (1) criar tarefa com
  `coluna_ao_concluir='Abordagem'`, marcar o checkbox de um lead como
  concluído → `tarefa_leads.concluida_via='manual'` E o lead moveu de
  "Frios" pra "Abordagem" de verdade; (2) criar outra tarefa com
  `coluna_gatilho_conclusao='RSVP'`, mover esse lead pra "RSVP" via
  `executarMovimentoParaColuna()` (mesmo caminho de qualquer
  movimentação real no Kanban) → o item da tarefa marcou
  `concluida=true, concluida_via='coluna'` SOZINHO, sem clicar em nada
  na tela de Tarefas.
- **Não construído nesta rodada** (registrado, não esquecido — próximas
  etapas naturais depois desta base existir):
  - **Metas** (ex: "N contatos hoje", "N inscrições na Abertura de
    Turma") calculadas automaticamente pelo CRM, não reportadas à mão —
    precisa definir de onde vem o sinal de "contato" (hoje `log_atividade`
    registra mudança de coluna/tag, mas não um evento explícito de
    "liguei pra essa pessoa"; pode precisar de uma ação nova, tipo um
    botão "Registrar Contato" na gaveta).
  - **Menções (@usuário) em comentários** — não existe sistema de
    comentário nenhum ainda (nem em tarefa, nem em lead); a Central de
    Notificações (`js/notificacoes.js`) só dispara em 5 gatilhos fixos
    do sistema hoje, precisaria de um 6º gatilho pra "fulano te
    mencionou".
  - **Espaço de comunicação interna** (discutir mudança de sistema,
    atendimento a um lead específico) — cogitado unificar com comentários
    de tarefa (acima), em vez de 2 sistemas de mensagem interna
    separados; decisão de design ainda em aberto.
  - **Resumo do trabalho na TELA** (voluntários pro master da escola,
    todos pro usuário) — já existe a LÓGICA pronta via WhatsApp
    (`resumo-semanal-chefe`, baseada em `log_atividade`), só falta
    expor isso como uma tela/relatório dentro do próprio CRM, com
    filtro por equipe/usuário.
  - **Fluxograma (motor de regras "se X, então Y")** — de propósito por
    último; a ideia é que ele CRIE/CONFIGURE tarefas automaticamente
    (ex: "se lead entra em Perdido, cria tarefa de follow-up pra
    Voluntários em 7 dias") em vez de ser um sistema paralelo.

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

1. **Aniversariantes de Hoje** (todas as filiais) — mesma ideia de
   `atualizarAniversariantes()` (Dashboard por filial), só que sem o
   filtro de `filial` e só o dia de HOJE (não o mês inteiro, já que aqui
   é "agenda do dia"). **Bug real achado em produção (2026-09-10)**: com
   a base já passando de ~3000 leads com `data_nascimento` preenchida
   (bem acima do limite PADRÃO de 1000 linhas por página do PostgREST), o
   `.select()` original vinha TRUNCADO silenciosamente — 3 dos 6
   aniversariantes reais do dia nunca chegavam ao navegador, sem erro
   nenhum aparecendo em lugar nenhum (usuário reportou "só aparecem 3",
   confirmado comparando com uma consulta direta no banco). Corrigido com
   uma função SQL, `aniversariantes_por_mes(p_mes, p_filial default null)`
   (`migracao_rpc_aniversariantes.sql`) — filtra por MÊS (e opcionalmente
   filial) DIRETO NO BANCO; o filtro fino por DIA continua no navegador,
   mas agora sobre um resultado já pequeno. A mesma função também passou
   a alimentar `atualizarAniversariantes()` (Dashboard por filial, antes
   buscava só por filial sem filtro de mês — mesma classe de risco pra
   filiais grandes, mesmo sem ter estourado ainda de verdade). Testado ao
   vivo: os 6 aniversariantes reais do dia (antes só 3 apareciam)
   confirmados na tela depois do fix.
   - **Botão "Enviar" direto na lista** (pedido do usuário, 2026-09-28:
     "coloque uma opção de 'mandar mensagem de aniversário' para todos
     os leads que aparecem no dashboard como 'Aniversariantes de
     Hoje'") — `enviarAniversarioRapido()` (`js/whatsapp.js`, mora lá
     por ser uma ação de envio, reaproveitada tanto aqui quanto no card
     por filial "Aniversariantes do Mês" — `js/app.js`, só nos itens de
     HOJE). Manda o template `aniversario` na hora, sem precisar abrir a
     gaveta antes — `event.stopPropagation()` no botão pra não também
     disparar o clique do item (que abre a gaveta). Depois de enviar,
     tira o lead de uma coluna fria (`moverParaAbordagemAposEnvio()`, ver
     seção própria abaixo).
     - **Bug real corrigido (2026-09-28, mesmo dia)**: o `{nome}` mandado
       pro template `aniversario` vinha do `pessoaNome` CRU (geralmente
       TUDO EM CAIXA ALTA, vindo da planilha) — "com cara de copiado e
       colado", pedido do usuário — em vez de passar pela MESMA política
       já usada em qualquer outro `{nome}` automático do app
       (`nomeParaChamar()`/`primeiroNomeFormatado()`, `js/app.js`: nome
       de preferência se tiver, senão só o primeiro nome, Title Case).
       Corrigido nos 2 pontos que montam o botão "Enviar"
       (`carregarAgendaGeralAniversariantes()` em `js/visao-geral.js`,
       `atualizarAniversariantes()` em `js/app.js`) — a EXIBIÇÃO na lista
       continua mostrando o nome completo (útil pro SDR identificar quem
       é quem), só o valor mandado pro WhatsApp mudou. Exigiu adicionar
       `como_prefere_ser_chamado` ao retorno de `aniversariantes_por_mes()`
       (`migracao_rpc_aniversariantes.sql`, recriada — precisou
       `drop function` antes por mudar o tipo de retorno).
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
6. **Calendário de Eventos Futuros** (`carregarAgendaGeralCalendarioEventos()`,
   2026-09-10, pedido explícito do usuário) — TODOS os eventos com `data
   >= hoje` de TODAS as filiais ATIVAS (cruza com `filiaisDisponiveis`,
   que já só lista as ativas), ordenados cronologicamente. **3 níveis de
   destaque visual** (não é uma pontuação exibida na tela, só prioridade
   de leitura — `_pesoTipoEvento()`): "Abertura de Turma" (peso 2, faixa
   dourada + ícone de capelo, texto maior), "Palestra" (peso 1, faixa
   azul + ícone de apresentação), qualquer outro tipo (peso 0, sem
   destaque, cinza neutro). O peso é decidido pelo NOME EXATO do `tipo`
   (mesma classificação automática por palavra-chave de
   `sincronizarCatalogoEventosNoCrm()`/`classificarTipoEvento()`) — editar
   o nome desses 2 tipos em "Gerenciar Tipos" mudaria qual `tipo` bate
   aqui também. Testado ao vivo com 3 eventos de teste (Abertura/Palestra/
   Café Cultural): ordem cronológica e classes CSS de peso confirmadas.
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

## Diagnóstico de Saúde (IA) e Recomendações de Contato (IA)

Pedido do usuário (2026-09-21): "quero que ela avalie a situação dos
leads das filiais e perceba se há algum erro de importação ou de
sincronização antes de eu esbarrar nos problemas... quero que ela avalie
as melhores tarefas por filial e por SDR, no sentido de converter em
matrículas. Quero que seja 'inteligente' em relação ao planejamento de
contato, para que o contato em si seja humanizado".

**Princípio de design, o mesmo já seguido em todo o resto do projeto**
("nunca inventar/chutar sem evidência real"): em NENHUM dos dois recursos
a IA decide um número, um nível de severidade, ou QUEM contatar — isso é
sempre calculado por regra fixa (contagens/limiares em SQL/JS, ou o
mesmo ranking 100% determinístico já usado em "50 Leads Prioritários",
ver seção "Agenda do Dia"). A Anthropic API é usada só pra ESCREVER, em
português natural, o texto a partir dos sinais/da lista já decidida —
nunca pra inventar fato que não veio no payload. O prompt de cada
function reforça essa regra explicitamente.

### 1. Diagnóstico de Saúde (IA)

Card novo no topo da aba Visão Geral/Dashboard, ACIMA de "Agenda do Dia —
Todas as Filiais" (`#diagnosticoIaCard`, `js/visao-geral.js`).

- **Detecção (determinística)**, feita dentro da Edge Function
  `ia-diagnostico-saude` (`supabase/functions/ia-diagnostico-saude/`):
  - **Sincronização**: dias desde a última tentativa/último sucesso de
    `mercurio`/`ulisses` em `status_sincronizacao_automatica` — `urgente`
    se a última tentativa falhou E o último sucesso foi há 2+ dias;
    `atencao` se não tenta há 3+ dias.
  - **Mercúrio nunca importou pra esta filial**: `total_leads >= 100` E
    `total_ativo_inativo == 0` (RPC `contagem_status_mercurio_por_filial()`,
    `migracao_diagnosticos_ia.sql` — mesmo cast jsonb de
    `leads_ativos_inativos_da_filial()`) → `urgente`. O limiar de 100
    evita falso-positivo numa filial nova/pequena que legitimamente ainda
    não passou pelo Mercúrio.
  - **Duplicados em alta**: `leads_a_tratar` com 150+ grupos pendentes
    numa filial → `atencao` (pode ser sintoma de um bug de importação
    criando duplicata em vez de casar com lead existente — mesma classe
    dos "Bug real #2/#3/#4/#5" já documentados na seção do Importador).
  - **Importação antiga**: última entrada `log_atividade.acao='importacao'`
    daquela filial há 14+ dias → `atencao`.
  - **Evento próximo sem inscrição via Ulisses**: evento ativo nos
    próximos 10 dias com ZERO `evento_leads.origem='ulisses'` (RPC
    `eventos_proximos_sem_inscricao_ulisses()`) → `atencao`.
  - Sem NENHUM problema: 1 registro `nivel='ok'`, sem chamar a IA (economiza
    a chamada quando não há nada a relatar).
- **Escrita (IA)**: só quando há 1+ problema, a function manda os sinais
  brutos (nunca o texto) pra Claude Haiku, pedindo, por item, `resumo`
  (1-2 frases, interpretando os números) e `acao_sugerida` (1 frase,
  referenciando um recurso que JÁ EXISTE no CRM, ex: "abra Sincronização
  Automática e rode o Mercúrio pra esta filial"). O `nivel`/`filial` da
  IA são sempre IGNORADOS — só o texto é aproveitado, sempre re-anexado
  ao sinal original antes de gravar. **Se a chamada à IA falhar por
  qualquer motivo** (rede, crédito, resposta malformada), cai num
  `resumo` genérico ("a IA não respondeu, ver sinais brutos") — a
  detecção (a parte que importa) nunca é bloqueada pela IA.
- **Tabela `diagnosticos_ia`** (`migracao_diagnosticos_ia.sql`) — log
  append-only de cada rodada (histórico, tipo `log_atividade`), com
  `sinais` jsonb guardando os NÚMEROS reais que geraram o diagnóstico
  (auditoria: "de onde veio isso?").
- **2 gatilhos**: botão "Analisar Agora" (`analisarSaudeIA()`, sob
  demanda) e automaticamente 1x/dia, como ÚLTIMA etapa de
  `scraper/mercurio.js` `main()` (`executarDiagnosticoSaudeIA()`, best-
  effort, via `supabaseAdmin.functions.invoke(...)` — mesmo padrão já
  usado pra `whatsapp-notificar-chefe-filial`/`lembrete-scraper`) — assim
  o diagnóstico já está pronto quando o usuário abre o CRM de manhã, sem
  precisar clicar em nada.
- O painel (`carregarDiagnosticosIaRecentes()`) mostra a rodada mais
  recente já gravada (sem chamar a IA de novo só pra exibir), ordenada
  por severidade (urgente > atenção > ok).

### 2. Recomendações de Contato (IA)

Botão "Recomendações de Contato (IA)" na aba Tarefas (`js/tarefas.js`),
ao lado de "Nova Tarefa" — escopado à FILIAL ATUAL (diferente do
Diagnóstico de Saúde, que é cross-filial).

- **QUEM contatar (determinístico)**: `_obterCandidatosContatoIA()`
  reaproveita a MESMA RPC e o MESMO critério de ranking já usados em "50
  Leads Prioritários" (`leads_agenda_geral_prioritarios()` +
  proximidade de Abertura de Turma > Lead Forte > Jornada > qtd. de
  tags, ver seção "Agenda do Dia") — só filtrado pra 1 filial e capado
  em 20 leads (`LIMITE_RECOMENDACOES_CONTATO_IA`). Não existe atribuição
  de lead a um SDR específico no banco hoje — "por SDR" é resolvido
  deixando o usuário escolher o responsável (pessoa OU equipe) no
  próprio modal de Tarefa, igual qualquer outra tarefa criada à mão.
- **COMO abordar (IA, "humanizado")**: os sinais 100% factuais de cada
  lead (dias até a Abertura de Turma inscrita, nível de Lead Forte,
  estágio da Jornada, tags da família "Interesses / Origem") vão pra
  Edge Function `ia-recomendar-contatos` (`supabase/functions/ia-recomendar-contatos/`,
  **sem nenhuma consulta ao banco** — só recebe o que o frontend já
  calculou, mesmo padrão de `classificar-temas`), que devolve, por lead,
  `motivo` (por que agora) e `abordagem` (sugestão de mensagem de
  abertura curta, calorosa, NUNCA insistente/vendedora na primeira
  frase — pedido explícito do usuário, "humanizado"). O prompt proíbe
  explicitamente inventar evento/data/fato que não veio nos sinais.
- **O que acontece ao gerar**: (1) preenche `abordagem_sugerida` de quem
  ainda está VAZIO (nunca sobrescreve um "Como Abordar" já escrito à
  mão — mesmo princípio de preservação de todo o resto do app); (2) abre
  o modal de "Nova Tarefa" JÁ existente (`abrirNovaTarefa()`), pré-
  preenchido com título/descrição (a descrição lista o motivo de cada
  lead, já que `tarefa_leads` não tem campo de nota por lead) e os leads
  já selecionados — a pessoa revisa/edita/escolhe o responsável e clica
  "Salvar" normalmente, exatamente como qualquer tarefa manual. Se
  cancelar, a tarefa não é criada (mas o `abordagem_sugerida` já escrito,
  sendo só um preenchimento de campo vazio, fica — não é destrutivo).
  Log em `log_atividade` (`acao='recomendacao_contato_ia'`).

### Limitação real, confirmada em produção (2026-09-21)

**A conta Anthropic usada pelo projeto está sem crédito** — confirmado
testando as 2 functions direto (`curl`): `"Your credit balance is too
low to access the Anthropic API. Please go to Plans & Billing to
upgrade or purchase credits."`. Isso bloqueia a ESCRITA em linguagem
natural das duas features (e também `classificar-temas`, que usa a
MESMA chave) — mas a DETECÇÃO/ranking determinístico dos dois recursos
continua funcionando 100% (testado: `ia-diagnostico-saude` detectou
corretamente 2 filiais com duplicados em alta, com os números certos;
só o texto ficou no fallback genérico). **Ação do usuário**: adicionar
crédito em https://console.anthropic.com (Plans & Billing) — nenhuma
mudança de código resolve isso.

**Ainda sem crédito em 2026-09-28** — reconfirmado testando
`classificar-resposta-convite` (ver seção "Classificação de Respostas de
Convite") direto contra produção: mesmo erro exato
(`"Your credit balance is too low..."`), e por isso 100% das
classificações de teste saíram `"ambiguo"` (o fallback seguro da
function quando a IA não responde) — não é um bug da function nova, é a
MESMA limitação de sempre, confirmada de novo. Enquanto o crédito não for
adicionado, a classificação de respostas de convite vai continuar
sempre caindo em "Ambíguo" — a detecção/query de candidatos (100%
determinística) já está correta e testada, só falta a escrita da IA.

**Achado incidental nesta mesma investigação — 3 Edge Functions
documentadas como "já deployadas" estavam AUSENTES em produção**
(`npx supabase functions list` não trazia `classificar-temas`,
`lembrete-scraper`, nem `whatsapp-notificar-chefe-filial` — o código-
fonte continuava intacto em `supabase/functions/`, só nunca tinha sido
(re)enviado ao projeto, ou foi perdido numa reconfiguração anterior do
projeto Supabase). Isso explica silenciosamente: eventos importados sem
`tema` (Importador cai no aviso "best-effort" sem dizer o motivo real),
o aviso de aniversário de aluno Ativo pro chefe de filial nunca chegando,
e o lembrete semanal/de evento próximo do Ulisses pro admin também nunca
chegando — tudo com erro `404 NOT_FOUND`, engolido pelos `catch`
best-effort de cada chamador (por design, pra nunca travar o resto do
job) e por isso nunca visível em lugar nenhum. **Corrigido**: as 3 foram
redeployadas nesta sessão (`npx supabase functions deploy <nome>`) —
nenhuma mudança de código, só reenviar o que já existia. Vale conferir
de vez em quando com `npx supabase functions list` se alguma function
"desaparece" de novo depois de uma reconfiguração do projeto.

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
     — canal Realtime PRÓPRIO (`wpp-notificacoes-global`), diferente do
     canal que já existe dentro de `criarChatController()`
     (`js/whatsapp.js`), que só escuta enquanto aquele chat específico está
     aberto. Esse canal fica sempre ativo, independente de qual aba/lead
     está sendo visto — assim uma mensagem de um lead que não está com o
     chat aberto ainda notifica.
     - **Bug real corrigido (2026-09-28, mesma classe do "WhatsApp
       Unificado nunca foi de verdade unificado")**: apesar do nome
       "Globais", o canal só escutava `filter: filial=eq.${filialAtual}`
       — mensagem de outra filial nunca notificava nada. Removido o
       filtro, agora é global de verdade (qualquer filial).
     - **Pop-up visível na tela** (pedido do usuário: "coloque um pop up
       no crm sempre que recebermos uma mensagem pelo whatsapp") —
       `mostrarPopupWhatsApp()`, canto inferior direito, criado
       dinamicamente (sem markup no `index.html`), auto-some em 8s ou ao
       clicar (fora do "x"). Diferente do sino (exige abrir o painel) e
       da notificação nativa do navegador (só aparece se a permissão já
       foi concedida antes — nem todo mundo chega a conceder), este
       SEMPRE aparece, só com o CRM aberto na aba.
  5. **Sincronização automática travada** (`verificarNotificacoesSincronizacao()`)
     — busca própria em `status_sincronizacao_automatica` (ver "Login
     Automático" no Importador); avisa se a tentativa mais recente do
     Ulisses (da filial atual) ou do Mercúrio (global) falhou, ou se a
     última bem-sucedida está mais velha que `HORAS_LIMITE_SEM_SYNC`
     (26h). Sem nenhuma linha na tabela ainda (scraper não implementado/
     nunca rodou), fica em silêncio — não inventa alerta de uma automação
     que não existe. Poll a cada 30 minutos.
     - **Bug real relatado pelo usuário (2026-09-10): "toda vez que
       atualizo a página aparece uma notificação NOVA de Ulisses travado",
       mesmo sem rodar o Ulisses há tempos**: `sincronizacoesJaNotificadas`
       (dedup por `sistema:filial:executado_em`) só existia em memória —
       reiniciava a cada F5, então a MESMA linha de falha antiga (com o
       MESMO `executado_em`, nada novo) virava "nova" de novo em todo
       reload. Corrigido persistindo esse Set em `localStorage`
       (`crm_na_sincronizacoes_notificadas`, cap de 200 chaves) — uma
       falha já notificada continua silenciosa depois de recarregar;
       só uma tentativa GENUINAMENTE nova (escrita pelo scraper de
       verdade, com `executado_em` diferente) volta a notificar.
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
   - **Mesclagem AUTOMÁTICA, sem revisão humana (2026-09-28, pedido do
     usuário)**: "se o telefone for o mesmo, e o nome também (ou se não
     coincidir exatamente, se o nome mais curto coincidir com o nome
     mais longo — é uma abreviação), mescle automaticamente". Regra
     estrita, deliberadamente MAIS conservadora que a pontuação de "nome
     parecido" (que é permissiva de propósito, pra sugerir casos pra
     revisão) — `nomesCompativeisParaAutoMesclagem()`: TODOS os tokens
     do nome mais curto precisam achar correspondência EXATA (ou
     abreviação de 1 letra) no nome mais longo, sem pontuação parcial. Um
     grupo com 3+ membros só é elegível se TODOS os pares forem
     compatíveis (ex: 2 pessoas de uma família com o mesmo telefone mas
     nomes diferentes cai de volta pra revisão manual normal, nunca
     mescla um subconjunto sozinho). Sobrevivente escolhido sem
     intervenção (`escolherSobreviventeAutoMesclagem()`): prefere ID
     REAL do Ulisses sobre sintético (ajuda futuras reimportações a
     casarem certo), depois o nome mais completo (mais caracteres).
     Reaproveita 100% a MESMA lógica de incorporação da mesclagem manual
     (`mesclarAutomaticamenteLeads()` — tags/histórico em união, e-mail
     nunca perdido, vira nota no `resumo_ia` se não for o escolhido) —
     só sem pedir confirmação nenhuma, e sem UI de conflito (telefone já
     é o mesmo por definição; e-mail diferente prioriza quem já tiver).
     Roda dentro de `detectarLeadsATratar()`, ANTES de montar os grupos
     pra `leads_a_tratar` — um telefone auto-mesclado nunca chega a virar
     card na tela. **Testado**: a lógica de compatibilidade de nomes foi
     validada contra 8 casos reais (abreviação de 1 palavra, abreviação
     de nome completo, nomes diferentes, o caso "LUCAS NUNES ... /
     LUCAS NUNES LIMA" já documentado como falso-positivo perigoso pra
     pontuação — aqui corretamente REJEITADO); a mecânica de banco
     (escolha de sobrevivente real-sobre-sintético, união de tags/
     eventos/e-mail, delete do duplicado) foi confirmada ponta a ponta
     contra 2 leads de teste descartáveis direto no Supabase (não usei
     Playwright/browser pra isso — replicado o mesmo fluxo via chamadas
     REST diretas, limpo depois).
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
- **Tags de cada membro visíveis no card do grupo (2026-09-28)** — pedido
  do usuário depois de reunião com a Ediliene (Jardim América): "as
  pessoas duplicadas ficam com problemas nas tags... isso dificulta o
  contato mais assertivo". Antes só dava pra ver a CONTAGEM de tags
  depois de já ter aberto "Mesclar"; agora `renderizarCardGrupoLeadsATratar()`
  mostra as tags de cada membro direto no card (badges pequenos,
  `classeVisualTag()`) — dá pra notar de cara que 2 "duplicados" têm
  tags divergentes (ex: um "Ativo", outro "Lead Forte 1") antes de
  decidir mesclar. Snapshot gravado na própria varredura
  (`leads_a_tratar.pessoa_tags`, `migracao_leads_a_tratar_tags.sql`) —
  mesmo espírito de `pessoa_nome`/`pessoa_telefone`/`pessoa_email`, que
  já são snapshot, não consulta em tempo real.
- **Duplicado CROSS-FILIAL não é coberto por esta tela — achado real
  (2026-09-28)**: `detectarLeadsATratar()` roda sempre escopada a 1
  filial (`.eq('filial', filial)`) — nunca detecta a MESMA pessoa
  cadastrada em 2 filiais diferentes com o mesmo telefone. Achado
  investigando um "não identificado" real: "GIORGIA TOMITAO MARIO"
  (`108424`, Goiânia II) e "GIORGIA TOMITÃO MÁRIO" (`901000090`, Jardim
  América) são a MESMA pessoa, mesmo telefone (`62 981626080`) — o
  webhook do WhatsApp encontrou os DOIS e corretamente recusou adivinhar
  (mesma regra de sempre: nunca escolhe entre 2+ leads ATIVOS ambíguos),
  então a mensagem dela ficou em "Não Identificados" esperando vínculo
  manual. **Não é um bug do 9º dígito** (os dois cadastros já têm o
  telefone no formato certo, idêntico) — é uma lacuna de detecção
  diferente, ainda sem solução construída: duplicado entre filiais
  nunca aparece em "Leads a Tratar" de nenhuma das duas (cada varredura
  só olha a própria filial). Não construído nesta rodada (fora do pedido
  específico) — se acontecer de novo, resolve pela mesma tela "Não
  Identificados" (botão "Vincular", escolher qual das 2 Giorgias é a
  certa pra aquela conversa); uma extensão futura óbvia seria
  `detectarLeadsATratar()` também avisar (não necessariamente mesclar
  automático — cada filial pode ter contexto próprio legítimo) sobre
  telefone idêntico encontrado em OUTRA filial.

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
- **Chat cortado lateralmente em janelas mais estreitas que 800px — bug
  real relatado pelo usuário (2026-09-10, print real)**: `.drawer`
  (`css/style.css`) tinha `width: 800px` fixo, sem nenhum limite pro
  tamanho da janela do navegador — numa janela mais estreita (ex: browser
  não maximizado), a gaveta simplesmente extrapolava a viewport, cortando
  o painel de chat (que divide o espaço com `.drawer-info`, 350px fixos)
  sem dar pra ver a conversa toda de lado a lado. Corrigido com
  `max-width: 100vw` — a gaveta encolhe pra caber na janela em vez de
  vazar pra fora dela; os balões de mensagem já eram responsivos por
  dentro (`.msg { max-width: 65%; word-wrap: break-word; }`), então só
  precisavam de um container que não vazasse.
- **Templates de mensagem** só existem depois de criados e aprovados no
  painel da Meta Business — a lista `TEMPLATES_WHATSAPP` no topo de
  `js/whatsapp.js` precisa ser preenchida (nome técnico exato + ordem das
  variáveis) conforme forem aprovados. Hoje tem 6: `contato_inicial`
  (3 variáveis: nome/atendente/filial — contato geral com quem já
  demonstrou interesse em Filosofia; reaprovado pela Meta em 2026-09-11
  com texto mais genérico, a 3ª variável deixou de ser "palestra"
  digitada à mão e passou a ser `filial`, preenchida automaticamente),
  `aniversario` (3 variáveis: nome/atendente/filial — NOVO, aprovado
  2026-09-11, mensagem de feliz aniversário), `resgate_lead_evento`
  (1 variável: nome — resgate de lead frio genérico), `contato_ulisses`
  (5 variáveis: nome/atendente/filial/tipo-do-evento/nome-do-evento —
  quem participou de algo pelo Ulisses e nunca foi aluno),
  `resgate_ex_aluno` (3 variáveis: nome/atendente/filial — ex-aluno
  inativo), `contato_aluno_ativo` (4 variáveis: nome/atendente/filial/
  evento — convite geral pro aluno atual, atualizados/confirmados
  2026-09-10 a partir do texto exato submetido na Meta) e
  `convite_palestra` (5 variáveis: nome/atendente/filial/evento/data —
  NOVO 2026-10-01, cadastrado a partir de print do usuário; **enviado
  pra análise na Meta mas ainda NÃO confirmado como aprovado** — pode
  falhar com "template não encontrado" até a aprovação sair; conferir
  status em "Gerenciar modelos" antes de usar em produção).
  - **`idioma` por template** (campo novo em cada entrada de
    `TEMPLATES_WHATSAPP`, padrão `'pt_BR'` quando omitido) — precisa
    bater EXATO com o "Selecione o idioma" registrado na criação do
    template na Meta, senão o envio falha (template não encontrado nesse
    idioma). `resgate_ex_aluno` e `contato_aluno_ativo` foram registrados
    como **English** (confirmado pelo usuário, não é engano a corrigir) —
    `idioma: 'en_US'` nesses dois; os outros 3 continuam `pt_BR`. O valor
    vai no corpo da chamada (`templateIdioma`) até `whatsapp-send`, que
    usa `templateIdioma || "pt_BR"` no `language.code` da Graph API (antes
    disso a function sempre mandava `pt_BR` fixo, o que teria falhado
    silenciosamente pros templates em inglês).
  - **Editar o texto de um template aprovado exige submeter de novo pra
    Meta e esperar reaprovação** (não é instantâneo) — por isso, antes de
    pedir aprovação de um template novo, vale considerar deixá-lo bem
    genérico/com mais variáveis (parecido com o padrão de
    `CONVITE_EVENTO_NAO_ALUNO`/`CONVITE_EVENTO_ATIVO` abaixo, que são só
    texto livre preenchido no chat — sem aprovação nenhuma da Meta, mas só
    funcionam DENTRO da janela de 24h) em vez de um texto fixo e específico
    demais pra um cenário só.
  - **Testado ao vivo (UI, sem enviar de verdade)**: os 5 templates
    aparecem no seletor da janela fechada, e as variáveis automáticas
    (`nome`/`atendente`/`filial`) pré-enchem corretamente pro template de
    5 variáveis (`contato_ulisses`) — envio real não testado de propósito
    (status de aprovação na Meta incerto no momento + bloqueio de API já
    documentado acima).
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
  membros de uma vez (ex: via seleção no Kanban) não foi construído pra
  ESTA foto real via Graph API (continua bloqueada pelo "API access
  blocked"); pra convite em massa de TEXTO, ver "Convites em massa via
  wa.me" logo abaixo, que resolve isso por outro caminho, sem depender da
  Meta.

### "Nova Turma" — convite de Abertura de Turma sob demanda, só pra Ativos

Pedido do usuário (2026-09-19): "quero poder encaminhar para os ativos
uma mensagem com imagem, link e texto sobre a próxima abertura de turma
da filial dele, que ele possa encaminhar para seus contatos e seus
grupos. Isso deve ser acessável na gaveta do lead". Diferente do
"Convidar pra Evento" genérico (lista TODOS os eventos futuros, exige
escolher um manualmente), este é um atalho de 1 clique específico pra
Abertura de Turma.

- **Botão `#btnConviteAberturaTurma`** ("Nova Turma", ícone de capelo),
  no cabeçalho do chat da gaveta, ao lado de "Convidar pra Evento" —
  **só aparece pra leads com a tag `"Ativo"`/`"Aluno Ativo"`**
  (`abrirGaveta()`, `js/app.js`, toggle de `display` igual outros blocos
  condicionais da gaveta, ex: "Saída (Inativo)"). Não pré-verifica se
  existe uma Abertura de Turma cadastrada antes de mostrar o botão (isso
  o próprio clique resolve, sem gastar uma consulta extra só pra decidir
  visibilidade).
- **`enviarConviteAberturaTurmaFilial()`** (`js/whatsapp.js`): acha
  sozinho, em `eventosAtuais` (já carregado da filial atual — mesma
  garantia de `carregarEventos()` já usada no resto do fluxo de convite),
  o evento com `tipo === 'Abertura de Turma'` mais próximo que ainda não
  "passou" (`dataEfetivaLimite()`). Sem nenhum encontrado, avisa e para.
  Achando, reaproveita **100%** `montarTextoConviteEvento()` — como o
  lead já é Ativo, isso já cai automaticamente no texto
  `CONVITE_EVENTO_ATIVO` (pede pra encaminhar/indicar contato/ser
  voluntário) — e só ACRESCENTA o link de inscrição
  (`evento.link_inscricao`, alimentado automaticamente pelo scraper via
  API do Ulisses — ver seção própria) no final do texto. Satisfaz os 3
  pedidos (imagem + link + texto) reaproveitando quase tudo que já
  existia: com `imagem_url` no evento, envia direto como mensagem de
  MÍDIA real (mesmo caminho de `confirmarConviteComFoto()`, `whatsapp-send`
  com `tipo:'imagem'`, pede `confirm()` antes por ser envio de verdade);
  sem imagem, cai pro comportamento de "Gerar Texto" (só preenche a
  caixa, não envia sozinho).
- **Bug real achado testando isto (2026-09-19), NADA A VER com o botão
  em si — afeta o app inteiro**: o evento real da campanha atual
  ("Novas turmas do Curso de Filosofia para Viver") estava com
  `tipo = null` no banco, mesmo já sincronizado com data/imagem/link
  corretos (ver seção "API oficial do Ulisses" acima) — o catálogo
  `tipos_evento` só reconhece "Abertura de Turma" pela palavra-chave
  literal `"ABERTURA DE TURMA"`, que não aparece nesse nome de campanha.
  Isso silenciosamente quebrava TUDO que depende de `tipo === 'Abertura
  de Turma'` — não só este botão novo, mas também a tag `"Inscrito:
  Abertura de Turma"`, o destaque dourado no "Calendário de Eventos
  Futuros" da Agenda do Dia, etc. **Corrigido na fonte**, em
  `sincronizarEventosUlissesApi()` (`scraper/importar-ulisses-api.js`):
  quando o catálogo por palavra-chave não reconhece nada, cai num
  fallback usando o PRÓPRIO enum da API do Ulisses
  (`ev.tipoEvento === 'ABERTURA_DE_TURMA'` → `"Abertura de Turma"`) — um
  sinal bem mais confiável que tentar adivinhar por palavra-chave o nome
  de campanhas que variam a cada ciclo. Só esse 1 mapeamento foi feito
  (não os outros enums do Ulisses, tipo `CURSO_LIVRE`/`LIVE` — sem
  correspondência clara e óbvia no nosso catálogo, não valia arriscar
  chute). Rodando a sincronização de novo já corrigiu retroativamente o
  evento real (confirmado no banco: `tipo` virou `"Abertura de Turma"`).
- **Testado ao vivo, ponta a ponta** (Playwright contra uma cópia local
  do CRM servida por `python -m http.server`, mesmo Supabase de
  produção): botão aparece só pro lead com tag Ativo (confirmado com 2
  leads reais de Goiânia - Garavelo, 1 com e 1 sem a tag); clicar nele
  achou a Abertura de Turma certa e mostrou o `confirm()` com o nome do
  evento, data formatada (05/10/2026) e o primeiro nome do lead —
  dispensado sem confirmar de verdade (evita mandar mensagem real durante
  o teste, e o envio real ia esbarrar no bloqueio conhecido da API da
  Meta de qualquer forma).

### Convites em massa via wa.me (WhatsApp pessoal, enquanto a Meta não libera)

Pedido do usuário (2026-09-15): disparar convite pra dezenas de leads de
uma vez, urgente, usando o WHATSAPP PESSOAL dele (não o número da Meta,
ainda bloqueado — ver seção acima), sem gastar com gateway terceiro
(Z-API/Evolution API, cogitados e descartados pra este caso: pra um
volume de "dezenas", o risco/custo de um gateway não compensa) e sem
risco de o número pessoal ser banido.

- **A decisão-chave**: o que causa bloqueio no WhatsApp não é "usar
  automação", é o PADRÃO de comportamento (rajada de mensagens idênticas
  pra gente que nunca teve contato, com links, sem pausa) — então a
  solução não precisa de nenhuma ferramenta nova, só precisa continuar
  sendo tecnicamente idêntica a "digitar a mensagem na mão".
- **Implementado**: botão "Convidar (Link)" na barra de seleção em massa
  do Kanban (`#bulkActionBar`, ao lado de "Mesclar") —
  `iniciarConvitesWhatsAppEmMassa()`/`gerarLinksConviteLote()`
  (`js/whatsapp.js`), modal `#modalConviteLote` (`index.html`). Fluxo:
  escolhe 1+ leads no Kanban (checkbox de sempre) → escolhe o evento (só
  os ainda não "passados", mesmo critério `dataEfetivaLimite()` de
  sempre) → o sistema gera **1 link `wa.me/55DDDNUMERO?text=...` por
  lead**, com o convite já personalizado (reaproveita a MESMA lógica de
  texto do convite individual — `montarTextoConviteEvento(lead, evento)`,
  extraída de `enviarConviteEvento()` pra não duplicar `{nome}`/
  `{atendente}`/`{quando}`/`{interesses}`). Clicar no link abre o
  WhatsApp Web logado com o número PESSOAL, com o texto já preenchido na
  caixa — quem aperta "Enviar" é a pessoa, um por um. Isso é
  tecnicamente IDÊNTICO a mandar na mão (zero automação de verdade), só
  economiza o trabalho de digitar a mesma mensagem repetidamente.
  - Cada checkbox ao lado do link só serve pra marcar visualmente "já
    enviei este" (esmaece a linha) — é estado local do modal, não
    persiste, não precisa (é uma sessão de cliques só, geralmente feita
    de uma vez).
  - Lead sem telefone cadastrado é ignorado (contado num aviso), não
    trava o resto da lista.
  - Cada lead com telefone também é vinculado a `evento_leads`
    (`resposta_convite` no padrão `'pendente'` do banco, `upsert(...,
    {onConflict: 'evento_id,pessoaIdentificador', ignoreDuplicates:
    true})` — nunca sobrescreve uma resposta já dada) — assim o
    "Follow-up de Eventos" do Dashboard e o resumo de participantes do
    evento já sabem quem foi convidado, mesmo que a mensagem tenha sido
    mandada por fora da Graph API.
- **Sincronizar a conversa de volta pro CRM depois**: não precisa de nada
  novo — usa o MESMO fluxo que já existe, "Importar Conversa de WhatsApp"
  (`js/importar-conversa-whatsapp.js`, ver seção própria): exportar a
  conversa do celular (.txt/.zip) e importar na gaveta do lead (1 a 1) ou
  em lote (`.zip` múltiplos, "Leads a Tratar" → "Conversas Importadas").
- **Não testado ao vivo** (não foi disparado um convite de verdade nesta
  sessão) — validar contra o Kanban real na próxima vez que o usuário for
  disparar um convite de verdade.
- **Texto revisado (2026-09-15)**: quebrado em parágrafos curtos (linha em
  branco entre cada um, pedido do usuário depois de ver o texto real
  chegando espremido numa linha só no wa.me) e sem emoji (o emoji chegava
  corrompido — "�" — no texto pré-preenchido do link; mais simples tirar
  do que diagnosticar um problema de encoding numa URL externa). `{filial}`
  passou a usar `nome_com_preposicao` (ex: "do Garavelo") em vez do nome
  cru da filial com um "-" fixo na frente — mesmo valor já usado nos
  templates aprovados da Meta (`preencherValorAutomatico('filial')`), as 4
  filiais já têm esse campo preenchido.
- **"Quem foi contatado" agora é registrado de verdade** (pedido do
  usuário: "incluir no relatório as pessoas que foram contatadas") — o
  checkbox "já enviei este" em cada linha do modal deixou de ser só
  visual: ao MARCAR (não ao desmarcar — log é append-only), grava 1 linha
  em `log_atividade` (`acao='convite_whatsapp_link'`,
  `marcarContatoWhatsAppLoteEnviado()`, `js/whatsapp.js`) com o lead e o
  nome do evento. Isso já aparece automaticamente na tela "Log de
  Atividade" (aba Relatórios) — sem precisar de relatório novo nenhum,
  `formatarDetalhesLog()`/`ROTULOS_ACAO_LOG` (`js/log-atividade.js`)
  ganharam o caso `convite_whatsapp_link`. É o sinal mais próximo que
  temos de "mandei de verdade" enquanto o envio é manual (não dá pra
  confirmar entrega/leitura vindo de um link wa.me, diferente de um envio
  real pela Meta Cloud API, que já grava tudo sozinho em
  `mensagens_whatsapp`). **Quando a API da Meta for liberada**, o mesmo
  relatório de "quem foi contatado" pode ser complementado cruzando
  `mensagens_whatsapp` (`direcao='saida'`) — ainda não construído, não é
  necessário enquanto o canal principal continua sendo o wa.me manual.
- **Move pra "Em Abordagem" só quando o checkbox é MARCADO, não ao gerar
  os links** (pedido do usuário, 2026-09-15 — corrigido no mesmo dia: a
  1ª versão movia todo mundo assim que o link era criado, mesmo sem
  clicar em "Abrir"/mandar nada) — `encontrarColunaAbordagem()` (mesma
  heurística por substring de `encontrarColunaRecontato()`, busca
  "ABORDAGEM" no `key`/`label` de `columnsConfig`, nunca cria a coluna
  sozinha; já bate com a 2ª coluna padrão do Kanban, `colunasPadrao()` em
  `js/app.js`, key `"Abordagem"`/label `"Em Abordagem"`) +
  `moverLeadsParaColuna()`, chamada de dentro de
  `marcarContatoWhatsAppLoteEnviado()` — 1 lead por vez, no exato momento
  em que a pessoa confirma que mandou. Mesmo gatilho que já grava em
  `log_atividade` (ver bullet acima) — os dois efeitos (log + mover)
  acontecem juntos, só ao marcar de verdade.
- **"Conferir telefone" direto nesta lista** (botão de lupa em cada linha,
  `marcarTelefoneParaVerificarLote()`) — pedido do usuário 2026-09-15,
  **comportamento trocado em 2026-09-17**: a 1ª versão (`marcarTelefoneInvalidoLote()`)
  apagava o telefone na hora, igual `marcarTelefoneInvalido()` da gaveta do
  lead. O usuário apontou que boa parte dos casos reais é só ERRO DE
  DIGITAÇÃO perceptível (1 dígito trocado), não um número que realmente
  não existe mais — apagar de cara jogava fora um dado bom demais cedo.
  Agora **nunca mexe no telefone**: só aplica a tag nova
  `"Conferir Telefone"` (família "Cadastro" em `FAMILIAS_TAG`, `js/app.js`
  — mesma cor de "Sem Telefone"/"Sem E-mail") e move o lead pra uma coluna
  dedicada de conferência, achada por `encontrarColunaVerificarTelefone()`
  (mesma heurística por substring de `encontrarColunaAbordagem()` — aceita
  "Verificar"/"Conferir"/"Atualizar Cadastro" no nome, nunca cria a coluna
  sozinha; sem achar, avisa em `alert()` pra criar uma em "Gerenciar
  Colunas" e deixa o lead onde estava). Continua removendo o vínculo
  "pendente" do evento atual em `evento_leads` (mesmo motivo de sempre:
  telefone suspeito também significa que não chegamos a contatar de
  verdade) e tirando a linha da lista (o link `wa.me` gerado não serve
  mais até o número ser conferido).
- **Fechar o modal não perde o lote gerado** (pedido do usuário,
  2026-09-17: "se eu sair dessa tela, consigo voltar?") — antes, reabrir
  "Convidar (Link)" sempre resetava pro passo 1 (escolher evento), mesmo
  só fechando sem querer no X/clicando fora, descartando a lista de links
  + quem já tinha sido marcado como enviado. Agora
  `iniciarConvitesWhatsAppEmMassa()` checa se já existe um resultado
  renderizado nesta sessão e, se sim, só reabre o modal onde parou — só
  reinicia do zero pelo botão explícito "Novo lote" dentro do resultado
  (`reiniciarConviteLote()`).
- **Modelos de mensagem editáveis pelo CRM** (`modelos_mensagem_whatsapp`,
  `migracao_modelos_mensagem_whatsapp.sql`) — pedido do usuário (2026-09-15):
  1ª versão do mesmo dia salvava só 1 texto em `localStorage` (por
  navegador); o usuário pediu mais 2 coisas: "uma mensagem pronta, sem
  ter que escrever nada" e "poder editar as mensagens base, pra não ter
  que editar de um por um" — resolvido trocando o texto único por uma
  tabela de modelos COMPARTILHADA (RLS pública, mesmo padrão de
  `tags_sugeridas`/`tipos_evento`), com uma tela própria **"Gerenciar
  Mensagens"** (botão dentro do próprio modal de Convidar).
  - Tela "Escolha do evento": `<select id="conviteLoteModeloSelect">`
    lista os modelos (`carregarModelosMensagemWpp()`); escolher um carrega
    o texto na caixa editável (`aplicarModeloConviteLote()`) — editar ali
    vale só PARA ESTE ENVIO (some ao reabrir); pra mudar o modelo de vez,
    usa "Gerenciar Mensagens". Lembra qual modelo foi usado por último
    (`localStorage`, `crm_na_modelo_convite_lote_id`) e já vem
    pré-selecionado da próxima vez.
  - **"Gerenciar Mensagens"** (`abrirGerenciarModelosMensagem()`,
    `#modalModelosMensagem`): lista cada modelo com nome + texto
    editáveis + Salvar/Remover, e "+ Novo Modelo". Editar aqui MUDA DE
    VEZ o modelo pra todo mundo que for usar o CRM depois — é a resposta
    direta a "não ter que editar de um por um".
  - **Seed inicial** (rodado nesta sessão via `supabase db query --linked`):
    3 modelos — `"Convite Geral (Não-Aluno)"`/`"Divulgação (Aluno Ativo)"`
    (os 2 textos que já existiam hardcoded, preservados) e
    **`"Abertura de Turma - Interessados"`** (NOVO, já com `{linkInscricao}`
    — pensado especificamente pra "mensagem pronta com o link de
    inscrição", pra usar com a tag nova `"Demonstrou Interesse"`, ver
    seção de Tags).
  - **`{linkInscricao}`** — novo placeholder, preenchido a partir de
    `eventos.link_inscricao` (`migracao_link_inscricao_evento.sql`, rodada
    nesta sessão) — campo novo no modal de Evento (Agenda), ao lado de
    "Ingresso". Preenchendo esse campo 1x por evento, a mensagem sai
    "pronta, sem ter que escrever nada" pra qualquer lead — sem ele, o
    placeholder vira string vazia (nunca quebra, só fica sem o link).
  - **Best-effort com fallback embutido**: sem a migração rodada,
    `carregarModelosMensagemWpp()` cai num array fixo
    (`MODELOS_MENSAGEM_FALLBACK`, os 2 textos de sempre) — a tela de
    Gerenciar Mensagens detecta esse caso (id começa com `"fallback-"`) e
    avisa que precisa rodar a migração antes de editar/criar.
  - `montarTextoConviteEvento()` ganhou um 3º parâmetro opcional
    `templateCustom` — quando informado (sempre o caso no disparo em
    massa), substitui a escolha automática entre `CONVITE_EVENTO_ATIVO`/
    `CONVITE_EVENTO_NAO_ALUNO` (o convite individual da gaveta continua
    sem esse parâmetro, comportamento de sempre). **Decisão de escopo
    mantida**: o modelo escolhido vale igual pra TODOS os selecionados no
    lote, mesmo quem já é aluno ativo — pra tratar diferente, basta
    escolher/criar um modelo específico e rodar a campanha em 2 lotes.
    Trocado `.replace()` por `.replaceAll()` nos placeholders — texto
    digitado à mão pode repetir um placeholder mais de uma vez.
  - **Não testado ao vivo** (migração aplicada e verificada direto no
    banco via `curl`, mas o fluxo completo pela UI — abrir Convidar,
    trocar modelo, editar em Gerenciar Mensagens — ainda não foi clicado
    de verdade nesta sessão).
- **Também remove o vínculo `evento_leads` "pendente" desse
  evento** (pedido do usuário: "nem chegamos a entrar em contato com
  eles" — telefone inválido não deveria contar como convite pendente,
  senão o evento fica com "pendentes" fantasmas que nunca viram contato
  de verdade); só o vínculo com ESTE evento é removido, outros eventos do
  mesmo lead não são tocados.
- **Bug real relatado pelo usuário (2026-09-15): "só está aparecendo os
  eventos quando eu clico na tela de Eventos"** — `eventosAtuais`
  (`js/eventos.js`) só é carregado ao abrir a aba Agenda ou ao trocar de
  filial (`trocarFilial()`, `js/app.js`); numa sessão nova que nunca fez
  nenhuma das duas coisas (ex: loga e usa o botão direto do Kanban),
  ficava vazio pra sempre, e o botão "Convidar (Link)" achava que não
  havia evento futuro nenhum. Corrigido chamando `carregarEventos()`
  (sempre, pra já garantir dado fresco) dentro do próprio
  `iniciarConvitesWhatsAppEmMassa()`, antes de checar a lista —
  `#agendaLista` existe no DOM o tempo todo (só escondido por CSS quando
  a aba não está ativa), então a busca funciona vinda de qualquer aba.
  **Mesmo bug, 2 focos irmãos nunca corrigidos junto (achado pelo usuário
  2026-09-17, lead novo por indicação em Setor Oeste)**: o botão
  "+Convidar" da gaveta "Eventos (Convites)"
  (`abrirFormConvidarEventoNaGaveta()`, `js/eventos.js`) e o botão
  "Convidar pra Evento" no cabeçalho do chat da gaveta
  (`abrirSeletorConviteEvento()`, `js/whatsapp.js`) filtravam
  `eventosAtuais` do mesmo jeito, mas nunca chamavam `carregarEventos()`
  antes — mostravam "Nenhum evento disponível pra convidar" mesmo com
  eventos futuros reais cadastrados, sempre que a sessão nunca tinha
  aberto a Agenda/trocado de filial (típico de quem só usa "Novo Lead
  Manual" + a gaveta direto). As 2 agora também chamam `carregarEventos()`
  antes de montar a lista (viraram `async`) — mesmo remédio, agora nos 3
  pontos de entrada que existem pra convidar 1 lead (gaveta "Eventos",
  chat da gaveta, e o lote via wa.me).

### Convites em Massa via API (templates aprovados) — 2026-09-28

Pedido do usuário: "crie uma opção dentro do CRM, para disparar convites
para eventos em massa via API, conforme os modelos aprovados no meta".
Botão **"Convidar (API)"** na barra de seleção em massa do Kanban
(`#bulkActionBar`, ao lado de "Convidar (Link)") —
`iniciarConviteApiEmMassa()`/`confirmarEnviarConviteApiLote()`
(`js/whatsapp.js`), modal `#modalConviteLoteApi` (`index.html`).

**Seleção "por segmento" (2026-09-28, reunião com a Ediliene, Jardim
América)**: "precisamos criar uma sistemática... para enviar mensagens
mais abertas para um número muito grande de pessoas" — a versão
original só operava sobre `cardsSelecionados` (checkbox do Kanban já
paginado/carregado), inviável pra "toda a filial que tem tal perfil".
- Novo botão **"Convidar em Massa"** sempre visível no topo da aba CRM
  (não só dentro de `#bulkActionBar`) — chama a MESMA
  `iniciarConviteApiEmMassa()`, que agora detecta se há seleção no
  Kanban e escolhe o modo certo automaticamente (`conviteApiModoSelecao`,
  `'kanban'` ou `'segmento'`) — 2 rádios no topo do modal deixam trocar
  manualmente também.
- Modo "segmento": `<select>` de tag (tags de sistema mais úteis pra
  campanha — Lead Forte 1/2/3, Jornada: X, Ativo/Inativo — + catálogo
  `TAGS_SUGERIDAS`) + botão "Buscar leads com essa tag" →
  `buscarLeadsPorSegmentoConviteApi()` chama a nova RPC
  `leads_por_tag_filial(p_filial, p_tag, p_limite, p_offset)`
  (`migracao_rpc_leads_por_tag.sql`, mesmo padrão de cast jsonb já usado
  em `leads_ativos_inativos_da_filial()`), paginada 1000-a-1000
  (mesmo limite de sempre do PostgREST) até esgotar TODA a filial —
  não só o que já estava carregado no navegador. Os leads encontrados
  são mesclados em `leadsAtuais` (mesmo padrão de
  `abrirResultadoBuscaGlobal()`) pra `preencherValorAutomatico()`
  conseguir resolver nome/filial sem duplicar essa lógica.
- **Exclui automaticamente quem já confirmou presença no evento
  escolhido** — `gerarPreviaConviteApiLote()` (agora `async`) consulta
  `evento_leads` (`resposta_convite='confirmado'`) pros ids candidatos
  antes de montar a lista final; quem já vai não recebe convite de novo
  (contado num aviso próprio na prévia).
- Resto do pipeline (resolução de variáveis por lead, envio em lotes de
  5, gravação de `evento_leads`/`log_atividade`, mover pra Abordagem) é
  100% reaproveitado sem nenhuma mudança — a única diferença é DE ONDE
  vem a lista de `ids` antes de tudo isso rodar.
- **Testado**: a RPC `leads_por_tag_filial()` foi testada ao vivo contra
  produção (Jardim América, tag "Lead Forte 1") e devolveu os leads
  certos. O fluxo completo pela UI (trocar de rádio, buscar, revisar,
  enviar) não foi clicado de verdade nesta sessão (sem Playwright
  disponível) — validar na próxima vez que for usado de verdade.

- **Diferença central em relação a "Convidar (Link)" (wa.me)**: aquele é
  tecnicamente idêntico a mandar na mão (zero automação, quem aperta
  Enviar é a pessoa) — este ENVIA de verdade, automaticamente, chamando
  `whatsapp-send` (Edge Function já existente) 1 vez por lead
  selecionado, usando um dos templates JÁ APROVADOS na Meta
  (`TEMPLATES_WHATSAPP`, `js/whatsapp.js`) — o texto aprovado é mostrado
  só como LEITURA (`#conviteApiCorpoAprovado`), nunca editável nesta
  tela (mudar o texto de um template aprovado exige reenviar pra
  aprovação na Meta e esperar — não é algo que o CRM resolva).
- **Fluxo**: escolhe (opcionalmente) um evento — só pra registrar o
  convite em `evento_leads`/"Follow-up de Eventos", não influencia o
  texto do template automaticamente exceto pré-preencher os campos
  "manuais" abaixo — e um template aprovado. Templates com variável
  `chave: null` (texto livre que não tem fonte automática — ex: "evento/
  motivo" em `contato_aluno_ativo`, ou "tipo do evento"/"nome do evento"
  em `contato_ulisses`) ganham 1 campo de texto que vale pra TODOS os
  selecionados neste envio (pré-preenchido com o nome do evento
  escolhido, se houver — só um ponto de partida, editável). Demais
  variáveis (`nome`/`atendente`/`filial`) são resolvidas por lead via a
  MESMA `preencherValorAutomatico()` já usada no envio individual —
  nenhuma lógica nova, só reuso. "Revisar antes de enviar" mostra a
  lista de nomes que vão receber ANTES de qualquer chamada de API
  acontecer; o botão final pede um `confirm()` explícito (é uma ação
  real e irreversível, diferente de gerar um link).
- **Envio em lotes pequenos** (`TAMANHO_LOTE_CONVITE_API = 5`,
  `Promise.all` por lote) — evita disparar dezenas/centenas de
  chamadas simultâneas de uma vez à Edge Function/Graph API. Cada
  resultado (sucesso, ou o erro REAL devolvido pela Meta — nunca um
  texto genérico) vira 1 linha do relatório final, junto com o nome do
  lead. Vínculo em `evento_leads` (`origem:'crm'`, `resposta_convite:
  'pendente'`, `upsert(..., {ignoreDuplicates:true})` — mesmo padrão de
  `gerarLinksConviteLote()`) só é criado pra quem o envio de fato SAIU
  (nunca gera um "convidado" fantasma pra quem a Meta rejeitou). Log em
  `log_atividade` (`acao='convite_whatsapp_api_lote'`).
- **Aviso fixo no topo da tela** (`#conviteApiAvisoBloqueio`) — chegou a
  avisar que a API estava bloqueada; atualizado em 2026-09-28 pra
  confirmar que foi LIBERADA (ver seção "Bloqueio da API do WhatsApp" —
  RESOLVIDO no mesmo dia, depois do usuário confirmar a conta de
  desenvolvedor na Meta).
- **Testado**: a chamada de rede em si (`whatsapp-send`, mesmo formato
  exato de payload que este botão manda — `templateNome`/`templateIdioma`/
  `templateParams`/`templatePreview`/`atendenteNome`) foi confirmada
  reproduzindo-a via `node -e "fetch(...)"` direto contra a Edge Function
  de produção, com o lead de teste próprio do usuário (904000019) — 1ª
  tentativa (API ainda bloqueada) devolveu `{"ok":false,"erro":"erro_meta",
  "detalhe":{"message":"API access blocked.",...}}` (mesmo formato que o
  código de tratamento de erro do botão já espera,
  `data.detalhe.message`); a 2ª tentativa, depois da Meta liberar,
  devolveu `{"ok":true,"wa_message_id":"wamid...."}` — sucesso real,
  confirmado em `mensagens_whatsapp` (`wa_status='enviado'`). **A tela em
  si (clicar pelo navegador) não foi testada ao vivo nesta sessão** — não
  havia Playwright disponível neste ambiente (mesma limitação de sempre
  do drive `G:\`, ver seção do scraper) — validar clicando de verdade na
  próxima vez que for usado, agora que os envios já saem de verdade.

**Campos manuais do evento preenchidos sozinhos (2026-10-05)** — pedido
do usuário com print real: escolhendo o template "Convite para evento"
(`convite_palestra`) com um evento já selecionado, os campos manuais
"evento (com artigo)" e "data" ainda exigiam digitar tudo à mão, mesmo
o evento já estando escolhido no `<select>` acima. Corrigido:
- Cada variável manual (`chave: null`) de `TEMPLATES_WHATSAPP` ganhou um
  `papel` opcional — `'evento_com_artigo'` (`convite_palestra`/
  `contato_aluno_ativo`) ou `'evento_data'` (só `convite_palestra`).
  `atualizarTemplateConviteApi()` (`js/whatsapp.js`) agora calcula o
  valor desses campos a partir do evento selecionado em
  `#conviteApiEventoSelect` — nunca mais parte de `eventoEscolhido.nome`
  cru pra TODOS os campos manuais (bug sutil da versão anterior: todo
  campo manual recebia o mesmo valor, o nome puro do evento, mesmo o
  campo "data" devendo ser uma data). Campos sem `papel` reconhecido
  (ex: "tipo do evento"/"tema" de `contato_ulisses` — fala de um evento
  PASSADO via Ulisses, não do evento futuro escolhido aqui) continuam em
  branco, exigindo digitação manual como sempre. O `<select>` de evento
  ganhou `onchange="atualizarTemplateConviteApi()"` — trocar o evento
  DEPOIS de já ter escolhido o template também re-preenche os campos
  (antes só recalculava ao trocar de TEMPLATE).
  - `'evento_com_artigo'` → `montarEventoComArtigo(evento)`
    (`js/eventos.js`): monta `"a Abertura de Turma"`/`"o Workshop..."`
    usando o artigo (a/o) cadastrado por TIPO de evento — nova coluna
    `tipos_evento.artigo` (`migracao_tipos_evento_artigo.sql`, mesmo
    padrão de `trilha`/`palavras_chave`, editável em "Gerenciar Tipos" na
    Agenda, novo `<select>` por linha). Sem artigo cadastrado pro tipo
    daquele evento (ou evento sem tipo), cai no fallback `'a'` — nunca
    trava, só pode soar levemente errado num caso raro, sempre revisável
    (o campo continua 100% editável, só vem pré-preenchido agora).
    Catálogo carregado via `ARTIGO_POR_TIPO_EVENTO` (`js/eventos.js`,
    populado dentro de `carregarTiposEvento()`, já chamada no início de
    `iniciarConviteApiEmMassa()` via `carregarEventos()` — garantido
    carregado antes de qualquer preenchimento automático rodar).
  - `'evento_data'` → `formatarDataCurtaEvento(evento.data)`
    (`js/eventos.js`): `"DD/MM"`, sem ano (bate com o exemplo do próprio
    label do template, "ex: 01/10").
  - Migração rodada (`npx supabase db query --linked`) com seed dos
    artigos conhecidos — tipos padrão (Palestra/Oficina/Aula Inaugural/
    Leitura Comentada/Abertura de Turma → `a`; Workshop/Curso/
    Filosofilme/Café Cultural → `o`) e também os nomes REAIS já
    cadastrados nesta conta, diferentes da lista padrão embutida
    (Workshop/Oficina, (Mini) Curso, Sábado de Voluntariado → `o`) —
    confirmado por `SELECT` direto antes/depois; só `"Outro"` ficou sem
    artigo (genérico demais pra adivinhar gênero, igual sempre foi).

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
       automática. **Confirmado com HTML real (2026-09-11, print do
       usuário)**: a aba "Eventos" repete 1 `<tr ng-repeat="fa in
       filiaisAtivas">` por filial de TODO o sistema (dezenas de linhas),
       com a Descrição em `<textarea>` (por isso o filtro
       `input:not([type="checkbox"])` já ignorava ela sozinho, por sorte)
       e Data/Qtd. Vagas em `<input>`, nessa ordem — bate exatamente com o
       que já estava codificado, nenhuma mudança de seletor precisou.
     - **Revisão geral do catálogo de eventos (2026-09-11)**, depois do
       usuário mandar HTML real da aba "Link": confirmado que **não existe
       campo "Ingresso"/"Valor"/"Preço"** no formulário do Ulisses — o
       texto "Entrada Gratuita" do preview não vem de um campo editável
       (removida a tentativa de leitura, que sempre voltava `null` e
       gastava até 3×4s por evento à toa). Descobertos e passados a
       capturar 2 campos que não existiam no código antes: **"Rodapé"** e
       **"Link alternativo"** (Sympla/Hotmart/etc.) — sem coluna própria
       no banco pra eles, entram concatenados dentro de `descricao` (igual
       Subtítulo/Informação), com "Link alternativo" rotulado como
       `"Link: ..."` no texto final.
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
     - **Ajustes 2026-09-10 (pedido do usuário: "corrigir a importação de
       eventos no Ulisses")** — escopo REVISADO com o usuário no meio do
       trabalho (a 1ª versão lia detalhes completos até 3 anos pra trás
       pra QUALQUER evento; o usuário esclareceu que evento PASSADO só
       precisa de nome/data/tipo/inscritos-comparecimento, não imagem/
       ingresso/capacidade — versão final é mais simples e mais rápida):
       - **`exportarCatalogoEventos()` continua só pra eventos FUTUROS**
         (voltou a pular todo evento com data no passado, como já era) —
         é o único caminho que lê imagem/capacidade/ingresso, e esses
         detalhes só importam pra evento que ainda vai acontecer.
       - **`tipo` de evento PASSADO agora vem de `sincronizarComparecimentoNoCrm()`**
         (extraído pra uma função compartilhada,
         `classificarTipoEventoUlisses()`/`carregarTiposEventoUlisses()`,
         mesmo catálogo `tipos_evento`/`palavras_chave` de sempre) — antes
         essa função só criava a linha "base" (nome+data) SEM classificar
         nada; agora classifica na criação, e também faz um UPDATE pontual
         se encontrar um evento já existente com `tipo` ainda `null`
         (nunca sobrescreve um `tipo` que já tinha valor). É essa função
         que cobre evento passado — não precisa abrir o painel de
         detalhes pra isso, só o `<select>` da tela Recepção (bem mais
         rápido, e evita o risco de abrir o card errado de OUTRA filial).
       - **Tentativa de ler "Ingresso"/"Valor"/"Preço"** (`eventos.ingresso`,
         só pra evento FUTURO, já existia como campo editável manualmente,
         nunca preenchido pelo scraper) — best-effort, **NÃO confirmado
         contra o HTML real** (não sei se esse rótulo existe no painel do
         Ulisses; `ler()` já devolve `null` sem quebrar nada se não
         existir). Se vier sempre vazio, mandar o HTML real do painel
         resolve.
       - **Preservação em `sincronizarCatalogoEventosNoCrm()`**: a
         atualização de um evento já existente agora NUNCA sobrescreve
         com `null` um campo que já tinha valor (`hora`/`capacidade`/
         `imagem_url`/`ingresso`/`descricao`) — antes, uma leitura
         inconsistente entre 2 rodadas (card que não abriu o painel a
         tempo, por exemplo) apagava silenciosamente um dado editado à
         mão na Agenda. `tipo` fica de fora dessa preservação de
         propósito — é sempre recalculado pelo catálogo de
         palavras-chave, pra uma reclassificação em "Gerenciar Tipos"
         valer já na próxima rodada. **Testado ao vivo** (filial
         descartável): evento pré-existente com `imagem_url`/`capacidade`
         reais manteve os dois depois de sincronizar um catálogo com
         esses campos vazios; `tipo` recalculado certo ("Palestra").
       - **Bug real #3 — DIAGNÓSTICO ORIGINAL CORRIGIDO (2026-09-10, o
         usuário apontou o erro com prints reais do Ulisses)**: a versão
         anterior deste bullet afirmava que o `<select>` da tela Recepção
         lista eventos de QUALQUER filial do sistema, indiscriminadamente
         — **isso é FALSO**, correção direta do usuário. O que a tela
         Recepção de uma filial mostra são as **inscrições feitas PARA
         aquela filial especificamente** — inclusive de um evento CRIADO
         (aba Links) por OUTRA conta. É assim porque existem eventos
         **centralizados**: a filial Setor Universitário, por exemplo,
         centraliza a criação dos eventos de "Abertura de Turma" pra toda
         a região de Goiânia — por isso a aba Links de uma filial comum
         nunca mostra esses eventos (não foram criados por ela), mas a
         Recepção mostra corretamente, porque quem se inscreveu escolheu
         aquela unidade especificamente no formulário público de
         inscrição (`inscricao.acropolebrasil.com.br`, que lista TODAS as
         unidades com sua data/hora própria num rádio "Selecione a
         unidade de interesse" — confirmado por print real). Isso é
         legítimo e intencional, não um vazamento cross-filial.
         Confirmado consultando o export real da Recepção de Setor Oeste
         (`comparecimento-Goi_nia___Setor_Oeste.json`): o mesmo nome
         `"Novas turmas do Curso de Filosofia para Viver"` aparece com 3
         datas BEM diferentes (14/10/2026, 28/05/2026, 27/11/2025) — são
         3 ciclos reais e distintos dessa campanha recorrente, cada um
         com gente que de fato se inscreveu para Setor Oeste naquele
         ciclo, não "vazamento" de outra filial.
         **O que ainda não está 100% explicado**: "Bushido, o código de
         honra dos samurais"/"Workshop de Oratória" (criados pela aba
         Links de Garavelo) existem em produção como linhas PRÓPRIAS
         também sob "Goiânia - Setor Oeste" (`eventos.id` 203/202), com a
         MESMA data exata de Garavelo e 0 vínculos cada — diferente do
         padrão "Novas turmas" acima (datas distintas por ciclo). Duas
         explicações possíveis, não confirmadas: (a) são eventos de
         ocorrência única (1 data, 1 local — talvez sediado em Garavelo)
         pros quais Setor Oeste também pode inscrever seu próprio público
         (mesmo padrão de evento multi-filial que `grupo_evento_id` já
         modela no CRM, ver seção "Eventos multi-filial" — nesse caso as
         2 linhas de Setor Oeste são legítimas e vão ganhar vínculos
         assim que alguém de lá se inscrever/comparecer), ou (b) alguma
         outra causa ainda não diagnosticada. **A trava adicionada
         (`chavesComParticipanteLocal`, só criar uma linha NOVA de evento
         se houver 1+ participante local de verdade batendo telefone/
         e-mail) foi MANTIDA no código** — é uma rede de segurança
         razoável independente do diagnóstico (nunca cria uma linha vazia
         "só por aparecer na lista"), mas a JUSTIFICATIVA original
         ("dropdown global") estava errada e foi removida daqui. Se
         Setor Oeste realmente hospeda sessão própria de Bushido/Workshop,
         essa trava não impede nada — a linha já existe, só falta alguém
         local ser vinculado (manualmente pela tela de Participantes, ou
         automaticamente quando/se um participante local for encontrado
         numa rodada futura).
       - **Hora do evento centralizado, capturada de graça (2026-09-14,
         pedido do usuário: "Abertura de Turma" completa mesmo criada por
         outra filial)**: tentamos logar na filial que centraliza
         "Abertura de Turma" (ex: Setor Universitário) pra ler o painel
         de detalhes completo (imagem/vagas) — sem acesso a essa conta.
         O site público (`acropole.org.br/<slug>/`) também não ajuda,
         confirmado testando ao vivo: é uma página institucional fixa
         (endereço/WhatsApp), sem calendário de eventos reais. Achado um
         ganho parcial sem precisar de acesso novo nenhum: a própria
         opção do `<select>` da Recepção já vem como "DD/MM/AAAA HH:MM",
         mas só a DATA era extraída (`paraISO()`) — a HORA ficava
         descartada. `sincronizarComparecimentoNoCrm()` agora também
         extrai a hora (`paraHora()`) e grava em `eventos.hora` ao criar
         a linha base, ou preenche se ainda estiver vazia num evento já
         existente (nunca sobrescreve um valor real já capturado pela
         aba "Eventos" do catálogo completo). **Quem se inscreveu e quem
         compareceu já eram 100% cobertos** por esta mesma função,
         independente de quem criou o evento — não precisou de nada
         novo. **Limitação aceita, sem solução automatizada por ora**:
         imagem e vagas (capacidade) só existem no painel "Link" de quem
         criou o evento — ficam em branco pra evento centralizado, editável
         manualmente na Agenda (rápido, 1x por campanha) até/se um dia
         existir acesso à conta criadora.
       - **`scraper/capturar-eventos-centralizados.js`, NOVO (2026-09-14)**
         — o usuário conseguiu a senha da conta que cria "Abertura de
         Turma" centralizadamente (Setor Universitário), então essa
         limitação parou de ser permanente. Script separado (não faz
         parte do job diário nem do `ulisses-local.js` de cada filial —
         roda avulso, só quando uma campanha nova de Abertura de Turma
         começa): login manual nessa conta específica, abre cada card
         FUTURO da aba "Links", lê Título/Imagem/Subtítulo/Informação/
         Descrição — e a aba "Eventos" do painel, que aqui pode ter
         **VÁRIAS linhas de filial marcadas ao mesmo tempo** (é quem
         organiza pra região toda, diferente do caso de 1 filial só já
         tratado em `lerDataHoraEVagas()`), cada uma com sua própria
         Descrição/Data/Vagas. Casa o nome de cada linha marcada contra
         as nossas 4 filiais (mesmo núcleo distintivo de
         `tokenDistintivoFilial()`) e **só ATUALIZA** (nunca cria) a
         linha de `eventos` que já existe pra aquela filial — sem essa
         linha de base já criada pela Recepção normal daquela filial,
         pula com aviso (`npm run capturar-eventos-centralizados`,
         `scraper/package.json`). NUNCA sobrescreve um campo que já tinha
         valor (mesmo princípio de preservação de sempre). **Não cria
         filial nova nenhuma nem lead nenhum** — é só um complemento de
         detalhe visual pra evento que já existe. **Ainda NÃO testado
         contra o Ulisses real** (escrito com base na estrutura já
         confirmada do painel — mesmos seletores de `ler()`/aba
         "Eventos" já testados em outro contexto, mas a leitura de
         MÚLTIPLAS linhas marcadas ao mesmo tempo é nova) — próxima
         rodada com a conta do Setor Universitário valida.
       - **Bug real GRAVÍSSIMO confirmado (2026-09-15) — data errada pra
         filial que NÃO criou o evento**: a Recepção do Ulisses, vista
         por uma filial que não criou a "Abertura de Turma" (ex:
         Garavelo), mostra o ciclo inteiro já "juntado" numa única opção
         (algo como "Abertura de turma de 25/09 a 01/10"), em vez de uma
         data específica — e `sincronizarComparecimentoNoCrm()` (que só
         entende UMA data por opção) sempre acaba gravando a ÚLTIMA data
         do intervalo pra QUALQUER filial não-criadora, mesmo quando a
         data real dela é outra. Confirmado ao vivo: Garavelo tinha
         28/09/2026 de verdade (segundo a página pública de inscrição),
         mas ficou gravado 01/10/2026 — igual Jardim América/Setor Oeste,
         que por coincidência JÁ tinham 01/10 como data real.
         **`scraper/corrigir-datas-inscricao-publica.js`, NOVO, testado
         ao vivo com sucesso**: usa a página PÚBLICA de inscrição
         (`inscricao.acropolebrasil.com.br/?eventoId=...`) como fonte de
         verdade — ela lista "Selecione a unidade de interesse" com a
         data EXATA de cada unidade, sem precisar de login nenhum (nem no
         Ulisses da filial, nem na conta centralizadora). O usuário
         confirmou que esse mesmo link (e a imagem do evento) aparece no
         site institucional de cada filial — é só entrar lá, copiar o
         link e baixar a imagem. Uso:
         `npm run corrigir-datas-inscricao-publica -- "<link>" "<nome EXATO do evento em eventos.nome>"`.
         Lê a página por PADRÃO DE TEXTO (não seletor CSS — não temos o
         HTML real confirmado, só um print; mesmo princípio de "achar
         pelo texto visível" já usado em outros pontos do scraper), casa
         cada unidade com nossas 4 filiais pelo núcleo distintivo do nome
         (mesma técnica de `nucleoFilialCrm()`), e **SEMPRE corrige** a
         data/hora do evento futuro mais próximo já existente com aquele
         nome exato naquela filial (diferente de
         `capturar-eventos-centralizados.js`, que só completa campo
         vazio — aqui a página pública é autoridade sobre ESTE dado
         específico, então uma data errada precisa ser sobrescrita, não
         só preservada). Nunca cria evento novo — só avisa se a filial
         ainda não tiver a linha base (rodar a sincronização de
         Comparecimento normal primeiro). Também grava `link_inscricao`
         de quebra. **Testado contra a página real** (evento 24343):
         leu as 9 unidades corretamente (3 delas nossas), confirmou
         Garavelo/Jardim América/Setor Oeste já corretos depois da
         correção manual feita nesta sessão (`336`/`500`/`418` — ver
         acima). Barra do Garças não participa deste ciclo específico
         (tem sua própria campanha local, datas diferentes).
         **Segunda rodada, o evento de verdade "Abertura de Turma"
         (2026-09-17)**: o evento acima ("Aula Experimental") é só a
         aula-teste antes da turma abrir — o usuário pediu pra achar e
         corrigir também o evento de MATRÍCULA de verdade ("Novas turmas
         do Curso de Filosofia para Viver" no nosso banco). O
         `eventoId` foi achado pesquisando o site institucional do
         Garavelo (`acropole.org.br/garavelo/`, via WebFetch — cada
         filial tem seu próprio slug em `filiais.slug_site_publico`),
         que lista os cards de evento com o link de inscrição real ao
         lado — achou `eventoId=24344` (diferente do 24343 da Aula
         Experimental). Rodando o script contra ele: **as 3 filiais
         estavam erradas** (não só 1 desta vez) — todas tinham
         2026-10-14 gravado, mas o real é Garavelo 05/10, Jardim América
         E Setor Oeste 08/10 (essas duas coincidentemente batiam entre
         si, mas não com Garavelo nem com a data antiga gravada).
         Confirma que esse bug (data "juntada" do ciclo inteiro, sempre
         vira a ÚLTIMA data pra filial não-criadora) afeta bem mais gente
         do que só 1 filial por campanha — vale sempre rodar o script pra
         TODAS as filiais de uma campanha, não só conferir a que parece
         mais suspeita.
       - **Bug real GRAVÍSSIMO, achado pelo usuário rodando o Garavelo de
         verdade (2026-09-14)**: a Recepção do Ulisses mostrava 6
         pré-inscritos num evento, mas a Agenda do CRM só tinha vinculado
         1. Não era bug de casamento (telefone/e-mail/nome já funcionavam
         certo) — era que `exportarCsvInscricoes()`/`ulisses-local.js`
         só EXPORTAVA o CSV de Inscrições pra disco, **nunca o importava
         de verdade em `leads_inscricoes`** — diferente do Mercúrio
         (`scraper/mercurio.js` chama `importarNoCrm()` sozinho todo
         dia), esse encadeamento nunca existiu do lado do Ulisses. Quem
         se pré-inscreve pela 1ª vez (nunca apareceu em Ativos/Inativos/
         Complementar/Aniversariantes do Mercúrio) simplesmente não
         existia como lead ainda quando `sincronizarComparecimentoNoCrm()`
         tentava casar por telefone/e-mail — só quem já era lead de outra
         fonte (ex: já Ativo) conseguia ser vinculado. Explica a
         estatística "341 sem lead achado" já vista numa rodada real.
         **Corrigido**: `processarFilialLocal()` (`ulisses-local.js`)
         agora tem uma etapa nova, `importar-inscricoes-no-crm`, logo
         depois de exportar o CSV — chama `importarNoCrm()` (mesma
         função que o Mercúrio já usa, pilotando a tela de Importar do
         CRM publicado) ANTES de tentar sincronizar comparecimento, numa
         aba/contexto `pageCrm` separado (mesmo padrão de
         `scraper/mercurio.js`), reaproveitado entre as filiais na mesma
         rodada. **Ainda NÃO testado contra o Ulisses real** — próxima
         rodada valida que os 6 pré-inscritos do exemplo aparecem todos
         vinculados.
       - **RESOLVIDO (2026-09-10, o usuário confirmou direto)**: são
         exclusivos do Garavelo mesmo — confirmado consultando os sites
         públicos das 3 outras filiais (`acropole.org.br/goiania-
         setoroeste/`, `.../goiania-jardimamerica/`, `.../barradogarcas/`)
         via WebFetch: nenhum menciona "Bushido"/"Workshop de Oratória".
         A causa mais provável (não 100% confirmada — sem log de sessão
         do Playwright pra provar) é confusão humana no login manual
         (`ulisses-local.js`): digitar/aceitar a senha de UMA filial na
         janela que o script abriu pensando ser OUTRA — o mesmo padrão já
         registrado antes neste arquivo ("usuário relatou ter se
         confundido sobre qual filial estava logando"). **2 defesas
         novas**: (1) `verificarFilialLogada()` em `ulisses-local.js` —
         depois do login, confere o nome da filial logada; se bater com
         uma filial DIFERENTE da esperada, ABORTA sem exportar/gravar
         nada nessa filial. **Reescrita com HTML real (2026-09-11, print
         do usuário)**: em vez de clicar no link "Filial" do menu e ler a
         PÁGINA INTEIRA por substring (nunca confirmado), agora só lê o
         nome que já fica sempre visível no canto superior direito do
         Ulisses (`<a class="ng-binding">` dentro de `<ul class="nav
         navbar-nav navbar-right">`, ao lado de "[SAIR]") — bem mais
         simples e sem precisar de clique nenhum. Confirmado pelo usuário
         que cada filial mostra um texto diferente ali; o de Jardim
         América é o caso "base" sem sufixo ("Nova Acrópole - Goiás -
         Goiânia"), tratado como caso especial no código — os sufixos
         exatos de Setor Oeste/Garavelo/Barra do Garças ainda NÃO foram
         confirmados individualmente (a função nunca bloqueia por uma
         leitura inconclusiva, só quando o texto bate claramente com
         OUTRA filial conhecida — se aparecer um aviso `ok: null` numa
         rodada real, mandar o texto exato exibido fecha o mapeamento). (2)
         `scraper/verificar-eventos-publicos.js`, NOVO — ao final de
         `npm run ulisses-local`, confere cada evento futuro que ficou em
         `eventos` contra o site público da MESMA filial
         (`filiais.slug_site_publico`, `migracao_filial_slug_site_publico.sql`,
         já preenchido pras 4 filiais ativas), avisando (nunca apaga
         nada sozinho) qualquer evento que o site público da filial não
         confirma. **Ação tomada em produção**: dado o volume de
         contaminação cross-filial confirmado (Mercúrio: índice stale
         entre reloads, bug já corrigido; Ulisses: login/sessão trocada
         entre filiais) e a dificuldade de confiar seletivamente no que
         estava certo, o usuário decidiu apagar TUDO (leads + eventos,
         não WhatsApp/turmas/log) das 4 filiais pra reimportar do zero já
         com as 2 correções acima. Apagados: 14.084 leads, 277 eventos,
         1.731 vínculos (`evento_leads`, cascade junto com os eventos) —
         `leads_a_tratar`/`leads_a_tratar_ignorados` também limpos (ficariam
         órfãos). Registrado em `log_atividade` (`acao =
         'limpeza_total_reimportacao'`, 1 linha por filial, com as
         contagens de antes). Não tocado: `mensagens_whatsapp` (histórico
         de conversa real), `turmas` (grade do Mercúrio, não é o problema
         relatado), `log_atividade` (append-only por design), `filiais`.
       - **Bug real #4 — vínculo de lead de OUTRA filial num evento**:
         achado consultando produção depois do relato do usuário
         ("Amelia Cristina Portugal" aparecendo na lista de um evento de
         Barra do Garças/MT sem ter estado lá) — ela é uma lead LEGÍTIMA
         de "Goiânia - Setor Oeste" (sintética, sem telefone/e-mail,
         `pessoaIdentificador` 900000004), vinculada por engano a um
         evento de outra filial. A checagem telefone/e-mail atual NUNCA
         produziria esse match (ela não tem nem um nem outro) — é resíduo
         de uma versão MAIS ANTIGA da lógica de casamento, de antes desta
         sessão. Achados 9 vínculos assim no total (`evento_leads` cujo
         evento e cujo lead têm `filial` diferente — uma regra objetiva:
         isso NUNCA é válido), todos envolvendo eventos de Barra do
         Garças/MT — removidos manualmente. Não é mais possível esse
         padrão se repetir (o casamento atual já é escopado à própria
         filial desde antes desta sessão). **Limitação conhecida, aceita
         de propósito**: alguém cujo cadastro no Ulisses começou em OUTRA
         filial mas que compareceu de verdade a um evento local (ex:
         "Eliane Maria de Faria", relatada pelo usuário) não é vinculada
         — é o preço de nunca arriscar casar com o lead errado entre
         filiais; fica pra vínculo manual pela tela de Participantes se o
         time souber quem é.
       - **2 bugs reais confirmados em produção (2026-09-10, achados
         diagnosticando um relato do usuário) e corrigidos em
         `sincronizarComparecimentoNoCrm()`**:
         1. **"Lead inventado" — telefone/e-mail bater não garante ser a
            MESMA pessoa.** Diagnóstico rodado contra dado real de Barra
            do Garças/MT (script descartável, não faz parte do projeto)
            achou 6 de 774 vínculos onde o nome que o Ulisses registrou
            pro participante não tem nada a ver com o nome do lead casado
            por telefone — a causa mais provável é telefone COMPARTILHADO
            entre parentes (ex: "Jefferson Teixeira Oliveira" bateu no
            telefone da lead "Lara Costa Dorneles Teixeira", provável
            marido/mulher). 4 desses 6 eram claramente pessoas diferentes
            (removidos manualmente da produção); os outros 2 eram só
            variação de grafia da MESMA pessoa ("Samara"/"Samar",
            "Mariluza"/"Marilusa" — mantidos). Corrigido comparando o
            PRIMEIRO NOME (normalizado, tolerando distância Levenshtein
            <= 2 — mesma técnica de `distanciaLevenshtein()` em
            `js/app.js`, reimplementada aqui pro lado do Node,
            `primeiroNomeParecidoUlisses()`) antes de criar o vínculo —
            nome muito diferente descarta o vínculo (log de aviso pra
            revisão manual) em vez de atribuir o comparecimento à pessoa
            errada. Sem nome de um dos lados pra comparar, não bloqueia
            (preserva o comportamento antigo).
         2. **Evento duplicado quando o nome do catálogo (tela Links) e o
            nome da Recepção divergem** — reproduziu exatamente o bug já
            documentado (card "Bushido"/typo "hora" vs "honra", ver bullet
            de `exportarCatalogoEventos()` acima): como
            `sincronizarComparecimentoNoCrm()` casa evento por
            `(filial, nome EXATO, data)`, uma linha órfã com o nome antigo
            errado nunca batia com o nome novo/correto vindo do catálogo,
            então toda rodada nova criava OUTRO evento duplicado — o
            usuário via o card bonito (imagem, do catálogo) SEM lista de
            inscritos, porque os inscritos foram pro duplicado feio (sem
            imagem, só a linha "base"). Corrigido com um fallback: sem
            match exato, procura por NOME PARECIDO (mesma técnica
            Levenshtein acima, tolerância maior — até 15% do tamanho do
            nome ou 4 caracteres) entre eventos da MESMA data — se achar,
            reaproveita em vez de criar duplicado. Duplicata real já
            existente em produção (Garavelo, evento "Bushido") foi
            mesclada manualmente (`evento_leads` movido pro id certo, id
            errado apagado). **Testado ao vivo** (filial descartável,
            reproduzindo os 2 cenários exatos): nome divergente
            corretamente IGNORADO (não vinculou à pessoa errada); nome
            parecido (variação de grafia) aceito normalmente; evento com
            nome levemente diferente na mesma data reaproveitou o id
            existente em vez de duplicar.
       - **3º bug real confirmado em produção (2026-09-10) — timing em
         `exportarComparecimento()`**: usuário relatou 2 filiais (Garavelo,
         Jardim América — justamente as com MAIS histórico de eventos)
         com status "login OK, mas 1+ exportação falhou". Prints de erro
         reais (`debug/ulisses-comparecimento-*.png`) mostraram a tela
         sempre no estado PADRÃO ("- Selecione um evento -", tabela vazia)
         — sinal de que o erro disparava ANTES de qualquer opção real
         carregar, não porque elas não existissem. Causa: `combobox.waitFor()`
         só garante que a tag `<select>` existe, não que o Angular já
         populou as `<option>`s de verdade — pra uma lista de milhares de
         eventos (Garavelo: 6439 linhas de histórico) isso demora mais que
         pra só desenhar o elemento vazio. Corrigido com espera ATIVA (poll
         de 500ms, até 20s) em vez de 1 leitura única — mesmo padrão já
         usado em `exportarCatalogoEventos()` pro Título do card. **Ainda
         NÃO testado contra o Ulisses real** (é um ajuste de timing puro,
         sem como reproduzir a demora real do Angular fora do site) — a
         próxima rodada do usuário confirma se resolveu.
       - **RESOLVIDO — "Setor Oeste sem eventos futuros" e "Garavelo só 1
         de 2" eram o MESMO bug** (2026-09-10, achado consultando `eventos`
         direto no banco depois do usuário relatar o sintoma de novo pro
         caso Garavelo): 10 eventos futuros (Setor Oeste, Garavelo, Jardim
         América) estavam com `ativo = false` no banco — provavelmente
         resíduo de quando o usuário "excluiu todos os eventos futuros"
         antes de deixar o scraper recadastrar do zero (clicou em
         "Desativar" na Agenda, que só marca `ativo=false`, não apaga a
         linha — ver bullet "Desativar = ativo=false" na seção da tabela
         `filiais`, mesmo padrão de retenção usado em toda tabela do
         projeto). O scraper (`sincronizarCatalogoEventosNoCrm()` e
         `sincronizarComparecimentoNoCrm()`) SEMPRE capturou os eventos
         certos e casou pelo `(filial, nome, data)` certo — mas como
         nenhum dos dois `UPDATE` tocava na coluna `ativo`, o evento
         recadastrado voltava com todos os dados corretos e continuava
         INVISÍVEL na Agenda (que só lista `ativo=true` por padrão),
         dando a falsa impressão de "o scraper não achou o evento".
         Corrigido: os dois agora sempre gravam `ativo: true` ao
         criar/atualizar um evento — se o Ulisses ainda lista, deveria
         estar visível na nossa Agenda também. Reativados manualmente os
         10 eventos futuros já afetados em produção (as 3 filiais).
       - **Evento FUTURO não deve virar "confirmado"/"não compareceu"
         sozinho — pedido explícito do usuário (2026-09-10)**: antes,
         `sincronizarComparecimentoNoCrm()` criava todo vínculo novo já
         com `resposta_convite='confirmado'` (só por ter se pré-inscrito
         no Ulisses) e gravava `compareceu=false` sempre que o checkbox da
         Recepção vinha desmarcado — pra evento que AINDA NÃO ACONTECEU,
         isso é sempre verdade (ninguém compareceu a um evento que não
         rolou ainda), então gerava um falso "2 confirmados, 2 confirmado(s)
         sem comparecer" pra evento lá no futuro (confirmado pelo card real
         de "Bushido, o código de honra dos samurais", 26/09/2026 — ver
         screenshot do usuário). Corrigido: pra evento com `data >= hoje`,
         `compareceu` só é gravado como `true` (sinal real, recepção já
         fez check-in adiantado) — `false`/ausente vira `null` ("em
         branco", correto: ainda não sabemos), e `resposta_convite` de um
         vínculo NOVO vira `'pendente'` em vez de `'confirmado'` (inscrição
         no Ulisses não é confirmação de presença — isso depende do time
         entrar em contato e a pessoa confirmar de verdade). Evento
         PASSADO mantém o comportamento de sempre (pré-inscrição é sinal
         real de interesse, e o comparecimento já reflete o que aconteceu
         de fato). **Limpeza retroativa em produção**: 19 vínculos em 5
         eventos futuros (as 3 filiais) tinham exatamente esse padrão
         (`compareceu=false` + `resposta_convite='confirmado'` num evento
         `data >= hoje`) — resetados pra `compareceu=null`/`'pendente'`.
         **Testado ao vivo** (filial descartável): evento futuro sem check
         grava `pendente`/`null`; evento passado com check desmarcado
         mantém `confirmado`/`false` (comportamento de sempre).
       - **Mensagem de status corrigida**: `processarFilial()`/
         `processarFilialLocal()` diziam "(marco 2 — ainda não alimenta
         o CRM automaticamente)" mesmo depois de `sincronizarCatalogoEventosNoCrm()`/
         `sincronizarComparecimentoNoCrm()` já estarem chamadas e
         funcionando — texto estava só desatualizado (marco 3 já foi
         feito), corrigido pra refletir a realidade.
       - **"Inscritos automáticos" já existia** (`sincronizarComparecimentoNoCrm()`,
         apesar do nome — lê a MESMA tela "Pré-inscrições → Recepção" que
         o usuário pediu pra cruzar, e já grava `evento_leads` com
         `resposta_convite='confirmado'` pra quem casa por telefone/
         e-mail) — confirmado em produção no momento deste ajuste: 1004
         vínculos já gravados dessa forma. O que estava faltando de
         verdade era só o `tipo` de evento passado (item acima).
       - **Importar 1 filial só de cada vez** (`ulisses-local.js`) — o
         usuário relatou ter se confundido sobre qual filial estava
         logando e digitado a senha errada na janela errada, cadastrando
         eventos de uma filial em outra (já limpou os eventos futuros
         incorretos manualmente antes de reimportar). Resposta: **já era
         possível** rodar 1 filial só — `npm run ulisses-local -- "Setor
         Oeste"` — só não estava em destaque no topo do arquivo, agora
         está.
       - **Tentativa de pré-preencher o e-mail via `login_hint` na URL —
         TESTADA e REVERTIDA (2026-09-10)**: a ideia era passar
         `?login_hint=...` pra `login.html` (parâmetro padrão OIDC/Auth0
         que apps com `auth0-spa-js` costumam repassar sozinhos pro
         Universal Login), documentada como best-effort que "se não
         funcionar, nada quebra". Isso era ERRADO: o usuário testou e
         relatou telas BRANCAS com a URL mudando sozinha, sem nenhuma
         informação na tela — a página de login nunca chegou a carregar
         o formulário de verdade. `login.html` provavelmente usa
         `location.search`/`location.href` pra alguma lógica própria de
         roteamento/redirect (SPA), e o parâmetro extra quebrou esse
         fluxo em vez de só ser ignorado. **Revertido**: `aguardarLoginManual()`
         volta a navegar pra `URL_LOGIN` limpa, sem nenhum parâmetro.
         Lição: um parâmetro de URL "padrão" em outro sistema nunca é
         garantidamente inofensivo só porque é comum — sem confirmar
         contra o HTML/comportamento real, o risco de quebrar algo é
         real, não hipotético.
       - **Mostrar o e-mail só no TERMINAL não é confiável — achado
         testando ao vivo (2026-09-10)**: usuário relatou não ter visto
         a mensagem de forma alguma. Causa provável: o Chromium abre e
         rouba o foco na hora que o script imprime a dica, deixando a
         janela do terminal escondida atrás dele — fácil de nunca notar
         se a pessoa só olha pro navegador. **Corrigido mostrando o
         e-mail DENTRO da própria janela do navegador**: antes de ir pra
         `URL_LOGIN` de verdade, `aguardarLoginManual()` agora renderiza
         uma tela local (`page.setContent()`, sem rede) com o e-mail em
         destaque e um botão "Ir para a tela de login" — só avança
         quando esse botão é clicado DE VERDADE (`window.__ulissesLocalConfirmado`,
         setado só pelo `onclick`; o script espera essa flag virar
         `true` via `page.waitForFunction()`, nunca clica nele sozinho —
         só assim garante que é um clique humano, não um passo
         automático que passaria direto). Sem credencial salva pra
         aquela filial, pula essa tela (nada pra mostrar) e vai direto
         pro login, como antes. Testado com um script isolado
         (Playwright): confirmado que o texto do e-mail aparece
         corretamente, que a espera FICA BLOQUEADA sem clique (não
         resolve sozinha), e que libera imediatamente depois de um
         clique real — depois removido, não faz parte do projeto. O
         e-mail continua sendo impresso no terminal também, como
         registro extra.
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
       - **Armadilha real de timing, achada em 2026-09-10** (é a causa
         raiz de "pessoas inativas sem a tag de Inativo" persistir mesmo
         DEPOIS desta correção existir): o commit que liga esta importação
         (`d4c1961`) só foi feito/pushado às 07:56 (Brasília) do dia
         10/09 — mas a última execução automática do Mercúrio antes disso
         tinha rodado às 07:01, ainda com o código ANTIGO (só exportava
         CSV, nunca escrevia no CRM). Confirmado lendo o LOG REAL do
         GitHub Actions daquela execução (`gh`/API do GitHub,
         `actions/runs/.../jobs/.../logs`) — via commit `head_sha` de cada
         run comparado com `git merge-base --is-ancestor`. Toda automação
         que dependa de "a próxima execução agendada" precisa considerar
         que o GITHUB ACTIONS usa o `main` de QUANDO O JOB DISPARA, não
         de quando o código foi escrito na sessão — uma correção só entra
         de verdade na PRÓXIMA execução DEPOIS do push, nunca na que já
         estava em andamento ou já tinha rodado antes do push.
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
     - **Bug real achado (2026-09-10)**: passou a existir um 2º botão
       "Rodar Mercúrio Agora" (na Agenda do Dia do Dashboard, ver seção
       própria) sem o `id="btnDispararMercurio"` que a função usava pra
       mostrar spinner/mensagem — clicar nele disparava o scraper DE
       VERDADE, mas sem NENHUM feedback visual (a confirmação só aparecia
       dentro do modal de Sincronização, que nem abria sozinho), parecendo
       que "não fez nada". Isso levou a um clique duplicado (no botão
       certo, tentando de novo) que chegou a disparar o workflow 2 VEZES
       em paralelo contra o Mercúrio real. Corrigido: qualquer botão com a
       classe `.btn-disparar-mercurio` funciona igual (via
       `querySelectorAll`, não mais 1 ID fixo), a tela de Sincronização
       abre AUTOMATICAMENTE ao disparar de qualquer lugar, e uma trava
       global (`disparoMercurioEmAndamento`) impede clique duplicado
       enquanto uma rodada já está em andamento.
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
     - **Disparo por 1 filial só (2026-09-10, pedido do usuário)**: motivo
       duplo — testar uma mudança numa filial só sem esperar as outras 3, e
       evitar tráfego desnecessário no Mercúrio conforme mais filiais forem
       entrando (login/exportação de todas de uma vez fica cada vez mais
       pesado). `<select id="mercurioFilialFiltro">` dentro do modal
       (populado a partir de `filiaisDisponiveis`, "Todas as filiais" como
       padrão) — o botão da Agenda do Dia (Dashboard) continua sempre
       disparando TODAS, de propósito (é o botão "atualiza tudo" do
       cross-filial, não faria sentido restringir a 1). O valor escolhido
       vai em `{filial}` no corpo de `scraper-disparar` -> repassado como
       `inputs.filial` no `workflow_dispatch` (novo `on.workflow_dispatch.inputs.filial`
       em `scraper.yml`) -> chega em `mercurio.js` via `process.env.FILTRO_FILIAL`
       -> cai no MESMO `filtro` que já existia pra uso local
       (`node mercurio.js -- "Garavelo"`, agora com 2 fontes possíveis:
       argv OU env var). String vazia/omitida em qualquer ponto da cadeia =
       comportamento de sempre (todas as filiais). **Não testado de ponta
       a ponta contra o GitHub Actions real** (deploy da Edge Function já
       feito; evitei disparar mais uma rodada real logo depois de já ter
       corrigido 2 rodadas redundantes na produção, ver bullet abaixo) — a
       próxima vez que o usuário escolher 1 filial no seletor valida o
       caminho completo.
     - **Bug real relatado pelo usuário (2026-09-10): "atualizei a página
       e pareceu que parou de rodar"** — não parou: o job roda inteiramente
       no GitHub Actions, sem nenhuma dependência do navegador continuar
       aberto. O que se perdia era só o ACOMPANHAMENTO visual
       (`disparoMercurioEmAndamento`/`pollSincronizacaoTimer` são só
       memória JS, zeram com qualquer F5) — sem nenhum sinal de "ainda tem
       uma rodada rolando", o botão "Rodar Mercúrio Agora" voltava a
       aparecer solto/clicável, convidando a clicar de novo. **Foi
       exatamente isso que aconteceu**, confirmado consultando a API REST
       do GitHub (`api.github.com/repos/.../actions/workflows/scraper.yml/runs`,
       pública, sem token — o repositório é público): a rodada que o
       usuário via completar às 16:00:59 (Brasília) era real e tinha
       terminado com sucesso, mas 2 rodadas REDUNDANTES foram disparadas
       poucos minutos depois (16:09 e 16:16), quase certamente pelo mesmo
       clique repetido depois do reload. Corrigido persistindo
       `{timestampAntes, inicioPoll, filial}` em `localStorage`
       (`crm_na_mercurio_disparo_em_andamento`) a cada disparo — a lógica
       de acompanhamento foi extraída pra `iniciarAcompanhamentoMercurio()`,
       chamada tanto por um disparo novo quanto por
       `restaurarAcompanhamentoMercurioSeHouver()` (roda 1x no
       `DOMContentLoaded`): se sobrar um acompanhamento salvo e ainda
       dentro do orçamento de 20min, RETOMA sozinho (mesmo timestamp,
       mesmo relógio de início — não reinicia a janela de timeout), sem
       deixar o botão parecer "livre" enquanto ainda tem uma rodada de
       verdade em andamento no GitHub. **CORREÇÃO do que foi escrito
       aqui**: "reimportar 2x a mesma coisa é inofensivo" estava ERRADO —
       ver bullet "GRAVÍSSIMO" logo abaixo, achado poucos minutos depois:
       rodadas concorrentes não são inofensivas, corrompem dado de
       verdade.
     - **GRAVÍSSIMO, achado em produção minutos depois do bullet acima
       (2026-09-10)**: o usuário relatou "rodei o Mercúrio e não importou
       Garavelo nem Barra do Garças" — a causa real não era nenhuma
       filial ficar de fora, era CONCORRÊNCIA: as 2 rodadas redundantes
       do bullet anterior (mais outras disparadas em seguida tentando
       "corrigir") ficaram rodando PARCIALMENTE AO MESMO TEMPO (confirmado
       via API do GitHub: run concluindo às 19:18:21 enquanto outro run já
       tinha começado às 19:16:10), todas logadas com a MESMA credencial
       compartilhada do Mercúrio (Matrícula/Senha, `filial='GLOBAL'` no
       cofre — só existe 1 login pra todas as filiais). Evidência
       definitiva, achada consultando `log_atividade` diretamente: uma
       importação com `enviados=117`/`resumo.alunoAtivo=33`/
       `resumo.exAluno=84` — a ASSINATURA EXATA de Barra do Garças, igual
       bit a bit a outras importações confirmadas daquela filial — foi
       gravada com `"filial": "Goiânia - Jardim América"`. Ou seja: uma
       sessão concorrente leu/exportou os dados REAIS de uma filial mas o
       dado foi importado no CRM sob o NOME de outra — **exatamente a
       mesma classe de sintoma já documentada como "Bug real #4
       GRAVÍSSIMO" (índice de link CADASTRO stale entre reloads,
       corrigido com `indiceAtualParaLabel()`)**, só que aquela correção
       resolve a navegação DENTRO de uma única sessão; nunca protegia
       contra 2 sessões inteiras rodando ao mesmo tempo pisando uma na
       outra do lado do SERVIDOR do Mercúrio (é bem provável que o
       Mercúrio não isole bem 2 logins simultâneos da mesma matrícula —
       nada que o nosso código sozinho resolvesse). Isso explica também,
       retroativamente, o "CELSO JESUS MORAIS existe 3x" e outros
       duplicados antigos nunca 100% explicados: sempre foi concorrência,
       o índice stale era só o sintoma mais fácil de flagrar, não a causa
       raiz completa. **Corrigido na raiz**: `concurrency: {group:
       scraper-mercurio, cancel-in-progress: true}` em `scraper.yml` —
       recurso NATIVO do GitHub Actions, garante que só 1 execução deste
       workflow roda por vez (um disparo novo CANCELA o anterior em vez
       de rodar em paralelo). Resolve pra sempre, sem depender de nenhum
       lock do lado do CRM (que só protege clique duplicado NO MESMO
       navegador — nunca protegeria contra o cron diário caindo no meio,
       outro dispositivo, ou outra aba). O passo do Ulisses (sempre `if:
       false`, nunca executava de verdade) foi REMOVIDO do arquivo por
       completo nesta mesma limpeza — pedido explícito do usuário
       ("quero um scraper só para o mercúrio, e um só para o ulisses"):
       tecnicamente já eram 100% separados (scripts diferentes,
       `ulisses-local.js` roda só na máquina local do usuário, nunca no
       GitHub Actions), mas o passo morto sugerindo uma dependência que
       nunca existiu só confundia. `name:` do workflow trocado pra
       "Scraper Mercúrio" pra reforçar isso visualmente na aba Actions do
       GitHub. **Arquivo continua `scraper.yml`** (não renomeado pra
       `mercurio.yml`) — decisão de escopo, pra não ter que coordenar
       trocar o default de `GITHUB_WORKFLOW_FILE` na Edge Function
       `scraper-disparar` sob a mesma pressa de corrigir a concorrência;
       renomear o arquivo é só cosmético e fica pra depois se ainda
       importar.
     - **Bug real relatado pelo usuário (2026-09-10): "parei direto no
       github, mas continue rodando no crm"** — cancelar a run pela UI do
       GitHub mata o processo do `mercurio.js` com SIGINT/SIGTERM; sem
       handler nenhum pra esses sinais, ele morria sem gravar NADA em
       `status_sincronizacao_automatica`. Como o poll do CRM
       (`iniciarAcompanhamentoMercurio()`) só detecta "terminou" vendo uma
       linha NOVA aparecer, cancelamento pelo GitHub simplesmente não
       produz sinal nenhum pro CRM enxergar — fica "Rodando..." até o
       timeout de 20min. **2 correções**: (1) `mercurio.js` agora escuta
       `SIGINT`/`SIGTERM` (`tratarCancelamento()`, no fim do arquivo) e
       tenta gravar um status de cancelamento em até 5s antes de sair —
       best-effort, dentro da folga de ~7.5s que o GitHub Actions dá entre
       o sinal e o SIGKILL final. (2) Rede de segurança no lado do CRM,
       pro caso desse aviso não chegar a tempo (ex: SIGKILL direto, sem
       folga): link "Cancelei no GitHub, parar de acompanhar" no próprio
       aviso "Rodando..." (`cancelarAcompanhamentoMercurio()`) — limpa o
       estado local (memória + `localStorage`) e reabilita o botão na
       hora, sem esperar nada do servidor. Esse link também sobrevive a
       fechar/reabrir o modal (`abrirSincronizacaoScraper()` agora
       reconstrói o aviso "Rodando..." se `disparoMercurioEmAndamento`
       ainda for `true`, em vez de só mostrar o card de status parado,
       que já era um gap pequeno de antes). Testado ao vivo (Playwright):
       simulando um acompanhamento em andamento, chamar
       `cancelarAcompanhamentoMercurio()` reabilita o botão e limpa o
       `localStorage` imediatamente.
     - **Bug real relacionado, achado no mesmo incidente — filtro de
       filial não batia com o rótulo do Mercúrio**: o novo seletor de
       filial (bullet acima) manda o `filiais.nome` inteiro do CRM (ex:
       "Goiânia - Garavelo", "Barra do Garças/MT") como filtro — mas o
       `.includes()` original era LITERAL, sem tirar acento nem palavra
       genérica, então nunca batia (a etiqueta do Mercúrio usa outra
       estrutura de texto: "GOIÂNIA UNIVERSITARIO: GOIANIA GARAVELO", sem
       o " - "; e não tem o "/MT" que sobra em "Barra do Garças/MT").
       Confirmado no próprio `status_sincronizacao_automatica`: tentar
       rodar só "Goiânia - Garavelo" deu
       `"Nenhuma filial bate com o filtro"`. Corrigido reaproveitando a
       MESMA técnica que `resolverFilialCrm()` já usava com sucesso
       (extraída pra `nucleoDistintivoFilial()`): tira acento
       (`normalizarTextoFilial()`) e palavra genérica (`GOIANIA`/
       `UNIVERSITARIO`/`MT`) dos 2 lados antes de comparar — testado
       isoladamente (fora do navegador real) contra os 4 rótulos reais do
       Mercúrio: as 4 filiais batem certo agora. **As rodadas concorrentes
       do incidente acima também produziram novos leads possivelmente
       mesclados/duplicados** (contagem de Jardim América oscilando
       durante a investigação, 2743 -> 2572, entre auto-merges de
       `detectarLeadsATratar()` disparados por 2 importações da MESMA
       filial ao mesmo tempo) — recomendado fazer OUTRA limpeza total +
       reimportação única (sem concorrência, já com os 2 fixes acima)
       antes de confiar no dado das 4 filiais de novo.
     - **Achado incidental investigando o bug acima**: as tentativas
       manuais de Ulisses do próprio dia (13:49-14:26 Brasília, ANTES da
       limpeza total desta sessão) mostraram URLs com
       `?login_hint=...@...` nos logs de erro — o parâmetro que já tinha
       sido testado e REVERTIDO (ver bullet "Tentativa de pré-preencher o
       e-mail via login_hint... TESTADA e REVERTIDA" mais abaixo). Ou seja,
       `C:\Scrapper` estava rodando uma cópia DESATUALIZADA de
       `ulisses-local.js` (o revert existia no código-fonte/git, mas nunca
       tinha sido copiado pra lá) — explica pelo menos parte das falhas
       reais de Garavelo/Jardim América naquele dia. **Lição**: depois de
       qualquer edição em `scraper/*.js` nesta sessão (ou em qualquer
       sessão futura), reconferir que `C:\Scrapper` foi realmente
       ressincronizado ANTES da próxima rodada real — "committei e
       documentei" não é o mesmo que "está rodando de verdade na máquina
       que importa". `ulisses-local.js`/`verificar-eventos-publicos.js`/
       `mercurio.js` foram resincronizados nesta sessão (ver histórico
       acima) — já sem esse parâmetro.

### Scraper Ulisses/Mercúrio — reformulação do Mercúrio (2026-09-10)

Pedido do usuário, avaliado em várias rodadas de perguntas/screenshots
reais ANTES de qualquer código ("antes de rodar qualquer código, avalie o
seguinte") — mapeou telas novas do Mercúrio (grade de seções da ficha do
aluno, HISTÓRICO, ENDEREÇOS, lista de Turmas, detalhe de turma) e definiu
2 mudanças: (1) o mapeamento de nível de aluno (Merlin/CA, ver bullet
"Nível de aluno/ex-aluno" na seção de Tags) e (2) o fluxo do scraper do
Mercúrio abaixo, em `scraper/mercurio.js` (`processarTurmas()`, renomeada
de `processarMatriculasRecentesTurmas()`).

- **2 modos**: **Incremental** (padrão, roda todo dia sozinho) só processa
  ingressos do MÊS CORRENTE (como já era) + candidatos a REINGRESSO (novo,
  ver abaixo); **Completo** (`node mercurio.js -- --completo` /
  `npm run mercurio-completo`, ou env `MODO_COMPLETO=true`) visita a ficha
  de **todo aluno de toda turma**, bem mais lento — pensado pra importação
  inicial (alimentar e-mail/cidade/UF de toda a base) ou uma reconferência
  pontual, nunca pro dia a dia. **De propósito NÃO exposto como input do
  `workflow_dispatch`** (`.github/workflows/scraper.yml`) — só roda via
  CLI/`.env` local (`C:\Scrapper`), nunca pelo botão "Rodar Mercúrio Agora"
  do CRM nem pelo cron diário, pra ninguém disparar sem querer uma rodada
  tão mais pesada.
- **Reingresso simplificado — comparar Ingresso do aluno vs. Início da
  PRÓPRIA TURMA, não mais "ingresso é este mês"** (ideia do usuário,
  confirmada com exemplo real: turma "AMIGOS", Início 27/08/2026, 2 alunos
  com ingresso em/depois dessa data — novos de verdade — e 1 com ingresso
  20/06/2019 — só pode ser reingresso/transferência, é logicamente
  impossível ter entrado "fresco" numa turma que ainda não existia).
  `processarTurmas()` agora lê **"Início:"** do cabeçalho de cada turma
  (mesmo padrão de `td:has-text(...)` já usado pra "Dia:"/"Horário:") e
  compara com o "Ingresso" de cada aluno da lista — quem tem ingresso
  ANTES do início da turma é candidato; quem tem ingresso NO ou DEPOIS do
  início nunca precisa da checagem (funciona nos 2 modos, reduz quantas
  fichas o Modo Completo também precisa abrir). **Dedup usa a própria tag
  `"Recuperado"`, não uma coluna nova**: como essa tag é permanente (nunca
  removida em reimportação, ver `ehTagDeSistema()`), um candidato que JÁ
  tem a tag nunca é revisitado — resolve o problema levantado pelo usuário
  ("como o CRM vai saber que a pessoa já foi Inativa antes, se zeramos a
  base?") sem precisar reconstruir histórico nenhum: a verificação agora é
  direta na tela HISTÓRICO do Mercúrio (campo "Aluno/Membro Recuperado"),
  não mais por comparação entre 2 importações.
  - `aplicarTagRecuperado()`: acrescenta `"Recuperado"` ao array de tags
    (upsert idempotente) e grava 1 linha em `log_atividade`
    (`acao='recuperacao_detectada_scraper'`, com nome + data de reingresso
    nos `detalhes`) — dá uma trilha DATADA de quando cada recuperação foi
    detectada, base pra um relatório futuro de "Recuperações por Mês" se
    fizer sentido (ainda não construído — pergunta em aberto: vale criar
    uma coluna `data_recuperacao` própria em `leads_inscricoes`, ou o log
    já basta? Não decidido ainda).
- **ENDEREÇOS (Modo Completo apenas)**: mesma navegação de HISTÓRICO
  (clicar no nome do aluno na lista da turma → grade de seções da ficha →
  "ENDEREÇOS") — captura e-mail, cidade, UF e um telefone alternativo.
  Gravados em `cidade`/`uf`/`telefone_alternativo`
  (`migracao_lead_cidade_uf.sql`, aplicada nesta sessão) e `pessoaEmail`
  — `aplicarDadosEndereco()` NUNCA sobrescreve um valor já preenchido
  (mesmo princípio de preservação já usado em
  `sincronizarCatalogoEventosNoCrm()` pro Ulisses).
- **`carregarMapaLeadsPorNome(filialCrm)`**: carrega todos os leads da
  filial num Map por nome normalizado 1x por filial por rodada (mesma
  técnica/limitação de `sincronizarAniversariantesNoCrm()` — homônimo vira
  `ambiguo`, nunca escolhido automaticamente), reaproveitado por toda a
  varredura de turmas em vez de 1 query por aluno.
- **`processarFichaAluno(page, linkNome, {verificarHistorico,
  verificarEnderecos})`**: função combinada que abre a ficha do aluno 1
  vez só e lê HISTÓRICO e/ou ENDEREÇOS, conforme o que for pedido — evita
  abrir a ficha 2x pro mesmo aluno quando os 2 sinais se aplicam (Modo
  Completo + candidato a reingresso ao mesmo tempo).
- **HISTÓRICO — seletores reais confirmados e corrigidos (2026-09-11)**:
  a 1ª versão usava `ctx.getByLabel(/Aluno\/?\s*Membro Recuperado/i)` e
  `getByLabel(/reingressou/i)`, que NUNCA funcionavam — confirmado via
  HTML real (DevTools) que o usuário mandou: a seção "Reingresso
  (Recuperação)" não tem NENHUM `<label>` de verdade, é um
  `<input name="chkrec" type="CHECKBOX">` com texto solto ao lado ("Aluno/
  Membro Recuperado"), e a data de reingresso é 3 `<input>` de TEXTO
  separados (`txtdiar`/`txtmesr`/`txtanor` — dia/mês/ano, não 1 campo de
  data só). Reescrito com os seletores reais
  (`ctx.locator('input[name="chkrec"]').isChecked()`, valor de cada
  `txtdiar`/`txtmesr`/`txtanor` concatenado em `DD/MM/AAAA`). **Testado ao
  vivo em produção (Barra do Garças/MT, modo incremental)**: os 3 nomes
  que o usuário apontou como recuperados de verdade (Laura, Simone,
  Tibério) receberam a tag `"Recuperado"` corretamente, mais 3 outros
  candidatos reais na mesma rodada (Danilo, Rosemary, Marcos) — confirmado
  direto no banco depois da rodada.
- **`processarComplementar()` — bug de navegação perdida entre programas
  (2026-09-11)**: cada um dos 4 programas (C. de Amigos/Correntinha/
  Távolas/Janos) tinha um `continue` (registros vazios, ou erro de
  leitura) posicionado ANTES do `page.goto(URL_FUNCOES, ...)` de
  recuperação no fim do bloco — um `continue` disparado num programa
  (ex: "Correntinha" vazio) pulava a navegação de volta, e o PRÓXIMO
  programa do loop (ex: "Távolas") dava timeout tentando achar
  `ger_funcao.php` a partir de uma tela errada. Corrigido envolvendo o
  corpo inteiro do loop em `try { ... } finally { await
  page.goto(URL_FUNCOES, ...) }` — confirmado que `continue` dentro de um
  `try` ainda executa o `finally` antes de pular pra próxima iteração.
- **ENDEREÇOS/Aniversariantes — tag "Sem E-mail" nunca era removida ao
  preencher o e-mail (2026-09-11)**: tanto `aplicarDadosEndereco()`
  (Modo Completo) quanto `sincronizarAniversariantesNoCrm()` gravavam
  `pessoaEmail` mas nunca tiravam a tag `"Sem E-mail"` que já estava no
  lead — confirmado por 2 screenshots reais do usuário (Danilo/Daniel com
  e-mail visível no bloco Contato, mas o badge "Sem E-mail" continuava
  aparecendo). Corrigido nos dois lugares: ao gravar um `pessoaEmail`
  novo, remove `"Sem E-mail"` do array de tags se estiver presente.
  **Corrigido retroativamente em produção** com um script descartável —
  1210 leads em TODAS as filiais tinham esse resíduo (confirma que o bug
  existia desde que a sincronização de e-mail foi adicionada, não só
  nesta rodada).
- Reentrar na turma do zero por aluno (`entrarNaTurma()`, CADASTRO →
  Turmas → clica na turma de novo) em vez de tentar "voltar" no meio de
  um `<frameset>` — mais lento, mas evita depender de navegação incerta.
  Best-effort em todas as camadas (por aluno, por turma, por filial) —
  qualquer falha só gera aviso no log (`[ficha-aluno]`), nunca trava o
  resto da rodada.

#### Ativos/Inativos 100% completos sem depender do Ulisses (2026-09-11)

Pedido explícito do usuário: "temos que ter ativos e inativos completos:
com telefone, e-mail, cidade/UF, data de aniversário... não é pra
depender do Ulisses pra nada". Resolvido reaproveitando telas do Mercúrio
já comprovadamente funcionais, em vez de depender dos seletores ainda não
confirmados de HISTÓRICO/ENDEREÇOS:

- **E-mail/cidade/UF**: a tela **Aniversariantes** (já usada pra
  `data_nascimento`) tem uma coluna "Endereço" com Logradouro/Bairro/
  "CIDADE-UF-CEP"/E-mail em 4 linhas dentro da MESMA célula — confirmado
  por print real. `extrairEnderecoAniversariante()` faz o parse (procura
  a linha com "@" pra e-mail, e a linha no formato "CIDADE-UF-numero" pra
  cidade/UF — CEP vira "0" quando não preenchido). `sincronizarAniversariantesNoCrm()`
  agora grava `pessoaEmail`/`cidade`/`uf` além de `data_nascimento`,
  sempre preservando valor já existente. **Não usa a coluna "Fone" desta
  tela** — confirmado pelo usuário que vem sem DDD, não confiável.
  Cobre Ativos E Inativos de uma vez (`INA` já está em
  `SITUACOES_ANIVERSARIANTES`).
- **Telefone**: `aplicarTelefoneDaTurma()` — a lista de alunos de cada
  Turma (já lida por `processarTurmas()`, dado comprovadamente confiável)
  tem telefone de TODO aluno, não só de quem matriculou recente; agora
  preenche quem estiver sem telefone, em qualquer modo (Incremental ou
  Completo), sem navegação extra. A lista "Ativos" nunca teve telefone —
  só a Turma tem.
- **Círculo de Amigos/Correntinha/Távolas/Janos** (`processarComplementar()`):
  achado testando de verdade — essas pessoas **nunca aparecem na lista
  "Ativos"** (é uma seção separada, "COMPLEMENTAR", no menu do Mercúrio,
  confirmado por 4 prints reais). Sem isso, ninguém do Círculo de Amigos
  nunca ganhava lead nem tag no CRM. Lê as 4 listas (`exportarComplementar()`,
  2 formatos de coluna confirmados — "C. de Amigos" sem nascimento, as
  outras 3 com) e, pra quem já existe (casado por nome), só adiciona
  `"Ativo"` + o nível (`CA`/`Merlin`/`Merlin`/`JN`, mesmo mapeamento de
  `classificarNivel()`); pra quem não existe, cria um lead novo — ID
  sintético `BASE_ID_COMPLEMENTAR (970000000) + matrícula real do
  Mercúrio` (aqui "Matr." já é a matrícula de verdade, confirmado no
  print — diferente da tabela de Turma, onde é só um índice de linha),
  coluna "Frios" (mesmo default de `colunasPadrao()`, js/app.js). Roda no
  modo Incremental normal, ANTES de Aniversariantes (pra quem for criado
  aqui já poder ser enriquecido na etapa seguinte).
- **3 bugs reais corrigidos no mesmo dia, achados testando de verdade**:
  (1) o parsing de `--turma`/filtro de filial não filtrava a `--` que o
  Node deixa em `process.argv` quando roda um arquivo `.js` (não `-e`)
  com um `--` solto na linha de comando — rodava nas 4 filiais mesmo
  pedindo 1 só; (2) quando `--turma` estava AUSENTE, a exclusão de índice
  descartava sempre a posição 0 (onde cai o nome da filial, quando é o
  único argumento) — mesmo sintoma, causa diferente; (3) a etapa de
  Aniversariantes rodava ANTES da importação de Ativos/Inativos no CRM —
  numa filial recém-zerada, tentava casar por nome contra leads que
  AINDA NÃO EXISTIAM (112 de 112 sem match, confirmado testando contra
  Barra do Garças/MT). Reordenado: `importarNoCrm()` agora roda primeiro,
  Complementar/Aniversariantes/Turmas depois.

### API oficial do Ulisses (OAuth2 Client Credentials, via Auth0) — LIBERADA (2026-09-18)

Descoberta nova, potencialmente GRANDE: existe uma API REST oficial por
trás do Ulisses (`https://api.acropolebrasil.com.br/`, documentada em
`/v3/api-docs` — Swagger, Spring Boot), com autenticação
machine-to-machine (OAuth2 Client Credentials Grant, tenant Auth0
`acropolebrasil.us.auth0.com`). Se isso avançar, **substitui o scraper
Playwright do Ulisses inteiro** (login manual, Cloudflare, HTML frágil)
por chamadas HTTP diretas — muito mais simples e confiável.

- **Contato**: Célio Vasconcelos, responsável pelo banco de dados do
  Ulisses do lado da Acrópole Brasil (contato via WhatsApp do usuário,
  fora do CRM). Ele confirmou que a API existe e já passou um client
  M2M — mas foi explícito: **"Para estudo, enquanto preparo o acesso a
  chamadas"** (ele sempre soube que era só sandbox por enquanto) e,
  quando soube que a integração está sendo construída com IA, respondeu
  **"Se eu me envolver nisso, não tem fim"** + "Estuda o protocolo
  OAuth2 com JWT" — um recado real (em tom de brincadeira, sem climão)
  de que ele não quer virar suporte técnico sob demanda de uma lista
  crescente de pedidos. **Lição de relacionamento, não só técnica**: não
  mandar pra ele mais mensagens técnicas/listas de endpoint por
  iniciativa própria — ele já sabe o que falta (mandamos 1 vez, com a
  lista completa de endpoints/tags) e vai liberar no tempo dele. Deixar o
  lado nosso PRONTO e só confirmar quando ele avisar, em vez de cutucar.
- **Endpoints mapeados** (lendo o Swagger completo, 63 rotas — não é
  chute): a API cobre tanto o que interessa pro CRM (inscrições, eventos,
  comparecimento) quanto um sistema de e-mail marketing próprio do
  Ulisses (grupos, mensagens, envios — fora do nosso escopo). Os
  relevantes:
  - `GET /facade/csvInscricoes/{filialId}` — o CSV de Inscrições direto,
    sem Playwright.
  - `GET /facade/participantes/{eventoId}` — participantes de um evento.
  - `POST /facade/compareceu/{emailEventoId}/{compareceu}` — marcar
    comparecimento.
  - `GET /facade/filiaisAtivas` / `GET /facade/filial/{filialId}` — lista
    de filiais e o ID interno de cada uma NO SISTEMA DELES (ainda não
    sabemos o mapeamento pras nossas 4 filiais — só descobrimos quando
    `filiaisAtivas()` parar de dar 401).
  - `GET /facade/listarTodosEventos/{filialId}` — catálogo de eventos.
  - **Públicos, já funcionam com o client atual, sem scope nenhum**:
    `GET /tiposEvento`, `GET /proximosEventos`, `GET /evento/{eventoId}`,
    `GET /eventos/{filialId}` — dá pra usar hoje mesmo se algum dia fizer
    sentido (ex: catálogo de eventos futuros sem precisar de permissão).
- **Estado da autorização, confirmado por teste real (não suposição)**:
  o token é emitido normalmente (`grant_type=client_credentials`), mas o
  JWT devolvido **não tem nenhum claim `scope`** — decodificado e
  conferido. Pedir um `scope` explícito no corpo do POST pro Auth0 (ex:
  `"scope":"read:eventos read:inscricoes"`) devolve
  `{"error":"access_denied","error_description":"Client has not been
  granted scopes: ..."}` — prova objetiva de que NADA foi concedido
  ainda pro client `6ZTGIIVJGxQ4BoZmjgOe1t3QR9luUHqA` nessa API, do lado
  do painel Auth0 da Acrópole Brasil (aba "Machine to Machine
  Applications" da API, ou RBAC/Permissions se estiver habilitado).
  Reflete exatamente o "enquanto preparo o acesso a chamadas" que o
  Célio já tinha avisado — não é bug nem má configuração da nossa parte.
- **Credencial já salva no cofre** (`credenciais_scraper`, novo valor de
  `sistema`: `'ulisses_api'`, `migracao_credenciais_scraper_ulisses_api.sql`
  — JÁ RODADA nesta sessão via `supabase db query --linked`): client_id
  vai em `usuario`, client_secret cifrado em `senha_cifrada`, sempre
  `filial='GLOBAL'` (é 1 aplicação M2M só, compartilhada — igual
  Mercúrio). Salva também na UI: bloco novo "Ulisses — API oficial" em
  "Login Automático" (`renderizarCredenciaisScraper()`/
  `salvarCredencialScraper()`, `js/importador.js`) — e na Edge Function
  `gerenciar-credenciais` (aceita `sistema='ulisses_api'` agora, mesma
  validação/força `filial='GLOBAL'` de `mercurio`/`mercurio_http`/
  `crm_acesso`).
- **`scraper/ulisses-api.js`, NOVO** — cliente pronto pra essa API:
  `obterTokenUlissesApi()` (lê o client do cofre via `lerCredencial('ulisses_api',
  null)`, cacheia o token em memória por até 24h, renova sozinho) +
  `chamarApi()` genérica autenticada, e uma função exportada por
  endpoint relevante (`tiposEvento`/`proximosEventos`/`evento`/
  `eventosPorFilial` públicas; `filiaisAtivas`/`filial`/
  `listarTodosEventos`/`participantesEvento`/`csvInscricoes`/
  `marcarCompareceu` protegidas). **De propósito NÃO encadeado em
  nenhum job ainda** (`main()` de `ulisses.js`/`mercurio.js` não chama
  nada daqui) — os protegidos sempre vão dar 401 até o Célio liberar, não
  faz sentido gerar erro constante num job que já roda sozinho.
- **`scraper/testar-ulisses-api.js`, NOVO** (`npm run testar-ulisses-api`,
  dentro de `scraper/`) — roda os 2 grupos de endpoint (públicos e
  protegidos) e imprime um relatório simples (✅ funcionou / 🔒 ainda
  bloqueado com 401, o esperado / ❌ erro de verdade, inesperado). Existe
  especificamente pra checar "o Célio já liberou?" a qualquer momento sem
  precisar pedir pra alguém rodar `curl` na mão. **Testado ao vivo
  (2026-09-18, `C:\Scrapper`)**: públicos retornam 200 com dado real
  (`tiposEvento`: 7 valores; `proximosEventos`: eventos reais com
  `eventoId`/nome/data); os 5 protegidos retornam 401, como esperado —
  confirma que o módulo funciona de ponta a ponta (lê cofre → token →
  chamada), só falta a autorização do lado deles.
- **LIBERADO de verdade (2026-09-18, confirmado ao vivo)**: rodando
  `npm run testar-ulisses-api` de novo, os 5 endpoints protegidos que
  antes davam 401 agora respondem 200 com dado real —
  `filiaisAtivas()`/`filial(1)`/`listarTodosEventos(1)`/
  `participantesEvento(24343)`/`csvInscricoes(1)` todos ✅. O Célio
  autorizou o client sem precisar de nenhuma mensagem nova da nossa
  parte — confirma que a estratégia de "deixar pronto e esperar" (ver
  bullet acima) foi a certa.
- **Mapeamento de `filialId` (sistema deles) → filial do CRM**, resolvido
  consultando `filiaisAtivas()` (140 filiais no total, sistema nacional
  da Acrópole Brasil) e casando pelo `labelBotaoLandingPage` (mais
  confiável que `nome` — já vem no formato exato usado no site público de
  cada unidade):
  | `filialId` (Ulisses) | `labelBotaoLandingPage` | Filial no CRM |
  |---|---|---|
  | 15 | Goiânia - Jardim América | Goiânia - Jardim América |
  | 132 | Goiânia - Setor Oeste | Goiânia - Setor Oeste |
  | 14 | Ap. de Goiânia - Garavelo | Goiânia - Garavelo |
  | 44 | Barra do Garças | Barra do Garças/MT |
  | 16 | Goiânia - Setor Universitário | (não é filial nossa no CRM — é
  quem centraliza "Abertura de Turma" pra região, ver bullet sobre isso
  na seção de Ulisses acima; agora dá pra puxar os dados dela direto pela
  API se um dia fizer sentido) |
  | 65 | Goiânia - Goiania 2 | Goiânia II (criada nesta sessão, só
  Mercúrio importado até agora — a API já permitiria trazer as
  Inscrições dela também) |
  Não existe coluna pra guardar esse `filialId` ainda (nem migração
  criada) — quando o próximo passo (migrar algum endpoint de verdade pro
  scraper) for feito, decidir se vale a pena adicionar uma coluna
  `filial_id_ulisses` em `filiais` ou só manter um mapa fixo no código do
  scraper (mais simples, já que são só 4-6 filiais e mudam raramente).
- **Próximo passo real**: nenhum código novo ainda — é uma DECISÃO a
  tomar com o usuário (não assumida aqui): qual endpoint migrar primeiro
  do Playwright (`scraper/ulisses.js`/`ulisses-local.js`) pra
  `scraper/ulisses-api.js`. Candidato mais óbvio: `csvInscricoes`, que
  elimina o Cloudflare/login manual por completo pra Inscrições — mas
  isso muda o encadeamento de `importar-no-crm.js`
  (hoje espera um arquivo CSV em disco) e precisa de decisão sobre
  Setor Universitário (dado extra disponível agora, nunca puxado antes)
  antes de codificar. Rodar `npm run testar-ulisses-api` continua sendo o
  jeito rápido de reconfirmar que o acesso não foi revogado.

#### Ulisses entra na importação automática de 5h (2026-09-18)

Pedido do usuário: "vamos incluir o ulisses na importação automática com
o mercúrio, às 5h da manhã. importe também o setor universitário (os
eventos de abertura de turma, aula experimental, etc)". Implementado
inteiramente via a API oficial (acima) — sem precisar de mais nenhuma
navegação/login manual — encadeado dentro do MESMO `main()` de
`scraper/mercurio.js`, então já herda o agendamento existente (`pg_cron`
5h Brasília, botão "Rodar Mercúrio Agora", disparo por 1 filial só) sem
precisar mexer em nada do lado do agendamento/Edge Functions.

- **`scraper/importar-ulisses-api.js`, NOVO** — 2 funções principais:
  - `sincronizarEventosUlissesApi()`: roda 1 VEZ por rodada (não por
    filial) — busca `filiaisAtivas()` da API + nossas filiais ativas
    (Supabase), casa cada uma por nome (mesma técnica de núcleo
    distintivo já usada em `mercurio.js`/`resolverFilialCrm()`), lista os
    eventos de cada filial nossa **+ do Setor Universitário
    (`filialId=16`, hardcoded — não é filial nossa no CRM, só fonte de
    eventos)** via `listarTodosEventos()`, filtra por recência
    (`maiorDataProduto` dentro de ~90 dias pra trás, ou ausente — senão
    filiais com 800+ eventos de histórico tornariam a rodada lenta à
    toa), e pra cada `eventoId` único chama `evento(id)` (público) UMA
    vez — o retorno traz `filiaisEventos[]` com a data/vagas EXATAS de
    CADA filial que participa daquele evento. **Isso resolve de vez o
    bug histórico de "data errada pra quem não criou o evento"**
    (documentado extensivamente acima, `corrigir-datas-inscricao-publica.js`)
    — antes dependia de raspar a página pública de inscrição pra
    desambiguar; agora a própria API já devolve a data certa por filial,
    direto. Cria/atualiza `eventos` (match por filial+nome+data exato,
    com fallback por nome PARECIDO reaproveitando
    `distanciaLevenshteinUlisses()`/`normalizarNomeUlisses()`, agora
    **exportadas de `ulisses.js`** pra reuso), nunca sobrescrevendo com
    `null` um campo que já tinha valor (mesmo princípio de
    `sincronizarCatalogoEventosNoCrm()`). `tipo` continua classificado
    pela MESMA tabela `tipos_evento`/palavras-chave de sempre (não pelo
    enum próprio do Ulisses — evita divergir do que "Gerenciar Tipos" já
    edita).
  - `sincronizarInscricoesFilialViaApi(pageCrm, filialCrm, filialIdUlisses)`:
    busca `csvInscricoes(filialIdUlisses)` (texto CSV, já EXATAMENTE no
    formato que `processarPlanilhas()` espera — confirmado ao vivo, zero
    transformação), escreve num arquivo temporário (UTF-8 — a API já
    devolve `charset=utf-8`) e reaproveita 100% o `importarNoCrm()` já
    existente (mesma automação Playwright que pilota a tela de Importar
    do CRM publicado, usada pelo Mercúrio) — evita duplicar a lógica de
    cruzamento/tags/Lead Forte, que continua vivendo só em
    `js/importador.js`.
  - `resolverFilialIdUlisses(nomeFilialCrm, filiaisUlisses)`: casamento
    de nome dinâmico (não é uma lista fixa de 4 IDs hardcoded) — busca
    entre TODAS as filiais do sistema deles (140+, nacional) por núcleo
    distintivo batendo com `labelBotaoLandingPage`. Isso significa que
    uma filial nova entra automaticamente, sem precisar editar código —
    só não escolhe se a busca for ambígua (0 ou 2+ candidatos).
    **Bug real, achado pelo usuário perguntando por que "Goiânia II"
    nunca sincronizava (2026-09-21)**: o núcleo distintivo do NOSSO nome
    ("Goiânia II") sobra `"II"` (numeral romano); o núcleo do rótulo do
    Ulisses (`labelBotaoLandingPage = "Goiânia - Goiania 2"`, filialId
    65) sobra `"2"` (numeral arábico) — nunca batem por igualdade nem
    substring, então essa filial ficava pra sempre sem correspondência,
    mesmo com o `filialId` certo já mapeado e documentado (ver tabela
    acima). Corrigido com `MAPEAMENTO_FILIAL_ID_CONHECIDO` — um mapa de
    exceções explícitas (checado ANTES do algoritmo genérico, pelo nome
    EXATO da nossa filial), só pra correspondências já confirmadas contra
    a API que o algoritmo nunca resolveria sozinho (mesmo espírito de
    `FILIAL_ID_SETOR_UNIVERSITARIO`, hardcoded por bom motivo). Testado
    ao vivo: `sincronizar-ulisses-api-local.mjs -- "Goiânia II"` importou
    865 leads com sucesso, sem o aviso de "sem correspondência".
- **Encadeamento em `scraper/mercurio.js` `main()`**: `sincronizarEventosUlissesApi()`
  roda 1x, ANTES do loop de filiais (Setor Universitário "abastece"
  várias filiais de uma vez, então tem que existir antes de qualquer
  importação de Inscrições rodar). Dentro do loop, por filial,
  `sincronizarInscricoesFilialViaApi()` roda logo depois da importação de
  Ativos/Inativos do Mercúrio e ANTES de Complementar/Aniversariantes/
  Turmas — mesmo raciocínio de sempre (cria leads novos antes das etapas
  que dependem deles já existirem). Como a linha de `eventos` já existe
  nesse ponto (evento sincronizado no passo global), o `vincularEventoLeadsAutomaticamente()`
  que já roda dentro de `confirmarEnviarImportacao()` (ver seção do
  Importador) já casa e cria os `evento_leads` sozinho — nenhum código
  novo precisou lidar com isso.
- **LIMITAÇÃO REAL #1, comparecimento NÃO vem pela API — investigado A
  FUNDO de novo (2026-09-21, pedido do usuário: "é que não é possível,
  ou é que não temos acesso?")** — resposta: **é um BUG real e específico
  do lado deles, não falta de permissão** (diferente do caso do Setor
  Oeste, que ERA só permissão e o Célio resolveu na hora). Investigação
  completa, ponto a ponto:
  - `GET /facade/emails/{eventoId}` (o endpoint que devolveria, por
    evento, cada pessoa com seu array `emailEventos[]` — cada item tendo
    `id` = o `emailEventoId` e o campo `compareceu`) continua dando
    **500 Internal Server Error**: `"Cannot invoke Claim.asString()
    because emailClaim is null"` — reproduzido de novo com token
    totalmente fresco, erro idêntico ao de antes. É um `NullPointerException`
    de verdade (não 401/403) — o código deles tenta ler uma claim
    "e-mail" que só existe num JWT de USUÁRIO humano (login normal),
    nunca presente num token client_credentials (M2M).
  - **Achado novo**: `GET /facade/emailEvento/{id}` (rota nunca testada
    antes — achada relendo o Swagger completo de novo) **FUNCIONA
    normalmente via M2M**, sem crash nenhum — testado com IDs reais
    (100, 1000) e devolveu o registro completo, **incluindo o campo
    `compareceu`**. Ou seja: o DADO em si não está bloqueado — dá pra
    ler o comparecimento de um registro específico, se você já souber o
    `emailEventoId` certo.
  - **O problema real é a FALTA DE UM CAMINHO LEGÍTIMO pra descobrir
    esse ID** pros participantes de UM evento nosso: `participantesEvento()`
    só devolve `pessoaId`/`pessoaNome` (schema `EmailDTO`, confirmado no
    Swagger — não tem o campo); `emailPorId()` devolve o perfil da
    pessoa mas sem o array `emailEventos`. O ÚNICO endpoint desenhado
    pra fazer essa ponte (evento → lista de `emailEventoId` dos
    inscritos) é justamente o `/facade/emails/{eventoId}` que quebra.
  - **Testado e descartado**: `GET /facade/csv/{filialId}` (rota
    parecida, nunca testada antes) existe mas é só um export de
    marketing (nome/e-mail/telefone pra e-mail em massa) — sem
    `emailEventoId` nenhum, não ajuda.
  - **Por que não força a barra tentando adivinhar o ID por tentativa
    (brute-force)**: os IDs de `emailEvento` são sequenciais e GLOBAIS —
    o mesmo contador vale pra TODAS as filiais do Brasil, desde sempre
    (o ID 1000 testado devolveu um registro de 2020, de uma pessoa e
    evento completamente aleatórios). Pra achar os IDs de um evento de
    2026 seria preciso varrer uma faixa enorme e desconhecida de
    números, e cada tentativa "acha" um registro de OUTRA pessoa/filial
    sem relação nenhuma com a nossa — isso seria efetivamente escanear
    dado de terceiros fora do nosso escopo de autorização, não uma
    consulta legítima. Não fiz isso.
  - **Conclusão na época**: comparecimento continuava exigindo
    `npm run ulisses-local` (Playwright, tela Recepção) — mas com
    diagnóstico preciso o bastante pra levar ao Célio como um bug de
    verdade (não um pedido vago de "mais acesso"): *"`GET
    /facade/emails/{eventoId}` quebra com NullPointerException pra
    token M2M (emailClaim null) — dá pra tratar esse caso, ou expor um
    jeito de listar `emailEventoId` por evento sem depender desse
    endpoint?"*.
  - **RESOLVIDO (2026-09-30)** — o usuário levou a pergunta ao Célio, que
    respondeu: *"Todas as APIs estão disponíveis. Ou seja, tem jeito."* +
    *"Provavelmente algo como filtrarEmails"*. Relendo o Swagger completo
    de novo à procura desse nome: existe `POST /facade/filtrarEmails`
    (corpo `FiltroDTO`), **testado ao vivo contra produção e confirmado
    funcionando perfeitamente via token M2M** — sem o NullPointerException
    do `GET /facade/emails/{eventoId}`. 2 detalhes não-documentados no
    Swagger, achados por tentativa e erro controlada:
    1. `filialId` é OBRIGATÓRIO no corpo (sem ele, 403 — mesmo erro de
       permissão de sempre, não um bug novo).
    2. Os 3 arrays de filtro (`alunos`/`comparecimentos`/`ligacoes`)
       precisam ter PELO MENOS 1 valor cada (400 "Selecione pelo menos um
       filtro..." se vazio) — mas testado com vários valores arbitrários
       (`TODOS`, `SIM`, `PENDENTE` etc.), a maioria devolve o MESMO
       resultado completo (só `COMPARECEU` filtrou de verdade, devolvendo
       0 — sinal de que o enum real é outro, nunca confirmado). Decisão:
       usar `["TODOS"]` nos 3 e filtrar `compareceu` DO NOSSO LADO (pelo
       campo `emailEventos[].compareceu` de cada pessoa devolvida), em vez
       de arriscar um valor de enum nunca documentado.
  - **Correção real do Célio (2026-09-30, 22:24-22:25)**: `["TODOS"]`
    pra `ligacoes` não é seguro em toda chamada — ele reportou de volta,
    direto do próprio servidor: `"FiltroDTO.getLigacoes() is null"`, com
    a instrução explícita `"Passa um array vazio na propriedade
    'ligacoes'"`. Ou seja, em pelo menos alguma combinação de
    evento/filial, o valor `"TODOS"` especificamente nesse array não é
    reconhecido como enum válido do lado deles e vira `null`, quebrando
    com `NullPointerException` (mesma classe de erro do
    `/facade/emails/{eventoId}` original). Corrigido só pra `ligacoes`
    (único array que ele reportou) — `filtrarEmails()` agora manda
    `ligacoes: []`, mantendo `alunos`/`comparecimentos` como `["TODOS"]`
    (já confirmados funcionando). Sincronizado em `C:\Scrapper` também.
  - **Implementado**: `ulisses-api.js` ganhou `filtrarEmails(eventoId,
    filialId)`; nova coluna `eventos.evento_id_ulisses`
    (`migracao_evento_id_ulisses.sql`, preenchida por
    `sincronizarEventosUlissesApi()` — sem ela, cada sincronização de
    comparecimento precisaria redescobrir o eventoId do zero) + nova
    função `sincronizarComparecimentoViaApi(filialCrm, filialIdUlisses)`
    (`importar-ulisses-api.js`) — reaproveita 100% a MESMA lógica de
    casamento (telefone > e-mail, checagem de sanidade por primeiro-nome
    via Levenshtein, "evento futuro nunca confirma presença sozinho") já
    validada em `sincronizarComparecimentoNoCrm()` (Playwright/ulisses.js),
    só que mais simples — já sabemos o `eventoId` exato, não precisa
    reconstruir identidade de evento por nome+data. Encadeada em
    `mercurio.js` (nos 2 pontos que já chamavam Inscrições via API —
    `executarSomenteUlissesApi()` e o loop diário principal), isolada por
    filial (nunca trava o resto da rodada).
  - **Testado ao vivo, ponta a ponta, contra produção** (Goiânia - Setor
    Oeste): `sincronizarEventosUlissesApi()` preencheu `evento_id_ulisses`
    em 2 eventos recentes (24344/"Novas turmas...", 24343/"Aula
    Experimental..."); `sincronizarComparecimentoViaApi()` gravou **3
    vínculos novos + 25 atualizados (compareceu)**, de 2 eventos — e a
    checagem de sanidade funcionou de verdade num caso real (1 vínculo
    corretamente IGNORADO: telefone batendo com "CECILIA REIS" no CRM,
    mas o nome do Ulisses era "Luiz Cláudio Ferreira" — mesmo padrão de
    telefone compartilhado entre parentes já documentado antes). **Não é
    mais verdade que comparecimento "continua exigindo Playwright"** —
    só continua valendo como alternativa pra eventos antigos sem
    `evento_id_ulisses` ainda gravado (nunca removida do projeto).
- **LIMITAÇÃO REAL #2, item 1 RESOLVIDO (2026-09-21)** — `filialId=132`
  (Goiânia - Setor Oeste) dava 403 em qualquer endpoint que dependesse de
  "listar a partir dessa filial" (`listarTodosEventos`/`csvInscricoes`/
  `filial`), enquanto as outras filiais sempre funcionaram — mesma
  mensagem literal da API: `"Este usuário não tem permissão de acesso à
  esta filial"`. O Célio liberou essa permissão do lado da Acrópole
  Brasil — confirmado testando ao vivo (2 tentativas antes ainda deram
  403 com token novo; a 3ª, minutos depois, já veio OK nos 3 endpoints).
  Rodando `sincronizar-ulisses-api-local.mjs -- "Setor Oeste"` de
  verdade: **1191 leads importados, catálogo sincronizado, zero 403** —
  e o número de inscrições REAIS ("Aula Experimental do Curso de
  Filosofia para Viver") pulou de 5 pra **42** (antes só chegava o que
  aparecia "de lado" via outra filial que compartilha o mesmo evento;
  agora o CSV de Inscrições da própria filial é lido direto). Antes desta
  liberação, a maior parte do dado de Setor Oeste ainda chegava de outra
  forma: quando um evento é listado a partir de OUTRA filial (ex: Setor
  Universitário) e Setor Oeste também participa dele, o `evento(id)`
  (público) sempre devolveu a entrada de Setor Oeste normalmente dentro
  de `filiaisEventos` — só o CSV de Inscrições PRÓPRIO da filial é que
  ficava de fora, e agora não fica mais.
- **LIMITAÇÃO REAL #2, item 2**: `GET /evento/{id}` (público) devolve **400 Bad Request**
     ("Todas as vagas já foram preenchidas.") pra eventos com vagas
     esgotadas — parece intencional do lado deles (o endpoint público é
     pensado pra alimentar a página de inscrição, que não faz sentido
     mostrar pra evento lotado), mas isso significa que não conseguimos
     detalhe algum (nem imagem/descrição/data por filial) de um evento já
     lotado. Isolado por evento (log de aviso, pula só aquele).
- **Testado ao vivo, ponta a ponta, em produção (2026-09-18)**:
  `sincronizarEventosUlissesApi()` rodou contra as 4 filiais + Setor
  Universitário — 11 eventos atualizados (0 duplicado criado), incluindo
  a "Abertura de Turma" real (`eventoId=24344`): confirmado no banco que
  Garavelo ficou com `2026-10-05`, Jardim América/Setor Oeste com
  `2026-10-08` (ambos batendo com a correção manual feita antes via
  `corrigir-datas-inscricao-publica.js`) e `capacidade=200` preenchida
  automaticamente pela 1ª vez. **`imagem_url`/`link_inscricao` também
  propagam pra TODAS as filiais que compartilham o evento** (pedido do
  usuário logo depois do 1º teste — `ev.linkFinal` vira `link_inscricao`,
  mesmo link em todas, já que o `eventoId` é o mesmo) — confirmado no
  banco: Garavelo/Jardim América/Setor Oeste ficaram todos com a MESMA
  imagem e o MESMO link de inscrição do evento criado pelo Setor
  Universitário, sem precisar cadastrar nada à mão na Agenda. `sincronizarInscricoesFilialViaApi()`
  testado contra Barra do Garças/MT: 857 leads importados com sucesso
  (82 casados com sintéticos já existentes, sem duplicar), Lead Forte/
  Jornada calculados normalmente — o log é idêntico ao de uma importação
  manual normal, só que sem precisar de navegador nenhum no Ulisses.
  Rodada completa de `main()` (Mercúrio + Ulisses via API encadeados)
  validada filtrando por 1 filial só antes de confiar na rodada
  automática de 5h com as 4 de uma vez.
- **Não migrado ainda**: o catálogo completo de eventos (`exportarCatalogoEventos()`)
  e o comparecimento (`exportarComparecimento()`/`sincronizarComparecimentoNoCrm()`)
  do lado do Playwright (`ulisses.js`/`ulisses-local.js`) continuam
  existindo e não foram removidos — o comparecimento em especial SEMPRE
  vai continuar precisando deles, pela limitação #1 acima. `npm run
  ulisses-local` continua sendo o caminho pra isso (rodar manualmente
  quando quiser comparecimento atualizado).

#### CORREÇÃO GRAVE (2026-09-21): a API do Ulisses TAMBÉM é bloqueada pelo GitHub Actions

A seção acima ("Ulisses entra na importação automática de 5h") e o
"Estado atual: LIBERADO" documentado em `scraper/ulisses-api.js`
descreviam a API como uma forma de "bypassar" o Cloudflare porque "é uma
chamada HTTPS pura, não navegação de browser" — **essa premissa estava
ERRADA**, descoberta ao tentar construir um botão dedicado pra disparar
só essa sincronização via GitHub Actions (pedido do usuário: "o botão
deveria invocar a API do Ulisses e atualizar os eventos e demais
dados"). **Confirmado por 2 disparos reais, 2 bloqueios idênticos**:

```
GET /facade/filiaisAtivas -> 403 ... "Just a moment..." (desafio do
Cloudflare, no lugar do JSON esperado — mesmo com Bearer token válido,
sem navegador nenhum envolvido)
```

`api.acropolebrasil.com.br` está atrás do MESMO Cloudflare que já
bloqueava o login por navegador — e esse Cloudflare também bloqueia por
**reputação de IP/ASN** (datacenter/cloud, ex: GitHub Actions), não só
por detectar ausência de execução de JS numa navegação. **Consequência
séria**: desde que essa sincronização foi "encadeada" na rodada diária
automática do Mercúrio (2026-09-18), toda vez que ela rodou via GitHub
Actions (inclusive o cron das 5h) ela **falhou silenciosamente** — o
`catch` só logava no console (nunca marcava `algumaFalha`), e a mensagem
final em `status_sincronizacao_automatica` dizia **"+ Inscrições do
Ulisses via API ... OK" mesmo assim** (bug de verdade, incondicional,
não checava se a etapa realmente rodou). Evidência cruzada: 0 vínculos
`evento_leads` novos com `origem='ulisses'` desde 2026-09-19 (dia da
última sincronização real, feita por um disparo manual filtrado por
filial — não pelo cron).

**Corrigido, com pivot de arquitetura**:
- **`executarSomenteUlissesApi()`** (`scraper/mercurio.js`, `export`ada)
  ganhou uma guarda no topo: se `process.env.GITHUB_ACTIONS === 'true'`,
  falha IMEDIATO com uma mensagem clara (`registrarStatusSincronizacao`)
  em vez de tentar e receber o HTML confuso do Cloudflare. A chamada
  inline de dentro da rodada COMPLETA do Mercúrio (`main()`) tem a MESMA
  guarda — pula de cara quando `GITHUB_ACTIONS=true`, e agora um sinal
  próprio (`ulissesApiPulado`) faz a mensagem final dizer honestamente
  "[Ulisses via API: pulado aqui]" em vez do "OK" incondicional de antes.
  `mercurio.js` ganhou a mesma guarda de `ulisses.js`
  (`if (process.argv[1] === fileURLToPath(import.meta.url)) main();`) —
  necessária pra poder `import`ar `executarSomenteUlissesApi` de outro
  script sem disparar a rodada completa do Mercúrio por efeito colateral.
- **`.github/workflows/scraper.yml`**: o input `somente_ulisses_api`
  (criado e removido na mesma sessão) foi tirado — não faz sentido expor
  um controle que sempre falha. Comentário do topo do arquivo atualizado
  pra deixar claro que NADA do Ulisses (login OU API) funciona daqui.
- **`scraper/ulisses-local.js`** (roda na máquina de confiança, sempre
  funcionou pra Ulisses) ganhou um passo NOVO por filial,
  `sincronizar-inscricoes-via-api` (chama `sincronizarInscricoesFilialViaApi()`),
  mais uma chamada global de `sincronizarEventosUlissesApi()` antes do
  loop — agora QUALQUER rodada de `npm run ulisses-local` já sincroniza
  eventos/Inscrições via API de carona, além do comparecimento via
  Playwright de sempre.
- **`scraper/sincronizar-ulisses-api-local.mjs`, NOVO** — caminho
  dedicado e **100% HEADLESS** (sem Chromium visível, sem login manual
  nenhum, já que é só chamada HTTPS + pilotar a tela de Importar do
  PRÓPRIO CRM): `npm run ulisses-api-local` (ou `-- "Garavelo"` pra 1
  filial). Só reaproveita `executarSomenteUlissesApi()` já exportada de
  `mercurio.js` — sem duplicar lógica nenhuma. Como não depende de
  supervisão humana, é candidato natural a uma Tarefa Agendada do
  Windows na máquina de confiança, restaurando parte do "automático" que
  o GitHub Actions não consegue mais entregar pra este domínio.
- **Novo protocolo customizado `abrirulissesapi://`** (mesmo mecanismo
  de `abrirulisses://`, ver seção própria abaixo) registrado em
  `HKCU\Software\Classes\abrirulissesapi`. O botão "Sincronizar via API
  do Ulisses agora" (aba Importar → "Sincronização Automática") deixou
  de invocar a Edge Function/GitHub Actions — agora chama
  `abrirProtocoloUlissesApi(filial)` (`js/importador.js`), que monta
  `abrirulissesapi://rodar?filial=...` (usando o MESMO `<select>` de
  filial do botão do Mercúrio — "Todas as filiais" ou uma só) e navega
  pra essa URL. `dispararUlissesApiAgora()`/`botoesDispararUlissesApi()`/
  todo o JS de disparo+poll via GitHub Actions criado antes nesta mesma
  sessão foi REMOVIDO — sem sentido manter um caminho morto que só
  falharia sempre. `renderizarStatusSincronizacaoScraper()` voltou a ter
  só 2 parâmetros (o 3º, criado só pra esse botão antigo, também foi
  removido).
  - **Por filial** (pedido do usuário, 2026-09-21 — "quando estivermos
    com 20 filiais, vai ficar impraticável esperar todas se eu precisar
    atualizar uma específica"): já era possível por CLI
    (`npm run ulisses-api-local -- "Garavelo"`) desde que o script foi
    criado — só faltava expor no botão do CRM.
  - **Bug real, achado testando de verdade**: registrar o protocolo
    apontando pra um `.bat` (`"cmd.exe" /c ""...\Sincronizar Ulisses
    API.bat" "%1""`) corrompia a URL — `cmd.exe` interpreta `%` como
    caractere de variável (`%1`, `%2`...), então uma querystring
    codificada (`?filial=Barra%20do%20Gar%C3%A7as`) chegava ao script
    como `"Barra0do0GarA7as"` (`%20`/`%C3` interpretados como parâmetros
    `%2`/`%C` vazios seguidos do dígito literal que sobrou). **Corrigido
    registrando o protocolo DIRETO pro `node.exe`**, sem `cmd.exe`/`.bat`
    nenhum no meio: `"C:\Program Files\nodejs\node.exe"
    "C:\Scrapper\scraper\sincronizar-ulisses-api-local.mjs" "%1"` — o
    Windows substitui `%1` pela URL completa ANTES de qualquer shell
    processá-la, e como não existe MAIS NENHUM shell no caminho, a URL
    chega intacta no `process.argv[2]` do Node (que já faz o
    `new URL(...).searchParams.get('filial')` certinho, com
    `decodeURIComponent` embutido). O script ganhou um
    `process.chdir()` no topo (substitui o `cd /d` que o `.bat` fazia —
    sem ele, `dotenv/config` não acharia o `.env` da pasta certa) e usa
    imports DINÂMICOS (não estáticos) depois do `chdir()`, já que imports
    estáticos são içados e rodariam antes dele. **Lição pra qualquer
    protocolo customizado futuro que precise de parâmetro**: nunca passar
    por `cmd.exe`/`.bat` no meio — vai direto pro executável final
    (`.exe`), sempre. `Sincronizar Ulisses API.bat` continua existindo
    (sem `%1`) só pra quem preferir dar duplo-clique manual sem passar
    filial nenhuma.
  - **Testado ao vivo, 2 formas diferentes de disparo, ambas OK depois do
    fix**: `node sincronizar-ulisses-api-local.mjs
    "abrirulissesapi://rodar?filial=Barra%20do%20Gar%C3%A7as"` (mesmo
    comando que o registro roda) → só Barra do Garças, 857 leads; e
    `cmd /c start "" "abrirulissesapi://rodar?filial=Goi%C3%A2nia%20II"`
    (mais parecido com o clique real de um navegador) → só Goiânia II.
- **Testado ao vivo, com sucesso, direto de `C:\Scrapper`** (IP
  residencial): `node sincronizar-ulisses-api-local.mjs "Garavelo"` — 0
  bloqueio Cloudflare, catálogo sincronizado (9 eventos atualizados),
  1300 leads importados via `csvInscricoes`, 21 leads auto-vinculados a
  eventos a partir do histórico. Confirma que a API funciona perfeitamente
  bem — só nunca pode ser chamada a partir de um IP de datacenter.
- **Lição pro projeto**: "não é navegação de browser" nunca é garantia
  suficiente de que um Cloudflare vai deixar passar — WAFs modernos
  também bloqueiam por reputação de IP/ASN, independente do tipo de
  chamada. Qualquer integração nova com `acropolebrasil.com.br` (ou
  qualquer subdomínio dele) precisa ser testada de verdade a partir do
  AMBIENTE REAL onde vai rodar (aqui, GitHub Actions) antes de assumir
  que "funciona" — testar só localmente (`C:\Scrapper`) não basta.

#### Agendamento real do Ulisses via API — 2 Tarefas Agendadas do Windows (2026-10-01)

Pedido do usuário: "queria criar um cron pra rodar diariamente (acho que
já temos isso) e outro para rodar a cada 6 horas na semana do evento,
sem a cada hora nos dois dias que antecedem o evento. Isso ajuda a
manter o SDR acompanhando o resultado do trabalho em tempo real".

**Corrigindo a suposição "já temos isso"**: o cron diário de 5h (pg_cron,
`migracao_agendamento_mercurio_pgcron.sql`) só cobre o MERCÚRIO —
Inscrições via API do Ulisses foi DESLIGADA de dentro do GitHub Actions
(ver bloco acima, "CORREÇÃO GRAVE") porque o Cloudflare bloqueia IP de
datacenter até pra chamada HTTPS pura. Até esta sessão, "diário" pro
Ulisses só acontecia se alguém clicasse manualmente (botão no CRM, `.bat`,
ou `npm run ulisses-api-local`) — nunca foi automático de verdade.

- **Quanto tempo leva** (medido com dado real, 2 rodadas completas no
  mesmo dia): sincronizar as 5 filiais (catálogo de eventos + Inscrições +
  comparecimento + dedupe de Leads a Tratar) leva entre **~3 e ~5
  minutos** — rodar isso a cada 6h (ou mesmo a cada hora) é um custo
  desprezível de tempo/API.
- **2 Tarefas Agendadas do Windows criadas em `C:\Scrapper`**
  (`Register-ScheduledTask`, rodam como o usuário logado — "Run only
  when user is logged on", sem senha armazenada):
  1. **"CRM - Ulisses Diario"** — todo dia às 05:30 (logo depois do
     Mercúrio), roda `sincronizar-ulisses-api-local.mjs` incondicional,
     todas as filiais. Preenche a lacuna do "diário" que faltava.
  2. **"CRM - Ulisses 6h Semana Evento"** — dispara a cada 6h, o ano
     inteiro, rodando o script NOVO `scraper/ulisses-api-se-evento-proximo.mjs`.
- **`ulisses-api-se-evento-proximo.mjs`, NOVO**: em vez de tentar fazer o
  Windows Task Scheduler decidir dinamicamente "estamos perto de um
  evento?" (ele não enxerga nosso banco), o AGENDAMENTO fica fixo e
  simples (sempre a cada 6h) e é o PRÓPRIO SCRIPT que decide, a cada
  disparo, se vale a pena sincronizar de verdade: consulta `eventos`
  (`ativo=true`, `data` entre hoje e hoje+7 dias, qualquer filial) — sem
  nenhum evento na janela, é um no-op quase instantâneo (1 query leve);
  achando, roda a MESMA sincronização completa de sempre
  (`executarSomenteUlissesApi()`, reaproveitada). Janela de **7 dias**
  cobre "a semana do evento" inteira, INCLUINDO os 2 dias finais — que
  continuam em 6h, nunca escalando pra hora em hora (pedido explícito do
  usuário: "sem a cada hora nos dois dias que antecedem o evento").
  Considera QUALQUER evento ativo (não só "Abertura de Turma") — o pedido
  é acompanhar captação em geral, não um tipo específico.
- **Testado ao vivo, ponta a ponta, em produção**: a lógica da janela de
  7 dias foi confirmada por SQL direto (achou corretamente os eventos de
  HOJE, 01/10, em 3 filiais); o script novo foi rodado de verdade em
  `C:\Scrapper` — detectou o evento próximo e disparou a sincronização
  completa das 5 filiais com sucesso (mesmo resultado dos 2 testes reais
  anteriores do dia). As 2 Tarefas Agendadas foram registradas e
  confirmadas com `Get-ScheduledTask`/`Get-ScheduledTaskInfo`
  (`NextRunTime` correto nas duas).
- **Achado incidental, não corrigido nesta rodada**: `filtrarEmails()`
  (comparecimento) voltou a falhar com `400 "Selecione pelo menos um
  filtro..."` numa das 3 rodadas reais de hoje (a de 14:13), mas funcionou
  normal 8 minutos depois (14:21, 32-50 "atualizado(s) compareceu" por
  filial) — mesmo padrão de instabilidade do backend do Ulisses já
  documentado antes (ver seção "RESOLVIDO (2026-09-30)" acima); as
  Inscrições em si (o que importa pro acompanhamento em tempo real pedido
  aqui) funcionaram nas 3 rodadas, sem exceção.

#### Bug real: evento duplicado quando a data antiga estava ERRADA (2026-09-21)

Achado pelo usuário comparando 3 números diferentes pra "Novas turmas do
Curso de Filosofia para Viver" em Goiânia II — o card mostrava "0
inscritos no Ulisses" com data 14/10/2026, enquanto outra filial (mesmo
evento) já tinha inscritos reais numa data diferente (08/10). Causa:
`sincronizarEventosUlissesApi()` casava evento existente só por
`filial+nome+data` EXATOS (ou nome parecido, mas só dentro da MESMA
data) — se uma linha antiga já existia com uma data ERRADA (resíduo do
bug histórico "data juntada do ciclo inteiro", ver
`corrigir-datas-inscricao-publica.js` acima), a API (que sempre traz a
data certa) nunca encontrava essa linha pra corrigir, e criava uma
**segunda linha duplicada** com a data certa — a antiga ficava órfã,
ainda com os convites/CRM já vinculados a ela, e o card certo (com
inscrições reais) e o card errado (com os convites) pareciam 2 eventos
diferentes.

**Confirmado em produção**: id 656 (Goiânia II, "Novas turmas...", data
ERRADA 14/10, 11 vínculos `origem='crm'`) e id 736 (mesma filial/nome,
data CERTA 08/10, criada pela sincronização, 11 vínculos
`origem='ulisses'`) — **10 dos 11 `pessoaIdentificador` eram EXATAMENTE
os mesmos nos dois** (confirmando ser a mesma pessoa/mesmo evento,
convidada por nós E de fato inscrita no Ulisses).

**Corrigido em 2 partes**:
1. **Código** (`sincronizarEventosUlissesApi()`, `importar-ulisses-api.js`):
   novo 2º fallback — quando não acha por data exata nem por nome
   parecido na mesma data, procura por nome parecido na MESMA FILIAL
   entre eventos AINDA NÃO PASSADOS (`data >= hoje`), independente da
   data. Só resolve com EXATAMENTE 1 candidato (mesma cautela de sempre).
   Encontrando, **corrige a `data` da linha existente** (a API é
   autoridade) em vez de criar uma nova — restrito a eventos futuros de
   propósito: eventos passados legitimamente têm várias linhas com o
   mesmo nome (cada ciclo antigo é uma ocorrência própria, ex: "Aula
   Experimental" repete todo mês), corrigir a data de um passado
   destruiria histórico real.
2. **Dado já duplicado em produção** — mesclado manualmente (SQL direto):
   os 10 vínculos em comum foram promovidos pra `origem='ulisses'` na
   linha 656 (mantida, por ser a mais antiga), o 11º vínculo (só existia
   na 736) foi movido pra 656, a linha 656 recebeu os campos corretos da
   736 (data 08/10, capacidade 200, imagem, link de inscrição), e a linha
   736 foi apagada. **Varredura em toda a base** (todas as filiais,
   evento com `data >= hoje`) confirmou que este era o ÚNICO caso desse
   tipo — não precisou de mais nenhuma limpeza.
   Testado ao vivo depois do fix: rodando a sincronização de novo pra
   Goiânia II, o evento já correto foi só ATUALIZADO (0 criados, 14
   atualizados) — nenhuma duplicata nova.

**Correção da minha própria conta errada (mesma conversa)**: eu tinha
reportado "42 inscritos" pra "Aula Experimental" em Setor Oeste — errado,
porque minha consulta de diagnóstico agrupou por `nome` sem also agrupar
por `id`/`data`, somando TODOS os 11 ciclos históricos daquele nome
(2025-01 a 2026-10) numa conta só. O card do CRM sempre mostrou o número
certo do evento específico (ATUAL, 01/10/2026): **8 inscritos no
Ulisses** — que bate, com uma pequena defasagem esperada (a Recepção do
Ulisses mostrava 12 pré-inscritos na hora que o usuário conferiu,
~1h depois da sincronização; gente nova se inscreve o tempo todo, o
número só fica tão atual quanto a última vez que a sincronização rodou).

### Origem dos vínculos evento_leads — 'ulisses' vs 'crm' (2026-09-21)

Pedido URGENTE do usuário, com 2 sintomas reais relatados: (1) "não sei
quem de fato se inscreveu no Ulisses, e quem faz parte da abordagem que
estou fazendo mas ainda não se inscreveu — no Setor Oeste, o CRM indica
500 inscritos na Aula Experimental, mas isso não reflete o Ulisses"; (2)
"entrei em contato com uma série de leads fortes pra convidar pra Aula
Experimental/Abertura de Turma que, na verdade, já estavam inscritos — a
gaveta do lead não indica se essa informação veio do Ulisses ou se
CRIAMOS essa pendência pra ela".

**Causa raiz**: `evento_leads` é escrita por vários caminhos diferentes,
misturando 2 categorias sem distinção nenhuma — (a) vínculo REAL, casado
a partir de dado do Ulisses (`vincularEventoLeadsAutomaticamente()` em
`js/importador.js`, casando por `historico_eventos`; e
`sincronizarComparecimentoNoCrm()` em `scraper/ulisses.js`, casando por
telefone/e-mail contra a Recepção) — e (b) pendência/convite criado por
NÓS (convite manual na gaveta, vínculo manual no modal de Participantes,
convite em massa via wa.me) — a pessoa ainda não necessariamente se
inscreveu de verdade. `carregarResumoParticipantes()`/o card da Agenda
somavam os dois juntos em "N leads vinculados". **Confirmado em produção,
consultando o banco antes do fix**: o evento "Aula Experimental do Curso
de Filosofia para Viver" em Setor Oeste tinha 5 inscritos reais no
Ulisses e **496** vínculos criados por nós (convite em massa via wa.me,
quase certamente) — o "500 inscritos" relatado pelo usuário batia quase
exato com esse total, confirmando a causa.

- **`evento_leads.origem`** (`migracao_evento_leads_origem.sql`, `text
  not null default 'crm' check (origem in ('ulisses','crm'))`) — toda
  escrita nova já marca a origem certa:
  - `origem: 'ulisses'` — `vincularEventoLeadsAutomaticamente()`
    (`js/importador.js`) e `sincronizarComparecimentoNoCrm()`
    (`scraper/ulisses.js`).
  - `origem: 'crm'` (== default) — convite manual na gaveta
    (`confirmarConvidarEventoNaGaveta()`), vínculo manual no modal de
    Participantes (`adicionarParticipante()`), convite em massa via
    wa.me (`gerarLinksConviteLote()`, `js/whatsapp.js`) — todos em
    `js/eventos.js` exceto o último.
  - **Backfill retroativo** rodado contra produção (script descartável,
    não faz parte do projeto): reaplica a MESMA lógica de
    `vincularEventoLeadsAutomaticamente()` (nome normalizado + data)
    contra o `historico_eventos` atual de cada lead já vinculado — quem
    bate vira `'ulisses'`, o resto fica `'crm'` (já era o default).
    Resultado real: de 8975 vínculos existentes, **4880 confirmados como
    'ulisses'**, **3931 relabelados como 'crm'** (pendências nossas que
    estavam contadas como inscrição real).
- **`carregarResumoParticipantes()`** (`js/eventos.js`) — agora also
  soma `inscritosUlisses`/`convidadosCrm` por evento (mais os campos que
  já existiam). O card da Agenda (`renderizarListaEventos()`) mostra os
  dois separados: "N inscrito(s) no Ulisses" (verde, `.part-inscrito-ulisses`)
  e "N convidado(s) pelo CRM" (cinza neutro, `.part-convidado-crm`) — a
  antiga linha genérica "N leads vinculados" foi removida (ambígua
  demais, era exatamente a fonte da confusão).
- **Badge de origem em todo lugar que lista um vínculo**: modal de
  Participantes (`renderizarListaParticipantes()`) e, principalmente, a
  gaveta "Eventos (Convites)" do lead (`renderizarEventosDoLead()` — é
  a tela do print que o usuário mandou) — cada linha agora mostra
  "Inscrito no Ulisses" (badge verde, ✓✓) ou "Convite do CRM" (badge
  cinza, relógio, title explicando "ainda NÃO é inscrição confirmada no
  Ulisses").
- **"Inscrever no Ulisses" (manual, assistido)** — pedido do usuário na
  mesma leva: "quero integrar a possibilidade de nós mesmos fazermos a
  inscrição do lead no evento, se ele confirmar interesse através do
  WhatsApp. O SDR pede a inscrição através de um botão, capta nome/
  e-mail/telefone, e faz a inscrição manualmente no site do evento".
  - **Por que é assistido, não automático**: a API oficial do Ulisses
    (ver seção acima, 63 rotas mapeadas) **não tem nenhum endpoint pra
    CRIAR uma inscrição** — só leitura + marcar comparecimento.
    Automatizar o preenchimento do formulário público
    (`inscricao.acropolebrasil.com.br`) via Playwright exigiria adivinhar
    os nomes dos campos sem NUNCA ter visto o HTML real desse form —
    contra o princípio deste projeto de nunca escrever seletor "no
    chute" (mesma régua aplicada em toda a revisão do scraper do
    Mercúrio/Ulisses). Por isso o caminho é assistido: o CRM capta e
    mostra os 3 dados, abre o site oficial numa aba nova
    (`evento.link_inscricao`), e o SDR mesmo preenche e confirma lá.
  - **Botão "Inscrever no Ulisses"** (`abrirModalInscreverEvento()`,
    `js/eventos.js`), ao lado de "Convidar" no cabeçalho da gaveta
    "Eventos (Convites)" — abre `#modalInscreverEvento`: `<select>` de
    evento (qualquer evento ainda ativo da filial, MESMO já vinculado
    como `'crm'` — é justamente o caso de uso principal, "upgradar" uma
    pendência nossa pra inscrição real), pré-seleciona o evento já
    vinculado como `'crm'` mais próximo se houver, nome/e-mail/telefone
    pré-preenchidos a partir do lead (editáveis), botão "Copiar dados"
    (clipboard) e um link "Abrir site de inscrição" (o próprio
    `evento.link_inscricao` — aviso se o evento não tiver esse campo
    preenchido na Agenda).
  - **`confirmarInscricaoManualEvento()`** — só depois de um `confirm()`
    explícito ("já foi feita de verdade no site"), faz um `upsert` em
    `evento_leads` com `origem:'ulisses', resposta_convite:'confirmado'`
    — **de propósito sobrescreve** um vínculo `'crm'` já existente pra
    aquele evento+lead (é o upgrade pretendido, não um bug). Grava
    `log_atividade` (`acao='inscricao_manual_ulisses'`).
- **Testado ao vivo contra produção** (Playwright, cópia local do CRM,
  Supabase real, filial Goiânia - Setor Oeste): o card da "Aula
  Experimental" mostrou corretamente "5 inscritos no Ulisses" / "496
  convidados pelo CRM" (bate com a consulta direta no banco); a gaveta de
  um lead com vínculo `'crm'` mostrou o badge "Convite do CRM"; o modal
  "Inscrever no Ulisses" abriu com nome pré-preenchido e o link de
  inscrição resolvendo pra `inscricao.acropolebrasil.com.br/?eventoId=...`
  corretamente — fechado sem confirmar (evita gravar dado de teste em
  produção).

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

## Mapa de Turmas — REMOVIDO da interface (2026-09-21)

Existiu como aba própria (`js/mapa-turmas.js`, grade semanal dia x
horário por filial) — removida a pedido do usuário ("por enquanto não
vai servir pra nada e só polui a tela"). A tabela `turmas`
(`migracao_turmas.sql`) e a escrita nela dentro de `processarTurmas()`
(`scraper/mercurio.js`) **continuam existindo** — é um upsert best-effort
de baixo custo, feito de carona na mesma varredura que já visita cada
turma por outros motivos (matrícula/reingresso/telefone), sem nenhum
código extra dedicado a ela. Se uma tela de grade fizer sentido de novo
no futuro, o dado já vai estar acumulado — só reconstruir a aba de
leitura (`js/mapa-turmas.js` pode ser recuperado do histórico do git,
commit anterior a 2026-09-21).

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

## Navegação a partir de KPIs/atalhos (2026-09-11)

Pedidos do usuário pra deixar o Dashboard/Agenda do Dia mais acionáveis —
clicar num número deve levar direto pra onde aquele número "vive":

- **Coluna de Matriculados mostra o mês corrente no nome** (ex:
  "Matriculados em Setembro") — `labelExibicaoColuna(col)` (`js/app.js`),
  usada no cabeçalho da coluna no Kanban e no chip da gaveta de colunas
  recolhidas. Calculado na hora (`nomeMesAtualCapitalizado()`, via
  `Date.toLocaleDateString('pt-BR', {month:'long'})`) — **não muda o que
  cai na coluna** (continua sendo TODO mundo com `funil_agencia` =
  Matriculados, sem filtro por mês nenhum) nem o `col.label` gravado em
  `localStorage`, é só o texto exibido; não precisa renomear na mão todo
  mês, o nome do mês vira sozinho quando o mês virar. Detectada pela
  MESMA heurística por substring "matricul" já usada em todo o resto do
  app — se o usuário renomear a coluna pra algo sem essa palavra, o mês
  para de aparecer (comportamento esperado, mesma heurística de sempre).
- **KPI "Novas Matrículas" (Dashboard) é clicável** —
  `irParaColunaMatriculados()` (`js/app.js`): troca pra aba CRM e rola o
  quadro até a coluna de Matriculados (id `kanban-col-wrap-${key}`,
  adicionado no `<div class="kanban-col">` de `renderizarColunas()`),
  restaurando a coluna primeiro (`restaurarColuna()`) se ela estiver
  guardada na gaveta. Só navegação/scroll, sem aplicar filtro nenhum — a
  métrica já soma todo mundo que está ali.
- **KPI "Resgates Efetivados" (Dashboard) é clicável** —
  `filtrarPorRecuperados()` (`js/app.js`), mesmo padrão de
  `filtrarPorLeadForte()` já existente (Lead Forte por Nível): troca pra
  aba CRM e aplica `quickFilterTag('Recuperado')` em todas as colunas —
  é o critério PRINCIPAL do próprio KPI (ver bullet `"Recuperado"` na
  seção de Tags).
  - **Bug real relatado pelo usuário (2026-09-11): o filtro aplicava,
    mas leads numa coluna guardada na gaveta (`colunasRecolhidas`)
    continuavam invisíveis** — como um "Recuperado" pode ter caído em
    QUALQUER coluna do funil (não só Matriculados), não tem como saber
    de antemão qual coluna guardada precisaria ser restaurada. Corrigido
    dentro do próprio `quickFilterTag()` (usado tanto por este KPI quanto
    por `filtrarPorLeadForte()`): restaura TODAS as colunas guardadas na
    gaveta antes de aplicar o filtro — não faz sentido filtrar uma coluna
    que nem está visível.
  - **2º bug real relatado pelo usuário, mesmo dia**: clicar em "Novas
    Matrículas" DEPOIS de "Resgates Efetivados" continuava com o filtro
    de tag `"Recuperado"` ativo (os filtros de coluna são cumulativos por
    design — ver "Filtros avançados são POR COLUNA" na seção de tags —,
    então nada limpava o filtro anterior antes do próximo clique). Cada
    um desses 3 pontos de entrada (`filtrarPorLeadForte()`,
    `filtrarPorRecuperados()`, `irParaColunaMatriculados()`) é uma TROCA
    de contexto ("me leve pra ver X agora"), não uma composição — por
    isso os 3 agora chamam `limparFiltros()` (já existente, botão "Limpar
    Tudo") antes de aplicar seu próprio filtro/navegação. Os chips do
    Filtro Rápido dentro da própria aba CRM (`renderizarFiltrosRapidos()`)
    continuam chamando `quickFilterTag()` direto, sem `limparFiltros()` —
    ali sim faz sentido combinar mais de uma tag clicando em vários chips
    em sequência, não é o mesmo caso de uso.
- **Balão de mensagem no chat não respeitava quebra de linha/parágrafo
  dos templates** (`textoComQuebrasDeLinha()`, `js/whatsapp.js`, bug real
  relatado pelo usuário comparando print do template aprovado na Meta —
  com linha em branco entre parágrafos — contra o balão renderizado no
  CRM, tudo espremido numa linha só): `.msg` (`css/style.css`) não tem
  `white-space:pre-line`, então o `\n`/`\n\n` que já vinha certo dentro de
  `corpo_texto` (idêntico ao `corpoAprovado` de `TEMPLATES_WHATSAPP`,
  confirmado — o texto SALVO no banco sempre esteve correto, só a
  RENDERIÇÃO no balão que ignorava) nunca virava quebra visual. Corrigido
  convertendo `\n` → `<br>` DEPOIS de escapar (`escapeHTML()` preserva o
  caractere, só precisava de `<br>` pra virar quebra visível) — usado nos
  2 lugares que desenham o corpo da mensagem em `htmlMensagemWpp()`
  (texto normal e legenda de imagem).
- **Clicar num lead em "Aniversariantes de Hoje" (Agenda do Dia —
  Todas as Filiais) abre a gaveta já com o template `aniversario` do
  WhatsApp selecionado**, pronto pra revisar as variáveis e mandar —
  pedido direto do usuário depois do template `aniversario` ser
  aprovado pela Meta (ver seção WhatsApp). Encadeamento:
  `carregarAgendaGeralAniversariantes()` (`js/visao-geral.js`) chama
  `abrirResultadoBuscaGlobal(id, 'aniversario')` (2º parâmetro NOVO,
  opcional, `js/app.js`) → `abrirGaveta(id, {templateWhatsapp:
  'aniversario'})` (2º parâmetro NOVO, opcional) →
  `chatDrawer.abrir(id, 'aniversario')` (2º parâmetro NOVO, opcional,
  `js/whatsapp.js`) → `selecionarTemplatePorNome('aniversario')`, chamada
  DEPOIS do `await` de `carregarHistoricoMensagens()`/`renderizarAreaInput()`
  dentro do mesmo `abrir()` (não como uma chamada separada depois —
  evitando a corrida entre 2 chamadas concorrentes de `chatDrawer.abrir()`
  que existiria se a seleção do template fosse feita de fora, depois de
  `abrirGaveta()` já ter disparado seu próprio `chatDrawer.abrir()` sem
  esperar). `selecionarTemplatePorNome()` força a área de envio a mostrar
  o seletor de template (`renderizarAreaInputTemplate()`) mesmo QUANDO a
  conversa está dentro da janela de 24h (onde o padrão seria texto
  livre) — a intenção aqui é sempre o template aprovado, não texto livre,
  já que é especificamente o modelo de aniversário que se quer mandar.
  Todos os 3 parâmetros novos são opcionais (`|| null`/padrão), então
  nenhum dos outros ~15 lugares que já chamavam
  `abrirResultadoBuscaGlobal()`/`abrirGaveta()`/`chatDrawer.abrir()` com 1
  argumento precisou mudar.

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

## Inscrição assistida no Ulisses — Etapa 1 (2026-09-28)

Pedido do usuário, reunião com a Ediliene: "podemos retomar a ideia de
que o próprio crm fará as inscrições conforme a solicitação da pessoa?
Nem que eu tenha que acionar um botão manualmente, para abrir o
navegador e a partir daí o crm começar a preencher os dados". Dividido
em 2 etapas, porque a Etapa 2 depende de algo que só o usuário pode
providenciar.

- **Bloqueio real, sem solução ainda**: nunca vimos o HTML real do
  FORMULÁRIO de inscrição público (`inscricao.acropolebrasil.com.br`) —
  só a tela de "selecione a unidade", por print. Sem isso, escrever
  seletor pra autofill seria "no chute", contra o princípio deste
  projeto. **Próximo passo do usuário**: na próxima vez que abrir a
  página pública de inscrição de um evento com vaga aberta, abrir o
  DevTools no formulário de dados pessoais (não só a tela de unidade) e
  mandar o HTML (`Inspecionar` → `Copy outerHTML` do `<form>`).
- **Etapa 1, construída agora (não depende do HTML)**: botão novo
  **"Abrir e Preparar Inscrição (neste computador)"** no modal
  `#modalInscreverEvento` (`js/eventos.js`, ao lado de "Abrir site de
  inscrição") — copia os 3 dados pra área de transferência (reaproveita
  `copiarDadosInscreverEvento()` já existente) E aciona o protocolo
  customizado `abririnscricao://rodar?url=<link_inscricao codificado>`,
  MESMO mecanismo já usado por `abrirulisses://`/`abrirulissesapi://`
  (ver seção "'Botão' de acionar o Ulisses" abaixo) — registrado
  apontando DIRETO pro `node.exe`, sem `cmd.exe`/`.bat` no meio (mesma
  lição já aprendida: um shell no meio corrompe a querystring
  codificada).
  - `scraper/abrir-inscricao-assistida.js` (novo, também copiado pra
    `C:\Scrapper\scraper\`, a máquina de confiança onde o Playwright de
    verdade está instalado — `G:\` é um drive de rede, não roda
    Playwright de forma confiável): abre um Chromium VISÍVEL
    (`headless: false`) e só NAVEGA até a URL — zero seletor, então zero
    risco. Nunca fecha o browser sozinho (o SDR trabalha nessa janela
    até terminar de colar os dados e confirmar no site).
  - **Registro no Registro do Windows** (`HKCU\Software\Classes\abririnscricao`),
    feito nesta sessão:
    ```
    (Default) = "URL:Abrir Inscricao Assistida"
    "URL Protocol" = ""
    \shell\open\command\(Default) = "C:\Program Files\nodejs\node.exe" "C:\Scrapper\scraper\abrir-inscricao-assistida.js" "%1"
    ```
  - **Testado ao vivo, de ponta a ponta**: disparado
    `abririnscricao://rodar?url=...` (URL real de um evento,
    "Bushido, o código de honra dos samurais") via `Start-Process` do
    PowerShell — confirmado por `Get-Process` que um `node.exe` novo e
    um cluster de `chrome.exe` novos apareceram no exato segundo do
    disparo; a janela abriu na página certa. Processo de teste encerrado
    depois (não era um uso real).
  - **Limitação, igual às outras do mesmo mecanismo**: só funciona nesta
    máquina (`C:\Scrapper`), onde o protocolo foi registrado.
- **Etapa 2 (autofill de verdade dos campos)**: NÃO construída ainda —
  trava até o HTML real do formulário chegar. Quando chegar, o mesmo
  script ganha os seletores reais — mas **nunca vai clicar no botão
  final de enviar sozinho**, só preenche e para, pro SDR conferir e
  confirmar manualmente (mesma cautela de `scraper/importar-no-crm.js`).

## "Botão" de acionar o Ulisses — de decisão final a botão de verdade (2026-09-10)

**Histórico**: um botão comum no CRM publicado não consegue abrir uma
janela de navegador no PC de quem clica (é um site na nuvem, e nenhum
navegador deixa uma página web executar programas locais — bloqueio de
segurança deliberado, não falta de código). Por isso existe
`scraper/Importar Ulisses.bat`: atalho de duplo-clique (roda `npm run
ulisses-local`, todas as filiais) na máquina de confiança (`C:\Scrapper`),
com uma pausa no final pra dar tempo de ler o resumo.

**Solução final, pedida pelo usuário**: mesmo truque que apps como Zoom/
Slack/VS Code usam pra ter um botão "Abrir no app" numa página web — um
**protocolo de URL customizado** registrado no Windows
(`abrirulisses://`), que o navegador sabe repassar pro sistema quando
alguém clica num link desse esquema. Configurado (`HKEY_CURRENT_USER\Software\Classes\abrirulisses`,
só nesta conta Windows/máquina — reversível, não afeta nada remoto):
```
HKCU\Software\Classes\abrirulisses
    (Default) = "URL:Abrir Ulisses Local"
    "URL Protocol" = ""
    \shell\open\command
        (Default) = "C:\Windows\System32\cmd.exe" /c ""C:\Scrapper\scraper\Importar Ulisses.bat""
```
2 botões novos no CRM apontam pra `abrirulisses://rodar` (o "rodar" não
importa, é só o resto da URL depois do `://`; o .bat sempre roda todas as
filiais ativas, sem parâmetro nenhum): um em "Agenda do Dia — Todas as
Filiais" (Dashboard, ao lado de "Rodar Mercúrio Agora") e outro no modal
"Sincronização Automática" (aba Importar). São `<a href="abrirulisses://rodar">`
simples, sem JS — o próprio navegador intercepta a navegação pro esquema
não-http e delega pro Windows.
- **Limitação explícita, documentada na própria tela**: só funciona NESTE
  computador (onde o protocolo foi registrado) — se o CRM for aberto de
  outro PC, o clique não faz nada (o navegador vai perguntar "abrir com
  qual programa?" ou simplesmente ignorar, dependendo do navegador). Isso
  é aceitável — o Ulisses só pode mesmo rodar numa máquina de confiança já
  configurada (`C:\Scrapper` + `.env` com as credenciais do cofre), nunca
  em qualquer PC. Pra configurar em outra máquina de confiança (se um dia
  precisar), repetir os mesmos comandos de registro acima, ajustando o
  caminho do `.bat` se for diferente.
- **1ª vez, o navegador deve pedir confirmação** ("Este site quer abrir X.
  Permitir?") — comportamento padrão do Windows/navegador pra qualquer
  protocolo customizado, não um bug; marcar "sempre permitir" deixa 1
  clique dali em diante.
- **Testado**: registro no Registro do Windows confirmado (`Get-ItemProperty`
  mostrou o comando exato salvo) e os 2 botões renderizam certo com o
  `href` correto (Playwright, sem clicar de verdade — clicar abriria os
  Chromiums reais contra o Ulisses de produção, pedindo login manual em
  cada filial, o que só faz sentido o próprio usuário disparar). **O
  clique de ponta a ponta (abrir os Chromiums de verdade) não foi testado
  por mim** — precisa ser validado pelo usuário na primeira vez que usar.

## WhatsApp Unificado — de verdade cross-filial (2026-09-28)

Pedido do usuário: "eu quero que tenha exatamente isso, um whatsapp
unificado para todas as filiais, mas que identifique qual filial
pertence cada lead, e que possa filtrar por filiais". **Bug real
corrigido**: apesar do nome "Unificado", a aba sempre filtrou por
`filialAtual` por baixo dos panos (`renderizarContatosWpp()`,
`.eq('filial', filialAtual)`) — nunca foi de verdade cross-filial, só
mostrava a conversa da filial escolhida no topo, igual o resto do app.

- **Agora é SEMPRE todas as filiais por padrão** — a query de conversas
  (`vw_wpp_conversas`) não filtra mais por `filialAtual`. Um
  `<select id="wppFiltroFilialSelect">` novo (topo da lista de contatos,
  `index.html`) deixa restringir a 1 filial quando fizer sentido
  ("Todas as filiais" = padrão), populado a partir de `filiaisDisponiveis`
  (`popularFiltroFilialWpp()`).
- **Selo de filial por conversa** já existia no card da lista; agora
  também aparece no CABEÇALHO do chat aberto (`abrirChatWpp()`).
- **"Iniciar nova conversa" (buscar por nome) agora busca em TODA a
  base** (respeitando o filtro de filial escolhido, se houver) — antes
  só buscava dentro de `leadsAtuais` (escopado à filial atual), então só
  dava pra "começar" conversa com quem já estava paginado na filial
  selecionada; agora dá pra achar QUALQUER lead do sistema.
- **Bug real de fundo, também corrigido**: `abrirChatWpp(leadId)` só
  lia `leadsAtuais.find(...)` (escopado à filial) — abrir a conversa de
  um lead de OUTRA filial deixava `lead` undefined, quebrando o
  cabeçalho E as variáveis `nome`/`filial` dos templates
  (`preencherValorAutomatico()` também lê de `leadsAtuais`). Corrigido
  buscando do banco e MESCLANDO em `leadsAtuais` quando o lead ainda não
  estiver carregado — mesmo padrão já usado por
  `abrirResultadoBuscaGlobal()` (`js/app.js`) pra Agenda do
  Dia/notificações cross-filial.
  - **Trade-off aceito, herdado do mesmo padrão**: `renderizarCards()`
    não filtra `leadsAtuais` por `filialAtual` ("sem pré-filtro global",
    comentário no próprio código) — então um lead de OUTRA filial,
    aberto pelo WhatsApp Unificado, pode aparecer momentaneamente como
    card avulso no Kanban da filial atual, até a próxima troca de
    filial (que reseta `leadsAtuais` do zero). Isso já era um risco
    aceito pra Agenda do Dia/notificações (baixa frequência); com o
    WhatsApp agora abrindo leads cross-filial com muito mais frequência,
    fica mais visível — não corrigido aqui de propósito (mudar o filtro
    de `renderizarCards()` é uma decisão maior, fora do pedido
    específico desta rodada); se incomodar na prática, avaliar depois.
- **Variável "filial" dos templates tinha o MESMO bug de fundo**
  (pedido do usuário, item 1 da mesma leva): `preencherValorAutomatico('filial')`
  sempre usava `filialAtual` (o seletor do topo), nunca a filial do
  PRÓPRIO lead — um SDR olhando "Todas as filiais" e respondendo um lead
  de Barra do Garças mandava "...da Nova Acrópole do Jardim América" (a
  última filial selecionada no topbar, não a do lead). Corrigido — agora
  sempre usa `lead.filial` (extraído pra `nomeFilialComPreposicao()`,
  reaproveitada também em `montarTextoConviteEvento()`, que tinha o
  MESMO bug pro convite de evento avulso/em massa).
- **Indicador de "não lida"** (pedido do usuário, "máximo de
  funcionalidades iguais ao WhatsApp real"): client-side, por navegador
  (`localStorage`, `crm_na_wpp_ultima_leitura` — sem tabela nova) — nome
  em negrito forte + bolinha verde quando a última mensagem é de ENTRADA
  e mais nova que a última vez que ESTE navegador abriu aquela conversa
  (marcada como lida ao abrir pela aba WhatsApp OU pela gaveta do lead).
- **Separador de dia** ("Hoje"/"Ontem"/data completa) entre grupos de
  mensagens no chat, igual o WhatsApp real (`rotuloDataSeparadorWpp()`).
- **Anexar foto/documento do computador — construído (2026-09-28), depois
  de confirmar com o usuário que valia habilitar Storage**: 1ª vez que o
  projeto usa Supabase Storage (`migracao_storage_whatsapp_midia.sql` —
  bucket `whatsapp-midia`, **público** de propósito, mesmo motivo de
  `eventos.imagem_url` já ser uma URL pública: `whatsapp-send` só passa
  `{link: url}` pra Graph API, a própria Meta busca o arquivo — sem o
  bucket público, ela não conseguiria). RLS do bucket segue o MESMO
  padrão de acesso público do resto do projeto (`using(true) with
  check(true)`, ver comentário na migração).
  - **Ícone de clipe** (📎) no compose bar (`renderizarAreaInput()`,
    dentro de `criarChatController()` — vale pra aba unificada E pra
    gaveta do lead, os dois reaproveitam o mesmo controller) abre um
    `<input type="file">` (`image/*,.pdf,.doc,.docx,.xls,.xlsx`).
    Escolher um arquivo mostra uma PRÉVIA acima da caixa de texto
    (`.wpp-anexo-preview` — miniatura se for imagem, ícone + nome se for
    documento, com "x" pra cancelar) — igual o WhatsApp real, a legenda
    é a MESMA caixa de texto já existente; só ao clicar
    enviar/Enter é que sobe pro Storage e manda de verdade
    (`enviarComAnexo()`).
  - **`whatsapp-send` ganhou o tipo `"documento"`** (`document`/
    `filename`/`caption` pra Graph API — `mensagens_whatsapp.tipo` já
    aceitava esse valor desde a migração original, `documento` já
    estava no `check` da coluna, só nunca tinha sido usado). Tipo
    `"imagem"` (já existia, "Convite Compartilhável") ganhou de carona a
    possibilidade de vir de um anexo livre, não só de `evento.imagem_url`.
  - **`htmlMensagemWpp()`** ganhou a renderização de `tipo==='documento'`
    — um cartão clicável (ícone + nome do arquivo, abre em nova aba),
    igual ao card de documento do WhatsApp real.
  - **Testado ao vivo, ponta a ponta** (não só a UI — a cadeia completa:
    upload real pro bucket via REST com `apikey`+`Authorization` — o
    supabase-js do navegador já manda os dois automaticamente, mesmo
    padrão de toda outra chamada `.from()` do projeto —, confirmado que
    o arquivo fica público de verdade (`GET` no `publicUrl` devolveu
    200, `image/png`), e envio real de imagem E de documento pro lead de
    teste do usuário, ambos com `wa_message_id` real de volta). Arquivos
    de teste apagados do bucket depois.
- **Também fora de escopo, sem pedido explícito**: emoji picker de
  verdade pra DIGITAR (o ícone já existe na UI, só não abre nada —
  diferente de REAGIR, ver seção própria "Reações com emoji" abaixo, essa
  sim construída), encaminhar mensagem, apagar/editar mensagem enviada,
  indicador de "digitando...", gravar/enviar áudio (voice notes),
  chamada de voz/vídeo, conversas em grupo — nenhum desses tem
  equivalente simples na Meta Cloud API hoje (ou exigiria trabalho bem
  maior, fora do que foi pedido).

Conversas **NÃO identificadas** (webhook não achou nenhum lead com
aquele telefone) **não têm filial nenhuma pra mostrar** — o `filial` da
mensagem fica `null` nesse caso (confirmado no código do webhook,
`supabase/functions/whatsapp-webhook/index.ts`), e isso é inerente a ter
só 1 número de WhatsApp compartilhado por todas as filiais hoje (não dá
pra saber de qual escola veio antes de vincular a um lead) — continuam
fora do filtro de filial (mostradas sempre, "de qualquer filial").

## Mover pra "Em Abordagem" ao enviar QUALQUER mensagem (2026-09-28)

Pedido do usuário: "depois que eu mandar uma mensagem para um lead, ele
deve ser movido para outra coluna (em abordagem, por exemplo). Leads que
tem conversa no whatsapp não devem ficar em leads frios."

- **`moverParaAbordagemAposEnvio(leadId)`** (`js/whatsapp.js`) — só move
  quem ainda está na PRIMEIRA coluna do funil (`columnsConfig[0].key`,
  a "fria"/nunca trabalhada); nunca puxa de volta um lead que já avançou
  (Matriculado, Perdido etc.) só porque mandamos uma mensagem pra ele.
  Busca o `funil_agencia` ATUAL direto no banco (não em `leadsAtuais`) —
  o lead pode ser de outra filial (ver seção acima) e nem estar
  carregado ali. Reaproveita `moverLeadsParaColuna()` já existente —
  ganha de graça a barra de "Desfazer", `funil_agencia_atualizado_em`
  (SLA visual) e a sincronização com Tarefas.
- **Chamada depois de TODO envio real que saiu com sucesso**: texto
  livre e template (chat individual — aba unificada e gaveta), foto
  ("Convite Compartilhável"/"Nova Turma"), o botão rápido "Enviar" de
  aniversário (`enviarAniversarioRapido()`, ver "Agenda do Dia"/"Contas
  de Usuário" acima), e os 2 disparos em massa ("Convidar (Link)" — ao
  marcar "já enviei este" — e "Convidar (API)"). `marcarContatoWhatsAppLoteEnviado()`
  (link) foi simplificada pra usar esta mesma função em vez de mover
  incondicionalmente — mesma regra em todo lugar agora, não só nesse
  ponto de entrada.

## Investigação: reply cai em "Não Identificados" (2026-09-28)

Pedido do usuário: "testei responder à mensagem que recebi do API pelo
meu número pessoal, e caiu num lugar chamado 'não identificado'. Pq, se
é uma resposta?"

**Investigação honesta**: consultando `mensagens_whatsapp` direto, a
mensagem em questão (o "olá" do print) JÁ ESTAVA corretamente vinculada
ao lead certo (`pessoaIdentificador` preenchido) no momento em que
investiguei — ou seja, não foi possível reproduzir/confirmar a causa
EXATA daquele instante específico (o estado "não identificado" visto no
print foi, aparentemente, transitório). Isso é consistente com
`buscarLeadsPorTelefone()` (`whatsapp-webhook`) devolver `matches.length
> 1` (AMBÍGUO — 2+ leads com o mesmo telefone) só naquele momento exato,
e nunca mais depois.

**2ª rodada, teoria do usuário — "o CRM já lida com o 9º dígito na
resposta?" (2026-09-28, mesmo dia)**: o usuário levantou uma hipótese
concreta e bem razoável — "quando eu falo com a pessoa, o crm coloca o 9
na frente [via `montarNumeroE164()`]; quando a pessoa fala comigo, o
whatsapp não coloca o 9, e o crm não reconhece isso". Investigado contra
dado REAL antes de mexer em qualquer coisa (não aceitei a teoria de
cabeça, nem descartei): `_shared/telefone.ts` (`candidatosNumeroBR()`)
já gera as DUAS variantes (com/sem o 9º dígito) do número que chega no
webhook e compara contra `pessoaTelefoneNumero` de qualquer formato —
essa simetria já existe desde antes desta sessão, não é um bug novo.
Confirmado achando uma mensagem de entrada REAL de hoje com
`pessoaIdentificador is null` (`from = "556293162669"`, DDD 62, local
"93162669", 8 dígitos começando com 9 — exatamente o padrão do 9º dígito
duplicado sendo perdido pela Meta) e testando a lógica à mão contra o
banco: existe sim um lead com esse telefone
(`951000017`/"DANILO FORTALEZA DE MATOS AIRES", `pessoaTelefoneNumero =
"993162669"`), sem ambiguidade (só 1 candidato), fora da lixeira — ou
seja, a variante gerada por `candidatosNumeroBR()` ("993162669") BATE
exatamente com o telefone salvo. Pelo código, isso deveria ter casado.
**A causa real desta mensagem específica**: puxando o `payload_bruto`
completo, `type` era `"reaction"` (o usuário reagiu com ❤️ a uma
mensagem nossa) — **não é uma resposta de texto**. Comparando o horário
exato do evento (19:26:02 UTC) com o `updated_at` do último deploy do
`whatsapp-webhook` feito nesta mesma sessão (19:26:08 UTC, só 6 segundos
depois — o redeploy do fix da lixeira, ver acima), é bem mais provável
que esta mensagem específica tenha caído numa janela de corrida do
PRÓPRIO desenvolvimento (function sendo trocada quase no mesmo instante)
do que revelar uma falha permanente no casamento por telefone — que,
pela lógica e pelo teste manual acima, está correto.
- **Achado real e concreto que sobrou desta investigação, mesmo sem
  confirmar um bug de 9º dígito**: reações (`type: "reaction"`) nunca
  tinham tratamento próprio no webhook — caíam no caminho normal de
  mensagem, viravam uma linha esquisita (`tipo: "outro"`, corpo
  `"[Mensagem tipo reaction]"`) e, se o casamento de telefone falhasse
  por QUALQUER motivo passageiro (como parece ter sido o caso aqui),
  ficavam presas em "não identificado" pra sempre, poluindo a lista sem
  nunca terem sido uma conversa de verdade. Corrigido construindo suporte
  de verdade a reações (pedido do usuário na mesma leva — ver seção
  "Reações com emoji" logo abaixo): agora `type: "reaction"` NUNCA cria
  uma linha nova, só atualiza a reação da mensagem alvo.

- **Lacuna real encontrada e corrigida, independente de confirmar a
  causa exata**: `buscarLeadsPorTelefone()` contava leads na LIXEIRA
  (`lixeira_em` preenchido — soft-delete, ver "Lixeira de Leads") como
  candidatos válidos pra casar o telefone. Se um lead ATIVO e um lead já
  jogado na lixeira compartilham telefone (reaproveitamento de número de
  teste, ou coincidência real — este projeto tem histórico extenso de
  duplicados por telefone, ver "Bug real #2 a #6" na seção do
  Importador), a busca encontrava os DOIS e desistia por ambiguidade —
  mesmo a lixeira sendo, por definição, gente fora do fluxo ativo.
  Corrigido: `.is('lixeira_em', null)` adicionado à query. **Nunca**
  flexibiliza a escolha entre 2+ leads ATIVOS ambíguos (isso continua
  exigindo vínculo manual, "Vincular" na tela — de propósito, nunca
  arrisca atribuir uma conversa real à pessoa errada).
- **Por que não dá pra "auto-corrigir" uma mensagem já presa como não
  identificada**: mesmo que o item 3 acima (mesclagem automática) reduza
  duplicados de telefone daqui pra frente, uma mensagem JÁ gravada com
  `pessoaIdentificador = null` fica assim pra sempre, a menos que
  alguém clique "Vincular" manualmente — não existe (ainda) um job que
  reprocesse mensagens antigas não identificadas depois que a causa da
  ambiguidade for resolvida. Não construído nesta rodada (sem pedido
  explícito) — ficaria fácil de fazer se algum dia fizer falta: reaplicar
  `buscarLeadsPorTelefone()` (ou seu equivalente) contra as mensagens
  `pessoaIdentificador is null` existentes.
- **Redeployada**: `whatsapp-webhook` (só a query, sem mudança de
  comportamento pra ninguém que já está ativo).

**3ª rodada, CAUSA RAIZ REAL encontrada (2026-09-28, mesmo dia — o usuário
reportou de novo: "continua jogando as respostas em não identificados",
com print real de IANNY GRASIELLY SILVA, lead `900000012`, telefone `62
981255060`, respondendo "já sou membro da escola a três anos e meio")**:
consultado o banco direto, o telefone dela batia EXATO com o que
`candidatosNumeroBR()` já gera (variante com o 9º dígito) — não era o
teórico bug do 9º dígito (já investigado e descartado antes), nem
ambiguidade, nem lixeira. A causa real: `buscarLeadsPorTelefone()`
buscava **TODOS** os leads com aquele DDD (`.eq('pessoaTelefoneDDD',
ddd)`, sem filtrar por número na própria query) e só filtrava os
candidatos em JAVASCRIPT depois de a resposta chegar — mas o PostgREST
corta em **1000 linhas por padrão**, mesmo limite silencioso já
documentado várias vezes neste projeto (Aniversariantes, Ativos/
Inativos, Leads Prioritários da Agenda do Dia). Confirmado: **só o DDD
62 tem 12.939 leads** — a linha da Ianny simplesmente podia nunca chegar
a ser buscada (sem `.order()`/paginação, a ordem física devolvida pelo
Postgres não é garantida, e claramente ela ficava fora dos primeiros
1000). Isso significa que esse bug pode ter causado "não identificado"
pra qualquer resposta real de um lead com DDD 62 desde que a base
cresceu além de 1000 leads naquele DDD — não é um caso isolado.
**Corrigido de vez**: adicionado `.in('pessoaTelefoneNumero',
candidatos)` na própria query — o Postgres já filtra pelo número
específico do lado do banco, nunca mais varre (nem corre risco de
truncar) a base inteira daquele DDD. **Varredura completa em produção**
(SQL direto, sem o limite de 1000 do PostgREST, reproduzindo a mesma
lógica de `separarFromMeta()`/`candidatosNumeroBR()` em SQL puro):
confirmado que a Ianny era o **ÚNICO** caso real afetado ainda pendente
(o outro "não identificado" que sobrava, telefone `16465894168`, é o
número de onboarding do próprio WhatsApp, "Continue setting up your
account" — não é DDI 55, não é lead nenhum, 0 matches mesmo depois da
correção, esperado). As 2 mensagens da Ianny (ids 147/148) foram
vinculadas manualmente ao lead certo depois de confirmado o match único.
Redeployada de novo.

## Reações com emoji nas mensagens (2026-09-28)

Pedido do usuário: "quero poder 'reagir' às mensagens com emojis, como
numa mensagem normal do whatsapp" — a Meta Cloud API já suporta reação
nativamente (não precisou de nenhum workaround visual).

- **`mensagens_whatsapp.reacoes`** (jsonb, `migracao_whatsapp_reacoes.sql`):
  no máximo 1 reação por LADO — `{"lead": "❤️", "atendente": "👍"}` — nunca
  uma lista de várias reações da mesma pessoa (mesmo comportamento do
  WhatsApp real: reagir de novo TROCA a própria reação; mandar emoji vazio
  REMOVE). `null` = ninguém reagiu ainda.
- **`_shared/reacoes.ts`, NOVO** — `aplicarReacao(supabaseAdmin, tabela,
  waMessageIdAlvo, chave, emoji)`, compartilhado entre `whatsapp-send`
  (quando NÓS reagimos) e `whatsapp-webhook` (quando o LEAD reage): busca
  a mensagem alvo por `wa_message_id`, mescla `chave` (`'atendente'` ou
  `'lead'`) no jsonb já existente (ou remove a chave se `emoji` vier
  vazio/ausente), sempre gravando `null` de volta se a reação ficar
  vazia dos dois lados. **Nunca cria uma linha nova** — reação sempre
  atualiza uma mensagem que já existe.
- **`whatsapp-send` ganhou `tipo: 'reacao'`** (`{pessoaIdentificador,
  tipo:'reacao', mensagemAlvoId, emoji}` — `emoji: ''` é válido, remove
  uma reação já enviada, igual o app real): monta
  `{type:"reaction", reaction:{message_id, emoji}}` pra Graph API; só em
  caso de SUCESSO chama `aplicarReacao(..., 'atendente', emoji)` — ao
  contrário de texto/imagem/documento, o tipo `reacao` NUNCA insere uma
  linha nova em `mensagens_whatsapp` (nem em sucesso nem em falha), só
  atualiza a reação da mensagem alvo.
- **`whatsapp-webhook` trata `msg.type === 'reaction'` separadamente**,
  ANTES do casamento por telefone de sempre — chama `aplicarReacao(...,
  'lead', msg.reaction?.emoji)` casando pelo `msg.reaction.message_id`
  (o id da mensagem que o lead reagiu) e passa pro próximo item do loop
  (`continue`), sem tentar achar lead por telefone (a mensagem original
  já sabe de quem é) e sem nunca gravar uma linha "outro"/"[Mensagem tipo
  reaction]" como acontecia antes. Se a mensagem alvo não for encontrada
  (`wa_message_id` desconhecido), só loga aviso — best-effort, nunca
  quebra o resto do webhook.
- **Frontend (`js/whatsapp.js`)**: `htmlBotaoReagirWpp(m)` desenha um
  botão de carinha (só quando a mensagem tem `wa_message_id` de verdade —
  falha de envio e conversa importada manualmente não têm um id real da
  Meta pra reagir em cima) que só aparece no HOVER do balão
  (`.wpp-reagir-btn`, CSS `display:none` + `.msg:hover .wpp-reagir-btn`).
  Clicar abre `abrirSeletorReacaoWpp()` — um picker flutuante único e
  compartilhado (`#wppReacaoPicker`, criado 1x, reposicionado a cada
  abertura via `getBoundingClientRect()` do botão clicado, mesmo espírito
  de `_containerPopupWpp()` em `js/notificacoes.js`) com os 6 emojis
  padrão do WhatsApp (👍❤️😂😮😢🙏); clicar no MESMO emoji já ativo remove
  a reação (toggle), clicar em outro troca. `htmlReacoesWpp(m)` desenha o
  badge com a(s) reação(ões) já aplicada(s) (`.wpp-reacao-badge`,
  flutuando no canto inferior do balão — mostra só emojis DISTINTOS, se
  os 2 lados reagiram com o mesmo emoji aparece 1 badge só). Escuta de
  clique é DELEGADA no container de mensagens (`addEventListener` 1x na
  criação do `criarChatController()`, não por balão — o `innerHTML` é
  reconstruído a cada `renderizarMensagens()`, um listener por balão se
  perderia a cada render).
  - **Atualização em tela é via Realtime, sem chamada extra**: como o
    canal `postgres_changes` de `UPDATE` já existia (escuta qualquer
    UPDATE de `mensagens_whatsapp` daquele lead), tanto reagir quanto
    receber uma reação do lead atualizam a tela sozinhos assim que o
    banco muda — nenhuma chamada de `recarregarHistorico()` nova
    precisou ser adicionada.
- **Testado ao vivo, ponta a ponta, em produção** (lead de teste do
  usuário, 904000019): `whatsapp-send` com `tipo:'reacao'` e um
  `wa_message_id` real devolveu `{"ok":true}` e a Graph API aceitou de
  verdade (chamada real, mesma que teria ido pro WhatsApp do usuário);
  confirmado no banco que `reacoes` da mensagem alvo virou
  `{"atendente":"👍"}` SEM criar nenhuma linha nova; reenviando com
  `emoji:''` confirmado que `reacoes` voltou a `null` (remoção). **O
  lado do webhook (reação CHEGANDO do lead) não foi testado ao vivo**
  (não dá pra forjar a assinatura HMAC de um webhook real da Meta sem o
  `WHATSAPP_APP_SECRET`, que é um secret só do servidor) — mas usa a
  MESMA função `aplicarReacao()` já validada pelo teste acima, então o
  risco residual é baixo; a próxima reação real recebida de um lead
  confirma visualmente.

## Indicador de status de contato nas listas de aniversariantes (2026-09-28)

Pedido do usuário: "ao enviar uma mensagem através de comando no
dashboard, deve haver algum indicativo que a mensagem foi enviada (se
foi recebida, respondida, deu erro, etc) para que o follow up seja mais
realista e eu não volte a entrar em contato com alguém que já entrei."

Os "comandos de enviar" do Dashboard são o botão "Enviar" de
`enviarAniversarioRapido()` (Agenda do Dia — Todas as Filiais, e
Aniversariantes do Mês por filial) — antes disso, o único feedback era o
próprio botão virar "✓ Enviado" na hora, mas isso é só estado de
MEMÓRIA da renderização atual: recarregar a página (ou a próxima vez que
a lista é redesenhada) perdia esse sinal por completo, sem nenhuma pista
visual de que aquele lead já tinha sido contatado antes.

- **`obterStatusWhatsAppRecente(pessoaIds)`** (`js/whatsapp.js`) — 1
  única query em lote (`.in('pessoaIdentificador', ids)`, ordenada por
  `criado_em` desc) que busca a ÚLTIMA mensagem de CADA lead da lista,
  qualquer direção/tipo (não só a de aniversário) — devolve um `Map`
  `pessoaIdentificador -> {direcao, wa_status, criado_em}`.
- **`htmlBadgeStatusWpp(status)`** — badge pequeno ao lado do nome:
  **"Respondeu"** (verde, se a última mensagem da conversa foi do
  PRÓPRIO lead — o sinal mais forte de "já está em contato, não
  reabordar") ou o status da NOSSA última mensagem: "Enviado"/
  "Entregue"/"Lido" (cinza/azul) ou "Falhou" (vermelho, mesma cor de
  erro já usada em `.msg-status-falhou`). Sem histórico nenhum (nunca
  contatado), não mostra badge nenhum — evita poluir a lista inteira com
  "nunca contatado" repetido em todo item.
- **Ligado nos 2 pontos** que têm o botão "Enviar": `carregarAgendaGeralAniversariantes()`
  (`js/visao-geral.js`) e `atualizarAniversariantes()` (`js/app.js`) — os
  dois já buscam a lista de aniversariantes, então só precisaram de mais
  1 chamada em lote (não 1 query por lead) antes de montar o HTML.
- **Testado ao vivo contra dado real**: confirmado que a query devolve a
  mensagem mais recente certa pro lead de teste (904000019, que tinha
  tanto mensagens de saída quanto de entrada intercaladas) — a última
  mensagem da conversa era NOSSA e "lido", então o badge mostraria
  "Lido" (e não "Respondeu"), refletindo corretamente que o lead já leu
  mas ainda não respondeu DEPOIS dessa mensagem específica.
- **Limitação aceita, por ora**: só cobre as 2 listas de aniversariantes
  (onde existe o botão "Enviar" hoje) — não os outros pontos de envio em
  massa ("Convidar (Link)"/"Convidar (API)", que já têm seu próprio
  relatório de resultado por lote no momento do envio) nem o Kanban
  geral (que teria que decidir ONDE mostrar isso em cada card — fora do
  pedido específico desta rodada).

## Convidar (Janela Aberta) — pedido urgente, 2026-09-28

Pedido do usuário, urgente, no mesmo dia da reunião com a Ediliene:
"quero uma opção agora, urgente, para convidar as pessoas que estão com
a janela aberta (agora mesmo) para a abertura de turma que acontecerá
na semana que vem (tem que ser personalizado por filial)".

- **Diferença central em relação a "Convidar (API)"**: aquele SEMPRE
  usa um template aprovado (funciona fora da janela de 24h, mas o texto
  é fixo). Aqui é **texto livre**, porque a pessoa acabou de mandar
  mensagem — a janela já está aberta, não precisa de template. "Personalizado
  por filial" é resolvido de graça reaproveitando
  `montarTextoConviteEvento()` (já usa `lead.filial`, não `filialAtual`).
- **Botão "Convidar (Janela Aberta)"** — sempre visível no topo da lista
  de contatos do WhatsApp Unificado (`index.html`, abaixo do filtro de
  filial) — `iniciarConviteJanelaAberta()` (`js/whatsapp.js`), modal
  `#modalConviteJanelaAberta`.
- **Fluxo**: (1) busca `vw_wpp_conversas` com `ultima_direcao='entrada'`
  em QUALQUER filial, filtra quem ainda tem `horasRestantes > 0`; (2)
  busca a Abertura de Turma mais próxima **de cada filial** (`eventos`,
  `tipo='Abertura de Turma'`, `ativo=true`, `data >= hoje`, 1 por
  filial — cada unidade pode ter sua própria data); (3) mescla leads
  faltantes em `leadsAtuais` (mesmo padrão de
  `abrirResultadoBuscaGlobal()`); (4) quem não tem Abertura de Turma
  cadastrada pra SUA filial é ignorado (contado num aviso, nunca
  inventa evento); (5) exclui quem já confirmou presença
  (`evento_leads.resposta_convite='confirmado'`); (6) mostra a lista
  completa — nome, filial, evento, horas restantes, e o TEXTO EXATO que
  vai ser mandado (`<details>` expansível por lead) — com um botão pra
  **remover individualmente** um candidato da lista antes de enviar
  (achado testando ao vivo: conversas "abertas" incluem ruído real —
  respostas automáticas de negócios não relacionados que bateram o
  mesmo número reciclado — o botão de remover deixa tirar esses casos
  sem cancelar o lote inteiro); (7) só ao confirmar, envia de verdade em
  lotes de 5 (`whatsapp-send`, `tipo:'texto'`), vincula `evento_leads`
  (`origem:'crm'`, `pendente`) e move quem teve sucesso pra "Em
  Abordagem" (`moverParaAbordagemAposEnvio()`) — mesmo padrão de sempre.
- **Testado contra dado real**: confirmado que existem 4 filiais com
  Abertura de Turma cadastrada pra semana que vem (Garavelo 05/10;
  Jardim América/Setor Oeste/Goiânia II 08/10 — Barra do Garças/MT não
  tem, seria corretamente ignorada) e 13 conversas com janela aberta no
  momento do teste (12 em Garavelo, 1 em Jardim América) — todas
  bateriam certo com o evento certo da própria filial.

## Bug real corrigido: template mostrando "[Template: nome]" ao vivo (2026-09-28)

Relatado pelo usuário com print real (balão mostrando literalmente
`[Template: contato_inicial]` em vez do texto de verdade do template).
Causa: `confirmarEnviarConviteApiLote()` ("Convidar em Massa"/API,
construído antes nesta mesma sessão) sempre mandava
`templatePreview: "[Template: ${tpl.nome}]"` — um placeholder FIXO,
nunca o texto de verdade com as variáveis substituídas — enquanto
`ligarHandlersTemplate()` (envio individual) e `enviarAniversarioRapido()`
já faziam a substituição `{{1}}`/`{{2}}`... certinho, cada um duplicando
a mesma lógica separadamente. Corrigido extraindo
`montarPreviewTemplate(tpl, params)` (`js/whatsapp.js`) — usada agora
nos 3 lugares, sem duplicar a lógica de novo. **Mensagens antigas já
enviadas com o placeholder errado não são corrigidas retroativamente**
(o texto de verdade que a Meta mandou pro lead sempre esteve certo —
só a cópia exibida no CRM que estava errada — e não guardamos os
parâmetros do template separadamente pra reconstruir depois).

## Classificação de Respostas de Convite (IA) — 2026-09-28

Pedido do usuário, reunião com a Ediliene (Jardim América): "tratar as
respostas dessas pessoas de maneira muito inteligente e muito dinâmica,
de forma a reagrupar conforme a resposta, e disparar mensagens
específicas para cada grupo de respostas (alguns exemplos: 'infelizmente
não posso ir nesse evento', e respondemos com informações sobre os
próximos eventos)".

**Mesmo princípio de sempre** (`ia-diagnostico-saude`/`ia-recomendar-contatos`/
`classificar-temas`): a IA NUNCA decide quem entra na lista — a DETECÇÃO
de "quem tem resposta pendente pra classificar" é 100% regra fixa em
SQL. A IA só escolhe entre um conjunto FIXO e pequeno de categorias e
escreve o texto de acompanhamento. **Decisão confirmada com o usuário**
antes de construir: quando uma resposta é classificada, o CRM prepara a
tag certa E o texto sugerido, mas só ENVIA quando o SDR clicar "Enviar"
— nunca dispara sozinho.

- **`mensagens_candidatas_classificacao_convite(p_limite)`**
  (`migracao_classificacao_respostas_convite.sql`) — RPC que junta
  mensagem de ENTRADA recente (últimas 3h) + um vínculo `evento_leads`
  ainda `pendente` pra um evento não muito passado (até 3 dias) + ainda
  sem classificação (`left join ... where id is null`). `distinct on
  (m.id)` pega só 1 evento por mensagem (o mais recente, se o lead tiver
  mais de um convite pendente ao mesmo tempo).
- **Categorias fixas**: `confirmou`, `nao_pode_ir`, `pediu_informacao`,
  `sem_interesse`, `ambiguo` (fallback seguro sempre que a IA não
  responder num formato válido, ou a chamada falhar por qualquer
  motivo — nunca trava a rotina, nunca inventa categoria fora da lista).
- **Nova tabela `classificacoes_resposta_convite`** — `pessoaIdentificador`,
  `evento_id`, `mensagem_origem_id` (`unique` — protege contra
  duplicar se 2 execuções do cron se sobrepuserem), `categoria`,
  `sugestao_resposta`, `status` (`pendente`/`enviada`/`descartada`).
  RLS pública de sempre.
- **Nova Edge Function `classificar-resposta-convite`** — chamada por
  **cron** (`migracao_agendamento_classificacao_respostas.sql`, a cada
  15 min, mesmo padrão `pg_cron`/`net.http_post` de
  `migracao_agendamento_resumo_semanal.sql`), **NUNCA pelo
  whatsapp-webhook** (não queremos arriscar atrasar o `200 OK` pra Meta
  com uma chamada de IA de 1-3s no caminho crítico do webhook). Pra cada
  mensagem candidata: monta um prompt com a mensagem + nome/data do
  evento + a lista fixa de categorias, valida a categoria devolvida
  contra o enum (categoria inválida ou JSON malformado → `ambiguo`, sem
  sugestão), grava a linha, aplica a tag `"Convite: <categoria>"` no
  lead (**substituindo** qualquer `"Convite: X"` anterior — nunca
  acumula categoria velha se a pessoa responder de novo e mudar de
  ideia), e atualiza `evento_leads.resposta_convite` quando a categoria
  mapeia claramente (`confirmou`→`confirmado`,
  `nao_pode_ir`/`sem_interesse`→`recusado`; `pediu_informacao`/`ambiguo`
  deixa `pendente`, precisa de humano).
  - **Modo de diagnóstico** (`?debug=1` no POST): classifica só 3
    candidatas e devolve o texto BRUTO da IA (ou o erro exato) sem
    gravar nada no banco — foi assim que a causa da 1ª rodada de teste
    (100% "ambiguo") foi identificada na hora: sem crédito na Anthropic
    (ver seção "Limitação real" acima), não um bug de parsing.
- **Família de tag nova "Convite"** (`FAMILIAS_TAG`, `js/app.js`) — cor
  por categoria, não uma cor só pra família inteira: verde
  (`tag-convite-confirmou`), âmbar (`tag-convite-info`), vermelho
  (`tag-convite-negativo`), cinza (`tag-convite-neutro`, "Não Pode
  Ir"/"Ambíguo").
- **Painel "Respostas de Convite pra Revisar"** — novo card full-width
  na Agenda do Dia (`carregarAgendaGeralRespostasConvite()`,
  `js/visao-geral.js`, mesmo padrão de "Aniversariantes de Hoje"): lista
  `classificacoes_resposta_convite` com `status='pendente'`, nome +
  filial + evento + badge de categoria + `<textarea>` EDITÁVEL com a
  sugestão (quando existe) + botão "Enviar" (`enviarSugestaoRespostaConvite()`,
  chama `whatsapp-send` de verdade com o texto do textarea — sempre
  dentro da janela de 24h, é resposta a uma mensagem que a pessoa acabou
  de mandar) + "Descartar"/"Marcar como revisado"
  (`descartarSugestaoRespostaConvite()`, só muda `status`).
- **Central de Notificações, gatilho 8** —
  `verificarNotificacoesRespostasConvite()` (`js/notificacoes.js`): poll
  de 10 min, avisa quando aparece uma classificação nova `pendente`.
  Dedup por `id` em `localStorage` (mesmo padrão do gatilho 5).
- **Testado ao vivo**: a RPC de candidatas devolveu mensagens reais
  (incluindo ruído esperado — respostas automáticas de negócios não
  relacionados, números reciclados; isso nunca causa dano, só vira
  `"ambiguo"`, que exige revisão humana por design). O modo `?debug=1`
  confirmou a causa raiz do 100% "ambiguo" (falta de crédito Anthropic,
  não um bug). O painel foi validado inserindo uma linha descartável
  direto no banco e conferindo as 3 queries que ele faz (classificação +
  nome/filial do lead + nome do evento) — bateram certo; a linha de
  teste foi apagada depois. **Fluxo de clique real (Enviar/Descartar)
  não foi testado numa UI de verdade** (sem Playwright neste ambiente) —
  validar na próxima vez que uma classificação de verdade aparecer (uma
  vez que o crédito Anthropic for adicionado).

## Timer regressivo de 24h — "não deixar a conversa esfriar" (2026-09-28)

Pedido do usuário, depois de reunião com a Ediliene (Jardim América):
"precisamos ter um timer regressivo de 24h em algum lugar... não podemos
deixar esfriar para não fechar a conversa (de acordo com as regras do
Meta API, eu posso conversar livremente se a pessoa tiver me mandando
uma mensagem nas últimas 24h)".

**Decisão de design**: NÃO é uma coluna nova do Kanban. `columnsConfig[0]`
já tem 2 papéis acoplados à POSIÇÃO (SLA vermelho de coluna fria, e "a
coluna fria" pros KPIs/`moverParaAbordagemAposEnvio()`) — inserir uma
coluna de estado transitório ali arriscaria descolar esses cálculos sem
ninguém perceber, e como colunas são só `localStorage`/por navegador,
uma coluna "do sistema" nem chegaria em quem já usa o CRM. "Aguardando
resposta" também não é uma etapa de FUNIL (pode acontecer em qualquer
coluna) — é um indicador de TEMPO, não uma posição no quadro.

- **`htmlTimerJanelaWpp(conversa)`** (`js/whatsapp.js`) — badge na lista
  de contatos do WhatsApp Unificado (`htmlContatoWpp()`), reaproveitando
  100% `vw_wpp_conversas` (mesma view já consultada por
  `renderizarContatosWpp()` — nenhuma tabela/coluna nova precisou
  existir). Só aparece quando `ultima_direcao === 'entrada'` (a última
  mensagem da conversa foi do LEAD — é exatamente aí que a janela está
  correndo; depois que respondemos, o timer some, o "problema" virou
  outro). Verde (&gt;12h restantes) / âmbar (4-12h) / vermelho pulsante
  (&lt;4h) / cinza "Janela fechada" (já passou de 24h). A lista se
  atualiza a cada 1 min (`setInterval`, só quando a aba WhatsApp está
  ativa — mesmo espírito do refresh de 3 min já usado pro SLA de coluna
  fria em `js/app.js`) pra o texto do timer não ficar visualmente parado.
- **Central de Notificações, gatilho 7** —
  `verificarNotificacoesJanelaFechando()` (`js/notificacoes.js`): poll de
  10 min, GLOBAL (todas as filiais, mesmo espírito do gatilho 4 — a
  janela de 24h não escolhe filial), avisa quando uma conversa esperando
  nossa resposta está a menos de `HORAS_AVISO_JANELA_FECHANDO` (4h) de
  fechar. Dedup persistido em `localStorage`
  (`crm_na_janelas_notificadas`, chave `pessoaId:ultima_mensagem_em`,
  mesmo padrão do gatilho 5) — nunca repete o aviso pra MESMA mensagem
  entre reloads; se chegar uma mensagem nova do mesmo lead depois, a
  chave muda e o aviso pode disparar de novo (correto — é uma conversa
  "nova" precisando de atenção de novo).
- **Testado contra dado real**: confirmado via consulta direta que
  `vw_wpp_conversas` devolve `ultima_mensagem_em`/`ultima_direcao`
  corretos, e que o cálculo de horas restantes bate (mensagens recém-
  chegadas mostrando ~24h restantes).

## Bug real GRAVÍSSIMO: respostas caindo em "Não Identificados" — causa raiz de verdade (2026-09-29)

Depois do fix de `buscarLeadsPorTelefone()` (limite de 1000 do
PostgREST, ver seção "Investigação: reply cai em 'Não Identificados'"
acima), o usuário relatou que "várias respostas continuam caindo no não
identificados" — e que, além disso, não dava pra abrir essas conversas
pra ler/responder (só existia o botão "Vincular", que exige já saber o
nome de antemão).

- **Causa raiz real, confirmada consultando produção**: TODOS os casos
  investigados (14 conversas presas) eram o MESMO padrão — telefone
  duplicado entre 2 (ou 3) FILIAIS diferentes (a mesma pessoa cadastrada
  mais de uma vez, resíduo dos bugs históricos de importação já
  documentados). `buscarLeadsPorTelefone()` corretamente se recusa a
  escolher entre 2+ leads ATIVOS ambíguos — mas isso vinha acontecendo
  com muito mais frequência desde que as campanhas em massa ("Convidar
  (Janela Aberta)"/"Convidar (API)") passaram a contatar um volume bem
  maior de gente de uma vez.
- **Sinal seguro pra desambiguar, achado consultando o histórico real**:
  toda mensagem de SAÍDA (`whatsapp-send`) já sabe EXATAMENTE qual
  `pessoaIdentificador` estava mandando pra (nunca é ambígua — a chamada
  vem com o id certo desde o CRM) — então "qual dos candidatos JÁ
  recebeu alguma mensagem nossa antes" é um sinal confiável de "é esse
  aqui que estamos de fato contatando", nunca um chute.
  `resolverAmbiguidadePorHistorico()` (`whatsapp-webhook/index.ts`): só
  resolve quando EXATAMENTE 1 dos candidatos tem QUALQUER linha em
  `mensagens_whatsapp` — 2+ com histórico, ou nenhum, continua ambíguo
  (mesma cautela de sempre). Testado contra os 14 casos reais que
  motivaram este bug (Kelly Susan, Nayana, Lorena, Giorgia, Rodrigo,
  Fernanda/Cleuber, Rômulo, Joselle, Eloiza, Ana Carolina, Josilena,
  Pollyanne) — os 14 resolveriam corretamente com este critério.
  `payload_bruto` grava `resolvido_por_historico: true` quando esse
  caminho foi usado (auditoria — diferencia de um match direto por
  telefone único). **Backfill retroativo rodado contra produção**: as 14
  conversas já presas antes deste fix foram religadas ao lead certo via
  `UPDATE` direto (mesma lógica, aplicada manualmente).
- **"Não dava pra abrir a conversa" — corrigido** (`js/whatsapp.js`):
  antes, `htmlContatoNaoIdentificadoWpp()` só tinha o botão "Vincular"
  (que abre um `prompt()` pedindo o nome) — a linha em si não tinha
  `onclick` nenhum. Agora a linha inteira abre `abrirChatNaoIdentificado(telefone)`
  — uma mini-visão de chat própria (não reaproveita `criarChatController()`,
  que é montado em torno de um `pessoaIdentificador` fixo pro Realtime/
  templates/anexos — aqui ainda não há lead nenhum): histórico completo
  (`mensagens_whatsapp` filtrado por `telefone_whatsapp`, reusando
  `htmlMensagemWpp()`) + resposta livre. **`whatsapp-send` ganhou um
  novo parâmetro `telefoneWhatsapp`** (alternativa a
  `pessoaIdentificador`, só pra `tipo: 'texto'`) — resolve o número
  direto, sem lead/filial nenhuma, cai no `phone_number_id` padrão.
  Quando a última mensagem ficou ambígua, `payload_bruto.candidatos_ambiguos`
  (já existia, agora inclui `pessoaNome` também) alimenta uma **escolha
  rápida** — um botão por candidato (`vincularConversaNaoIdentificadaPorId()`),
  sem precisar digitar nome.
- **`vincularConversaNaoIdentificada()` (busca por nome) também corrigida**:
  antes buscava só em `leadsAtuais` (escopado à filial selecionada no
  topo) — pra um duplicado CROSS-FILIAL, o lead certo podia nem estar
  carregado, e a busca dizia "nenhum lead encontrado" à toa. Agora busca
  direto no banco, em TODAS as filiais.
- **Achado nesta mesma varredura, não relacionado ao bug acima**: um
  pedido de LGPD (Thiago Dias, "peço, gentilmente, que exclua meu
  telefone... já havia feito esse pedido em outra oportunidade") e um
  caso real de telefone errado (Gisele Nunes Miranda, "Não sou Gisele e
  nem conheço nenhuma Gisele!" — telefone marcado como `"Telefone
  Inválido"` manualmente, mesmo efeito de `marcarTelefoneInvalido()` na
  gaveta).

## Convidar (Janela Aberta) — mensagem editável, sem auto-apresentação (2026-09-29)

Feedback direto do usuário sobre o recurso ("Convidar (Janela Aberta)",
ver seção própria acima): "libere a mensagem para edição. Reparei que vc
criou uma mensagem em que eu me apresento de novo, e isso não é
necessário pois estamos respondendo uma mensagem já iniciada".

- **Texto de cada candidato agora é editável** antes de enviar
  (`renderizarPreviaConviteJanelaAberta()`, `js/whatsapp.js`) — o antigo
  `<div>` só-leitura virou um `<textarea>` (`editarTextoCandidatoConviteJanelaAberta()`
  atualiza o array em memória a cada tecla, sem re-render — perderia o
  cursor); `confirmarConviteJanelaAberta()` já lia `c.texto` na hora do
  envio, então o valor editado é o que sai.
- **Novas variantes de template SEM auto-apresentação**
  (`CONVITE_EVENTO_NAO_ALUNO_SEM_APRESENTACAO`/`CONVITE_EVENTO_ATIVO_SEM_APRESENTACAO`,
  `js/whatsapp.js`) — os templates originais (`CONVITE_EVENTO_NAO_ALUNO`/
  `CONVITE_EVENTO_ATIVO`) sempre abrem com "Aqui é {atendente}, da Nova
  Acrópole {filial}, tudo bem?", apropriado pra um contato FRIO — mas
  "Janela Aberta" SEMPRE responde uma conversa já em andamento (é
  literalmente o critério de entrada: só quem tem a janela de 24h aberta
  porque já nos mandou mensagem). `montarTextoConviteEvento()` ganhou um
  4º parâmetro, `semApresentacao` — quando `true`, troca a escolha
  ativo/não-aluno pra essas variantes (a lógica de detectar "Ativo" via
  tag continua igual, só o texto-base muda). Chamado com
  `semApresentacao=true` só no ponto de montagem dos candidatos da
  Janela Aberta — o convite individual da gaveta/lote via wa.me/API
  continuam usando os templates originais (contato às vezes é frio de
  verdade nesses casos).

## WhatsApp Unificado: ordenar/filtrar + tags direto na conversa (2026-09-29)

Pedido do usuário, itens 3 e 4 de uma lista de 5: "coloque uma forma de
ordenar e filtrar as conversas no whatsapp unificado (não lidas,
respostas mais recentes, dentro da janela, etc.)" e "dentro da área de
whatsapp unificado, permita as tags (ver, incluir, remover, alterar)".

- **Ordenar/filtrar** (`index.html`, `#wppOrdenarSelect`/
  `#wppFiltroSoJanelaAberta`, ao lado do filtro de filial já existente):
  3 modos de ordenação — "Mais recentes primeiro" (padrão, já era a
  ordem da query), "Não lidas primeiro" (`conversaNaoLidaWpp()`, já
  existia pro indicador visual) e "Janela fechando primeiro" (menor
  `horasRestantesJanelaWpp()` primeiro — quem não tem janela correndo,
  porque a última mensagem foi NOSSA, vai pro fim, não é urgente) — mais
  um checkbox "Só dentro da janela de 24h". Tudo aplicado em MEMÓRIA
  sobre o que `renderizarContatosWpp()` já buscou (sem bater no banco de
  novo) — `horasRestantesJanelaWpp()` foi extraída do corpo de
  `htmlTimerJanelaWpp()` pra ser reaproveitada aqui.
- **Tags direto no cabeçalho da conversa** (`#wppChatTagsBlock`,
  `js/whatsapp.js`, `renderizarTagsWpp()`/`confirmarNovaTagWpp()`/
  `removerTagWpp()`): antes só dava pra ver/editar tags abrindo a gaveta
  do lead no Kanban. **De propósito NÃO reaproveita `renderDrawerTags()`/
  `confirmarNovaTag()`/`removerTag()` diretamente** (`js/app.js`) — são
  amarradas ao `currentLeadId` global e a elementos DOM da gaveta
  (`drawer-tags`, `drawer-tag-form`); em vez disso, funções paralelas
  que operam por `leadId` explícito, reaproveitando as peças PURAS
  (`parseTags`/`classeVisualTag`/`TAG_LEAD_MANUAL`/`registrarLogAtividade`,
  com `origem: 'whatsapp_unificado'` no log) e a MESMA regra de negócio
  (exclusão mútua Ativo/Inativo, tag "CRM" permanente). Reusa o
  `<datalist id="tagsSugeridasList">` que já existia globalmente — sem
  datalist novo. Chamado de dentro de `abrirChatWpp()`, depois do lead
  já estar garantido em `leadsAtuais`.

## Áudio recebido pelo WhatsApp toca de verdade no CRM (2026-09-29)

Pedido do usuário: "não consigo ouvir áudio pelo crm e preciso disso" —
`extrairTexto()` (`whatsapp-webhook`) sempre só gravou o texto literal
"[Áudio recebido]" pra mensagens de voz, sem nunca baixar a mídia de
verdade. A Graph API nunca manda a mídia direto no payload do webhook,
só um `id` — é preciso 1 chamada (`GET /{media-id}`, Bearer token) pra
pegar uma URL temporária assinada (expira rápido) e outra pra baixar o
binário de fato, com o MESMO Bearer.

- **`_shared/midia.ts`, NOVO** — `baixarEArmazenarMidiaRecebida(supabaseAdmin,
  mediaId)`: faz as 2 chamadas e re-hospeda no MESMO bucket público já
  usado pro envio de anexos (`whatsapp-midia`,
  `migracao_storage_whatsapp_midia.sql`) — assim o link nunca expira e o
  navegador só precisa de uma URL pública comum
  (`<audio src>`/`<img src>`), sem token nenhum. Best-effort: falha em
  qualquer etapa (token, rede, upload) devolve `null`, a mensagem ainda
  é gravada normalmente (cai no texto placeholder), nunca trava o
  webhook. Compartilhado entre `whatsapp-webhook` (mídia nova, tempo
  real) e `whatsapp-backfill-midia` (mídia antiga, ver abaixo).
- **Ganho de carona pra imagem/documento recebidos**: `htmlMensagemWpp()`
  já lia `payload_bruto.imagem_url`/`documento_url`+`nome_arquivo` pra
  renderizar imagem/documento — mas só preenchidos quando NÓS
  enviávamos (`whatsapp-send`). Populando essas MESMAS chaves pra
  mensagens RECEBIDAS (`msg.image.id`/`msg.document.id`), o render já
  funciona pros dois lados sem nenhuma mudança de frontend — só áudio
  precisou de um branch novo (`<audio controls>`, `audio_url`/`audio_mime`
  em `payload_bruto`).
- **`whatsapp-backfill-midia`, NOVA Edge Function de manutenção pontual**
  (não faz parte de nenhum cron/fluxo automático) — baixa a mídia de
  áudio/imagem/documento recebidos ANTES deste recurso existir (senão
  ficariam pra sempre só com o texto placeholder). Chamada manualmente 1x
  via `curl`/`invoke` — **já rodada contra produção nesta sessão**:
  recuperou os 2 áudios recebidos antes do deploy, confirmados
  publicamente acessíveis (`curl -I`, `200 OK`, `audio/ogg`).
- **Testado ao vivo, ponta a ponta**: os 2 áudios de backfill confirmados
  gravados com `audio_url`/`audio_mime` corretos e acessíveis via HTTP
  direto. Áudio novo chegando pelo webhook em tempo real não foi
  confirmado visualmente nesta sessão (sem receber um áudio de teste) —
  a lógica é a MESMA já validada pelo backfill, risco residual baixo.

## Sugestão de resposta por IA no WhatsApp — toggle por conversa e por filial (2026-09-29)

Pedido do usuário: "Crie uma sugestão de resposta com IA para cada lead
que respondeu (eu preciso autorizar o envio dessa sugestão). Permita
habilitar ou desabilitar essa função por conversa, e também por
filial". Mesmo princípio de sempre (`ia-diagnostico-saude`/
`ia-recomendar-contatos`/`classificar-resposta-convite`): a IA NUNCA
decide quem entra na lista nem envia sozinha — só escreve um rascunho; a
detecção é 100% regra fixa em SQL, e o SDR sempre autoriza o envio.

- **Diferença pra `classificar-resposta-convite`** (seção própria acima):
  aquela só cobre quem tem um CONVITE DE EVENTO pendente (categoriza
  confirmou/recusou/etc., toca em `evento_leads`); esta cobre QUALQUER
  resposta recebida, sem categoria fixa, só um rascunho de resposta —
  as duas coexistem, e esta pula quem já tem uma classificação de
  convite pra evitar 2 sugestões concorrentes pro mesmo lead.
- **2 toggles novos**: `filiais.ia_sugestao_resposta_habilitada`
  (boolean, default `true` — "Gerenciar Filiais", checkbox novo ao lado
  de "Ativa") é o padrão da FILIAL; `leads_inscricoes.ia_sugestao_resposta`
  (boolean NULLABLE — `null` = segue o padrão da filial; `true`/`false`
  = override explícito) é o override por CONVERSA, um `<select>` novo no
  cabeçalho do chat (WhatsApp Unificado, ao lado das tags —
  `alternarSugestaoIaLead()`). `migracao_sugestao_resposta_ia.sql`.
- **Detecção 100% determinística**: `mensagens_candidatas_sugestao_resposta(p_limite)`
  (`migracao_rpc_candidatas_sugestao_resposta.sql`) — mensagens de
  ENTRADA de texto das últimas 2h, sem sugestão ainda, respeitando
  `coalesce(lead.ia_sugestao_resposta, filial.ia_sugestao_resposta_habilitada, true)`.
- **Edge Function `sugerir-resposta-whatsapp`**, chamada por pg_cron a
  cada 15 min (`migracao_agendamento_sugestao_resposta.sql`, mesmo
  padrão de `net.http_post` com a chave publishable como Bearer): pra
  cada candidata, monta o CONTEXTO (últimas 6 mensagens da conversa,
  `montarContexto()`) e pede um rascunho curto/caloroso/não-vendedor à
  Claude Haiku — proibido explicitamente inventar fato concreto (data,
  valor, endereço) que não veio no contexto; sem confiança, devolve
  `sugestao: null` em vez de forçar um texto. Grava em
  `sugestoes_resposta_wpp` (`status='pendente'`, `unique(mensagem_origem_id)`
  — corrida entre execuções do cron falha o insert e segue, sem
  duplicar).
- **Card de revisão no WhatsApp Unificado** (`#wppSugestaoIaBox`, entre
  as mensagens e a caixa de texto): aparece quando o lead aberto tem uma
  sugestão `pendente` — texto EDITÁVEL (`<textarea>`) + "Enviar"
  (`enviarSugestaoIaWpp()`, chama `whatsapp-send` de verdade e marca
  `status='enviada'`) + "Descartar". Sem texto gerado (IA falhou), mostra
  só "Descartar" e um aviso pra escrever na mão. Atualiza sozinho via
  Realtime (canal `postgres_changes` filtrado por `pessoaIdentificador`,
  mesmo padrão do chat) quando o cron gera uma sugestão nova enquanto a
  conversa já está aberta. **Badge na lista de contatos**
  (`htmlContatoWpp()`, ícone de varinha) avisa quem tem sugestão
  pendente sem precisar abrir cada chat — 1 query em lote, não 1 por
  lead.
- **Testado ao vivo, ponta a ponta, contra produção**: RPC de candidatos
  confirmada com dado real (5 mensagens reais); dedupe contra
  `classificar-resposta-convite` confirmado (4 de 5 candidatas puladas
  por já terem classificação de convite — só a que não tinha convite
  pendente gerou sugestão de verdade); leitura via chave publishable
  confirmada (`curl` direto na REST API). **A ESCRITA da IA está
  falhando** — `"credential validation failed"` (Anthropic), um erro
  diferente do já documentado "Your credit balance is too low" — mesma
  classe de bloqueio externo, mas causa nova; a detecção/fallback nunca
  trava (grava `sugestao_resposta: null`, mesmo comportamento seguro de
  sempre), só falta o texto até a credencial ser corrigida no Console da
  Anthropic (ação do usuário, fora do código).

## Responder mensagem específica, encaminhar, Ctrl+Enter, contatos legíveis (2026-09-29)

Pedido do usuário: "inclua na tela do whatsapp unificado e na gaveta do
lead a opção de responder a uma mensagem específica (igual no whatsapp
real)", "inclua também a opção de encaminhar mensagens de um contato
para outro, e de criar uma nova linha na mensagem ao apertar ctrl+enter"
— mais 2 bugs reais achados no meio do caminho (contato compartilhado
ilegível, pergunta sobre foto de perfil).

- **Responder a uma mensagem específica**: botão (ícone de seta,
  `.wpp-responder-btn`) aparece no hover de qualquer balão com
  `wa_message_id` — clicar preenche uma barra "Respondendo a..." acima
  da caixa de texto (com "x" pra cancelar), e a mensagem enviada carrega
  a citação. Implementado DENTRO de `criarChatController()`
  (`js/whatsapp.js`) — como `chatWpp` (WhatsApp Unificado) e
  `chatDrawer` (gaveta do lead) são as 2 instâncias desse MESMO
  controller, o recurso já cobre as 2 telas de uma vez, sem duplicar
  nada. `whatsapp-send` ganhou `contextoMessageId` (manda
  `context.message_id` pra Graph API, suportado em qualquer tipo de
  mensagem de saída) + `contextoPreview`/`contextoRemetente` (só
  nossos, guardados em `payload_bruto.contexto_preview`/
  `contexto_remetente` — evita ter que resolver de novo depois).
  - **Renderização da citação**: `resolverCitacaoWpp(m, mapaPorWaId)` —
    mensagem de SAÍDA já tem o preview guardado (não precisa resolver
    nada); mensagem de ENTRADA só traz `context.id` (a Meta nunca manda
    o texto da mensagem citada, só o id) — resolve contra o que já está
    carregado NA CONVERSA (`mapaPorWaId`, construído a cada
    `renderizarMensagens()`); se a citada não estiver carregada (mais
    antiga que a janela já buscada), mostra "Mensagem anterior" mesmo
    assim, sem travar.
  - **Testado ao vivo contra produção**: envio real com
    `contextoMessageId` de uma mensagem real do lead de teste (904000019)
    confirmado — `payload_bruto.contexto_preview`/`contexto_remetente`
    gravados corretos.
- **Encaminhar mensagem**: botão (`.wpp-encaminhar-btn`) abre um painel
  flutuante (`abrirSeletorEncaminharWpp()`) com busca de lead por nome
  em TODA a base (cross-filial, mesmo padrão de outras buscas já
  existentes) — escolher um lead reenvia o MESMO conteúdo (texto,
  imagem, documento ou áudio, usando a URL já pública guardada em
  `payload_bruto`) como mensagem nova pra ele. **Limitação real da API,
  não do CRM**: a Graph API não tem um "flag de encaminhado" pra
  mensagem de SAÍDA — chega pro destinatário como uma mensagem comum,
  sem o rótulo "Encaminhada" que o app nativo mostra.
  - **`whatsapp-send` ganhou o tipo `"audio"` nativo** (Graph API
    `{type:"audio", audio:{link}}`) — antes só existia imagem/documento/
    texto/template/reação; necessário pra encaminhar áudio como áudio de
    verdade (não como documento). Testado ao vivo: áudio real
    encaminhado com sucesso pro lead de teste.
- **Ctrl+Enter insere nova linha** — a caixa de mensagem
  (`.chat-input`) virou um `<textarea>` (antes era `<input type="text">`,
  fisicamente incapaz de mostrar quebra de linha) com auto-crescimento
  (`ajustarAlturaTextareaWpp()`, até `max-height` do CSS, depois rola).
  Enter sozinho continua enviando (`e.preventDefault()` só nesse caso);
  Ctrl+Enter cai no comportamento padrão do `<textarea>` (insere `\n`),
  sem nenhum código especial pra isso — só não intercepta.
- **Bug real corrigido: contato compartilhado (vCard) ilegível** —
  relatado pelo usuário ("recebemos contatos pelo whatsapp, que não
  conseguimos ler"), com exemplo real colado (2 mensagens
  "[Mensagem tipo contacts]" sem nome/telefone nenhum visível).
  `extrairTexto()` (`whatsapp-webhook`) nunca lia `msg.contacts` (array
  de vCard que a Meta já manda completo — nome, telefone — sempre
  preservado em `payload_bruto` desde sempre, só a coluna `corpo_texto`
  nunca extraía nada dali). Corrigido: monta
  `"📇 Contato compartilhado: {nome} — {telefone}"` a partir de
  `msg.contacts[].name.formatted_name`/`phones[0].phone`. **Sem migração
  nova** — continua gravado com `tipo='outro'` (`mensagens_whatsapp.tipo`
  não tem `'contato'` no `check` constraint, e o texto já resolve o
  problema relatado sem precisar alargar o schema). 2 mensagens já
  presas com o texto genérico foram corrigidas via backfill (Sheila,
  Ivani — nomes/telefones reais recuperados do `payload_bruto` já
  salvo).
- **Pergunta do usuário, resposta honesta**: "também gostaria de ver as
  fotos dos contatos" — a WhatsApp Business Cloud API **não expõe foto
  de perfil de contato/lead nenhum** (só a foto do PRÓPRIO número de
  negócio, via um endpoint diferente) — é uma limitação deliberada da
  Meta por privacidade, não algo que dê pra contornar com código. Não
  construído, e não há solução conhecida enquanto essa restrição da API
  existir.

## "O que pode melhorar" — rodada de dívida técnica (2026-09-30)

Pedido do usuário depois de uma auditoria (comparativo WhatsApp real vs.
CRM) que terminou com 3 listas — o que temos, o que falta, o que pode
melhorar: "siga com tudo o que pode melhorar, e depois vamos reavaliar o
que falta".

### `tools/lint/verificar-globais.mjs` — verificador estático sem dependências

Motivação: um bug real (`abrirChatWpp()`, `js/whatsapp.js` — referenciava
`${id}` dentro de um botão novo, mas a variável se chamava `leadId`;
`ReferenceError` síncrono no meio da função, sem nenhum erro visível pro
usuário) só foi achado porque o usuário reportou "estou clicando nos
leads no whatsapp unificado, e não consigo acessar às conversas" — um
linter de verdade (ESLint) pegaria isso na hora, antes de chegar em
produção. **`npm install` não funciona neste drive** (`G:\`,
streaming do Google Drive — mesma limitação já documentada pra
`scraper/`, confirmado de novo tentando instalar ESLint: `EPERM`/`EBADF`
no meio da instalação). Solução: um script Node **sem nenhuma
dependência** (`tools/lint/verificar-globais.mjs`), numa pasta ISOLADA
de propósito — nunca um `package.json` na raiz do repositório, porque
isso mudaria a detecção zero-config do Vercel (hoje funciona só porque
não existe nenhum `package.json` lá) e podia quebrar o deploy estático
que já está no ar.

- **Como funciona** (heurística, não um parser de verdade — documentado
  no próprio arquivo): calcula a lista de "globais do projeto" lendo os
  14 arquivos de `js/` (toda função/const/let/var na COLUNA 0 — os
  scripts são `<script>` clássicos, sem `type="module"`, compartilhando
  1 escopo só); pra cada função de nível superior, extrai o corpo
  inteiro (brace-aware) e confere se todo `${identificador}` dentro de
  template literals está declarado em algum lugar (global, parâmetro,
  const/let/var do próprio corpo, parâmetro de arrow function) — se não
  estiver em NENHUM desses, reporta como suspeito.
- **2 bugs reais no PRÓPRIO verificador, achados testando contra o
  código de verdade** (documentados extensamente nos comentários do
  arquivo):
  1. Literal de regex com aspa dentro (`csvEscapeCampo()`, `js/app.js`:
     `if (/[",\n;]/.test(str))`) — sem reconhecer regex, o `"` DENTRO do
     regex era interpretado como início de STRING nova, desincronizando
     o parser pro resto do arquivo inteiro.
  2. Template literal ANINHADO (`abrirChatWpp()`, `js/whatsapp.js`:
     `` `${x ? \`texto ${y}\` : ''}` ``) — um simples toggle "entrei/saí
     de template" nunca dá conta disso; reescrito com uma PILHA de
     contextos (`BRACE`/`INTERP`/`TEMPLATE`/`STRING1`/`STRING2`/`REGEX`/
     `REGEX_CLASSE`) em vez de um `modo` único.
  3. Múltiplos declaradores numa linha (`let a = 0, b = 1;`) e
     destructuring (`const { count, error } = ...`, `const [ano, mes,
     dia] = ...`) geravam falso-positivo (regex não-guloso só capturava
     o 1º nome, ou a vírgula sobrava no meio do nome depois de tirar só
     `{}[]`).
- **Testado**: reintroduzindo o bug real `${id}` de propósito, o
  verificador ACHA (linha e função certas); revertendo, fica limpo (0
  suspeitas nos 14 arquivos). Rodar: `node tools/lint/verificar-globais.mjs`
  (sem instalar nada) — vale rodar depois de qualquer edição em `js/*.js`.

### Paginação de histórico do WhatsApp (bug real + feature nova)

`carregarHistoricoMensagens()` (`js/whatsapp.js`) buscava com
`.order('criado_em', {ascending: true}).limit(200)` — ou seja, as 200
mensagens MAIS ANTIGAS da conversa, não as mais recentes. Numa conversa
com mais de 200 mensagens, isso mostraria o início de anos atrás em vez
do que aconteceu ontem. Corrigido (`ascending: false` + `.reverse()` no
fim) + botão **"Carregar mensagens anteriores"** no topo da lista
(`carregarMaisAntigas()`, dentro de `criarChatController()` — cobre
WhatsApp Unificado e gaveta de uma vez) que pagina pra trás
(`.lt('criado_em', primeiraJaCarregada)`) preservando a posição de
rolagem (calcula `scrollHeight` antes/depois do prepend).

### Gatilho 9 na Central de Notificações — taxa de falha por pagamento

`verificarNotificacoesFalhasPagamento()` (`js/notificacoes.js`) — avisa
quando 5+ mensagens falharam na última hora com código `131042`
("Business eligibility payment issue"). Antes só se descobria porque
alguém notava (foi exatamente o que aconteceu com o lote de 453
falhas). Dedup por HORA (não por linha — o interesse é "a taxa está
alta agora"), poll de 15 min (mesma cadência do reenvio automático).
Clicar leva direto pro billing hub da Meta.

### Throughput pacing nos disparos em massa

Pausa de 400ms (`pausarWpp()`/`PAUSA_ENTRE_LOTES_MS`, `js/whatsapp.js`;
equivalente inline em `whatsapp-reenviar-falhas`) entre cada lote de 5
— nos 3 pontos que disparam em lote (Convidar API, Convidar Janela
Aberta, reenvio automático). Não é uma garantia formal de taxa (a Meta
tem seus próprios limites por número/qualidade), só um respiro.

### Detecção de duplicados ENTRE filiais (gap já documentado, resolvido)

Nova RPC `duplicados_entre_filiais(p_limite)`
(`migracao_rpc_duplicados_entre_filiais.sql`) — mesmo telefone
cadastrado em 2+ FILIAIS diferentes (normaliza o 9º dígito de celular
antes de agrupar, mesma lógica de `normalizarTelefoneParaChave()`).
Nova seção **"Duplicados Entre Filiais"** na aba Leads a Tratar
(`carregarDuplicadosEntreFiliais()`, `js/leads-a-tratar.js`) — sob
demanda (botão "Verificar", consulta a base INTEIRA, não roda sozinho
ao abrir a aba), só leitura, nunca mescla automaticamente (reaproveita
`abrirModalMesclarManual()` já existente pra revisão humana — pessoas
diferentes podem legitimamente compartilhar telefone, ex: casal).
**Testado contra produção**: 243 grupos reais / 507 leads confirmados
(nomes batendo de verdade entre filiais — ex: "Gleison Batista dos
Santos" em Jardim América e Goiânia II). **Achado ruído real no
caminho**: telefone "000000000" (placeholder de "sem telefone de
verdade" usado numa das planilhas antigas) juntava 4 pessoas sem
relação nenhuma — filtro adicionado na própria RPC
(`!~ '^(\d)\1*$'`, exclui número com todos os dígitos iguais).

### Itens deliberadamente NÃO tocados nesta rodada

- **Pesos do modo "Prioridade"** (sugestão de IA > janela > Lead Forte >
  não lida) — ficam como estão até uso real mostrar se a ordem bate com
  o que o time acha certo; não há o que "melhorar" sem esse feedback.
- **Credencial da Anthropic quebrada** — ação externa do usuário
  (Console da Anthropic), fora do alcance de qualquer mudança de código.

## Reenvio automático de falhas de WhatsApp (2026-09-29/30)

Achado real, não um bug de código: um disparo em massa via "Convidar
(API)" gerou 453 falhas — 312 por `131042` ("Business eligibility
payment issue", fatura em aberto na conta de WhatsApp Business da Meta)
e 141 por `131026` ("Message Undeliverable", número sem WhatsApp de
verdade). O usuário pediu um script automático que reenvie sozinho as
falhas a cada 3h.

- **Decisão de design, deliberada**: NUNCA reenviar tudo que falhou —
  só códigos de erro genuinamente TEMPORÁRIOS, que podem se resolver
  sozinhos com o tempo. Whitelist (`131042` fatura em aberto, `130429`/
  `131056` limite de taxa passageiro) vive DENTRO da RPC
  `mensagens_falhas_retriaveis()` (`migracao_rpc_falhas_retriaveis.sql`)
  — única fonte de verdade, a Edge Function não duplica a lista.
  `131026` (Message Undeliverable) e qualquer outro código NUNCA entram
  — reenviar pra um número que nunca teve WhatsApp de verdade não
  funciona nunca, só gasta chamada de API à toa e arrisca a reputação
  do número de negócio.
- **`migracao_whatsapp_reenvio_automatico.sql`**: `tentativas_reenvio`
  (int, default 0) + `ultima_tentativa_reenvio_em` em
  `mensagens_whatsapp`, e o `check` de `wa_status` ganhou o valor
  `'reenviada'` — a linha ORIGINAL que falhou fica marcada assim quando
  um reenvio dá certo (a mensagem de verdade é uma linha NOVA, já que
  `whatsapp-send` sempre insere 1 linha por chamada) — sai da fila de
  retentativa pra sempre, sem duplicar a mesma falha em `'falhou'` pra
  sempre.
- **`whatsapp-send` ganhou `template_nome`/`template_idioma`/
  `template_params` em `payload_bruto`** (só existiam pra imagem/
  documento/áudio antes) — necessário pra um reenvio futuro conseguir
  reconstruir a MESMA chamada de template; sem isso, só o texto já
  renderizado (`corpo_texto`) fica gravado, que não dá pra mandar de
  volta como template de verdade pra Graph API.
- **Nova Edge Function `whatsapp-reenviar-falhas`**, cron a cada 3h
  (`migracao_agendamento_reenvio_falhas.sql`) — busca candidatas via a
  RPC (limite de 5 tentativas, validade de 7 dias), reconstrói o corpo
  exato por tipo (`montarCorpoReenvio()`) e chama `whatsapp-send`
  servidor-a-servidor (`SUPABASE_SERVICE_ROLE_KEY`, mesmo padrão de
  `resumo-semanal-chefe` → `whatsapp-notificar-chefe-filial`) em lotes
  de 5. Incrementa `tentativas_reenvio` ANTES de saber o resultado —
  evita reprocessar a mesma linha pra sempre se algo quebrar no meio.
- **Bug real corrigido durante o teste**: a 1ª versão buscava as falhas
  com `.order(criado_em asc).limit(200)` e filtrava o código de erro EM
  MEMÓRIA depois — com 723 falhas acumuladas em 7 dias, os 200 primeiros
  (mais antigos) quase nunca eram os retriáveis de verdade (`"puladas":
  200"`, 0 retriáveis). Corrigido filtrando por código DIRETO no banco
  via a RPC (mesma lição já aprendida várias vezes neste projeto sobre
  filtro jsonb complexo via PostgREST client-side).
- **Backfill pontual pro lote histórico**: as 312 falhas de `131042` já
  existentes foram gravadas ANTES de `whatsapp-send` guardar
  `template_nome` — sem esse dado, `montarCorpoReenvio()` devolvia
  `null` (`"sem_dado_suficiente": 312`). Como as 312 usavam o MESMO
  template (`contato_inicial`, confirmado por regex batendo 100% contra
  `corpo_texto`), os parâmetros (`nome`/`atendente`/`filial`) foram
  reconstruídos via `regexp_match()` sobre o texto já renderizado e
  gravados retroativamente em `payload_bruto`. Só serviu pra ESTE lote
  específico — reenvios futuros já nascem com o dado certo, sem precisar
  de backfill nenhum.
- **Testado ao vivo, ponta a ponta, contra produção**: rodando a
  function depois do backfill, **30 das 312 mensagens foram reenviadas
  com sucesso de verdade** (confirmado no banco, `wa_status='reenviada'`
  na linha original + uma linha nova com `wa_status='enviado'`) — as
  outras 282 falharam de novo com o mesmo código (fatura ainda em
  aberto na Meta) e continuam na fila, tentando de novo a cada 3h até o
  limite de 5 tentativas ou 7 dias.

## Vídeo/figurinha/localização, leitura ativa, busca, priorização e IA com contexto do CRM (2026-09-29)

Pedido do usuário: "implemente tudo que for possível no whatsapp do
crm" — a partir do comparativo WhatsApp real vs. Cloud API vs. CRM feito
nesta sessão, mais "quero criar um 'bot' de atendimento que possa ler a
conversa e organizar a ordem de resposta por prioridade... já com uma
sugestão de resposta inteligente (pode pesquisar em todo os crm para
responder)". Não é um bot novo/separado — é a MESMA infraestrutura de
`sugerir-resposta-whatsapp` (ver seção própria acima) enriquecida.

- **Bug real corrigido primeiro: cabeçalho do chat da gaveta cortado**
  — `.chat-header` (`css/style.css`) não tinha `flex-wrap`; a gaveta
  acumulou botões (Importar Conversa/Convidar pra Evento/Nova Turma/
  Buscar/Ver no WhatsApp Unificado/alterar nome) numa coluna estreita
  (drawer tem 800px total, 350px já vão pra `.drawer-info`) e a fila
  simplesmente extrapolava a largura. Corrigido com `flex-wrap: wrap`
  (inofensivo pro cabeçalho do WhatsApp Unificado, painel bem mais
  largo).
- **Vídeo e figurinha recebidos** — mesmo mecanismo de
  `baixarEArmazenarMidiaRecebida()` (áudio/imagem/documento, ver seção
  própria) — `msg.video.id`/`msg.sticker.id` → `video_url`/`sticker_url`
  em `payload_bruto`. `htmlMensagemWpp()` ganhou `<video controls>` e um
  `<img>` pequeno (sem moldura de balão, igual o real) pra figurinha.
  **Sem migração nova** — `tipo` já aceitava `'video'`/`'sticker'` no
  `check` constraint desde `migracao_whatsapp.sql`, só nunca eram
  baixados de verdade.
- **Localização compartilhada** — `msg.location` já vem com lat/long
  direto (sem `id` de mídia pra baixar); card clicável (`<a>` pro Google
  Maps, `?q=lat,long`) com nome/endereço quando a Meta manda.
- **Confirmação de leitura ativa** (✓✓ azul do lado do lead) — nova Edge
  Function `whatsapp-marcar-lido` (`POST .../messages` com
  `{status:"read", message_id}`, endpoint PRÓPRIO da Graph API,
  diferente do envio normal — por isso não entrou em `whatsapp-send`).
  Chamada de dentro do `abrir()` do `criarChatController()` — cobre
  WhatsApp Unificado E gaveta de uma vez (os 2 usam o mesmo `abrir()`).
  `wppMensagensMarcadasLidas` (Set em memória) evita repetir a chamada
  pra mesma mensagem em reaberturas seguidas da mesma sessão.
- **Busca dentro da conversa aberta** — `toggleBuscaConversa()` (dentro
  do controller, exposta em `chatWpp`/`chatDrawer`), botão de lupa nos 2
  cabeçalhos. Filtra os balões já carregados (mesmo limite de 200 de
  `carregarHistoricoMensagens()`) — diferente do WhatsApp real (que
  destaca e pula entre resultados sem esconder o resto), aqui é uma
  versão mais simples: só mostra quem bate, com contador "N resultado(s)".
- **Priorização automática ("bot")** — novo modo de ordenação
  `"Prioridade (recomendado)"`, agora o PADRÃO da lista de conversas
  (`#wppOrdenarSelect`). Pontuação 100% determinística (nunca a IA
  decidindo a ordem), combinando sinais que já existiam no CRM:
  sugestão de IA pendente (+1000, pesa mais — já tem resposta pronta, só
  falta autorizar), janela fechando (+400/+200/+50 conforme urgência),
  Lead Forte 1/2/3 (+300/+180/+90), não lida (+60). Empate cai pra mais
  recente primeiro.
- **`sugerir-resposta-whatsapp` ganhou `montarContextoCRM()`** — antes só
  via as últimas 6 mensagens da PRÓPRIA conversa (nunca respondia
  "quanto custa"/"onde fica"/"que evento eu já fui" com segurança, sempre
  caía no "vou confirmar"). Agora busca, por lead: tags, últimos 5
  eventos de `historico_eventos`, `resumo_ia`, `abordagem_sugerida`; por
  filial: `nome_com_preposicao`/`endereco`/`valor_mensalidade`. O prompt
  instrui explicitamente a IA a USAR esses dados reais quando responderem
  a pergunta, e continua proibido inventar o que não estiver ali.
  **Testado**: campos confirmados no formato real do banco (`tags` como
  string JSON, `historico_eventos` como array `{evento,data,tipo}`) —
  a geração de texto em si continua bloqueada pela mesma falha de
  credencial da Anthropic já documentada (não testado com resposta real
  da IA, só a montagem do contexto).

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

**Reverificado em produção, 2026-09-28 (pedido do usuário: "verifique se
a meta já liberou a API")** — CONTINUA bloqueado. Teste real (não só
consulta ao histórico): chamada direta a `whatsapp-send` (template
`resgate_lead_evento`, pro lead de teste próprio do usuário,
`pessoaIdentificador` 904000019) devolveu exatamente o mesmo erro de
sempre: `{"code":200,"type":"OAuthException","message":"API access
blocked.","fbtrace_id":"..."}`. Nenhuma tentativa real de envio constava
em `mensagens_whatsapp` desde 2026-09-11 (todo contato desde então foi
via wa.me manual/link pessoal, que não passa por aqui) — por isso foi
preciso mandar 1 mensagem de teste de verdade pra saber o status atual,
em vez de só ler o histórico. Ação continua sendo só do usuário (Business
Manager / WhatsApp Manager da Meta, ver bullets acima) — nenhuma mudança
de código resolve isso. Ver também "Convites em Massa via API (templates
aprovados)" na seção WhatsApp — construído já pronto pra funcionar no
instante em que este bloqueio cair.

**CAUSA RAIZ provável encontrada, 2026-09-28 — supera a teoria anterior
("divergência de telefone/documento na Receita Federal")**: o usuário
entrou em `developers.facebook.com/apps` e encontrou a tela
"Confirmação de conta necessária" — *"Notamos uma atividade incomum
nessa conta desenvolvedor. Conclua as etapas de confirmação para
recuperar o acesso."* Ou seja: não é o número de WhatsApp nem o app que
está bloqueado isoladamente — é a **conta de desenvolvedor da Meta**
(dono do app) que foi suspensa por suspeita de atividade incomum, e é
essa suspensão que se propaga pra "API access blocked" no app/número.
Clicar em "Confirmar conta" levou a um 2º erro — *"Ocorreu um erro: Há
um problema técnico com esse recurso. Estamos trabalhando para
corrigi-lo."* — que parece ser uma instabilidade do LADO da Meta no
próprio fluxo de verificação (não algo causado pelo usuário). Ação:
o usuário precisa concluir esse fluxo de confirmação de identidade
(reconfirmar telefone/e-mail, documento, ou tentar de novo/por outro
navegador/pelo app Meta Business Suite se o erro técnico persistir) —
continua sendo 100% do lado dele, fora do CRM.

**✅ RESOLVIDO, 2026-09-28** — o usuário concluiu o fluxo de confirmação
de conta de desenvolvedor na Meta (ver bullet acima). Reteste real
imediatamente depois (mesmo `whatsapp-send`, mesmo lead de teste
904000019): `{"ok":true,"wa_message_id":"wamid...."}` — **sucesso**,
confirmado também em `mensagens_whatsapp` (`wa_status='enviado'`, sem
erro). A API está liberada de novo. Bloqueio durou de 2026-09-05 até
2026-09-28 (23 dias) — causa raiz real: conta de desenvolvedor suspensa
por "atividade incomum", não o telefone/documento da verificação de
empresa (teoria original, nunca confirmada, agora descartada). O
banner de aviso no modal "Convidar (API)" (`index.html`,
`#conviteApiAvisoBloqueio`) foi atualizado pra refletir isso — daqui pra
frente, os templates aprovados podem ser enviados de verdade, tanto
individualmente (gaveta do lead) quanto em massa ("Convidar (API)", ver
seção própria abaixo). **Ainda não testado**: envio de imagem (`tipo:
'imagem'`, "Convite Compartilhável") e o lembrete automático pro admin
(`lembrete-scraper`) — devem funcionar agora também, mas usam
`whatsapp-send`/secrets diferentes o suficiente pra valer confirmar na
próxima vez que rodarem de verdade.

**Bug real GRAVE, achado NA HORA (2026-09-28) — só apareceu porque o
bloqueio acima finalmente caiu**: 2 envios reais de aniversário pela
gaveta do lead falharam com um erro NOVO, nunca visto antes —
`{"code":131026,"message":"Message undeliverable"}` — bem diferente de
"API access blocked" (esse é POR NÚMERO, não da conta toda). Os 2 casos
(Eduardo Menezes Ferreira, Lorranny Cardoso) tinham o telefone cadastrado
com **8 dígitos começando com "3"** (`32510156`, `32995562`, DDD 62).
**Causa raiz**: `montarNumeroE164()` (`supabase/functions/_shared/telefone.ts`)
tratava QUALQUER telefone de 8 dígitos como "celular esquecendo o 9º
dígito" e completava com um "9" na frente — mas um número local de 8
dígitos começando com **2/3/4/5** é, pelo plano de numeração da Anatel,
**SEMPRE telefone FIXO** (nunca foi celular, nunca precisou/vai ganhar o
9º dígito) — só números começando com 6/7/8/9 eram celular no formato
antigo de 8 dígitos. "Completar" um fixo com "9" produz um número de
celular que **não existe**, e é isso que a Meta rejeita como "Message
Undeliverable" — ela processa a chamada normalmente (prova de que a API
está liberada, não é o bloqueio de conta de novo), só não consegue
entregar num número que nunca existiu. **Nunca tinha aparecido antes**
porque, com a API bloqueada geral, TODO envio falhava direto com "API
access blocked" — o erro específico por número nunca tinha chance de
aparecer.
- **Levantamento no banco confirmou que não são só 2 casos isolados**:
  **755 leads** (738 só em Goiânia - Jardim América, 10 no Garavelo, 3
  em Barra do Garças/MT, 3 na Goiânia II, 1 no Setor Oeste) têm telefone
  de 8 dígitos começando com 2/3/4/5 — provavelmente TODOS são fixo, sem
  WhatsApp real, e cada tentativa de envio pra eles (individual OU em
  massa) ia gastar uma chamada de API só pra falhar, com um erro que não
  deixa óbvio que o problema é o número.
- **Corrigido em 3 lugares** (mesma regra, `/^[6-9]/` no 1º dígito de um
  número de 8 dígitos decide se completa com "9" ou devolve `null`/
  "sem WhatsApp"):
  1. `montarNumeroE164()` (`supabase/functions/_shared/telefone.ts`) —
     usada por `whatsapp-send` (envio individual E pelo novo "Convidar
     via API" em massa, que chama a mesma function por lead) e
     `whatsapp-importar-conversa`. Redeployadas as 2 functions.
  2. `numeroPareceFixo()`/`telefoneParaWaMe()` (`js/whatsapp.js`) — o
     link wa.me também nunca deveria ser gerado pra um fixo (a pessoa só
     ia descobrir depois, clicando, que o WhatsApp Web não reconhece o
     número); de quebra, `telefoneParaWaMe()` passou a completar
     corretamente com "9" um 8-dígitos que É celular de verdade
     (6-9) — antes ela nunca completava nada, nem pro caso legítimo.
  3. `gerarPreviaConviteApiLote()` (`js/whatsapp.js`, "Convidar via API"
     em massa) — mesma checagem antes de montar a lista de envio, pra
     contar como "sem telefone válido" em vez de gastar uma chamada.
- **Testado ao vivo, ponta a ponta**: reenviando pro lead do Eduardo
  (mesmo `pessoaIdentificador`) depois do redeploy — antes: tentava
  enviar e voltava "Message undeliverable"; depois: `{"ok":false,
  "erro":"lead_sem_telefone"}` direto, sem gastar chamada nenhuma na
  Graph API.
- **Decisão em aberto, não construída ainda**: os 755 leads continuam
  com o telefone cadastrado (a correção só impede tentativa de WhatsApp
  futura, não apaga nem marca nada retroativamente) — não usei "Telefone
  Inválido" pra eles porque o número provavelmente ESTÁ certo, só não é
  WhatsApp (apagar perderia um contato válido pra LIGAÇÃO). Se fizer
  sentido, uma tag nova tipo `"Só Ligação (Telefone Fixo)"` marcando
  esses 755 automaticamente seria o próximo passo natural — não construída
  por decisão de escopo, fica pra o usuário decidir se quer.

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
  principio de sempre). Entrada pela gaveta do lead aceita **texto colado
  OU um arquivo .zip** (ver bullet abaixo) — pra "colei/subi uma conversa
  mas não sei de qual lead é", ver "Importação em Lote de Conversas".

### Importação em Lote de Conversas (.zip, várias de uma vez)

O WhatsApp empacota o export em `.zip` (não só `.txt`) quando inclui mídia
— e em alguns aparelhos mesmo "Sem mídia" já vem em `.zip`. Pedido do
usuário: sustentar esse formato E permitir subir VÁRIAS conversas de uma
vez, casando cada uma com o lead certo automaticamente quando possível.

- **Leitura do .zip no navegador** (`extrairTextoDoZip()`,
  `js/importar-conversa-whatsapp.js`): usa **JSZip** (CDN, `index.html`)
  — abre o `.zip`, acha o primeiro arquivo `.txt` dentro (ignora mídia) e
  devolve o texto, que passa pelo MESMO `parseTextoConversaWhatsApp()` de
  sempre. **Botão de importação de 1 lead (gaveta) também ganhou um
  `<input type="file" accept=".zip">`** ao lado da caixa de colar texto —
  escolher um `.zip` já extrai e processa automaticamente
  (`processarZipConversaWpp()`), sem precisar copiar/colar nada.
- **Botão "Importar Conversas em Lote"** (ícone de zip, ao lado da busca
  na aba WhatsApp Unificada, `abrirImportarConversasLote()`): digita "seu
  nome nas conversas" (o nome EXATO que aparece nos exports como
  remetente — é sempre o mesmo em todas as conversas exportadas do MESMO
  celular/conta, então só precisa digitar uma vez pro lote inteiro) e
  sobe 1+ arquivos `.zip` de uma vez (`processarLoteConversasWpp()`).
  **Sem seletor de filial de propósito** — pedido explícito do usuário:
  "o ideal seria não separar a importação por filial. Eu queria importar
  todas as conversas de uma vez, e depois procurar os leads em cada
  filial pra fazer a atribuição correta" (ver "Bug real" mais abaixo,
  achado exatamente por causa da versão com filial obrigatória).
- **Casamento por conversa contra a BASE INTEIRA (todas as filiais de uma
  vez), em ordem de confiança** (pedido explícito do usuário — telefone
  > nome exato > manual):
  1. **Telefone**: se o rótulo do OUTRO remetente (não o "seu nome")
     "parece um telefone" (`pareceTelefone()` — 10 a 13 dígitos depois de
     tirar tudo que não é número; é assim que o WhatsApp mostra quando o
     contato NÃO estava salvo no celular de quem exportou, ex: "+55 62
     99999-8888"), normaliza pro formato brasileiro
     (`normalizarDigitosTelefoneBr()` — tira o "55" do DDI se sobrar
     DDD+8/9 dígitos depois) e casa por
     `normalizarTelefoneParaChave()` (mesma função já usada em
     `js/importador.js`/Leads a Tratar) contra TODOS os leads
     (`carregarTodosLeadsParaMatchLoteConversas()`, paginado 1000 em
     1000, sem filtro de filial) — só resolve se achar exatamente 1
     candidato em QUALQUER filial (2 leads com o mesmo telefone em
     filiais diferentes = ambíguo, cai pra triagem).
  2. **Nome exato**: se não parecer telefone (contato estava salvo, o
     rótulo é um nome), casa por `normalizarNomeImport()` — só resolve
     com exatamente 1 candidato em toda a base (homônimo, mesmo de
     filiais diferentes, = ambíguo demais, não arrisca).
  3. **Manual**: sem match (ou ambíguo) — grava mesmo assim, com
     `pessoaIdentificador = null` e `filial = null`, mas SEM SE PERDER
     (ver schema abaixo) — é aqui que entra "procurar o lead em cada
     filial", na tela de triagem.
  - **Direção das mensagens também depende de bater "seu nome"**: se a
    conversa tiver os 2 remetentes e nenhum bater com o nome informado
    (nem um jeito nem outro — checagem nas 2 direções, `includes()` cruzado),
    o arquivo é IGNORADO por completo (contado em "sem atendente
    identificado" no relatório final) — sem isso, arriscaria gravar a
    direção errada (quem mandou o quê) mesmo num arquivo que casaria bem
    com um lead.
- **Schema** (`migracao_whatsapp_importacao_lote.sql`): `telefone_whatsapp`
  deixou de ser `NOT NULL` (uma conversa sem lead E sem telefone
  detectável — contato salvo por nome — não tem telefone nenhum pra
  gravar); `nome_bruto_importado` (texto, só preenchido em conversas SEM
  lead) guarda o rótulo original do remetente, pra a pessoa reconhecer de
  quem é na tela de triagem; `lote_importacao_id` (uuid, gerado no
  navegador por ARQUIVO — `crypto.randomUUID()`) identifica todas as
  linhas de UM `.zip` — evita juntar por engano 2 conversas de pessoas
  DIFERENTES que coincidentemente exportaram com o mesmo nome salvo
  (ex: 2 "Maria" diferentes, cada uma seu próprio lote).
- **Edge Function `whatsapp-importar-conversa` ganhou um 2º modo**: sem
  `pessoaIdentificador`, aceita `nomeBruto`/`telefoneDetectado`/
  `loteImportacaoId` — grava do mesmo jeito (`importado_manualmente =
  true`), só que com `pessoaIdentificador = null` e `filial = null` (não
  tem lead pra derivar, e não pede mais pra escolher uma de antemão).
- **Tela de triagem: "Leads a Tratar" &gt; "Conversas Importadas"** — SEM
  filtro de filial (`carregarConversasImportadasATratar()`, mostra
  TODAS as pendentes, de qualquer unidade, já que o casamento também não
  é mais por filial). NÃO misturada com "não identificados" do WhatsApp
  Unificado (que é sobre mensagem RECEBIDA de verdade pela API sem bater
  telefone; a query de "não identificados" em `js/whatsapp.js` exclui
  explicitamente `nome_bruto_importado is not null`, pra não duplicar/
  confundir os 2 conceitos). Lista cada LOTE (1 `.zip` = 1 card, agrupado
  por `lote_importacao_id`) com o nome/telefone bruto exportado e a
  última mensagem; botão "Vincular" abre uma busca por nome/telefone
  TAMBÉM sem filtro de filial (mostra a filial de cada resultado, pra
  diferenciar homônimos de unidades diferentes) e, ao escolher um lead,
  faz 1 `UPDATE` em todas as linhas daquele lote de uma vez
  (`.eq('lote_importacao_id', ...)`) — grava `pessoaIdentificador` E
  `filial` (a do lead escolhido; até então estava `null`, senão o selo
  de filial da conversa ficaria em branco pra sempre na aba WhatsApp).
  **Sem Edge Function nova pra vincular** — reaproveita a MESMA policy de
  UPDATE que já existia pra "vincular conversa não identificada"
  (`migracao_whatsapp.sql`: só libera linhas que AINDA estão com
  `pessoaIdentificador is null`).
- **Bug real, achado pelo usuário na primeira versão (com filial
  obrigatória)**: importou 1 conversa que foi pra triagem, mas na tela
  "Conversas Importadas" não aparecia nada. Causa: a 1ª versão pedia pra
  escolher a FILIAL no modal de upload (pra restringir o casamento a ela)
  — a conversa foi salva com essa filial, mas a tela de triagem filtrava
  pela filial SELECIONADA NO TOPBAR no momento em que a pessoa checou a
  lista, que era outra. A conversa existia no banco, só nunca aparecia
  pra quem olhava com outra filial selecionada. Resolvido removendo o
  conceito de "filial do lote" inteiramente (ver bullets acima) — não só
  corrige o sintoma, é a mudança de design que o usuário pediu direto.
- **Testado ao vivo, ponta a ponta, 2 vezes** (filiais/leads descartáveis,
  `.zip` de teste gerados com `Compress-Archive`): 1ª rodada (mesma
  filial) — 1 conversa casou por telefone, 1 por nome exato, 1 foi pra
  triagem, vínculo manual funcionou. 2ª rodada (DEPOIS da mudança pra
  cross-filial) — 2 leads em 2 filiais DIFERENTES casaram certo (1 por
  telefone, 1 por nome) sem escolher filial nenhuma antes, confirmando
  que o casamento cross-filial funciona e grava a filial certa em cada
  caso; e confirmado que a conversa órfã ("Gisele Múcia", presa numa
  filial que não era a selecionada no topbar) passou a aparecer na tela
  de triagem independente da filial atual, depois do fix. Upload de
  `.zip` único na gaveta de 1 lead também confirmado (extrai o texto e já
  processa, mesmo fluxo de sempre a partir daí).
- **Não construído nesta rodada**: "Descartar"/ignorar um lote sem
  vincular (hoje só dá pra vincular; pra descartar de vez seria preciso
  uma Edge Function nova, já que a policy de UPDATE pública não cobre
  DELETE) — fica como extensão natural se aparecer volume de conversas
  que realmente não são de ninguém no CRM.

## Publicação/Deploy — CRM público (Vercel) + portão de acesso

O CRM sempre rodou só localmente (Live Server, `127.0.0.1:5500`) — passou
a ter uma publicação pública (Vercel, escolha do usuário — Netlify também
serviria, é só HTML/CSS/JS estático, sem build) porque o scraper (marco 3
acima, opção b) precisa conseguir abrir o CRM de fora da rede local.

- **`js/acesso.js`** — login NOMINAL por conta (nome + senha), ver seção
  "Contas de Usuário e Login Nominal" — substituiu o portão de senha
  única original desta seção (histórico: era uma senha só, compartilhada
  pelo time inteiro, sem usuários individuais). Necessário porque, sem
  ele, publicar o CRM numa URL pública deixaria qualquer pessoa com o
  link ver/editar todos os leads (o app não tem autenticação de verdade —
  a chave publishable do Supabase já garante acesso total a quem tiver o
  HTML, publicado ou não, com ou sem login). **Não é proteção contra um
  atacante determinado** — é só pra impedir acesso casual e dar
  identidade a cada atendente.
- Repositório Git local iniciado nesta sessão (antes não existia nenhum)
  — necessário tanto pra publicar via Vercel quanto pro GitHub Actions do
  scraper rodar.

## WhatsApp — últimos itens de paridade com o app real (2026-09-30)

Pedido do usuário: "implemente tudo que falta, e seja possível implementar
agora, incluindo o plano maior" — depois de confirmar que **as 5 frentes
do plano maior da reunião com a Ediliene já estavam TODAS implementadas**
em rodadas anteriores desta mesma sessão (convite em massa por segmento/
tag — `iniciarConviteApiEmMassa()`/`leads_por_tag_filial()`; classificação
de resposta de convite por IA — `classificar-resposta-convite`; timer de
24h — `htmlTimerJanelaWpp()`; tags no card de duplicado — "Leads a
Tratar"; inscrição assistida no Ulisses Etapa 1 —
`abrir-inscricao-assistida.js`), o trabalho novo desta rodada focou nos 5
itens que realmente faltavam da lista "falta implementar" (comparativo
WhatsApp real vs. CRM). 2 continuam de fora, por impossibilidade real da
API (não código): **lista de transmissão nativa** (Cloud API não tem
conceito de broadcast list) e **grupos/chamadas/Status/foto de perfil/
"digitando.../presença** (já documentado antes, reconfirmado).

- **Gravar áudio no navegador** (`alternarGravacaoAudioWpp()`,
  `js/whatsapp.js`, dentro de `criarChatController()` — cobre WhatsApp
  Unificado e gaveta do lead de uma vez): botão de microfone no compose
  bar, ao lado do de enviar. Clique começa a gravar (`MediaRecorder`,
  `getUserMedia({audio:true})`), o próprio botão vira "⏹ 0:0N" enquanto
  grava; clicar de novo para e entra no MESMO fluxo de anexo já existente
  (`selecionarAnexo(file, 'audio')` → preview com `<audio controls>` →
  `enviarComAnexo()`, que já sabia mandar `tipo:'audio'` pro
  `whatsapp-send` desde a feature de encaminhar áudio recebido — nenhuma
  mudança de backend precisou existir). Trocar de conversa no meio de
  uma gravação DESCARTA ela (`pararGravacaoSeAtiva(true)`, chamada em
  `abrir()`/`fechar()`) — nunca manda áudio de uma conversa errada.
  **Limitação real, não escondida**: o formato gravado depende do que o
  NAVEGADOR sabe gravar via `MediaRecorder.isTypeSupported()` — tenta, em
  ordem, `audio/mp4` → `audio/ogg;codecs=opus` → `audio/webm;codecs=opus`
  → `audio/webm` (o que a Graph API mais aceita de verdade primeiro). Se
  o navegador só souber `webm` (comum em Chrome/Edge), a Meta pode não
  tocar como voice note de verdade no celular do lead — **não testado
  contra a Graph API real nesta sessão** (só a gravação/preview no
  navegador foi validada por leitura de código; enviar de propósito
  dependeria de microfone real disponível neste ambiente de execução).
- **"Apagar" mensagem enviada — na real, só dá pra OCULTAR** (pedido do
  usuário, item "editar/apagar mensagem enviada"): confirmado que a Meta
  Cloud API **não tem nenhum endpoint pra editar ou apagar uma mensagem
  já entregue** pelo número de negócio — isso é um recurso do app
  PESSOAL do WhatsApp, nunca exposto pela Business Platform. Implementar
  uma "edição" falsa seria enganoso (o CRM mostraria um texto diferente
  do que o lead recebeu de verdade). O que foi construído, honesto: botão
  de lixeira (`htmlBotaoOcultarWpp()`, só em mensagens de SAÍDA, hover do
  balão) que OCULTA a mensagem só na nossa tela
  (`mensagens_whatsapp.oculta_em`, `migracao_whatsapp_pin_arquivar_ocultar.sql`)
  — o `confirm()` antes de ocultar já avisa isso explicitamente. O lead
  continua vendo a mensagem normalmente no celular dele; é só limpeza da
  NOSSA visualização (ex: some um envio de teste feito por engano).
  Precisou de uma policy de UPDATE nova em `mensagens_whatsapp` (a única
  que já existia só liberava linha com `pessoaIdentificador` nulo, pra
  vincular conversa não identificada) — mesmo modelo de acesso público já
  usado no resto do projeto.
- **Pin/fixar e arquivar conversa** (`alternarFixarConversaWpp()`/
  `alternarArquivarConversaWpp()`, `js/whatsapp.js`; colunas
  `wpp_fixado`/`wpp_arquivado` em `leads_inscricoes`,
  `migracao_whatsapp_pin_arquivar_ocultar.sql` — cada lead tem no máximo
  1 conversa de WhatsApp, então o estado vive direto no lead, mesmo
  padrão de qualquer outro campo simples dele; herdou a RLS pública já
  existente na tabela, sem policy nova). Ícones de alfinete/caixa no
  hover de cada linha da lista de contatos (sempre visíveis quando já
  ativos). Fixada sempre sube pro TOPO da lista, **independente do modo
  de ordenação escolhido** (`#wppOrdenarSelect`) — feito com uma 2ª
  passada de `.sort()` só pela flag `wpp_fixado` depois do sort principal
  (`Array.prototype.sort` é estável no spec ECMAScript, então só reagrupa
  em 2 blocos preservando a ordem interna de cada um). Arquivada some da
  lista principal por padrão — checkbox novo "Ver arquivadas"
  (`index.html`) revela de volta.
- **Busca com destaque + navegação entre resultados** (pedido do
  usuário: "igual no whatsapp real" — a versão anterior, de 2026-09-29,
  só filtrava/escondia quem não batia). Reescrito: a busca dentro da
  conversa aberta (lupa no cabeçalho) agora **nunca esconde o resto da
  conversa** — destaca cada ocorrência com `<mark>`
  (`destacarTermoBuscaWpp()`, aplicado sobre o texto JÁ ESCAPADO, então só
  funciona pra termos sem caracteres HTML especiais — suficiente pra
  busca de texto comum) e mostra "posição/total" na barra, com botões
  ⌃/⌄ (ou Enter/Shift+Enter no campo) pra navegar — o resultado atual
  ganha um contorno extra (`.msg-busca-ativa`) e a tela rola até ele
  (`scrollIntoView`). Contador reseta pro resultado mais recente
  (`buscaIndiceAtual = null` → resolvido pro último match) toda vez que o
  termo muda.
- **Emoji picker pra digitar** (`abrirEmojiPickerDigitarWpp()`,
  `js/whatsapp.js`) — o ícone de carinha já existia no compose bar desde
  a feature de anexos, mas não abria nada. Agora abre um picker flutuante
  (~30 emojis comuns, grade) que insere no CURSOR do `<textarea>` (não só
  no fim do texto) — diferente do picker de REAÇÃO (que já existia,
  callback fixo por mensagem), este é genérico, reaproveitado pelos dois
  chats (unificado e gaveta) por estar dentro de `renderizarAreaInput()`.
- **Bug real evitado (achado revisando, não relatado pelo usuário)**: o
  botão de ocultar (acima) é desenhado por `htmlMensagemWpp()`, que
  também é usada pelo mini-chat de "não identificado"
  (`carregarERenderizarChatNaoIdentificado()`, compartilha o MESMO
  container DOM `wppMessages` com `chatWpp`) — sem guarda, clicar
  "ocultar" ali chamaria `renderizarMensagens()` do controller `chatWpp`
  (com `leadId` nulo nesse momento), que apagaria a visualização do
  mini-chat sozinho (mostrando "Nenhuma mensagem ainda" por engano).
  Corrigido com a MESMA guarda já usada no botão de reagir
  (`if (btnOcultar && leadId)`) — ocultar simplesmente não funciona
  enquanto a conversa ainda não foi vinculada a um lead (vincular
  primeiro, depois ocultar normalmente).
- **Não testado ao vivo pela UI** nesta sessão (sem Playwright disponível
  neste ambiente, mesma limitação de sempre) — migração já rodada e
  confirmada contra produção (`wpp_fixado`/`wpp_arquivado`/`oculta_em` +
  a policy nova, todos verificados por `information_schema`/`pg_policies`
  direto); a lógica em si foi revisada por leitura de código com cuidado
  extra nos pontos de estado compartilhado (ver bug evitado acima), mas
  clicar de verdade (gravar áudio, fixar/arquivar, navegar resultados de
  busca, inserir emoji) fica pra confirmar na próxima sessão de uso real.

## Segunda rodada de incrementos (2026-09-30) — "o que falta" + ideias novas

Depois de fechar os últimos itens de paridade com o WhatsApp real, o
usuário pediu uma lista nova ("o que falta implementar, o que podemos
incrementar que ainda não pensamos") e respondeu item por item. Esta
seção documenta o que foi CONSTRUÍDO nesta rodada; itens que o usuário só
pediu pra EXPLICAR (não construir) estão no histórico da conversa, não
repetidos aqui.

### "Último Contato" (automático + manual)

Pedido do usuário: "precisamos criar uma interação que permita marcar:
último contato... de forma automática pelo crm, e organizar os novos
contatos com base, entre outras coisas, nisso".

- **Coluna `leads_inscricoes.ultimo_contato_em`**
  (`migracao_whatsapp_snooze_fila_ultimo_contato.sql`).
- **Automático**: `whatsapp-send` (Edge Function) carimba sozinho, em
  TODO envio real bem-sucedido (texto, template, imagem, documento,
  áudio) — é o ÚNICO ponto por onde todo envio passa (individual, convite
  em massa, aniversário, etc.), então nenhum chamador precisou mudar.
  Testado ao vivo contra o lead de teste (904000019): envio real
  confirmado, coluna carimbada, depois revertida (não era contato real).
- **Manual**: botão "Registrar Contato" (gaveta do lead,
  `registrarContatoManual()`, `js/app.js`) — cobre contato por FORA do
  WhatsApp (ligação, presencial). Grava em `log_atividade`
  (`acao='contato_manual_registrado'`).
- **"Organizar novos contatos com base nisso"**: `leads_agenda_geral_prioritarios()`
  (RPC, `migracao_rpc_leads_agenda_geral.sql`, recriada com
  `drop function` primeiro — mudou o tipo de retorno) agora também devolve
  `ultimo_contato_em`; a lista "50 Leads Prioritários" (Agenda do Dia,
  `js/visao-geral.js`) filtra fora quem já foi contatado HOJE (não
  insiste 2x no mesmo dia) e, em empate nos critérios de sempre, prioriza
  quem está há MAIS tempo sem contato (ou nunca contatado) — badge
  "Contatado há Nd"/"Nunca contatado" em cada item da lista.

### Menções (@usuário) no Resumo/Anotações + IA complementando

Pedido do usuário: "crie uma forma de mencionar outros perfis de usuários
lá no resumo (tire a informação que o resumo é feito com ia, mas permita
que a ia complemente o resumo, ou sugira a criação de um resumo)".

- **Renomeado** "Resumo da Conversa (IA)" → **"Resumo / Anotações"**
  (`index.html`, gaveta do lead) — é sempre texto digitado pela equipe; a
  IA só ajuda opcionalmente (botão próprio, nunca automático).
- **Bug de segurança evitado, achado revisando (não relatado pelo
  usuário)**: `renderAISummary()` jogava `lead.resumo_ia` direto no
  `innerHTML` **sem `escapeHTML()`** — um texto com `<script>`/tags HTML
  executaria no navegador de quem abrisse o lead depois. Corrigido
  (`renderizarResumoComMencoes()`, `js/app.js`) — escapa sempre, e só
  DEPOIS disso destaca `@Nome` (nunca o inverso, senão a menção
  escaparia a própria marcação HTML de destaque).
- **`nomesUsuariosAtivos`** (`js/acesso.js`) — lista global de nomes
  ativos, carregada de carona dentro de `popularSeletorNomesAcesso()`
  (já fazia essa mesma busca pro seletor de login, só não guardava o
  resultado em lugar nenhum) — usada pra reconhecer `@Nome` válido.
- **`mencoes_resumo`** (`migracao_mencoes_resumo.sql`) — grava 1 linha
  por menção NOVA (`registrarMencoesResumo()`, comparando o texto ANTES e
  DEPOIS do salvamento — só quem é novo no texto notifica, editar o
  resumo sem tirar/pôr uma menção não renotifica ninguém). Central de
  Notificações ganhou o **gatilho 10** (`verificarNotificacoesMencoes()`,
  poll de 3 min) — diferente de todos os outros gatilhos (globais/por
  navegador), este é **por PESSOA** (filtrado pelo usuário logado,
  `lida` gravada no banco, não localStorage — faz sentido "ler" de
  qualquer navegador que a pessoa usar).
- **"Sugerir com IA"** (`sugerirComplementoResumoIA()`/nova Edge Function
  `ia-sugerir-resumo`) — junta o resumo atual + últimas 10 mensagens de
  WhatsApp do lead, pede um COMPLEMENTO (ou um resumo do zero, se ainda
  vazio) à Claude Haiku. **Nunca salva sozinho** — mostra a sugestão com
  "Usar esta sugestão"/"Descartar". Testado ao vivo (`curl`): a
  detecção/montagem de prompt funciona perfeitamente, mas a ESCRITA
  falha com a mesma limitação de crédito da Anthropic já documentada
  (`"Your credit balance is too low..."`) — nada a corrigir no código.

### Resumo do Trabalho na tela

Pedido do usuário: "ok, siga" (expor como tela/relatório, além do
WhatsApp pro chefe). `resumo-semanal-chefe` ganhou `modoPreview: true` +
`dias` configurável — devolve os dados já computados (mesma busca em
`log_atividade`) SEM mandar nada pro WhatsApp. Nova seção na aba
Relatórios ("Resumo do Trabalho", `js/relatorios-whatsapp.js`,
`carregarResumoTrabalho()`) com seletor de período (7/15/30 dias) — lista
clicável de leads tocados, mesma UX de outras listas do app
(`abrirResultadoBuscaGlobal()`).

### Pin/fixar, arquivar, silenciar, fila de atendentes, respostas rápidas, exportar (WhatsApp Unificado)

- **Auto-arquivar conversas inativas** (`arquivar_conversas_whatsapp_inativas()`,
  `migracao_auto_arquivar_conversas_whatsapp.sql`, cron diário 08:30
  Brasília) — 30+ dias sem mensagem, nunca toca em conversa FIXADA.
- **"Silenciar" conversa** (`abrirMenuSilenciarWpp()`, coluna
  `wpp_silenciado_ate`) — menu com 1h/8h/24h/7 dias; enquanto no futuro,
  o sino/popup de "mensagem recebida" não dispara pra esse lead
  (checado dentro de `iniciarNotificacoesWhatsAppGlobais()`,
  `js/notificacoes.js`), mas o indicador de "não lida" continua normal —
  mesmo comportamento do WhatsApp real (silenciado ≠ lido).
- **Fila de distribuição automática** (`wpp_atendente_responsavel`) —
  `whatsapp-webhook` atribui sozinho, só na 1ª mensagem de um lead
  NOVO (nunca reatribui uma conversa em andamento), escolhendo entre os
  usuários com módulo `tab-whatsapp` ativo quem tem MENOS conversas
  abertas atribuídas (menor carga, não round-robin cego). Badge "👤
  Fulano" em cada card da lista + checkbox "Só minhas conversas"
  (filtro client-side por `obterNomeAtendente()`). **Não testado ao
  vivo** (exigiria forjar uma assinatura HMAC de webhook real da Meta,
  que só o servidor consegue calcular) — revisão cuidadosa de código no
  lugar, mesmo risco residual baixo já aceito outras vezes no projeto
  pro mesmo motivo.
- **Respostas rápidas prontas** (`respostas_rapidas_whatsapp`, botão "⚡"
  no compose bar) — insere no CURSOR do texto (não só no fim, reaproveita
  `inserirTextoNoInputWpp()`, compartilhada com o emoji picker).
  Placeholders `{nome}`/`{atendente}`/`{filial}`/`{endereco}`/
  `{valor_mensalidade}` resolvidos na hora (nunca gravados resolvidos no
  catálogo). Tela "Gerenciar Respostas" embutida no próprio picker
  (reaproveita o overlay flutuante já usado por "Encaminhar mensagem",
  sem markup novo em `index.html`).
- **Exportar conversa (.txt)** (`exportarConversaWppTxt()`) — busca o
  HISTÓRICO INTEIRO (não só as 200 mensagens já carregadas na tela),
  gera um arquivo no MESMO formato que "Importar Conversa" já lê de
  volta (`DD/MM/AAAA HH:MM - Remetente: texto`) — simetria proposital.
  Mensagens ocultadas (`ocultarMensagemWpp()`) nunca entram no export.

### Relatórios de WhatsApp — SLA, desempenho por atendente, volume

3 RPCs novas (`migracao_rpc_relatorios_whatsapp.sql`), só leitura, nova
seção na aba Relatórios (`js/relatorios-whatsapp.js`,
`carregarRelatoriosWhatsApp()`):
- **SLA de 1ª resposta** — diferente do timer de 24h (janela da Meta) e
  do SLA de coluna fria (tempo sem mover): quanto tempo até a PRIMEIRA
  resposta nossa depois de uma mensagem recebida. Window function
  (`lag()`) pra achar o início de cada "período aguardando resposta".
- **Bug real achado testando, corrigido antes de qualquer uso real**:
  a 1ª versão de `desempenho_atendentes_whatsapp()` fazia
  `JOIN ... ON t.atendente_nome = e.atendente_nome` — como
  `atendente_nome` não é único, isso multiplicou linhas (produto
  cartesiano): "Henrique" apareceu com **1,3 MILHÃO** de "mensagens
  enviadas" (o real era 1149). Corrigido calculando o tempo de resposta
  DENTRO da mesma CTE por linha de mensagem (nunca precisando de JOIN
  nenhum depois) — testado de novo, confirmado 1149.
- **Volume por dia** — enviadas/recebidas/falhas, gráfico de barras
  simples (CSS puro, sem lib de gráfico) últimos 30 dias.

### Inscrição Assistida no Ulisses — Etapa 2 PARCIAL

O usuário mandou print real (DevTools) da tela "Selecione a unidade de
interesse" do formulário público de inscrição — confirmou que cada rádio
usa `<input type="radio" name="selecao" id="{filialId}">`, onde
`{filialId}` é o MESMO id interno do Ulisses já mapeado em
`scraper/importar-ulisses-api.js` (ex: `id="14"` = Ap. de Goiânia -
Garavelo). Como isso é só NAVEGAÇÃO + CLIQUE num rádio (nunca digitar em
campo nenhum), deu pra automatizar com segurança, sem violar o princípio
de "nunca escrever seletor no chute" — `scraper/abrir-inscricao-assistida.js`
agora recebe a filial do lead (`&filial=` na URL do protocolo
`abririnscricao://`, preenchida por `atualizarLinkInscreverEvento()`,
`js/eventos.js`) e marca a unidade certa sozinho, quando reconhecida.
**Preenchimento dos campos PESSOAIS (nome/telefone/e-mail) continua
travado** — ainda não vimos o HTML real desse formulário especificamente
(só da tela de unidade), então o SDR continua colando esses 3 campos na
mão (já tem o clipboard pronto, `copiarDadosInscreverEvento()`). Nunca
clica em "Inscrever" sozinho, nunca vai clicar.

### Testado ao vivo nesta rodada (resumo)

Confirmado contra produção via `curl` (chave publishable, como o
navegador chamaria): as 3 RPCs de relatório, `leads_por_tag_filial`
(sanity check), `respostas_rapidas_whatsapp` (seed + leitura pública),
`mencoes_resumo` (insert/select, depois limpo), `ia-sugerir-resumo`
(chegou até a chamada real da Anthropic, barrada só pelo crédito),
`whatsapp-send` (envio real ao lead de teste 904000019, `ultimo_contato_em`
carimbado e depois revertido). **Não testado clicando pela UI** (sem
Playwright neste ambiente) — silenciar/arquivar/pin, respostas rápidas,
export .txt, "Sugerir com IA" e a fila de atendentes (esta última,
estruturalmente impossível de testar sem um webhook real assinado)
ficam pra confirmar na próxima sessão de uso real.

## Bug real: IA calculando "próxima quinta" errado + confundindo filial com a lista completa (2026-10-01)

Relatado pelo usuário com um caso real: o atendente tinha prometido "uma
outra oportunidade na próxima quinta" (sem data exata) numa mensagem
anterior; o lead respondeu "Sim" HOJE, uma quinta-feira (01/10) — e a
sugestão de `sugerir-resposta-whatsapp` disse "nos vemos na próxima
quinta (05/10)", só que 05/10 é uma SEGUNDA-feira, não quinta. **As
datas da tabela `eventos` estavam certas o tempo todo** (confirmado por
SELECT direto) — o erro era só a IA CALCULANDO de cabeça que dia é "a
próxima quinta" a partir de "hoje é 2026-10-01", tarefa de aritmética de
calendário em que LLMs erram com frequência.

- **Corrigido com o mesmo princípio de sempre** (nunca deixar a IA
  calcular/inventar um fato que o código já pode entregar pronto): nova
  `supabase/functions/_shared/calendario.ts`,
  `montarTabelaDiasSemana(hojeISO, dias=14)` — monta os próximos 14 dias
  JÁ CALCULADOS (dia da semana + data), com uma marca especial na linha
  de +7 dias ("é isso que 'a próxima X' significa a partir de hoje" —
  sempre o mesmo dia da semana de hoje, já que 7 dias se repetem). O
  prompt das duas functions de IA (`sugerir-resposta-whatsapp`,
  `classificar-resposta-convite`) passou a receber essa tabela no lugar
  de só "Hoje é AAAA-MM-DD", com instrução explícita pra NUNCA calcular
  dia da semana de cabeça — só consultar a tabela.
- **2º bug real, achado testando ao vivo o fix acima** (não relatado
  pelo usuário, achado na validação): com a tabela de calendário
  funcionando (data certa confirmada 2x), a IA respondeu com os dados da
  **ÚLTIMA filial da lista** ("Goiânia II") pra um lead de "Barra do
  Garças/MT" — mesmo o lead nunca tendo mencionado NENHUMA outra unidade
  na conversa. Causa: desde o fix anterior do mesmo dia (filial errada —
  ver `_shared/filiaisInfo.ts`), a lista de TODAS as filiais ativas
  passou a entrar no prompt **sempre**, mesmo quando o lead nunca
  menciona outra unidade — puro ruído na maioria das conversas, e esse
  ruído criava viés de recência (o último item da lista "vence").
  **Corrigido**: `buscarListaFiliais(filialDoLead, textoParaChecarOutraMencao?)`
  ganhou um 2º parâmetro — quando informado, a função só MONTA (e só
  inclui no prompt) a lista completa se detectar, por substring (núcleo
  do nome da filial, sem "Goiânia"/"MT"/pontuação, com variante numeral
  romano↔arábico pra cobrir "Goiânia II"/"Goiânia 2"), a menção de
  alguma filial que NÃO é a do lead dentro do texto da conversa recente.
  Sem menção real a outra unidade, a lista nem entra no prompt — elimina
  a fonte de confusão pro caso comum (a grande maioria das conversas).
  Os 2 chamadores (`montarContextoCRM()`/`buscarDadosEvento()`) passam o
  histórico+mensagem atual como texto de checagem.
- **Testado ao vivo, ponta a ponta, contra produção** (lead de teste
  904000019, histórico limpo pra não contaminar com menções de testes
  anteriores da sessão): reproduzido o cenário exato (atendente promete
  "próxima quinta" sem data, lead responde "Sim" hoje, uma quinta) — a
  sugestão gerada disse corretamente "08/10" (quinta-feira real seguinte)
  **e** "aqui na Nova Acrópole de Barra do Garças" (filial certa do
  lead, sem a lista completa aparecer no prompt). Dados de teste
  apagados depois (mensagens + sugestões geradas).
- **Lead real afetado, não corrigido retroativamente**: a mensagem com a
  data errada (05/10) JÁ FOI ENVIADA de verdade pro lead real "BRASILIA
  BORGE" (`pessoaIdentificador=456575`, Goiânia - Setor Oeste) antes
  deste fix — como é uma mensagem de WhatsApp já entregue, não dá pra
  "desenviar"; precisa de um follow-up manual do time corrigindo a data
  certa (08/10) com essa pessoa.

## Custo da Anthropic API — visibilidade real + cache de prompt (2026-10-01)

Pergunta do usuário: "o custo da api está mais alto que o sistema de
corretores. pq será? o que estamos usando que está gastando tanta api do
claude?". Investigação (não chute): das 6 Edge Functions que chamam a
Anthropic (`classificar-temas`, `ia-diagnostico-saude`,
`ia-recomendar-contatos`, `ia-sugerir-resumo`, e as 2 que rodam sozinhas
a cada 15 min — `classificar-resposta-convite`/`sugerir-resposta-whatsapp`),
só estas 2 últimas rodam em CRON contínuo, e **nenhuma das 6 usava cache
de prompt** — pagando inteiro, em toda chamada, um bloco de instrução
fixo que é quase idêntico de um candidato pro outro na mesma rodada.

- **`supabase/functions/_shared/anthropic.ts`, NOVO**: `chamarClaude()`
  centraliza a chamada (nunca mais duplicar fetch+parse em cada
  function) — recebe o prompt JÁ DIVIDIDO em `blocoCacheavel` (regras
  fixas + calendário do dia + exemplos, igual pra qualquer candidato da
  MESMA rodada) e `blocoDinamico` (dados do lead/evento específico,
  histórico, última mensagem) — só o 1º ganha `cache_control: {type:
  "ephemeral"}`. Também grava (best-effort) 1 linha em `ia_uso_tokens`
  (`migracao_ia_uso_tokens.sql`, RLS pública, log puro) por chamada, com
  os números EXATOS que a Anthropic devolve
  (`input_tokens`/`output_tokens`/`cache_creation_input_tokens`/
  `cache_read_input_tokens`) — substitui estimar custo por tamanho de
  texto por uma fonte de verdade consultável.
- **`sugerir-resposta-whatsapp`/`classificar-resposta-convite`**:
  prompts reescritos em `montarPromptCacheavel()`/`montarPromptDinamico()`
  — o cacheável vem SEMPRE antes do dinâmico na mensagem final (a
  Anthropic cacheia um PREFIXO; se o dinâmico viesse primeiro, o prefixo
  nunca se repetiria entre leads diferentes). Referências a "acima"/
  "abaixo" nas regras foram reescritas pra não depender da ordem antiga.
- **Bug real, só descoberto medindo contra a API de verdade (não por
  erro nenhum retornado)**: com o cache implementado, as 2 primeiras
  rodadas de teste ao vivo sempre voltavam
  `cache_creation_input_tokens: 0` **e** `cache_read_input_tokens: 0` —
  nos dois lados (criação E leitura), sem nenhum aviso/erro da API
  (`resp.ok` sempre `200`, sem campo "ignorado" no corpo). Adicionar o
  header `anthropic-beta: prompt-caching-2024-07-31` (1ª hipótese) não
  resolveu. Causa real, confirmada por busca na documentação: a
  Anthropic exige um **MÍNIMO de tokens pro bloco ser elegível a cache**,
  e esse mínimo **varia por modelo** — 1.024 tokens pra Opus/Sonnet,
  2.048 pras versões antigas de Haiku (3/3.5), mas **4.096 tokens pro
  Haiku 4.5** (`claude-haiku-4-5-20251001`, o modelo usado aqui) — bem
  mais alto que os ~2.800-3.700 tokens que o bloco de regras+exemplos
  somava. Abaixo do mínimo, o `cache_control` é **silenciosamente
  ignorado**, sem erro nenhum — só dá pra perceber medindo o `usage` da
  resposta de verdade.
  - **Medido ao vivo** (não estimado): um endpoint de diagnóstico
    temporário (removido depois de confirmar o fix) mandava só o bloco
    cacheável puro pra Anthropic e lia `usage.input_tokens` da resposta
    — forma exata de saber o tamanho real em tokens sem depender de
    estimativa por caractere.
  - **Corrigido** aumentando o bloco cacheável com conteúdo REAL (não
    enchimento) — `EXEMPLOS_ADICIONAIS_ESTILO`/
    `EXEMPLOS_ADICIONAIS_ESTILO_CONVITE` (constantes hardcoded em cada
    function, não dependem da tabela `exemplos_resposta_ia`, que hoje só
    tem ~10 linhas curadas — poucas pra garantir o mínimo sozinha e de
    forma estável): mais pares cenário→bom-padrão-de-resposta cobrindo
    situações reais do dia a dia (pergunta de preço, objeção de tempo,
    ex-aluno hesitante, "é seita?", pedido de descadastro, confirmação de
    presença, etc.) — o MESMO tipo de conteúdo que já existia, só mais
    dele. Resultado medido depois do ajuste: ~4.564-4.764 tokens nos 2
    blocos, com margem sobre o piso de 4.096.
  - **Testado ao vivo, confirmado funcionando**: 1ª chamada após o fix →
    `cache_creation_input_tokens: 4764` (criou o cache); 2ª chamada
    (mesmo bloco) → `cache_read_input_tokens: 4764` (leu do cache, custo
    bem menor). Repetido pras 2 functions. Teste de ponta a ponta pelo
    fluxo REAL (`?debug=1`, não só o endpoint de medição): uma chamada
    de produção leu do cache criado minutos antes por outra invocação
    (`cache_read_input_tokens: 4764`, `input_tokens: 1120` — só o
    bloco dinâmico + overhead), confirmando que o cache também é
    reaproveitado ENTRE invocações da function (não só dentro do mesmo
    loop de candidatos), contanto que caia dentro da janela de 5 min
    padrão da Anthropic.
  - **Risco residual aceito**: a margem sobre o piso de 4.096 depende em
    parte dos ~10 exemplos reais de `exemplos_resposta_ia` (ativo=true)
    — se essa tabela ficar vazia um dia, o bloco cacheável ainda fica
    seguramente acima do piso graças só ao conteúdo hardcoded
    (`EXEMPLOS_ADICIONAIS_ESTILO*`), mas com menos folga. Se o cache
    voltar a mostrar `cache_creation_input_tokens: 0`/
    `cache_read_input_tokens: 0` no futuro, o primeiro passo de
    diagnóstico é sempre medir o tamanho real do bloco cacheável contra
    a API (não estimar por caractere) e comparar com o piso do modelo em
    uso — pode mudar de novo se o modelo (`MODELO`, hoje
    `claude-haiku-4-5-20251001`) for trocado por outro.
- **Dados de teste gerados durante esta investigação já foram limpos**
  (mensagens de WhatsApp de teste, sugestões geradas, linhas de
  `ia_uso_tokens`) — a tabela `ia_uso_tokens` ficou vazia de propósito
  ao final, pronta pra só acumular uso real da próxima rodada de cron em
  diante.

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

## Bug real: filtro de coluna só considerava os leads JÁ VISÍVEIS (2026-10-05)

Pedido do usuário: "quando coloco um filtro no crm, ele não considere
todos os leads daquela coluna, mas, somente os visíveis. Quero que
considere todos". `aplicarFiltroVisualColuna()` sempre rodou em cima dos
`.lead-card` já RENDERIZADOS no DOM (show/hide por atributo `data-*`) —
pras colunas SECUNDÁRIAS isso já era o conteúdo completo
(`carregarColunasSecundariasSemPaginacao()` já carrega todas por inteiro,
ver bullet "Matriculados recém-criado podia ficar invisível" acima), mas
a **1ª coluna do funil** (a única que continua paginada de verdade,
geralmente "Frios") só tinha a JANELA já paginada carregada — um filtro
de tag/evento/data/telefone/e-mail/resumo nessa coluna nunca enxergava
quem ainda não tinha sido paginado pro navegador. Mesma classe dos bugs
já documentados de Matriculados/Ativos-Inativos, só que no filtro em vez
da listagem simples.

- **`colunasFiltroCompletasCarregadas`** (`Set`, `js/app.js`) — marca
  quais colunas já têm 100% do conteúdo em `leadsAtuais`. Toda coluna
  SECUNDÁRIA já entra sozinha (marcada dentro de
  `carregarColunasSecundariasSemPaginacao()`, que já carregava tudo
  mesmo); resetado a cada troca de filial/reset de `carregarLeads()`.
- **`garantirColunaFiltravelCompleta(key)`**, nova — chamada ANTES de
  qualquer filtro rodar (`toggleFiltroColunaChip()`/
  `toggleFiltroColunaChipExcluir()`/`aplicarFiltroColunaCampos()`, todas
  viraram `async`): se a coluna ainda não está marcada como completa,
  busca TUDO dela no banco (paginado 1000 em 1000, mesmo padrão de
  `carregarColunasSecundariasSemPaginacao()`) antes de filtrar — só
  dispara a busca na 1ª vez que o usuário mexe no filtro daquela coluna
  naquela sessão (lazy, sob demanda — nunca carrega "Frios" inteiro só
  por trocar de filial, só quando alguém realmente for filtrar essa
  coluna especificamente). Trazendo lead novo, chama `renderizarCards()`
  (que já reaplica o filtro de toda coluna no final) pra esses cards
  passarem a existir no DOM antes de poderem ser escondidos/mostrados;
  já estando completa, só reaplica `aplicarFiltroVisualColuna(key)`
  direto, sem round-trip nenhum.

## Reengajamento automático antes da janela de 24h fechar (2026-10-05)

Pedido do usuário: "vamos rodar um bot para as pessoas que estão com
menos de 12h para fechar a janela sem interação nossa... usando IA vamos
ler a conversa toda e interagir estrategicamente" — refinado em seguida:
"mude para uma vez só de reengajamento por janela" e "a ideia é evitar a
nossa demora em responder, e não incomodar o lead". Ou seja: não é pra
ficar insistindo com quem não respondeu — é pra COMPENSAR a demora do
time, preparando com antecedência (lendo a conversa INTEIRA, não só as
últimas mensagens) a melhor resposta possível, pronta assim que alguém
abrir o CRM.

**Decisão confirmada com o usuário antes de codificar** (3 perguntas
diretas): (1) aprovação humana antes de enviar — como TODA function de
IA do projeto; (2) 1 tentativa só por janela (não insiste de novo mais
perto do fim); (3) toggle por filial, ligado por padrão.

**Revertido pelo próprio usuário, ainda no mesmo dia**: "no caso do bot
de reengajamento, eu acredito que precisa ser autônomo. Pq a ideia é que
se estivermos sem acessar o crm dentro da janela de alguém, precisamos
mantê-la aberta" — o item (1) acima foi corretamente apontado como
contraditório com o PRÓPRIO propósito do recurso: se o time está
ausente/atrasado o bastante pra precisar do reforço de 12h, também não
vai estar disponível pra clicar "Enviar" a tempo. **Esta é a PRIMEIRA
exceção deliberada, nesta sessão, ao princípio de sempre do projeto ("IA
nunca age sozinha, só sugere")** — aceita porque o próprio usuário pediu
explicitamente e entendeu o trade-off. Mais uma trava de segurança foi
adicionada no prompt por causa disso: "se a última mensagem for do lead,
mas a CONVERSA COMO UM TODO já soa concluída/encerrada (despedida,
assunto resolvido) — `'sugestao': null`, mesmo sendo tecnicamente 'do
lead'. Reabrir uma conversa que já tinha terminado naturalmente é pior
que deixá-la fechada." A regra MAIS importante do prompt virou "na
dúvida, NÃO ENVIE NADA" — texto explícito, antes de qualquer outra
instrução, dado que agora não há revisão humana no meio do caminho.

- **Mecânica do envio autônomo**: a Edge Function chama `whatsapp-send`
  ela mesma (servidor-a-servidor, `SUPABASE_SERVICE_ROLE_KEY`, mesmo
  padrão de `resumo-semanal-chefe`/`whatsapp-reenviar-falhas`) sempre que
  a IA devolver uma sugestão não-nula — `atendenteNome: "Bot de
  Reengajamento (IA)"` (aparece no balão da mensagem, igual qualquer
  outro atendente, pra nunca disfarçar que foi automático). Sucesso grava
  `status: 'enviada'` + 1 linha em `log_atividade`
  (`acao='reengajamento_automatico_enviado'`); falha no envio (ex: janela
  já fechou nos minutos entre a leitura e o envio) grava `status:
  'pendente'` de novo — vira candidata normal de revisão humana, como
  qualquer sugestão que não foi enviada. **Não reaproveita
  `moverParaAbordagemAposEnvio()`** (que é só frontend/`localStorage`,
  sem equivalente server-side) — limitação aceita, documentada no
  próprio código: o lead não é movido de coluna por este envio
  automático especificamente.
- **Status do deploy**: `npx supabase functions deploy
  reengajar-janela-fechando` tinha sido bloqueado por uma permissão do
  próprio Claude Code (classificador de modo automático marcou o comando
  como "perigoso") — contornado rodando o MESMO comando manualmente pelo
  próprio usuário no terminal dele, com sucesso. **A versão AUTÔNOMA já
  está em produção** desde então — o cron de 15 min (já agendado desde
  antes, `migracao_agendamento_reengajamento_janela.sql`) passa a enviar
  mensagens de verdade, sem revisão humana, assim que achar candidatas
  reais (12-24h de conversa parada, toggle da filial ligado). Ainda não
  confirmado visualmente um envio automático real em produção (o cron
  roda sozinho; a próxima vez que alguém notar uma mensagem com
  `atendente_nome = "Bot de Reengajamento (IA)"` no histórico de um lead,
  ou uma entrada `acao='reengajamento_automatico_enviado'` em
  `log_atividade`, confirma ponta a ponta).

- **Reaproveita 100% a tabela/UI de `sugerir-resposta-whatsapp`**
  (`sugestoes_resposta_wpp`, card de revisão no WhatsApp Unificado) em
  vez de criar uma estrutura paralela — só 2 colunas novas
  (`migracao_reengajamento_janela.sql`): `filiais.ia_reengajamento_janela_habilitado`
  (toggle por filial, separado do toggle de "Sugestão de Resposta" — são
  gatilhos diferentes, uma filial pode querer só um dos dois; o override
  por CONVERSA continua sendo o MESMO campo, `leads_inscricoes.ia_sugestao_resposta`,
  já que semanticamente é a mesma pergunta) e `sugestoes_resposta_wpp.reengajamento_em`
  (marca "já passou pelo reforço de 12h" — garante "uma vez só por
  janela": uma vez marcada, essa MESMA mensagem nunca é reprocessada,
  mesmo que o lead não responda e a conversa continue parada).
- **`mensagens_candidatas_reengajamento_janela(p_limite)`**
  (`migracao_rpc_candidatas_reengajamento_janela.sql`) — candidata = a
  ÚLTIMA mensagem de uma conversa, direção `entrada`, entre 12h e 24h de
  idade (depois de 24h a janela já fechou, não adianta mais),
  `reengajamento_em is null`, e (sem linha nenhuma ainda em
  `sugestoes_resposta_wpp` OU uma linha `status='pendente'` — já
  `enviada`/`descartada` pelo SDR não mexe mais), respeitando o toggle
  filial+conversa.
- **Nova Edge Function `reengajar-janela-fechando`**
  (`supabase/functions/reengajar-janela-fechando/`, cron a cada 15 min,
  `migracao_agendamento_reengajamento_janela.sql`) — pra cada candidata:
  lê a conversa **quase inteira** (`LIMITE_HISTORICO_COMPLETO = 60`
  mensagens, bem mais que as 6 de `sugerir-resposta-whatsapp` — um teto
  generoso, não literalmente ilimitado, com aviso no próprio contexto
  quando a conversa for mais longa que isso) + o mesmo `montarContextoCRM()`
  de grounding (tags/eventos/resumo/filial/convite pendente — copiado da
  function irmã, não compartilhado, já que as duas podem divergir em
  tom/propósito com o tempo). Prompt focado em RETOMAR o fio genuinamente
  (nunca mencionar "janela"/demora/prazo pro lead — ele não sabe que
  existe um relógio do nosso lado), com instrução explícita pra devolver
  `"sugestao": null` quando não houver nada de real valor a acrescentar
  (ex: última mensagem do lead já era só "ok"/agradecimento) — "nunca
  incomodar o lead só pra manter a conversa viva" é uma regra textual do
  prompt. Mesmo contrato de JSON de `sugerir-resposta-whatsapp`
  (sugestão + lembrete_sugerido + tag_sugerida) pra reaproveitar 100% a
  UI já existente sem mudança nenhuma no frontend.
  - **Upsert, não insert sempre**: se já existe uma sugestão `pendente`
    pra essa mensagem (criada antes pelo gatilho de 2h de
    `sugerir-resposta-whatsapp`, ainda não enviada/descartada 12h
    depois), ATUALIZA ela com a versão mais completa (conversa inteira)
    + grava `reengajamento_em`; sem linha nenhuma ainda, cria uma nova já
    com `reengajamento_em` preenchido.
  - **Mesma lição de cache de prompt já documentada acima**: o bloco
    cacheável precisou de um banco de exemplos de retomada (temáticos,
    diferentes dos de "responder pergunta nova" da function irmã) grande
    o bastante pra passar dos 4.096 tokens mínimos do Haiku 4.5 — medido
    ao vivo, ficou em ~4.467 tokens, confirmado `cache_creation_input_tokens`/
    `cache_read_input_tokens` funcionando nas 2 chamadas seguintes.
  - **Testado ao vivo, ponta a ponta, contra produção**: mensagem de
    teste inserida com 13h de idade (lead de teste 904000019) → RPC
    encontrou a candidata certa → `?debug=1` gerou uma sugestão coerente
    usando o contexto real da filial → chamada real gravou a linha com
    `reengajamento_em` preenchido → chamando de novo logo em seguida,
    `processadas: 0` (confirma "uma vez só por janela" funcionando).
    Dados de teste apagados depois.

## Lembrete de follow-up: calendário real em vez de digitar a data (2026-10-05)

Pedido do usuário, com print real do navegador: "libere um calendário
para marcarmos a data. Digitar assim é incômodo" — `abrirLembreteWpp()`
(botão de lembrete/snooze no WhatsApp Unificado, `js/whatsapp.js`) usava
2 `prompt()` encadeados (data digitada à mão no formato AAAA-MM-DD + nota)
— único lugar do app que ainda pedia data por texto pra isso (a gaveta já
usa `<input type="date">` nativo desde sempre, `salvarLembreteLead()`).
Trocado por um popover flutuante (mesmo padrão visual/posicionamento do
menu "Silenciar conversa", `_containerMenuSilenciarWpp()`) com
`<input type="date">` de verdade + campo de nota + botões Salvar/Remover —
`.wpp-lembrete-popover` (`css/style.css`). Mesma função
`salvarLembreteWpp()` de sempre por trás, só a captura dos valores mudou.

## Foco voltava pra caixa de texto, mas um re-render alguns ms depois tirava de novo (2026-10-05)

Pedido do usuário: "ao dar enter para enviar uma mensagem... voltar o
cursor automaticamente para o campo de digitar. Tenho que clicar com o
mouse toda vez". `enviarTexto()` (`js/whatsapp.js`) já chamava
`input.focus()` logo depois do envio — mas o usuário reportou, testando
ao vivo, que "a tela atualiza alguns milissegundos depois do enter...
e isso tira do campo de digitação". Causa real: `renderizarAreaInput()`
(dentro de `criarChatController()`, compartilhada entre WhatsApp
Unificado e a gaveta do lead) sempre reconstruía o `<textarea>` do ZERO
(`container.innerHTML = ...`) toda vez que era chamada — inclusive pelo
canal Realtime, que recebe de volta o INSERT da PRÓPRIA mensagem que
acabamos de mandar alguns milissegundos depois (rede, não é instantâneo)
e também chama `renderizarAreaInput()`. Um `<textarea>` NOVO nunca está
focado, mesmo substituindo visualmente o antigo no mesmo lugar.

**Corrigido**: `renderizarAreaInput(forcarRecriar)` ganhou um parâmetro —
se o container JÁ tem a caixa de texto livre e a janela continua aberta
(mesmo modo, mesma conversa), a função NÃO mexe no DOM, só atualiza a
barra "Respondendo a..." — preserva foco/cursor/rascunho. Só reconstrói
de propósito quando `forcarRecriar=true`, passado explicitamente por
`abrir()` (trocar de conversa SEMPRE precisa limpar qualquer rascunho da
conversa anterior — nunca deve herdar o texto que alguém estava digitando
pro lead errado). Os outros 2 call sites (`recarregarHistorico()`, direto
depois de enviar; e o handler do canal Realtime) continuam chamando sem
argumento (reaproveita o `<textarea>` existente) — são exatamente os 2
pontos onde o foco precisava ser preservado. Como `criarChatController()`
é compartilhado, o fix cobre WhatsApp Unificado E a gaveta do lead de
uma vez, sem código duplicado.

## Investigação: "mesclagem automática está funcionando?" + DDD chutado em Inativos (2026-10-05)

Pedido do usuário, 3 mensagens em sequência: "a mesclagem automática está
funcionando? estou vendo várias pessoas com e-mail e/ou telefone igual...
ainda esperando mesclar"; "isso tem feito a gente entrar em contato com
pessoas cujas tags não estão atualizadas"; "algumas pessoas estão com
leads a mesclar com o mesmo telefone, mas com DDD diferente. Estamos
colocando o DDD por conta própria, quando no cadastro não tem?".

**Investigação com SQL direto contra produção** (não especulação):

- **Auto-mesclagem (só `criterio='telefone'`) está ativa e funcionando**:
  `log_atividade` confirma 6231 mesclagens históricas, as mais recentes
  há poucas horas da investigação.
- **Backlog pendente, por critério**: nome=2212, telefone=1302, sem
  telefone=257, email=198 — volume esperado de fila de revisão manual,
  não evidência de bug.
- **Amostra de 30 grupos `telefone` pendentes**: todos com nomes
  genuinamente diferentes entre si — corretamente NÃO auto-mesclados
  (a regra exige nomes compatíveis — igual ou abreviação —, nunca só
  telefone igual).
- **"Mesmo telefone, DDD diferente" NÃO acontece nos grupos `telefone`**
  — estruturalmente impossível: `normalizarTelefoneParaChave(ddd,
  numero)` concatena DDD+número na própria chave de agrupamento, então
  2 DDDs diferentes NUNCA caem no mesmo grupo "telefone" (confirmado
  também por SQL, 0 ocorrências). **O padrão que o usuário viu é dos
  grupos `nome` (critério 3, "Nome Parecido")** — confirmado por
  amostra real (ex: "ANA CLARA NAVES" DDD 62 vs "ANA CLARA" DDD 85).
  Isso é consequência DIRETA de uma decisão de design já registrada
  neste arquivo (ver seção "Leads a Tratar" acima): *"Deliberadamente SEM
  usar telefone/e-mail DIFERENTES como desqualificador... um lead pode
  ter trocado de telefone, ou um dos dois cadastros pode ter erro de
  digitação"* — não é um bug, é o comportamento pretendido (revisão
  manual, nunca mescla sozinho nesse critério).
- **Bug real confirmado, separado**: `parseTelefoneInativo()`
  (`js/importador.js`) **chutava `ddd:'62'` pra QUALQUER filial** sempre
  que a planilha de Inativos do Mercúrio não trazia DDD explícito no
  telefone (comum — 42% dos 1302 membros pendentes em grupos "telefone"
  têm a tag "Inativo", ou seja, passaram por essa função). Isso é
  **errado pra Barra do Garças/MT** (DDD real 66) — silenciosamente
  atribuía DDD de Goiânia a gente de outra cidade, com risco real de
  mandar WhatsApp pro número errado (mesmo DDD + número de verdade de
  outra pessoa). Também inflava falso-positivo de agrupamento por
  telefone (2 pessoas sem DDD informado, de filiais diferentes, caindo
  no mesmo DDD fabricado).
  - **Corrigido**: nova `dddPadraoDaFilial(filialDestino)` —
    mapeamento de EXCEÇÃO explícita (`{'Barra do Garças/MT': '66'}`,
    mesmo espírito de `MAPEAMENTO_FILIAL_ID_CONHECIDO` em
    `scraper/importar-ulisses-api.js`), fallback `'62'` pras demais
    filiais (todas efetivamente Goiânia hoje). `parseTelefoneInativo()`
    ganhou um 2º parâmetro (`dddPadrao`), resolvido 1x no topo de
    `processarPlanilhas()` a partir da filial selecionada, e passado no
    único call site. **Nunca muda telefone já gravado** — só afeta a
    PRÓXIMA importação de Inativos sem DDD explícito; registros antigos
    com DDD '62' fabricado (de filiais erradas) não são corrigidos
    retroativamente por este fix (precisaria de um backfill manual
    pontual se algum caso real em Barra do Garças/MT for confirmado).
- **Conclusão prática pro usuário**: a mesclagem automática está
  funcionando como projetado; os grupos "telefone"/"nome" ainda
  pendentes são, pela amostra, pessoas genuinamente diferentes (família
  compartilhando telefone fixo, ou coincidência de nome comum) — segue
  exigindo revisão manual, não é sinal de bug na régua de auto-mesclagem.
  O único bug real confirmado e corrigido foi o DDD fabricado em
  Inativos pra filiais fora de Goiânia.

## Aviso de violação de política da Meta — causa real: RAJADA, não volume (2026-10-05)

Pedido do usuário: "recebemos nova mensagem de que estamos violando a
política do whatsapp, mas mandei muito menos mensagens via api. Veja
quantas mensagens mandei hoje, e o que podemos fazer pra evitar disparar
essa auditoria".

**Investigado com SQL direto, não suposição**: só 58 mensagens de SAÍDA
no dia (33 template + 25 texto livre, pra 45 destinatários distintos) —
volume baixo de verdade, confirma a estranheza do usuário. Mas olhando o
INTERVALO entre envios consecutivos: de 57 intervalos no dia, **31
foram menores que 2 segundos** (o menor, 4 milissegundos) — um burst
real de ~33 mensagens de TEMPLATE idêntico ("Olá, {nome}! Aqui quem fala
é Henrique...") pra dezenas de destinatários NOVOS, concentrado em poucos
segundos (`14:37:17` a `14:37:20`).

- **Causa raiz confirmada no código**: "Convidar (API)"
  (`confirmarEnviarConviteApiLote()`) e "Convidar (Janela Aberta)"
  (`js/whatsapp.js`) mandavam em **lotes de 5 via `Promise.all()`**
  (5 chamadas praticamente SIMULTÂNEAS à Graph API) com só **400ms** de
  pausa entre lotes — o mesmo padrão existia em `whatsapp-reenviar-falhas`
  (Edge Function). O problema nunca foi "quantas mensagens por dia", foi
  a TAXA instantânea (mensagens/segundo) + conteúdo IDÊNTICO + muitos
  destinatários NOVOS de uma vez — exatamente o sinal que os sistemas
  automáticos de detecção de spam/qualidade da Meta tratam como disparo
  em massa automatizado, independente do volume total do dia.
- **Corrigido nos 3 pontos**: lote reduzido de 5 pra **1** (serializa —
  nunca 2+ chamadas concorrentes à Graph API) + pausa aumentada de 400ms
  pra **1500ms** entre cada envio individual (`TAMANHO_LOTE_CONVITE_API`/
  `PAUSA_ENTRE_LOTES_MS` em `js/whatsapp.js`, `TAMANHO_LOTE` em
  `whatsapp-reenviar-falhas/index.ts`). Não é uma garantia formal de taxa
  (a Meta tem limites próprios por número/qualidade, `messaging_limit` no
  WhatsApp Manager) — só elimina a ASSINATURA de rajada que motivou o
  aviso. Custo aceito: uma campanha de 33 pessoas agora leva ~50s em vez
  de ~3s — trade-off claramente a favor, dado o risco de bloqueio.
- **Resposta à pergunta "recebemos um 'strike' se o lead bloquear?"**:
  a WhatsApp Business Platform não funciona com um contador público de
  "strikes" discretos — o número de telefone tem uma **Quality Rating**
  (Verde/Amarelo/Vermelho, visível no WhatsApp Manager) calculada a
  partir de um conjunto de sinais acumulados: bloqueios pelo destinatário,
  denúncias de spam, feedback negativo, e padrões de envio anômalos
  (rajada/burst, conteúdo repetido, muitos contatos novos de uma vez —
  justamente o que causou este aviso). Um único bloqueio isolado não
  derruba a conta sozinho, mas contribui pro score agregado; se a
  Quality Rating cair pra Vermelho de forma sustentada, a Meta reduz o
  `messaging_limit` (teto de conversas novas por 24h) e, em casos
  persistentes, pode restringir/suspender o envio daquele número — é
  risco cumulativo, não um "1 bloqueio = banido". **Fora do alcance de
  código**: a mensagem de aviso em si só aparece no Business
  Manager/WhatsApp Manager (não chega pelo nosso webhook, que só recebe
  evento de mensagem/status) — não há como o CRM detectar esse aviso
  específico sozinho; vale checar o Quality Rating lá periodicamente
  depois de qualquer disparo em massa.

## Mesclagem inteligente pontual em "Leads a Tratar" (2026-10-05)

Pedido do usuário: "faça uma mesclagem agora nos leads que estão na aba
de leads a tratar (usando os critérios inteligentes que falamos, e
preservando ambos telefone e e-mail)". Script descartável (não faz parte
do projeto), reaproveitando FIELMENTE a lógica já validada de
`nomesCompativeisParaAutoMesclagem()`/`escolherSobreviventeAutoMesclagem()`
(`js/leads-a-tratar.js`), estendida aqui pra grupos `criterio='email'`
(nunca tinha auto-merge, só `'telefone'` tinha).

- **Escopo decidido durante a execução, não assumido de antemão**:
  rodado primeiro em modo dry-run contra os 3 critérios — confirmou
  `telefone`: 0 elegíveis (o auto-merge de toda importação já resolve
  isso sozinho, nada sobrou pra fazer aqui) e `email`: 46 elegíveis
  (evidência forte independente — e-mail idêntico — + nome compatível).
  `nome` (826 grupos, 155 passariam no teste estrito) foi **excluído de
  propósito** — ali não há telefone/e-mail batendo como segunda
  evidência, só o nome sozinho; um exemplo real da amostra ("ANA PAULA DE
  OLIVEIRA" vs "ANA PAULA OLIVEIRA DE SOUZA") mostrou risco real de
  sobrenome comum coincidente (mesma classe de falso-positivo já
  documentada na seção "Leads a Tratar" — "Lucas Nunes..."), então
  continua exigindo revisão manual, como já era.
- **Preservação de telefone ESTENDIDA** (pedido explícito do usuário):
  o `mesclarAutomaticamenteLeads()` original só preserva e-mail
  divergente (telefone nunca diverge nesse caso, é o próprio critério de
  agrupamento) — o script generalizou o MESMO tratamento pro telefone
  também, já que aqui (`criterio='email'`) os telefones PODEM divergir:
  um vira o campo oficial, o outro vira nota em `resumo_ia` ("Telefone
  alternativo (de NOME): DDD NUMERO") — nunca perdido.
- **46 grupos mesclados, 0 erro**, confirmado por `log_atividade`
  (`acao='mesclar_leads'`, `detalhes.origem='script_mesclagem_inteligente_2026-10-05'`).
  Grupos com 2+ IDs REAIS do Ulisses no mesmo grupo (0 casos neste lote)
  ficariam de fora de propósito — mesclar 2 cadastros reais é risco
  diferente, fora do escopo.
- **Achado real no meio da verificação**: em 7 dos 46 sobreviventes, o
  telefone já existente (mantido como "oficial" por já ser truthy) era
  pré-existente MAL FORMADO (DDD vazio, ou os 2 primeiros dígitos do
  próprio número de celular usados por engano como DDD — ex:
  DDD="99"+numero="9221011", quando o certo era DDD 62 + "999221011") —
  bug de dado de ALGUM momento anterior, não causado por este script (só
  exposto por ele: o merge preservou os dois valores corretamente, só
  manteve o pior como oficial). Corrigido num 2º passo pontual:
  promovido o telefone bem-formado (já salvo como nota) pro campo
  oficial nesses 7 registros, removendo a nota que virou redundante.
  **Não investigada a causa raiz desse bug de origem** (fora do escopo
  deste pedido) — se reaparecer em volume, vale auditar de onde esses 7
  telefones vieram originalmente.
- **Limpeza de remanescente órfão**: o script deletava de
  `leads_a_tratar` só os IDs efetivamente apagados, mas esquecia de
  também remover a linha do PRÓPRIO sobrevivente no grupo já resolvido —
  sobrava um "grupo fantasma" de 1 membro só na tela (cosmético, sem
  perda de dado). Corrigido com uma limpeza extra (grupos
  `telefone`/`email` com exatamente 1 membro restante = sempre resíduo
  de merge, nunca um estado legítimo desses 2 critérios). Confirmado:
  `email` caiu de 75 pra 29 grupos (75-46, bate exato).

## Tags "Contato Recente: 7/30 dias" (2026-10-06)

Pedido do usuário: "crie uma tag para quem recebeu mensagem nossa nos
últimos dias (pode ser nos últimos 7, e ultimos 30 dias) e já marque
todo mundo que atende a esse critério. Assim evitamos enviar mensagem de
novo".

**Decisão de design**: NÃO é uma tag comum (adicionada 1x, esquecida) —
isso viraria uma mentira depois que os 7/30 dias passassem, exatamente o
oposto do propósito ("não mandar de novo pra quem já foi contatado"). É
uma tag de SISTEMA, sempre recalculada a partir da coluna
`ultimo_contato_em` (já existente, carimbada automaticamente em todo
envio real desde `migracao_whatsapp_snooze_fila_ultimo_contato.sql`):

- **Adicionada na hora**, dentro de `whatsapp-send` (Edge Function) — no
  MESMO bloco que já carimba `ultimo_contato_em`, agora também lê as
  tags atuais do lead e adiciona `"Contato Recente: 7 dias"`/`"Contato
  Recente: 30 dias"` se ainda não estiverem lá (as duas coexistem — quem
  foi contatado há 3 dias tem as DUAS, quem foi contatado há 15 dias só
  a de 30). Cobre todo envio real (individual, convite em massa, bot de
  reengajamento, etc.) de graça, sem precisar mexer em cada chamador.
- **Removida pelo tempo passando, não por nenhum evento** — função SQL
  `sincronizar_tags_contato_recente()` (`migracao_tags_contato_recente.sql`),
  rodando via `pg_cron` 1x/dia (09:05 UTC = 06:05 Brasília): percorre
  TODA a base (exceto lixeira), compara `ultimo_contato_em` contra os 2
  limiares e ADICIONA ou REMOVE cada tag conforme o caso — nenhuma outra
  rotina do projeto remove uma tag baseada só em tempo decorrido, esta é
  a primeira (mesmo padrão de `limpar_lixeira_leads_vencidos()`/
  `arquivar_conversas_whatsapp_inativas()`, só que atualiza em vez de
  excluir/arquivar).
- **`tags` é jsonb mas guardado como STRING jsonb contendo o array**
  (confirmado: `jsonb_typeof(tags) = 'string'`) — a função SQL usa
  `(tags #>> '{}')::jsonb` pra extrair o array de verdade e
  `to_jsonb(...::text)` pra regravar no MESMO formato, mesma técnica já
  usada em `leads_ativos_inativos_da_filial()` etc.
- **Rodada manualmente 1x contra produção** (satisfaz "já marque todo
  mundo que atende a esse critério" imediatamente, sem esperar o cron do
  dia seguinte): confirmado 896 leads tagueados, batendo exato com
  `count(*) where ultimo_contato_em >= now() - interval '7/30 days'`.
- **Nova família de tag** (`FAMILIAS_TAG`, `js/app.js`) —
  `/^Contato Recente: /i`, cor neutra/informativa própria
  (`.tag-contato-recente`, cinza-azulado — não é alerta nem conquista,
  só um "já foi contatado, cuidado pra não repetir"). Não protegida
  contra remoção manual (mesmo tratamento de `Jornada:`/`Convite:`/
  `Conversa:` — se alguém remover na mão, o cron do dia seguinte
  recalcula sozinho de qualquer forma, já que é derivada de
  `ultimo_contato_em`, não um estado independente).
- **Uso pretendido**: filtro de coluna já tem a lista "Excluir" (chips
  vermelhos) — marcando `"Contato Recente: 7 dias"` ali, um SDR filtrando
  uma coluna pra disparo em massa já esconde sozinho quem foi contatado
  recentemente, sem precisar de nenhuma UI nova (reaproveita o mecanismo
  de exclusão por tag já existente).

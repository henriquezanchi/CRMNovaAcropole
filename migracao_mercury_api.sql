-- API externa do Mercury (v2 do Mercúrio) — substitui boa parte da
-- raspagem Playwright frágil (Ativos/Inativos, Turmas, ENDEREÇOS) por
-- chamadas REST diretas (ver supabase/functions/_shared/mercury.ts e
-- supabase/functions/mercury-sincronizar). Validado contra produção
-- nesta sessão: `matricula_mercurio` já gravado por leads existentes
-- bate 100% com o `registrationNo` do Mercury (5/5 casos testados) — é
-- a chave de casamento principal, sem precisar de nome/telefone.
--
-- `admissionDate` do Mercury é a fonte de verdade nova pra
-- `data_matricula` — bem mais confiável que o texto "Ingresso" raspado
-- da lista de turma (prova real: José Augusto Carneiro, matr. 46104,
-- tinha data_matricula=2026-10-02 no nosso banco — errado — Mercury diz
-- admissionDate=2025-04-30, batendo com o histórico real de contribuições
-- dele). `level.code` do Mercury bate exatamente com o vocabulário já
-- usado (PP/N1/N2.../TA/CO/CA/JN) — confirmado varrendo as 5 filiais.
--
-- Lacuna real do Mercury, documentada no próprio guia da API: o campo
-- `reentry` vem sempre "not_in_domain_model" — não dá pra confiar nele
-- pra detectar reingresso. Continuamos derivando "Recuperado" sozinhos:
-- se o lead JÁ estava "Inativo" no nosso banco e o Mercury agora diz
-- active=true, aplicamos a tag (mesmo sinal de sempre, só que sem
-- precisar mais raspar a tela HISTÓRICO do Mercúrio antigo).
alter table leads_inscricoes
    add column if not exists mercury_dossier_sincronizado_em timestamptz;

comment on column leads_inscricoes.mercury_dossier_sincronizado_em is
    'Quando a sincronização via API do Mercury (v2) leu pela última vez o dossiê desta pessoa (telefone/e-mail/cidade/UF/nascimento/motivo de saída) — null = nunca sincronizado por este mecanismo. Separado do registro básico (/people, sempre atualizado a cada rodada) porque o dossiê custa 1 chamada HTTP extra por pessoa — sincronizado em lotes pequenos (ver LOTE_DOSSIE_POR_RODADA em mercury-sincronizar/index.ts) pra nunca estourar o tempo de execução da Edge Function; se espalha sozinho ao longo de vários dias, mesmo padrão já usado em data_matricula_verificada_mercurio_em.';

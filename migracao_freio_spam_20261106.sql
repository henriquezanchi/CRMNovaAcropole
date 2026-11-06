-- 06/11/2026: a Meta avisou que a conta da Nova Acrópole (4141029446188721) foi identificada
-- "enviando spam" (volume saltou de ~30 para ~400 mensagens/dia em 04-05/11, quase tudo convite
-- frio; 73 números inválidos e 17 retenções 131049 em 05/11). Decisão do usuário: reduzir.
-- Convites pendentes de hoje suspensos (voltar = status 'pendente' nas linhas abaixo) e
-- DMF Goiânia de 200 para 50 por dia. Campanha de Catalão fica em espera.
update campanha_fila set status = 'cancelado'
where status = 'pendente' and campanha_id in (select id from campanhas_whatsapp where ativa);

update campanhas_whatsapp set cota_diaria = 50 where slug = 'dmf-2026';

insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'freio_spam_meta', 'Claude (aviso de spam da Meta)',
  jsonb_build_object('motivo', 'Meta: conta identificada enviando spam (06/11)', 'dmf_cota_antes', 200, 'dmf_cota_depois', 50));

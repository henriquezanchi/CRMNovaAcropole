-- Número extra das campanhas (28/11/2026, pedido do usuário): o número (62) 3190-2994, no portfólio
-- "LUIZ HENRIQUE ZANCHI BORGES" (limite próprio da Meta por portfólio), soma capacidade às campanhas de TODAS
-- as escolas, além do número da agência. Continua guardado em whatsapp_conexoes (a linha fica na filial em que
-- foi conectado, só para o token/ações da tela), mas com extra_campanhas = true ele não é "o número da escola":
--   * modelos manuais e mensagens novas da filial continuam saindo pelo número da agência;
--   * o agendador (campanha-whatsapp) distribui os convites entre a agência e os números extras, cada um com
--     teto, limite e qualidade próprios (rampa igual à da agência, começando em teto_inicial);
--   * respostas saem pelo número em que a pessoa escreveu (regra de sempre).
-- Só entra no rodízio com usar_no_crm = true (depois dos modelos aprovados e do pagamento cadastrado na conta).
alter table whatsapp_conexoes add column if not exists extra_campanhas boolean not null default false;
alter table whatsapp_conexoes add column if not exists teto_campanha integer;
alter table whatsapp_conexoes add column if not exists teto_ajustado_em date;
alter table campanha_fila add column if not exists phone_number_id text;

update whatsapp_conexoes set extra_campanhas = true where phone_number_id = '1490112977516416';

create or replace view whatsapp_conexoes_status as
select filial, waba_id, phone_number_id, numero_exibicao, nome_verificado, coexistencia, estado, usar_no_crm,
       contatos_sincronizacao_em, historico_sincronizacao_em, historico_progresso, ultimo_erro,
       conectado_em, conectado_por, desconectado_em, atualizado_em, extra_campanhas, teto_campanha
  from whatsapp_conexoes;
grant select on whatsapp_conexoes_status to anon, authenticated;

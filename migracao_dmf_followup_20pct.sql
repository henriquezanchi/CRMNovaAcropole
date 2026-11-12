-- DMF (12/11/2026, pedido do usuário): 2ª tentativa limitada a 20% da cota do dia, a sobra vai
-- para convites novos divididos por escola. Hoje a 2ª tentativa já passou dos 20% (45 enviadas),
-- então as pendentes de hoje são canceladas e o replanejamento de hoje roda com 0%; depois a
-- regra fica em 20% para os próximos dias (set em seguida, migracao_dmf_followup_20pct_b.sql).
update campanha_fila f set status = 'cancelado', motivo = 'refeito: 2ª tentativa limitada a 20%'
from campanhas_whatsapp c
where c.id = f.campanha_id and c.slug = 'dmf-2026' and f.status = 'pendente'
  and coalesce(f.motivo, '') not like 'reenvio:%'
  and f.agendado_para >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');

update campanhas_whatsapp set config = config || '{"percentual_maximo_followup": 0}'::jsonb where slug = 'dmf-2026';

insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'campanha_ajustada', 'Claude (pedido do usuário)', '{"campanha":"dmf-2026","percentual_maximo_followup":"0.4->0.2","replanejado":"hoje"}');

select executar_campanha_whatsapp('{"acao":"planejar","forcar":true}'::jsonb);

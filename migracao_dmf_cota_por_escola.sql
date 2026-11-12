-- DMF Goiânia (12/11/2026, pedido do usuário): sem peso de proximidade; convites divididos por escola,
-- proporcional ao banco de cada uma, mínimo de 10 por escola. Refaz a fila de convites do resto de hoje
-- (não mexe nos já enviados, nas 2ªs tentativas nem nos reenvios por falha de pagamento).
update campanhas_whatsapp set config = (config - 'peso_filial') || jsonb_build_object('cota_por_escola', true, 'minimo_por_escola', 10)
where slug = 'dmf-2026';

update campanha_fila f set status = 'cancelado', motivo = 'refeito: cota por escola'
from campanhas_whatsapp c
where c.id = f.campanha_id and c.slug = 'dmf-2026' and f.tipo = 'convite' and f.status = 'pendente'
  and coalesce(f.motivo, '') <> 'reenvio: pagamento da conta regularizado'
  and (f.agendado_para at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date;

insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'campanha_cota_alterada', 'Claude (pedido do usuário)', '{"dmf-2026":"cota por escola, mínimo 10, sem peso de proximidade"}');

select executar_campanha_whatsapp('{"acao":"planejar","forcar":true}'::jsonb);

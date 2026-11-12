-- Depois do replanejamento de hoje (feito com 0%), a regra fica em 20% para os próximos dias.
update campanhas_whatsapp set config = config || '{"percentual_maximo_followup": 0.2}'::jsonb where slug = 'dmf-2026';
select config->>'percentual_maximo_followup' from campanhas_whatsapp where slug = 'dmf-2026';

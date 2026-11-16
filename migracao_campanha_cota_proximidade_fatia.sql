-- Cotas por proximidade: fatia igual por abertura, contada a partir de 17/11/2026 (pedido do usuário, 16/11).
update campanhas_whatsapp set config = config || '{"proximidade_desde": "2026-11-17"}'::jsonb
where config->>'cota_por_proximidade' = 'true';
select slug, config->>'proximidade_desde' desde from campanhas_whatsapp where config->>'cota_por_proximidade' = 'true';

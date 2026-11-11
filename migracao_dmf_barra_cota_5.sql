-- Pedido do usuário (11/11/2026): DMF de Barra do Garças de 10 para 5 convites por dia.
update campanhas_whatsapp set cota_diaria = 5 where slug = 'dmf-barra-2026';
insert into log_atividade (filial, acao, autor, detalhes)
values ('Barra do Garças/MT', 'campanha_cota_alterada', 'Claude (pedido do usuário)', '{"campanha":"dmf-barra-2026","de":10,"para":5}');
select slug, cota_diaria from campanhas_whatsapp where slug = 'dmf-barra-2026';

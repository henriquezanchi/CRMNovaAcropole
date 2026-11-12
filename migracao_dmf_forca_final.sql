-- Reta final do DMF Goiânia (12/11/2026, pedido do usuário: "força total" para chegar a 100
-- inscritos de fora). 200 convites por dia, até sexta 13/11; o DMF é planejado antes das outras
-- campanhas, então as turmas ficam com o que sobrar do limite da Meta nesses dois dias.
-- Para de convidar quando restarem 20 vagas no Ulisses (config.parar_com_vagas_restantes).
update campanhas_whatsapp set cota_diaria = 200, fim_convites = date '2026-11-13', fim_followup = date '2026-11-13',
    config = config || jsonb_build_object('parar_com_vagas_restantes', 20)
where slug = 'dmf-2026';
insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'campanha_cota_alterada', 'Claude (pedido do usuário)',
        '{"dmf-2026":"50->200","fim_convites":"2026-11-12->2026-11-13","parar_com_vagas_restantes":20}');
select slug, cota_diaria, fim_convites, config->>'parar_com_vagas_restantes' parar from campanhas_whatsapp where slug = 'dmf-2026';

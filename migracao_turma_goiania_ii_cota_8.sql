-- Pedido do usuário (11/11/2026): aumentar um pouco os convites da turma de Goiânia II (4 -> 8/dia).
update campanhas_whatsapp set cota_diaria = 8 where slug = 'turma-goiania-ii-2026';
insert into log_atividade (filial, acao, autor, detalhes)
values ('Goiânia II', 'campanha_cota_alterada', 'Claude (pedido do usuário)', '{"campanha":"turma-goiania-ii-2026","de":4,"para":8}');
select slug, cota_diaria, config->'banco' banco from campanhas_whatsapp where slug = 'turma-goiania-ii-2026';

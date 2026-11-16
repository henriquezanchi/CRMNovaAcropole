-- Cotas por proximidade da aula + teto no limite da Meta (16/11/2026, pedido do usuário).
-- O freio que importa é a qualidade da conta (bloqueios/denúncias), não a quantidade dentro do
-- limite autorizado pela Meta. Teto = limite da Meta (250) menos 20 de folga para modelos fora das
-- campanhas. Continuam valendo: amarelo -> 30% e teto volta a 100; vermelho ou 5+ retenções em 3h -> para.
update campanha_parametros set teto_diario = 230, atualizado_em = now() where id = 1;
-- As aberturas de turma passam a dividir o teto pela proximidade da abertura (peso 1/dias²),
-- recalculado todo dia no planejamento das 08:25.
update campanhas_whatsapp set config = coalesce(config, '{}'::jsonb) || '{"cota_por_proximidade": true}'::jsonb
where slug in ('turma-universitario-2026','turma-jardim-america-2026','turma-goiania-ii-2026',
               'turma-setor-oeste-2026','turma-eldorado-2026','turma-catalao-2026');
insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'campanhas_cota_proximidade', 'Claude (pedido do usuário)', '{"teto_diario": 230, "peso": "1/dias^2"}'::jsonb);
select slug, fim_convites, (fim_convites - date '2026-11-17' + 1) dias,
  round(230 * (1.0/(fim_convites - date '2026-11-17' + 1)^2) / sum(1.0/(fim_convites - date '2026-11-17' + 1)^2) over ()) cota_amanha
from campanhas_whatsapp where config->>'cota_por_proximidade' = 'true' order by fim_convites, slug;

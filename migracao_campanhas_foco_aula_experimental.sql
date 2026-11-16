-- Foco na aula experimental (pedido do usuário, 16/11/2026). As campanhas de turma das escolas de Goiânia
-- passam a convidar para a AULA EXPERIMENTAL gratuita de cada escola (evento, data e prazo de convite = dia da
-- aula). O evento da turma fica guardado em config.turma_evento_id. Catalão não tem aula experimental e segue
-- com a turma (primeiro passo: palestra de 18/11). Alto da Glória segue pausada.
with mapa(slug, aula_id, data_aula) as (values
    ('turma-universitario-2026', 785, date '2026-11-17'),
    ('turma-goiania-ii-2026',    777, date '2026-11-17'),
    ('turma-eldorado-2026',      775, date '2026-11-18'),
    ('turma-jardim-america-2026',779, date '2026-11-19'),
    ('turma-setor-oeste-2026',   782, date '2026-11-19'))
update campanhas_whatsapp c set
    config = c.config || jsonb_build_object('turma_evento_id', c.evento_id, 'foco', 'aula_experimental'),
    evento_id = m.aula_id,
    evento_com_artigo = 'a aula experimental gratuita do Curso de Filosofia para Viver',
    evento_data_curta = to_char(m.data_aula, 'DD/MM'),
    fim_convites = m.data_aula,
    fim_followup = m.data_aula
from mapa m where c.slug = m.slug;

update campanhas_whatsapp set config = jsonb_set(config, '{instrucoes}', to_jsonb(
    '- FOCO DESTA FASE: o convite enviado é para a AULA EXPERIMENTAL gratuita do Curso de Filosofia para Viver, em '
    || evento_data_curta || ', às 20h, na própria escola. O objetivo é a pessoa se inscrever na aula experimental pelo link https://inscricao.acropolebrasil.com.br/?eventoId=24698. Fale da turma só se a pessoa perguntar ou já tiver ido à aula experimental.' || E'\n'
    || (config->>'instrucoes')))
where config->>'foco' = 'aula_experimental';

insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'campanhas_foco_aula_experimental', 'Claude (pedido do usuário)',
        (select jsonb_object_agg(slug, jsonb_build_object('evento_id', evento_id, 'data', evento_data_curta)) from campanhas_whatsapp where config->>'foco' = 'aula_experimental'));

select slug, evento_id, evento_com_artigo, evento_data_curta, fim_convites, left(config->>'instrucoes', 90) instr
from campanhas_whatsapp where slug like 'turma-%' order by fim_convites, slug;

-- Catalão (sem aula experimental) sai da divisão por proximidade: cota fixa de 15/dia até a véspera da turma.
update campanhas_whatsapp set config = config - 'cota_por_proximidade', cota_diaria = 15 where slug = 'turma-catalao-2026';

-- Próxima fase de cada campanha guardada na própria campanha (config.fase_seguinte), para a tela de
-- Planejamento de Mensagens projetar a semana com a troca já agendada (20/11: aula experimental -> turma).
-- A função agendada (campanhas_voltar_para_turma) aplica a troca e apaga o fase_seguinte.
with mapa(slug, data_turma) as (values
    ('turma-universitario-2026',  date '2026-11-24'), ('turma-goiania-ii-2026', date '2026-11-24'),
    ('turma-eldorado-2026',       date '2026-11-25'),
    ('turma-jardim-america-2026', date '2026-11-26'), ('turma-setor-oeste-2026', date '2026-11-26'))
update campanhas_whatsapp c set config = c.config || jsonb_build_object('fase_seguinte', jsonb_build_object(
    'desde', '2026-11-20', 'evento_id', (c.config->>'turma_evento_id')::bigint,
    'evento_data_curta', to_char(m.data_turma, 'DD/MM'), 'fim_convites', (m.data_turma - 1)::text,
    'proximidade_desde', '2026-11-20'))
from mapa m where c.slug = m.slug and c.config->>'foco' = 'aula_experimental';

create or replace function campanhas_voltar_para_turma()
returns void language plpgsql security definer set search_path = public as $$
begin
  with mapa(slug, data_turma) as (values
      ('turma-universitario-2026',  date '2026-11-24'),
      ('turma-goiania-ii-2026',     date '2026-11-24'),
      ('turma-eldorado-2026',       date '2026-11-25'),
      ('turma-jardim-america-2026', date '2026-11-26'),
      ('turma-setor-oeste-2026',    date '2026-11-26'))
  update campanhas_whatsapp c set
      evento_id = (c.config->>'turma_evento_id')::bigint,
      evento_com_artigo = 'a nova turma do Curso de Filosofia para Viver',
      evento_data_curta = to_char(m.data_turma, 'DD/MM'),
      fim_convites = m.data_turma - 1,
      fim_followup = m.data_turma - 1,
      config = jsonb_set(c.config - 'foco' - 'fase_seguinte', '{instrucoes}',
                 to_jsonb(regexp_replace(c.config->>'instrucoes', '^- FOCO DESTA FASE:[^\n]*\n', '')))
               || '{"proximidade_desde": "2026-11-20"}'::jsonb
  from mapa m
  where c.slug = m.slug and c.config->>'foco' = 'aula_experimental' and c.config ? 'turma_evento_id';

  insert into log_atividade (filial, acao, autor, detalhes)
  values ('GLOBAL', 'campanhas_volta_turma', 'Agendamento (pedido do usuário)',
          (select jsonb_object_agg(slug, jsonb_build_object('evento_id', evento_id, 'fim_convites', fim_convites))
             from campanhas_whatsapp where slug in ('turma-universitario-2026','turma-goiania-ii-2026',
               'turma-eldorado-2026','turma-jardim-america-2026','turma-setor-oeste-2026')));

  perform cron.unschedule('campanhas-voltar-turma-20261120');
end $$;

select slug, config->'fase_seguinte' from campanhas_whatsapp where config ? 'fase_seguinte' order by slug;

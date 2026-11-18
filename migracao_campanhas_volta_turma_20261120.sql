-- A partir de sexta 20/11/2026 as 5 campanhas de Goiânia voltam a convidar para a ABERTURA DE TURMA (pedido do
-- usuário, 18/11). Desfaz o foco na aula experimental (migracao_campanhas_foco_aula_experimental.sql): evento =
-- config.turma_evento_id, texto e data da turma, convites até a véspera da turma, linha de foco tirada das
-- instruções do robô. A divisão por proximidade recomeça a contar em 20/11 (fatia igual para cada escola nesta fase).
-- Roda uma vez, às 00:10 de 20/11 (03:10 UTC), antes do planejamento das 08:25, e se desagenda sozinho.

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
      config = jsonb_set(c.config - 'foco', '{instrucoes}',
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

select cron.schedule('campanhas-voltar-turma-20261120', '10 3 20 11 *',
                     $$ select campanhas_voltar_para_turma(); $$);

-- DMF de Catalão (evento 769, 18/11 19h30, palestra "Filosofia e Ciência" com o prof. João
-- Guilherme), no mesmo molde da campanha de Barra do Garças (06/11/2026).
-- ATENÇÃO: cria uma campanha ATIVA, que passa a mandar até 10 convites por dia pelo WhatsApp.
insert into campanhas_whatsapp (slug, nome, evento_id, filiais, atendente, ativa, cota_diaria, inicio, fim_convites,
  fim_followup, janela_inicio, janela_fim, template_convite, template_followup, template_idioma,
  evento_com_artigo, evento_data_curta, config)
select 'dmf-catalao-2026', 'Dia Mundial da Filosofia 2026 - Catalão', 769, array['Catalão'], atendente, true, 10,
  current_date, date '2026-11-17', date '2026-11-17', janela_inicio, janela_fim, template_convite, template_followup,
  template_idioma, 'o Dia Mundial da Filosofia', '18/11',
  (config - 'banco' - 'banco_em') || jsonb_build_object('instrucoes',
   E'- O evento acontece na própria escola de Catalão: Rua Maria R. da Costa, nº 56, Setor Santa Cruz, Catalão/GO. Quarta-feira, 18/11, às 19h30.\n'
   '- Palestra "Filosofia e Ciência: duas formas de buscar a verdade?", com o professor João Guilherme, de Goiânia. Não é preciso conhecer filosofia antes.\n'
   '- Entrada franca (gratuita). Vagas limitadas: é importante garantir a vaga pelo link de inscrição.\n'
   '- Contato da escola, se a pessoa pedir: WhatsApp (64) 99991-7888.\n'
   '- Este evento NÃO é o de Goiânia (PUC, dia 14/11). Nunca fale do evento de Goiânia.')
from campanhas_whatsapp where slug = 'dmf-barra-2026'
on conflict (slug) do nothing;

-- Aparece no painel da coordenação, na aba "Dia Mundial da Filosofia" (seletor de escola).
update painel_resultados_links set campanhas = array_append(campanhas, 'dmf-catalao-2026')
where id = 1 and not ('dmf-catalao-2026' = any(campanhas));

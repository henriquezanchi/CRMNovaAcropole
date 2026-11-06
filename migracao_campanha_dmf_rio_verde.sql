-- DMF de Rio Verde: o Minicurso de Oratória (evento 805, sábado 07/11, 15h às 18h) faz
-- parte das atividades do Dia Mundial da Filosofia (confirmado pelo usuário em 06/11/2026).
-- Convites só hoje (06/11), até 10, no mesmo molde da campanha de Barra do Garças.
-- O texto do modelo aprovado ("te convidar para {{4}} que deve acontecer no próximo dia
-- {{5}}") fica adequado ajustando só as variáveis desta campanha.
insert into campanhas_whatsapp (slug, nome, evento_id, filiais, atendente, ativa, cota_diaria, inicio, fim_convites,
  fim_followup, janela_inicio, janela_fim, template_convite, template_followup, template_idioma,
  evento_com_artigo, evento_data_curta, config)
select 'dmf-rio-verde-2026', 'Dia Mundial da Filosofia 2026 - Rio Verde', 805, array['Rio Verde'], atendente, true, 10,
  date '2026-11-06', date '2026-11-06', date '2026-11-06', janela_inicio, janela_fim, template_convite, template_followup,
  template_idioma, 'o Minicurso de Oratória do Dia Mundial da Filosofia', '07/11, sábado, às 15h',
  (config - 'banco' - 'banco_em') || jsonb_build_object('instrucoes',
   E'- Atividade do Dia Mundial da Filosofia em Rio Verde: MINICURSO DE ORATÓRIA, "A arte de se expressar na prática". Sábado, 07/11, das 15h às 18h, na Nova Acrópole Rio Verde.\n'
   '- É um minicurso pago: R$ 200,00. Alunos da Nova Acrópole: R$ 180,00. NÃO é gratuito: nunca diga que é gratuito nem que a entrada é franca.\n'
   '- Conteúdo: princípios e técnicas da oratória clássica para a comunicação, a expressão corporal, a organização das ideias e a segurança ao falar em público.\n'
   '- Vagas limitadas (30): é importante garantir a vaga pelo link de inscrição.\n'
   '- Contato da escola, se a pessoa pedir: WhatsApp (64) 99249-6444.\n'
   '- É amanhã: se a pessoa não puder ir, agradeça com gentileza, sem insistir.\n'
   '- Este evento NÃO é o de Goiânia (PUC, dia 14/11). Nunca fale do evento de Goiânia.')
from campanhas_whatsapp where slug = 'dmf-barra-2026'
on conflict (slug) do nothing;

-- Aparece no painel da coordenação, na aba "Dia Mundial da Filosofia" (seletor de escola).
update painel_resultados_links set campanhas = array_append(campanhas, 'dmf-rio-verde-2026')
where id = 1 and not ('dmf-rio-verde-2026' = any(campanhas));

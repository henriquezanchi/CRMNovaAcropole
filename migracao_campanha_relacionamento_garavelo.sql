-- Garavelo sem abertura de turma e sem evento futuro no Ulisses (11/11/2026): campanha de
-- relacionamento com o modelo aprovado contato_ulisses ("Vi que você participou {{4}} {{5}}
-- recentemente. E aí, o que achou?"), preenchido com o último evento de cada pessoa.
-- Só quem teve evento nos últimos 12 meses; sem 2ª tentativa (não insistir). 15 por dia;
-- para manter o total em 200, Jardim América 40 -> 32 e Setor Universitário 33 -> 26.

insert into campanhas_whatsapp (slug, nome, evento_id, filiais, atendente, ativa, cota_diaria, inicio, fim_convites,
  fim_followup, janela_inicio, janela_fim, template_convite, template_followup, template_idioma,
  evento_com_artigo, evento_data_curta, config)
select 'relacionamento-garavelo-2026-11', 'Relacionamento - Garavelo', null, array['Goiânia - Garavelo'], c.atendente, true, 15,
  current_date, date '2026-11-30', date '2026-11-30', c.janela_inicio, c.janela_fim, 'contato_ulisses', null, 'pt_BR',
  'conversar sobre o último evento de que a pessoa participou', null,
  jsonb_build_object('percentual_maximo_followup', 0, 'ultimo_evento_desde', (current_date - 365)::text,
    'padrao_grupo_a', '%filosofia para viver%',
    'corpos', jsonb_build_object('contato_ulisses', E'Oi, {{1}}! Aqui é {{2}}, da Nova Acrópole {{3}}, tudo bem?\n\nVi que você participou {{4}} {{5}} recentemente.\n\nE aí, o que achou?'),
    'instrucoes',
   E'- Esta não é uma campanha de convite: é uma conversa de relacionamento. A mensagem enviada perguntou o que a pessoa achou do último evento dela na Nova Acrópole do Garavelo.\n'
   '- Objetivo: ouvir com interesse genuíno. Pergunte o que mais marcou, que temas a interessam e como ela gostaria de continuar em contato com a filosofia. Uma pergunta por vez, mensagens curtas.\n'
   '- Se a pessoa disser que não chegou a ir, acolha sem constranger e pergunte que tipo de atividade ou tema a interessaria.\n'
   '- O Garavelo não tem turma nova, aula experimental nem evento marcado agora. Nunca prometa nem invente atividade do Garavelo. Diga que a escola vai avisar quando houver novidades.\n'
   '- Se a pessoa pedir algo para fazer agora, pode indicar uma atividade de outra escola da agenda que combine com o interesse dela, com nome, data, hora e link copiados da agenda, deixando claro em qual escola é.\n'
   '- Contato da escola, se a pessoa pedir: use os dados cadastrados da escola.')
from campanhas_whatsapp c where c.slug = 'turma-eldorado-2026'
on conflict (slug) do nothing;

update campanhas_whatsapp c set cota_diaria = v.cota
from (values ('turma-jardim-america-2026', 32), ('turma-universitario-2026', 26)) v(slug, cota)
where c.slug = v.slug;

update painel_resultados_links set campanhas = array_append(campanhas, 'relacionamento-garavelo-2026-11')
where id in (1, 4) and not ('relacionamento-garavelo-2026-11' = any(campanhas));

insert into log_atividade (filial, acao, autor, detalhes)
values ('Goiânia - Garavelo', 'campanha_criada', 'Claude (pedido do usuário)',
        '{"campanha":"relacionamento-garavelo-2026-11","cota":15,"turma-jardim-america-2026":"40->32","turma-universitario-2026":"33->26"}');

select slug, cota_diaria, inicio, fim_convites from campanhas_whatsapp
where ativa and cota_diaria > 0 and fim_convites >= current_date order by cota_diaria desc;

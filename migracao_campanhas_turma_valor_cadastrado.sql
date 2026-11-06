-- Campanhas de turma: as instruções ainda diziam "Valores do curso: nunca informe", resto da regra antiga,
-- e venciam a regra nova do robô (informa o valor cadastrado). Caso real 06/11: Renata (Setor
-- Universitário) perguntou o valor e ficou sem resposta, mesmo com a mensalidade cadastrada (R$150).
update campanhas_whatsapp
set config = jsonb_set(config, '{instrucoes}', to_jsonb(replace(config->>'instrucoes',
  '- Valores do curso: nunca informe; diga que vai ver isso e já passa (uma pessoa responde na mesma conversa) e que na aula experimental dá para conhecer tudo com calma.',
  '- Valor do curso: se perguntarem, informe a mensalidade cadastrada da escola (aparece nos dados da escola como "Mensalidade do Curso de Filosofia para Viver"), copiada exatamente, e lembre que a aula experimental é gratuita. Se a escola não tiver mensalidade cadastrada, ou se perguntarem outro valor (matrícula, material, desconto), diga que vai ver isso e já passa.')))
where slug like 'turma-%' and config->>'instrucoes' like '%Valores do curso: nunca informe%';

insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'campanha_instrucoes_valor', 'Claude (valor cadastrado nas campanhas de turma)',
        jsonb_build_object('motivo', 'instrução antiga impedia o robô de informar a mensalidade cadastrada'));

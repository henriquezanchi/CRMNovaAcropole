-- Pedido do usuário (11/11/2026): 200 mensagens de campanha por dia (convite + 2ª tentativa),
-- DMF Goiânia mantido em 50, o resto para as aberturas de turma, e Catalão entra nos convites.
-- Catalão não está na aula experimental compartilhada (Ulisses 24698); a porta de entrada
-- sugerida é a palestra gratuita da própria escola em 18/11 (Ulisses 24678).

insert into campanhas_whatsapp (slug, nome, evento_id, filiais, atendente, ativa, cota_diaria, inicio, fim_convites,
  fim_followup, janela_inicio, janela_fim, template_convite, template_followup, template_idioma,
  evento_com_artigo, evento_data_curta, config)
select 'turma-catalao-2026', 'Nova turma do Curso de Filosofia para Viver - Catalão', 808, array['Catalão'], atendente, true, 15,
  current_date, date '2026-11-24', date '2026-11-24', janela_inicio, janela_fim, template_convite, template_followup,
  template_idioma, evento_com_artigo, '25/11',
  (config - 'banco' - 'banco_em') || jsonb_build_object('instrucoes',
   E'- A campanha convida para a última turma de 2026 do Curso de Filosofia para Viver na Nova Acrópole de Catalão: primeira aula em 25/11, às 20h. Matrículas abertas. Vagas limitadas.\n'
   '- Link de inscrição da turma: https://inscricao.acropolebrasil.com.br/?eventoId=24699.\n'
   '- Catalão NÃO tem aula experimental nesta campanha. Nunca ofereça aula experimental. Para quem quiser conhecer a escola antes, ou hesitar, o primeiro passo recomendado é a palestra gratuita "Filosofia e Ciência: duas formas de buscar a verdade?", com o professor João Guilherme, de Goiânia, na própria escola, quarta-feira 18/11, às 19h30. Entrada franca, vagas limitadas, inscrição: https://inscricao.acropolebrasil.com.br/?eventoId=24678.\n'
   '- O curso: ensinamentos de grandes filósofos do Oriente e do Ocidente aplicados à vida cotidiana (autoconhecimento, valores humanos, vida com mais consciência e propósito).\n'
   '- Duração do curso: de 4 a 6 meses, com aulas uma vez por semana, de 2 horas, com intervalo de 20 minutos.\n'
   '- Valor do curso: se perguntarem, informe a mensalidade cadastrada da escola (aparece nos dados da escola como "Mensalidade do Curso de Filosofia para Viver"), copiada exatamente. Se perguntarem outro valor (matrícula, material, desconto), diga que vai ver isso e já passa.\n'
   '- Não diga que o curso é gratuito; só a palestra de 18/11 é gratuita.\n'
   '- Local: a própria escola de Catalão, Rua Maria R. da Costa, nº 56, Setor Santa Cruz, Catalão/GO.\n'
   '- Contato da escola, se a pessoa pedir: WhatsApp (64) 99991-7888.\n'
   '- Nunca fale de eventos de Goiânia (PUC, aulas experimentais de Goiânia).')
from campanhas_whatsapp where slug = 'turma-eldorado-2026'
on conflict (slug) do nothing;

-- Cotas por dia (somam 200): DMF 50, Barra 10, turmas 140.
update campanhas_whatsapp c set cota_diaria = v.cota
from (values ('dmf-2026', 50), ('dmf-barra-2026', 10), ('turma-jardim-america-2026', 50),
             ('turma-universitario-2026', 33), ('turma-setor-oeste-2026', 15), ('turma-goiania-ii-2026', 15),
             ('turma-catalao-2026', 15), ('turma-eldorado-2026', 12)) v(slug, cota)
where c.slug = v.slug;

-- Painel: Catalão no link da coordenação e no link da escola.
update painel_resultados_links set campanhas = array_append(campanhas, 'turma-catalao-2026')
where id in (1, 11) and not ('turma-catalao-2026' = any(campanhas));

insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'campanha_cota_alterada', 'Claude (pedido do usuário)',
        '{"total_dia":200,"dmf-2026":50,"dmf-barra-2026":10,"turma-jardim-america-2026":50,"turma-universitario-2026":33,"turma-setor-oeste-2026":15,"turma-goiania-ii-2026":15,"turma-catalao-2026":15,"turma-eldorado-2026":12}');

select slug, cota_diaria, fim_convites from campanhas_whatsapp where ativa and cota_diaria > 0 order by cota_diaria desc;

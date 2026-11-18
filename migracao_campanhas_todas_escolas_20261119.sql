-- Todas as escolas abertas com convites (pedido do usuário, 18/11/2026), exceto Alto da Glória (fechada).
-- Antes, só Goiânia (aula experimental / turma) e Catalão recebiam convites; Rio Verde, Jataí, Barra,
-- Garavelo e Cidade Jardim estavam com cota 0. O teto de 230/dia continua o mesmo: as cotas fixas abaixo
-- (65/dia) saem da fatia dividida por proximidade entre as aberturas de turma.

update filiais set nome_com_preposicao = 'de Rio Verde' where nome = 'Rio Verde' and nome_com_preposicao is null;
update filiais set nome_com_preposicao = 'de Jataí'     where nome = 'Jataí'     and nome_com_preposicao is null;

-- Rio Verde: abertura de turma de 24/11, entra na divisão por proximidade junto com Goiânia a partir de 20/11
-- (antes disso disputaria o último dia das aulas experimentais de Jardim América e Setor Oeste).
insert into campanhas_whatsapp (slug, nome, filiais, evento_id, evento_com_artigo, evento_data_curta, inicio,
    fim_convites, fim_followup, cota_diaria, janela_inicio, janela_fim, template_convite, template_followup,
    template_idioma, atendente, ativa, config)
select 'turma-rio-verde-2026', 'Nova turma do Curso de Filosofia para Viver - Rio Verde', array['Rio Verde'], 848,
    'a nova turma do Curso de Filosofia para Viver', '24/11', date '2026-11-20', date '2026-11-23', date '2026-11-23',
    0, '08:30', '20:00', 'convite_palestra', 'contato_inicial', 'pt_BR', 'Henrique', true,
    jsonb_build_object(
      'cota_por_proximidade', true,
      'proximidade_desde', '2026-11-20',
      'padrao_grupo_a', '%filosofia para viver%',
      'percentual_maximo_followup', 0.4,
      'link_convite', 'https://inscricao.acropolebrasil.com.br/?eventoId=24836',
      'instrucoes', E'- A campanha convida para a nova turma do Curso de Filosofia para Viver na Nova Acrópole de Rio Verde: início oficial terça-feira 24/11, às 20h. Matrículas abertas. Turma presencial, na própria escola de Rio Verde. Vagas limitadas.\n'
        || E'- Link de inscrição da turma: https://inscricao.acropolebrasil.com.br/?eventoId=24836.\n'
        || E'- O curso: Filosofia à maneira clássica, ensinamentos de grandes filósofos do Oriente e do Ocidente aplicados à vida cotidiana (Índia, Tibete, Buda, China, Egito, Platão, Aristóteles, estoicos, neoplatônicos).\n'
        || E'- Duração do curso: de 4 a 6 meses, com aulas uma vez por semana, de 2 horas, com intervalo de 20 minutos.\n'
        || E'- Valor do curso: se perguntarem, informe a mensalidade cadastrada da escola (aparece nos dados da escola como "Mensalidade do Curso de Filosofia para Viver"), copiada exatamente. Se perguntarem outro valor (matrícula, material, desconto), diga que vai ver isso e já passa.\n'
        || E'- Rio Verde NÃO tem aula experimental nesta campanha. Nunca ofereça aula experimental nem diga que o curso ou a primeira aula são gratuitos.\n'
        || E'- Endereço: não está cadastrado. Se perguntarem, diga que vai confirmar e já passa.\n'
        || E'- Contato da escola, se a pessoa pedir: WhatsApp (64) 99249-6444.\n'
        || E'- Nunca fale de eventos de Goiânia.')
where not exists (select 1 from campanhas_whatsapp where slug = 'turma-rio-verde-2026');

-- Barra do Garças e Jataí: sem turma nem evento futuro cadastrado -> relacionamento (mesmo modelo do Garavelo).
insert into campanhas_whatsapp (slug, nome, filiais, evento_id, evento_com_artigo, evento_data_curta, inicio,
    fim_convites, fim_followup, cota_diaria, janela_inicio, janela_fim, template_convite, template_followup,
    template_idioma, atendente, ativa, config)
select v.slug, v.nome, array[v.filial], null, 'conversar sobre o último evento de que a pessoa participou', null,
    date '2026-11-19', date '2026-11-30', date '2026-11-30', v.cota, '08:30', '20:00', 'contato_ulisses', null,
    'pt_BR', 'Henrique', true,
    (select config - 'banco' - 'banco_em' - 'instrucoes' from campanhas_whatsapp where slug = 'relacionamento-garavelo-2026-11')
      || jsonb_build_object('instrucoes', replace(replace(replace(
           (select config->>'instrucoes' from campanhas_whatsapp where slug = 'relacionamento-garavelo-2026-11'),
           'Nova Acrópole do Garavelo', 'Nova Acrópole ' || v.prep), 'O Garavelo não tem', v.sujeito || ' não tem'), 'do Garavelo', 'da escola'))
from (values
    ('relacionamento-barra-2026-11', 'Relacionamento - Barra do Garças', 'Barra do Garças/MT', 10, 'de Barra do Garças', 'Barra do Garças'),
    ('relacionamento-jatai-2026-11', 'Relacionamento - Jataí', 'Jataí', 10, 'de Jataí', 'Jataí')
) v(slug, nome, filial, cota, prep, sujeito)
where not exists (select 1 from campanhas_whatsapp c where c.slug = v.slug);

-- Garavelo (relacionamento) e Cidade Jardim (palestra 21/11, depois Café com Filosofia 28/11) voltam a convidar.
update campanhas_whatsapp set cota_diaria = 15
 where slug in ('relacionamento-garavelo-2026-11', 'evento-cidade-jardim-cavaleiro-2026', 'evento-cidade-jardim-cafe-2026');

insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'campanhas_todas_escolas', 'Claude (pedido do usuário)',
        jsonb_build_object('fixas', jsonb_build_object('Catalão', 15, 'Cidade Jardim', 15, 'Garavelo', 15,
                           'Barra do Garças', 10, 'Jataí', 10),
                           'proximidade', 'turmas de Goiânia + Rio Verde (desde 20/11)',
                           'fora', 'Alto da Glória (fechada)'));

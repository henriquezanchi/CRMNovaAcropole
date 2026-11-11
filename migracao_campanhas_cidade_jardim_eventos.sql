-- Regra combinada com o usuário (11/11/2026): escola sem abertura de turma convida para os
-- eventos dela publicados no Ulisses. Cidade Jardim não está na "Última turma de 2026":
-- uma campanha por evento, em sequência (palestra 21/11, depois Café com Filosofia 28/11).
-- Para manter o total em 200/dia, Jardim América cede 10 (50 -> 40).
-- Garavelo não tem evento futuro no Ulisses: fica sem campanha até cadastrar algum.

insert into campanhas_whatsapp (slug, nome, evento_id, filiais, atendente, ativa, cota_diaria, inicio, fim_convites,
  fim_followup, janela_inicio, janela_fim, template_convite, template_followup, template_idioma,
  evento_com_artigo, evento_data_curta, config)
select v.slug, v.nome, v.evento, array['Goiânia - Cidade Jardim'], c.atendente, true, 15, v.inicio, v.fim, v.fim,
  c.janela_inicio, c.janela_fim, c.template_convite, c.template_followup, c.template_idioma, v.artigo, v.dia,
  jsonb_build_object('percentual_maximo_followup', 0.4, 'padrao_grupo_a', v.grupo_a,
    'padrao_inscrito', v.inscrito, 'padrao_inscrito_data', v.inscrito_data, 'link_convite', v.link, 'instrucoes', v.instrucoes)
from campanhas_whatsapp c,
(values
  ('evento-cidade-jardim-cavaleiro-2026', 'Palestra Código de um Cavaleiro - Cidade Jardim', 799, current_date, date '2026-11-20',
   'a palestra "Código de um Cavaleiro"', '21/11', '%palestra%', '%cavaleiro%', '%21/11/2026%',
   'https://inscricao.acropolebrasil.com.br/?eventoId=24763',
   E'- A campanha convida para a Palestra Cultural "Código de um Cavaleiro", na Nova Acrópole Cidade Jardim, sábado 21/11, às 18h. Entrada franca (gratuita). Vagas limitadas: é importante se inscrever pelo link.\n'
   '- Tema: inspirada no livro "O Código de um Cavaleiro", de Ethan Hawke, uma reflexão sobre humildade, honestidade, coragem, compaixão e lealdade aplicadas aos desafios do dia a dia.\n'
   '- Inscrição: https://inscricao.acropolebrasil.com.br/?eventoId=24763.\n'
   '- Local: Rua Onze de Janeiro, nº 123, Quadra 96, Lote 03, Vila Aurora Oeste, Goiânia/GO. Localização: https://maps.app.goo.gl/Mtmn7UJanq5YMxDc9.\n'
   '- Contato da escola, se a pessoa pedir: WhatsApp (62) 99328-5358.\n'
   '- A Cidade Jardim não tem abertura de turma nem aula experimental agora. Nunca ofereça turma nova ou aula experimental desta escola.'),
  ('evento-cidade-jardim-cafe-2026', 'Café com Filosofia (Estoicismo) - Cidade Jardim', 802, date '2026-11-21', date '2026-11-27',
   'o Café com Filosofia sobre Estoicismo', '28/11', '%caf%filosofia%', '%estoicismo%', '%28/11/2026%',
   'https://inscricao.acropolebrasil.com.br/?eventoId=24766',
   E'- A campanha convida para o "Café com Filosofia | Estoicismo: chaves para viver e conviver melhor", na Nova Acrópole Cidade Jardim, sábado 28/11, às 17h.\n'
   '- Tema: como desenvolver mais serenidade diante dos desafios, cultivar o autodomínio, a sabedoria e relações mais harmoniosas, com os ensinamentos do estoicismo. Encontro de conversa e confraternização.\n'
   '- O evento é pago e o ingresso inclui quitandas, sucos, café e chá. Não diga o valor nem que é gratuito; se perguntarem o valor, diga que vai ver e já passa.\n'
   '- Vagas bem limitadas (cerca de 50 lugares): é importante se inscrever pelo link: https://inscricao.acropolebrasil.com.br/?eventoId=24766.\n'
   '- Local: Rua Onze de Janeiro, nº 123, Quadra 96, Lote 03, Vila Aurora Oeste, Goiânia/GO. Localização: https://maps.app.goo.gl/Mtmn7UJanq5YMxDc9.\n'
   '- Contato da escola, se a pessoa pedir: WhatsApp (62) 99328-5358.\n'
   '- A Cidade Jardim não tem abertura de turma nem aula experimental agora. Nunca ofereça turma nova ou aula experimental desta escola.')
) v(slug, nome, evento, inicio, fim, artigo, dia, grupo_a, inscrito, inscrito_data, link, instrucoes)
where c.slug = 'turma-eldorado-2026'
on conflict (slug) do nothing;

update campanhas_whatsapp set cota_diaria = 40 where slug = 'turma-jardim-america-2026';

update painel_resultados_links set campanhas = campanhas || array['evento-cidade-jardim-cavaleiro-2026', 'evento-cidade-jardim-cafe-2026']
where id in (1, 7) and not ('evento-cidade-jardim-cavaleiro-2026' = any(campanhas));

insert into log_atividade (filial, acao, autor, detalhes)
values ('Goiânia - Cidade Jardim', 'campanha_criada', 'Claude (pedido do usuário)',
        '{"regra":"escola sem abertura de turma convida para os eventos do Ulisses","campanhas":["evento-cidade-jardim-cavaleiro-2026","evento-cidade-jardim-cafe-2026"],"cota":15,"turma-jardim-america-2026":"50->40"}');

select slug, cota_diaria, inicio, fim_convites from campanhas_whatsapp where ativa and cota_diaria > 0 and fim_convites >= current_date order by inicio, cota_diaria desc;

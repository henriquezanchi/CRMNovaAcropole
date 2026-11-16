-- Pós-evento do Dia Mundial da Filosofia - Goiânia (16/11/2026, pedido do usuário).
-- Mensagem para quem se inscreveu no DMF (Ulisses 24664, 14/11) e não foi marcado como presente
-- na recepção, perguntando o que achou. Quem disser que foi tem a presença marcada no Ulisses e
-- no painel (campanha-responder, config.pos_evento). Modelo aprovado: contato_ulisses_saida
-- ("Vi que você participou {{4}} {{5}} recentemente. E aí, o que achou?" + "responda SAIR").
--
-- Público: inscritos não marcados como presentes, sem alunos ativos, com cadastro e telefone,
-- sem "Não Contatar"/"WhatsApp não entrega" e sem conversa pelo WhatsApp desde o evento.
-- A fila é montada aqui (cota_diaria = 0: o agendador não acrescenta ninguém).

insert into campanhas_whatsapp (slug, nome, evento_id, filiais, atendente, ativa, cota_diaria, inicio, fim_convites,
  fim_followup, janela_inicio, janela_fim, template_convite, template_followup, template_idioma,
  evento_com_artigo, evento_data_curta, config)
select 'dmf-2026-pos', 'Pós-evento: Dia Mundial da Filosofia - Goiânia', 764, c.filiais, 'o Henrique', true, 0,
  current_date, current_date, current_date, c.janela_inicio, c.janela_fim, 'contato_ulisses_saida', null, 'pt_BR',
  c.evento_com_artigo, c.evento_data_curta,
  jsonb_build_object(
    'pos_evento', true,
    'evento_de', 'do',
    'evento_nome', 'Dia Mundial da Filosofia',
    'conversa_desde', '2026-11-14T18:00:00Z',
    'percentual_maximo_followup', 0,
    'corpos', jsonb_build_object('contato_ulisses_saida',
      E'Oi, {{1}}! Aqui é {{2}}, da Nova Acrópole {{3}}, tudo bem?\n\nVi que você participou {{4}} {{5}} recentemente.\n\nE aí, o que achou?'),
    'instrucoes', E'- O Dia Mundial da Filosofia de Goiânia foi no sábado, 14/11, às 16h, no auditório da PUC Goiás (Área I). Já aconteceu.\n'
      '- Esta conversa é com quem se inscreveu e não foi marcado como presente na recepção. Pode ter ido sem passar pela recepção, ou não ter conseguido ir.\n'
      '- Objetivo: saber se a pessoa foi e o que achou, e, se fizer sentido, convidar com leveza para a aula experimental gratuita do Curso de Filosofia para Viver na escola de origem dela.')
from campanhas_whatsapp c where c.slug = 'dmf-2026'
on conflict (slug) do nothing;

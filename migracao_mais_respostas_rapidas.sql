-- Pedido do usuário (2026-10-01): "crie mais opções de respostas rápidas
-- (adequadas aos exemplos de conversas que temos disponíveis), e coloque
-- o link do maps na resposta rápida sobre o endereço, conforme cada
-- filial". Textos baseados em padrões REAIS de resposta já usados pelo
-- time (mesma varredura de mensagens_whatsapp que alimentou
-- exemplos_resposta_ia) — não inventados do zero.
--
-- Cada INSERT é guardado por `where not exists (... atalho = 'X')`
-- individualmente (diferente do seed original, que só guardava a tabela
-- inteira) — permite rodar de novo sem duplicar, e sem depender da
-- tabela estar vazia.
insert into respostas_rapidas_whatsapp (atalho, texto, ordem)
select 'Endereço (com mapa)', 'Claro! Ficamos {endereco}. Aqui está a localização no mapa: {link_maps}', 10
where not exists (select 1 from respostas_rapidas_whatsapp where atalho = 'Endereço (com mapa)');

insert into respostas_rapidas_whatsapp (atalho, texto, ordem)
select 'Aula é gratuita', 'A aula experimental em si é gratuita! Caso decida se inscrever e seguir no curso depois, a contribuição mensal é R$ {valor_mensalidade}.', 11
where not exists (select 1 from respostas_rapidas_whatsapp where atalho = 'Aula é gratuita');

insert into respostas_rapidas_whatsapp (atalho, texto, ordem)
select 'Não pode hoje', 'Ah, que pena! Teremos uma outra oportunidade em breve — consegue me confirmar quando seria melhor pra você, que eu já aviso com antecedência?', 12
where not exists (select 1 from respostas_rapidas_whatsapp where atalho = 'Não pode hoje');

insert into respostas_rapidas_whatsapp (atalho, texto, ordem)
select 'Sem tempo agora', 'Ah, compreendo! Que pena 😢 Podemos voltar a entrar em contato em outra oportunidade, tudo bem?', 13
where not exists (select 1 from respostas_rapidas_whatsapp where atalho = 'Sem tempo agora');

insert into respostas_rapidas_whatsapp (atalho, texto, ordem)
select 'Ex-aluno, convite pra voltar', 'Que bom ter você de volta! Ficamos à disposição caso queira nos fazer uma visita, sem compromisso nenhum.', 14
where not exists (select 1 from respostas_rapidas_whatsapp where atalho = 'Ex-aluno, convite pra voltar');

insert into respostas_rapidas_whatsapp (atalho, texto, ordem)
select 'Pedido de remoção (LGPD)', 'Perdão, peço desculpas pelo incômodo! Vou te remover da nossa lista agora mesmo, obrigado por avisar.', 15
where not exists (select 1 from respostas_rapidas_whatsapp where atalho = 'Pedido de remoção (LGPD)');

insert into respostas_rapidas_whatsapp (atalho, texto, ordem)
select 'Confirmar presença', 'Perfeito, {nome}! Fica confirmada sua presença. Qualquer dúvida até lá, é só chamar!', 16
where not exists (select 1 from respostas_rapidas_whatsapp where atalho = 'Confirmar presença');

insert into respostas_rapidas_whatsapp (atalho, texto, ordem)
select 'Pedir indicação', 'Já que você gostou, conhece mais alguém que também possa se interessar? Fico feliz em receber indicações! 😊', 17
where not exists (select 1 from respostas_rapidas_whatsapp where atalho = 'Pedir indicação');

insert into respostas_rapidas_whatsapp (atalho, texto, ordem)
select 'Boas-vindas/apresentação', 'Oi, {nome}! Aqui quem fala é {atendente}, {filial}. Tudo bem? Fico à disposição pra qualquer dúvida sobre nossos cursos e eventos 😊', 18
where not exists (select 1 from respostas_rapidas_whatsapp where atalho = 'Boas-vindas/apresentação');

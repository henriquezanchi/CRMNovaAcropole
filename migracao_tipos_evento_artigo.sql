-- Migração: coluna artigo em tipos_evento
--
-- Pedido do usuário (2026-10-05): ao convidar via API (templates
-- aprovados) um lote de leads pra um evento, o template "Convite para
-- evento" (e outros) tem um campo manual tipo "evento (com artigo, ex: a
-- Abertura de Turma)" — hoje precisa digitar isso à mão toda vez, mesmo
-- já tendo escolhido o evento no <select> da tela. O usuário quer que
-- isso preencha sozinho a partir do evento escolhido.
--
-- O nome do evento sozinho não basta — o template já tem a preposição
-- fixa ("para {{4}}"), então {{4}} precisa vir com o ARTIGO certo em
-- português ("a Abertura de Turma"/"o Workshop de Oratória") — e isso
-- depende do TIPO do evento, não dá pra adivinhar por regra genérica sem
-- arriscar gênero errado. Mesmo princípio de sempre (trilha/palavras_chave
-- em tipos_evento, "Gerenciar Tipos" na Agenda): guarda no catálogo
-- existente, editável sem sessão de código nova.
alter table tipos_evento add column if not exists artigo text check (artigo in ('a', 'o'));

-- Seed dos tipos padrão já conhecidos (nomes vindos de TIPOS_EVENTO em
-- js/eventos.js) — só preenche quem já não tiver um artigo definido, pra
-- nunca sobrescrever uma edição manual feita antes desta migração rodar.
update tipos_evento set artigo = 'a' where artigo is null and nome in ('Palestra', 'Oficina', 'Aula Inaugural', 'Aula Experimental', 'Leitura Comentada', 'Abertura de Turma');
update tipos_evento set artigo = 'o' where artigo is null and nome in ('Workshop', 'Curso', 'Filosofilme', 'Café Cultural');
-- Seed extra (2026-10-05) pros nomes REAIS já cadastrados nesta conta,
-- diferentes da lista padrão embutida em TIPOS_EVENTO (js/eventos.js) —
-- descobertos consultando a tabela direto, não chutados.
update tipos_evento set artigo = 'o' where artigo is null and nome in ('Workshop/Oficina', '(Mini) Curso', 'Sábado de Voluntariado');
-- "Outro" fica sem artigo (null) de propósito — não dá pra adivinhar
-- gênero de um tipo genérico; o campo manual simplesmente fica em branco
-- pra esses casos, editável à mão como já era antes desta migração.

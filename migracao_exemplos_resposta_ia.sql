-- Pedido do usuário (2026-10-01): "me ajude a treinar a IA. Veja as
-- respostas que recebemos (todas, desde o início) e as respostas que dei
-- lá. Vamos aprender a responder com o endereço, com os valores, e
-- quebrar as objeções dos leads".
--
-- Em vez de "treinar" um modelo (não é esse tipo de IA — é um modelo já
-- pronto, chamado por prompt), o jeito real de ensinar o TOM/estilo é
-- few-shot: mostrar pro prompt exemplos REAIS de perguntas de lead +
-- como o time já respondeu bem, extraídos do histórico de verdade de
-- `mensagens_whatsapp` (não inventados). Curado nesta sessão a partir de
-- uma varredura de TODAS as conversas desde o início do projeto.
--
-- Tabela editável (mesmo padrão de `respostas_rapidas_whatsapp`/
-- `tags_sugeridas`) — `ativo=false` desliga um exemplo sem apagar.
create table if not exists exemplos_resposta_ia (
    id bigint generated always as identity primary key,
    categoria text not null check (categoria in ('endereco', 'valor', 'objecao', 'geral')),
    mensagem_lead text not null,
    resposta_time text not null,
    ativo boolean not null default true,
    criado_em timestamptz not null default now()
);

alter table exemplos_resposta_ia enable row level security;
drop policy if exists "acesso publico exemplos_resposta_ia" on exemplos_resposta_ia;
create policy "acesso publico exemplos_resposta_ia" on exemplos_resposta_ia for all using (true) with check (true);

-- Seed: extraído de verdade da conversa real do WhatsApp (2026-10-01) —
-- não inventado. Valores/endereço aqui são só REFERÊNCIA DE TOM pro
-- prompt (os dados reais de CADA conversa já vêm de `filiais`/`eventos`
-- via contextoCRM, nunca destes exemplos — por isso os exemplos não
-- precisam bater exatamente com a filial de quem está sendo respondido
-- agora).
insert into exemplos_resposta_ia (categoria, mensagem_lead, resposta_time) values
('endereco', 'Qual endereço?', 'Claro! Estamos na [rua/avenida da filial], fica fácil de achar! Tem alguma dúvida sobre a localização?'),
('endereco', 'Ainda existe no mesmo lugar ou mudou de endereço?', 'Bom dia! Estamos atualmente em [endereço atual da filial].'),
('valor', 'Qual valor?', 'A aula experimental em si é gratuita! Caso decida se inscrever e seguir no curso depois, a contribuição mensal é a que está cadastrada aqui da filial.'),
('valor', 'E os valores?', 'A contribuição mensal é [valor da filial]. Não deixe de participar da nossa aula experimental pra conhecer melhor antes de decidir!'),
('objecao', 'Bom dia, obrigada pelo contato, mas no momento não posso estar fazendo o curso.', 'Que pena! De toda forma, ficamos à disposição para quando o momento for mais oportuno 😢'),
('objecao', 'Muito obrigada, mas no momento não consigo participar, estou sem tempo.', 'Ah, compreendo! Que pena 😢 Podemos voltar a entrar em contato em outra oportunidade?'),
('objecao', 'Frequentei por um período mas no momento não consigo.', 'Ah, que pena! De qualquer forma, ficamos à disposição caso possa nos fazer uma visita, sem compromisso. Temos sempre palestras e mini cursos que podem te interessar.'),
('objecao', 'Sim, só que hoje não dá.', 'Ah, que pena! Teremos uma outra oportunidade em breve — é possível pra você nessa data?'),
('objecao', 'Peço, gentilmente, que exclua meu telefone da lista de mensagens de vocês. Não tenho interesse.', 'Perdão, peço desculpas pelo incômodo. Vou excluir sim, obrigado por avisar.')
on conflict do nothing;

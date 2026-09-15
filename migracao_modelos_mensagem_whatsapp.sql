-- Modelos de mensagem de WhatsApp (convite/divulgação), editáveis pelo
-- próprio CRM ("Gerenciar Mensagens") em vez de ficarem hardcoded no
-- código (CONVITE_EVENTO_NAO_ALUNO/CONVITE_EVENTO_ATIVO, js/whatsapp.js)
-- — pedido do usuário (2026-09-15): "eu quero poder editar as mensagens
-- base, para não ter que editar de um por um". Mesmo padrão de acesso
-- público de tags_sugeridas/tipos_evento (RLS using(true) with
-- check(true)) — compartilhado entre navegadores/time.
create table if not exists modelos_mensagem_whatsapp (
    id bigint generated always as identity primary key,
    nome text not null,
    texto text not null,
    ordem integer not null default 0,
    criado_em timestamptz not null default now()
);

alter table modelos_mensagem_whatsapp enable row level security;

drop policy if exists "acesso publico total" on modelos_mensagem_whatsapp;
create policy "acesso publico total" on modelos_mensagem_whatsapp
    for all using (true) with check (true);

-- Seed: os 2 textos que já existiam hardcoded (pra não perder o que já
-- estava configurado) + 1 novo, pensado especificamente pro pedido de
-- "mensagem pronta com o link de inscrição" (usa {linkInscricao}, que só
-- vem preenchido se o evento tiver esse campo preenchido na Agenda —
-- ver migracao_link_inscricao_evento.sql).
insert into modelos_mensagem_whatsapp (nome, texto, ordem)
select * from (values
    ('Abertura de Turma - Interessados', $tpl$Olá, {nome}!

Aqui é {atendente}, da Nova Acrópole {filial}, tudo bem?

Abrimos novas turmas de {evento}{quando}! Você demonstrou interesse antes, e eu queria muito contar com você nessa turma.

Pra garantir sua vaga, é só se inscrever por aqui: {linkInscricao}

Qualquer dúvida, me chama!$tpl$, 0),
    ('Convite Geral (Não-Aluno)', $tpl$Olá, {nome}!

Aqui é {atendente}, da Nova Acrópole {filial}, tudo bem?

Vai rolar {evento}{quando} e eu queria muito te convidar pra vir!{interesses}

Posso te passar mais detalhes?$tpl$, 1),
    ('Divulgação (Aluno Ativo)', $tpl$Olá, {nome}!

Aqui é {atendente}, da Nova Acrópole {filial}, tudo bem?

Vai rolar {evento}{quando}, e você é muito importante nesse momento! Você pode: 1) encaminhar esse convite pra quem você acha que ia gostar de conhecer; 2) me passar o telefone de alguém que valeria a pena a gente chamar pessoalmente; ou 3) topar ser voluntário(a) no dia, ajudando a receber o pessoal.

Me conta o que topa fazer?$tpl$, 2)
) as novos(nome, texto, ordem)
where not exists (select 1 from modelos_mensagem_whatsapp);

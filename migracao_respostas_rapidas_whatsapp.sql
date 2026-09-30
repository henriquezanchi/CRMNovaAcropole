-- Respostas rápidas prontas (canned responses) — pedido do usuário
-- (2026-09-30): frases de FAQ (endereço, valor, horário) pra colar com 1
-- clique dentro da janela de 24h, sem precisar de template aprovado pela
-- Meta (que é lento pra editar). Mesmo padrão de acesso público de
-- `tags_sugeridas`/`modelos_mensagem_whatsapp` — catálogo compartilhado,
-- editável pelo time, não por lead.
--
-- Suporta os MESMOS placeholders já usados em outros textos do app
-- ({nome}/{atendente}/{filial}) — resolvidos na hora de inserir no chat,
-- não gravados resolvidos no catálogo.
--
-- Rodar manualmente: npx supabase db query --linked --file migracao_respostas_rapidas_whatsapp.sql
create table if not exists respostas_rapidas_whatsapp (
    id bigint generated always as identity primary key,
    atalho text not null, -- nome curto mostrado na lista (ex: "Endereço")
    texto text not null,
    ordem int not null default 0,
    criado_em timestamptz not null default now()
);

alter table respostas_rapidas_whatsapp enable row level security;
drop policy if exists "acesso publico respostas_rapidas_whatsapp" on respostas_rapidas_whatsapp;
create policy "acesso publico respostas_rapidas_whatsapp"
    on respostas_rapidas_whatsapp for all
    using (true)
    with check (true);

insert into respostas_rapidas_whatsapp (atalho, texto, ordem)
select * from (values
    ('Endereço', 'Claro! Ficamos {endereco}. Posso te passar a localização exata pelo Maps se quiser 😊', 0),
    ('Valor', 'O valor da mensalidade é R$ {valor_mensalidade} — mas o ideal é vir conhecer a escola antes, sem compromisso!', 1),
    ('Horário', 'As aulas costumam ser semanais, à noite. Me conta melhor o que te interessou que eu já te passo o dia certo da turma 🙂', 2)
) as seed(atalho, texto, ordem)
where not exists (select 1 from respostas_rapidas_whatsapp);

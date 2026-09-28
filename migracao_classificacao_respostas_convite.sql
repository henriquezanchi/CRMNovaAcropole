-- Pedido do usuário (2026-09-28, reunião com a Ediliene, Jardim
-- América): "tratar as respostas dessas pessoas de maneira muito
-- inteligente e muito dinâmica, de forma a reagrupar conforme a
-- resposta, e disparar mensagens específicas para cada grupo de
-- respostas". Mesmo princípio já seguido em `ia-diagnostico-saude`/
-- `ia-recomendar-contatos`/`classificar-temas`: a IA NUNCA decide livre
-- — só escolhe entre um conjunto FIXO e pequeno de categorias
-- (`categoria`, ver check abaixo) e escreve o texto de acompanhamento; a
-- DETECÇÃO de quem tem resposta pendente pra classificar é 100% regra
-- fixa em SQL, dentro da Edge Function `classificar-resposta-convite`,
-- nunca a IA.
--
-- Decisão confirmada com o usuário: quando uma resposta é classificada,
-- o CRM prepara a tag certa E o texto de acompanhamento, mas só ENVIA
-- quando o SDR clicar "Enviar" (painel "Respostas de Convite pra
-- Revisar", Agenda do Dia) — por isso existe `status`, não é
-- "classificou e já mandou sozinho".
create table if not exists classificacoes_resposta_convite (
    id bigserial primary key,
    "pessoaIdentificador" text not null,
    evento_id bigint references eventos(id) on delete set null,
    mensagem_origem_id bigint references mensagens_whatsapp(id) on delete set null,
    categoria text not null check (categoria in ('confirmou', 'nao_pode_ir', 'pediu_informacao', 'sem_interesse', 'ambiguo')),
    sugestao_resposta text,
    status text not null default 'pendente' check (status in ('pendente', 'enviada', 'descartada')),
    criado_em timestamptz not null default now(),
    unique (mensagem_origem_id)
);

create index if not exists idx_classificacoes_resposta_status on classificacoes_resposta_convite (status);
create index if not exists idx_classificacoes_resposta_pessoa on classificacoes_resposta_convite ("pessoaIdentificador");

alter table classificacoes_resposta_convite enable row level security;
drop policy if exists "acesso publico classificacoes_resposta_convite" on classificacoes_resposta_convite;
create policy "acesso publico classificacoes_resposta_convite" on classificacoes_resposta_convite for all using (true) with check (true);

-- RPC usada pela Edge Function `classificar-resposta-convite` (chamada
-- por pg_cron) pra achar mensagens candidatas — junta mensagem de
-- ENTRADA recente + convite ainda `pendente` pra um evento ainda não
-- muito passado + ainda sem classificação. `distinct on` pega só 1
-- evento por mensagem (o mais próximo no tempo, se o lead tiver mais de
-- um convite pendente ao mesmo tempo — caso raro, mas evita duplicar a
-- mesma mensagem em 2 linhas candidatas).
create or replace function mensagens_candidatas_classificacao_convite(p_limite int default 30)
returns table (
    mensagem_id bigint,
    "pessoaIdentificador" text,
    corpo_texto text,
    evento_id bigint,
    evento_nome text,
    evento_data date
)
language sql
stable
as $$
    select distinct on (m.id)
        m.id as mensagem_id,
        m."pessoaIdentificador",
        m.corpo_texto,
        el.evento_id,
        ev.nome as evento_nome,
        ev.data as evento_data
    from mensagens_whatsapp m
    join evento_leads el on el."pessoaIdentificador" = m."pessoaIdentificador" and el.resposta_convite = 'pendente'
    join eventos ev on ev.id = el.evento_id
    left join classificacoes_resposta_convite c on c.mensagem_origem_id = m.id
    where m.direcao = 'entrada'
      and m."pessoaIdentificador" is not null
      and m.criado_em > now() - interval '3 hours'
      and c.id is null
      and ev.data >= (current_date - 3)
    order by m.id, ev.data desc
    limit p_limite;
$$;

grant execute on function mensagens_candidatas_classificacao_convite(int) to service_role;

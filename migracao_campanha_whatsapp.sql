-- Campanhas de convite por WhatsApp com fila automática (04/11/2026, pedido do
-- usuário): primeiro uso é o Dia Mundial da Filosofia 2026 (DMF), só para as
-- escolas de Goiânia e Aparecida de Goiânia, 250 convites por dia com o
-- modelo aprovado, espaçados até 20h, robô respondendo quem responder e uma
-- segunda tentativa para quem não respondeu em 24h.
--
-- Ordem de quem convidar (definida com o usuário em 30/10/2026): quem nunca
-- foi aluno vem antes; entre eles, A) já foi a um Dia Mundial da Filosofia,
-- B) último evento em 2026, C) em 2025, D) 2023-2024, E) antes disso ou sem
-- evento. Ex-alunos (X) só entram depois de todos os outros.

create table if not exists campanhas_whatsapp (
    id bigserial primary key,
    slug text unique not null,
    nome text not null,
    evento_id bigint references eventos(id),
    filiais text[] not null,
    template_convite text not null,
    template_followup text,
    template_idioma text not null default 'pt_BR',
    atendente text not null default 'Henrique',
    evento_com_artigo text,
    evento_data_curta text,
    cota_diaria int not null default 250,
    janela_inicio time not null default '08:30',
    janela_fim time not null default '20:00',
    inicio date not null,
    fim_convites date not null,
    fim_followup date not null,
    ativa boolean not null default true,
    config jsonb not null default '{}'::jsonb,
    criado_em timestamptz not null default now()
);

create table if not exists campanha_fila (
    id bigserial primary key,
    campanha_id bigint not null references campanhas_whatsapp(id) on delete cascade,
    "pessoaIdentificador" text not null,
    filial text,
    telefone_chave text,
    grupo text,
    prioridade numeric,
    tipo text not null default 'convite' check (tipo in ('convite', 'followup')),
    agendado_para timestamptz,
    status text not null default 'pendente' check (status in ('pendente', 'enviando', 'enviado', 'falhou', 'pulado', 'cancelado')),
    motivo text,
    enviado_em timestamptz,
    wa_message_id text,
    criado_em timestamptz not null default now(),
    unique (campanha_id, "pessoaIdentificador", tipo)
);
create index if not exists campanha_fila_agenda on campanha_fila (status, agendado_para);
create index if not exists campanha_fila_pessoa on campanha_fila ("pessoaIdentificador");
create index if not exists campanha_fila_telefone on campanha_fila (campanha_id, telefone_chave);

-- Uma linha por mensagem recebida que o robô assumiu (a chave primária impede
-- responder duas vezes a mesma mensagem, mesmo com webhook e cron juntos).
create table if not exists campanha_respostas_bot (
    mensagem_id bigint primary key,
    "pessoaIdentificador" text not null,
    campanha_id bigint references campanhas_whatsapp(id) on delete cascade,
    status text not null default 'processando',
    resposta text,
    decisao jsonb,
    criado_em timestamptz not null default now(),
    respondido_em timestamptz
);
create index if not exists campanha_respostas_bot_pessoa on campanha_respostas_bot ("pessoaIdentificador");

-- Links do painel de acompanhamento (mesmo modelo do painel das escolas: só o
-- hash da chave fica no banco, a chave vai no fragmento do link).
create table if not exists campanha_links_painel (
    id bigserial primary key,
    campanha_id bigint not null references campanhas_whatsapp(id) on delete cascade,
    chave_hash text unique not null,
    rotulo text,
    expira_em timestamptz not null,
    revogado_em timestamptz,
    criado_em timestamptz not null default now()
);

alter table campanhas_whatsapp enable row level security;
alter table campanha_fila enable row level security;
alter table campanha_respostas_bot enable row level security;
alter table campanha_links_painel enable row level security;
-- O CRM lê para mostrar a campanha; escrita só pelas Edge Functions (service_role).
drop policy if exists campanhas_whatsapp_leitura on campanhas_whatsapp;
create policy campanhas_whatsapp_leitura on campanhas_whatsapp for select using (true);
drop policy if exists campanha_fila_leitura on campanha_fila;
create policy campanha_fila_leitura on campanha_fila for select using (true);
drop policy if exists campanha_respostas_bot_leitura on campanha_respostas_bot;
create policy campanha_respostas_bot_leitura on campanha_respostas_bot for select using (true);
-- campanha_links_painel: sem policy nenhuma (só service_role).

create or replace function campanha_tags(p jsonb) returns text[]
language plpgsql immutable as $$
declare j jsonb := p;
begin
    if j is null then return '{}'; end if;
    if jsonb_typeof(j) = 'string' then
        begin j := (j #>> '{}')::jsonb; exception when others then return '{}'; end;
    end if;
    if jsonb_typeof(j) <> 'array' then return '{}'; end if;
    return array(select trim(x) from jsonb_array_elements_text(j) x);
end $$;

-- Chave de telefone para não convidar a mesma pessoa duas vezes (mesmo número
-- em cadastros de escolas diferentes). DDD + últimos 8 dígitos; nulo quando o
-- número não serve para WhatsApp (fixo de 8 dígitos começando com 2-5).
create or replace function campanha_telefone_chave(p_ddd text, p_num text) returns text
language sql immutable as $$
    select case
        when length(d) = 2 and length(n) = 9 and left(n, 1) = '9' then d || right(n, 8)
        when length(d) = 2 and length(n) = 8 and left(n, 1) between '6' and '9' then d || n
        else null end
    from (select regexp_replace(coalesce(p_ddd, ''), '\D', '', 'g') d,
                 regexp_replace(coalesce(p_num, ''), '\D', '', 'g') n) x
$$;

create or replace function campanha_candidatos(p_campanha bigint, p_limite int)
returns table (pessoa text, filial text, telefone_chave text, grupo text, prioridade numeric)
language sql stable as $$
with c as (select * from campanhas_whatsapp where id = p_campanha),
evento as (select e.id, e.nome, e.data from eventos e join c on c.evento_id = e.id),
base as (
    select l."pessoaIdentificador" pid, l.filial, campanha_tags(l.tags) tags, l.historico_eventos h,
           coalesce(l.acompanhamento, '{}'::jsonb) a, l.data_matricula, l.matricula_mercurio,
           campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero") tel
    from leads_inscricoes l, c
    where l.filial = any(c.filiais) and l.lixeira_em is null
      and coalesce(l."pessoaNome", '') !~* '^\s*teste'
),
com_eventos as (
    select b.*,
        (select max(to_date(left(e->>'data', 10), 'DD/MM/YYYY'))
           from jsonb_array_elements(case when jsonb_typeof(b.h) = 'array' then b.h else '[]' end) e
          where e->>'data' ~ '^\d{2}/\d{2}/\d{4}') ultimo_evento,
        exists (select 1 from jsonb_array_elements(case when jsonb_typeof(b.h) = 'array' then b.h else '[]' end) e
                 where e->>'evento' ilike '%mundial da filosofia%'
                   and coalesce(e->>'data', '') not like '%/2026%') ja_foi_dmf,
        exists (select 1 from jsonb_array_elements(case when jsonb_typeof(b.h) = 'array' then b.h else '[]' end) e
                 where e->>'evento' ilike '%mundial da filosofia%' and e->>'data' like '%/11/2026%') inscrito_dmf
    from base b
),
-- Telefones que não podem receber: aluno ativo, pedido de não contato,
-- inscrito no evento, já está na campanha, conversa nos últimos 7 dias.
bloqueados as (
    select tel from com_eventos
    where tel is not null and (
        inscrito_dmf
        or 'Não Contatar' = any(tags) or 'Contato em conferência' = any(tags)
        or exists (select 1 from unnest(tags) t where t like 'Ativo: %' or t in ('Ativo', 'Aluno Ativo'))
        or a->>'contato' = 'nao_contatar' or a->>'relacao' = 'ativo'
    )
    union
    select f.telefone_chave from campanha_fila f join c on f.campanha_id = c.id where f.telefone_chave is not null and f.status <> 'cancelado'
    union
    select campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero")
    from evento_leads el join evento ev on ev.id = el.evento_id join leads_inscricoes l on l."pessoaIdentificador" = el."pessoaIdentificador"
    where el.origem = 'ulisses'
),
aptos as (
    select ce.*,
        case
            when exists (select 1 from unnest(ce.tags) t where t = 'Inativo' or t like 'Saída%' or t = 'Ex-Aluno (Inativo)')
                 or ce.data_matricula is not null or ce.matricula_mercurio is not null then 'X'
            when ce.ja_foi_dmf then 'A'
            when ce.ultimo_evento >= date '2026-01-01' then 'B'
            when ce.ultimo_evento >= date '2025-01-01' then 'C'
            when ce.ultimo_evento >= date '2023-01-01' then 'D'
            else 'E'
        end grupo
    from com_eventos ce
    where ce.tel is not null
      and ce.tel not in (select tel from bloqueados where tel is not null)
      and not exists (select 1 from unnest(ce.tags) t where t in (
            'Telefone Inválido', 'Conversa: Mudou de Cidade', 'Conversa: Sem Interesse', 'Convite: Sem Interesse',
            'Conversa: Já é Aluno', 'Contato Recente: 7 dias'))
      and coalesce(ce.a->>'intencao', '') not in ('nao', 'depois')
      and coalesce(ce.a->>'inscricao', '') not in ('solicitada', 'dados_pendentes', 'aguardando_registro')
      and (ce.a->>'proxima_em' is null)
      -- o envio de campanha exige inscrição no Ulisses ou contato permitido (whatsapp-send)
      and (jsonb_typeof(ce.h) = 'array' and jsonb_array_length(ce.h) > 0 or ce.a->>'contato' = 'permitido')
      and not exists (select 1 from mensagens_whatsapp m where m."pessoaIdentificador" = ce.pid and m.criado_em > now() - interval '7 days')
),
um_por_telefone as (
    select distinct on (tel) *
    from aptos
    order by tel, grupo, ultimo_evento desc nulls last, pid
)
select pid, filial, tel, grupo,
       (case grupo when 'A' then 6 when 'B' then 5 when 'C' then 4 when 'D' then 3 when 'E' then 2 else 1 end) * 100000
         + coalesce(ultimo_evento - date '2000-01-01', 0)
         -- Peso por proximidade da escola de origem ao local do evento (config.peso_filial).
         + coalesce(((select config from c)->'peso_filial'->>filial)::numeric, 0) prioridade
from um_por_telefone
order by prioridade desc, pid
limit p_limite
$$;

-- Conversas de leads convidados pela campanha cuja última mensagem é do lead e
-- ainda não foi assumida pelo robô (rede de segurança do disparo imediato pelo
-- webhook). Envio nosso que falhou não conta como resposta.
create or replace function campanha_conversas_aguardando(p_espera_segundos int, p_limite int)
returns table (pessoa text, mensagem_id bigint, campanha_id bigint, recebida_em timestamptz)
language sql stable as $$
with leads as (
    select distinct on (f."pessoaIdentificador") f."pessoaIdentificador" pid, f.campanha_id
    from campanha_fila f join campanhas_whatsapp c on c.id = f.campanha_id
    where c.ativa and f.status = 'enviado'
    order by f."pessoaIdentificador", f.enviado_em desc
),
ultima as (
    select l.pid, l.campanha_id, m.id, m.direcao, m.criado_em
    from leads l
    cross join lateral (
        select id, direcao, criado_em from mensagens_whatsapp m
        where m."pessoaIdentificador" = l.pid and coalesce(m.wa_status, '') <> 'falhou'
        order by criado_em desc limit 1
    ) m
)
select u.pid, u.id, u.campanha_id, u.criado_em
from ultima u
where u.direcao = 'entrada'
  and u.criado_em < now() - make_interval(secs => p_espera_segundos)
  and u.criado_em > now() - interval '23 hours'
  and not exists (select 1 from campanha_respostas_bot r where r.mensagem_id = u.id)
order by u.criado_em
limit p_limite
$$;

-- Cadastro do DMF 2026 (evento 764, PUC Goiás, 14/11 16h), só Goiânia e Aparecida.
insert into campanhas_whatsapp (slug, nome, evento_id, filiais, template_convite, template_idioma, atendente,
    evento_com_artigo, evento_data_curta, cota_diaria, janela_inicio, janela_fim, inicio, fim_convites, fim_followup, config)
values ('dmf-2026', 'Dia Mundial da Filosofia 2026', 764,
    array['Goiânia - Jardim América', 'Goiânia - Setor Oeste', 'Goiânia - Garavelo', 'Goiânia II',
          'Goiânia - Alto da Glória', 'Goiânia - Cidade Jardim', 'Goiânia - Eldorado', 'Goiânia - Setor Universitário'],
    'convite_palestra', 'pt_BR', 'Henrique', 'o Dia Mundial da Filosofia', '14/11', 250, '08:30', '20:00',
    date '2026-11-04', date '2026-11-12', date '2026-11-13',
    jsonb_build_object('meta_presentes_fora', 50, 'percentual_maximo_followup', 0.4))
on conflict (slug) do nothing;

-- Assume os envios vencidos de forma atômica (cron a cada minuto; duas rodadas
-- sobrepostas nunca pegam o mesmo item). 'enviando' parado há 10 min volta.
create or replace function campanha_assumir_envios(p_limite int)
returns setof campanha_fila language plpgsql as $$
begin
    update campanha_fila set status = 'pendente'
    where status = 'enviando' and agendado_para < now() - interval '10 minutes';
    return query
    update campanha_fila f set status = 'enviando'
    where f.id in (
        select id from campanha_fila
        where status = 'pendente' and agendado_para <= now()
        order by agendado_para
        limit p_limite
        for update skip locked)
    returning f.*;
end $$;
revoke all on function campanha_assumir_envios(int) from public, anon, authenticated;
revoke all on function campanha_candidatos(bigint, int) from public, anon, authenticated;
revoke all on function campanha_conversas_aguardando(int, int) from public, anon, authenticated;

-- Chamada interna das Edge Functions da campanha (mesmo token do Vault do funil).
create or replace function executar_campanha_whatsapp(p_corpo jsonb) returns bigint
language sql security definer set search_path = public, extensions as $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/campanha-whatsapp',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-funil-token',
            (select decrypted_secret from vault.decrypted_secrets where name = 'funil_analise_token' limit 1)),
        body := p_corpo, timeout_milliseconds := 120000);
$$;
create or replace function executar_campanha_responder(p_corpo jsonb) returns bigint
language sql security definer set search_path = public, extensions as $$
    select net.http_post(
        url := 'https://eovgljcowblwoxmobeno.supabase.co/functions/v1/campanha-responder',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-funil-token',
            (select decrypted_secret from vault.decrypted_secrets where name = 'funil_analise_token' limit 1)),
        body := p_corpo, timeout_milliseconds := 140000);
$$;
revoke all on function executar_campanha_whatsapp(jsonb) from public, anon, authenticated;
revoke all on function executar_campanha_responder(jsonb) from public, anon, authenticated;

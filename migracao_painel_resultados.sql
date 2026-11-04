-- Painel de resultados para dirigentes (04/11/2026, pedido do usuário):
--   1) campanha do Dia Mundial da Filosofia (Alice e quem ela indicar);
--   2) resultados da ação de matrícula em todas as escolas participantes
--      (contatados, respostas, funil, matrículas, vagas das aberturas de turma).
-- Acesso por link com chave aleatória (só o hash fica no banco), escopo por
-- link: quais escolas e quais campanhas a pessoa vê. Mostra nome e telefone
-- (decisão do usuário em 30/10/2026: os dirigentes já têm esses dados no Ulisses).

create table if not exists painel_resultados_links (
    id bigserial primary key,
    chave_hash text unique not null,
    rotulo text not null,
    filiais text[],                 -- null = todas as escolas participantes
    campanhas text[] not null default '{}',
    expira_em timestamptz not null,
    revogado_em timestamptz,
    ultimo_acesso_em timestamptz,
    criado_em timestamptz not null default now()
);
alter table painel_resultados_links enable row level security;
-- sem policy: só service_role

create or replace function painel_tel_formatado(p_ddd text, p_num text) returns text
language sql immutable as $$
    select case when length(n) = 9 then format('(%s) %s-%s', d, left(n, 5), right(n, 4))
                when length(n) = 8 then format('(%s) %s-%s', d, left(n, 4), right(n, 4))
                else nullif(trim(coalesce(p_ddd, '') || ' ' || coalesce(p_num, '')), '') end
    from (select regexp_replace(coalesce(p_ddd, ''), '\D', '', 'g') d, regexp_replace(coalesce(p_num, ''), '\D', '', 'g') n) x
$$;

-- Resumo do banco de convidados por grupo (gravado no planejamento diário, é caro).
create or replace function campanha_banco_resumo(p_campanha bigint) returns jsonb
language sql stable as $$
    select coalesce(jsonb_object_agg(grupo, n), '{}'::jsonb)
    from (select grupo, count(*) n from campanha_candidatos(p_campanha, 100000) group by grupo) x
$$;

create or replace function painel_campanha(p_slug text) returns jsonb
language sql stable as $$
with c as (select * from campanhas_whatsapp where slug = p_slug),
ev as (select e.* from eventos e join c on c.evento_id = e.id),
fila as (
    select f.*, l."pessoaNome" nome, l."pessoaTelefoneDDD" ddd, l."pessoaTelefoneNumero" num, campanha_tags(l.tags) tags,
           m.wa_status
    from campanha_fila f join c on c.id = f.campanha_id
    left join leads_inscricoes l on l."pessoaIdentificador" = f."pessoaIdentificador"
    left join mensagens_whatsapp m on m.wa_message_id = f.wa_message_id
),
convidados as (
    select distinct on ("pessoaIdentificador") * from fila where status = 'enviado' order by "pessoaIdentificador", enviado_em
),
respostas as (
    select cv."pessoaIdentificador", min(m.criado_em) primeira
    from convidados cv join mensagens_whatsapp m on m."pessoaIdentificador" = cv."pessoaIdentificador"
     and m.direcao = 'entrada' and m.criado_em > cv.enviado_em - interval '10 minutes'
    group by 1
),
-- Telefones de alunos ativos (qualquer escola), para separar alunos de público de fora.
alunos_tel as (
    select distinct campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero") tel
    from leads_inscricoes l
    where l.tags::text like '%Ativo: %' or l.tags::text like '%"Ativo"%' or l.tags::text like '%Aluno Ativo%'
),
inscritos as (
    select el."pessoaIdentificador", el.criado_em, el.compareceu, l."pessoaNome" nome, l.filial,
           l."pessoaTelefoneDDD" ddd, l."pessoaTelefoneNumero" num,
           campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero") tel
    from evento_leads el join ev on ev.id = el.evento_id
    join leads_inscricoes l on l."pessoaIdentificador" = el."pessoaIdentificador"
    where el.origem = 'ulisses'
),
inscritos_class as (
    select i.*,
        (i.tel is not null and i.tel in (select tel from alunos_tel where tel is not null)) aluno,
        exists (select 1 from convidados cv where cv.telefone_chave = i.tel or cv."pessoaIdentificador" = i."pessoaIdentificador") via_convite
    from (select distinct on (coalesce(tel, "pessoaIdentificador")) * from inscritos order by coalesce(tel, "pessoaIdentificador"), criado_em) i
)
select jsonb_build_object(
    'campanha', (select jsonb_build_object('nome', c.nome, 'inicio', c.inicio, 'fim_convites', c.fim_convites,
        'meta_presentes_fora', c.config->'meta_presentes_fora', 'banco', c.config->'banco', 'cota_diaria', c.cota_diaria) from c),
    'evento', (select jsonb_build_object('nome', ev.nome, 'data', ev.data, 'hora', ev.hora, 'vagas', ev.capacidade, 'link', ev.link_inscricao) from ev),
    'numeros', jsonb_build_object(
        'convites_enviados', (select count(*) from convidados),
        'segunda_tentativa', (select count(*) from fila where tipo = 'followup' and status = 'enviado'),
        'entregues', (select count(*) from convidados where wa_status in ('entregue', 'lido')),
        'lidos', (select count(*) from convidados where wa_status = 'lido'),
        'nao_entregues', (select count(*) from fila where status = 'falhou' or wa_status = 'falhou'),
        'agendados', (select count(*) from fila where status in ('pendente', 'enviando')),
        'responderam', (select count(*) from respostas),
        'vao', (select count(*) from convidados where 'Campanha: Vai ao evento' = any(tags)),
        'interessados', (select count(*) from convidados where 'Campanha: Interessado' = any(tags)),
        'nao_vao', (select count(*) from convidados where 'Campanha: Não vai' = any(tags)),
        'pediram_parar', (select count(*) from convidados where 'Não Contatar' = any(tags)),
        'inscritos_total', (select count(*) from inscritos_class),
        'inscritos_alunos', (select count(*) from inscritos_class where aluno),
        'inscritos_fora', (select count(*) from inscritos_class where not aluno),
        'inscritos_via_convite', (select count(*) from inscritos_class where via_convite),
        'presentes_fora', (select count(*) from inscritos_class where not aluno and compareceu)
    ),
    'por_dia', (select coalesce(jsonb_agg(x order by dia), '[]') from (
        select d::date dia,
            (select count(*) from convidados where (enviado_em at time zone 'America/Sao_Paulo')::date = d::date) convites,
            (select count(*) from respostas where (primeira at time zone 'America/Sao_Paulo')::date = d::date) respostas,
            (select count(*) from inscritos_class where (criado_em at time zone 'America/Sao_Paulo')::date = d::date) inscricoes
        from c, generate_series(least(c.inicio, (select min(criado_em)::date from inscritos_class)), least(current_date, (select data from ev)), interval '1 day') d) x),
    'por_escola', (select coalesce(jsonb_agg(x order by convidados desc), '[]') from (
        select f.filial escola, count(*) convidados,
            count(*) filter (where exists (select 1 from respostas r where r."pessoaIdentificador" = f."pessoaIdentificador")) responderam,
            count(*) filter (where exists (select 1 from inscritos_class i where i.via_convite and (i.tel = f.telefone_chave or i."pessoaIdentificador" = f."pessoaIdentificador"))) inscritos
        from convidados f group by f.filial) x),
    'inscritos', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'telefone', painel_tel_formatado(ddd, num), 'escola', filial,
            'aluno', aluno, 'via_convite', via_convite, 'em', criado_em, 'compareceu', compareceu) order by criado_em desc), '[]') from inscritos_class),
    'contatados', (select coalesce(jsonb_agg(jsonb_build_object('nome', cv.nome, 'telefone', painel_tel_formatado(cv.ddd, cv.num), 'escola', cv.filial,
            'enviado_em', cv.enviado_em, 'entrega', cv.wa_status, 'respondeu', r.primeira is not null,
            'situacao', (select t from unnest(cv.tags) t where t like 'Campanha: %' limit 1),
            'parar', 'Não Contatar' = any(cv.tags)) order by cv.enviado_em desc), '[]')
        from convidados cv left join respostas r on r."pessoaIdentificador" = cv."pessoaIdentificador"),
    'atualizado_em', now()
)
$$;

create or replace function painel_escolas(p_filiais text[], p_desde date) returns jsonb
language sql stable as $$
with fs as (
    select nome, nome_com_preposicao from filiais
    where ativo and (p_filiais is null or nome = any(p_filiais))
),
saida as (
    select m."pessoaIdentificador" pid, coalesce(m.filial, l.filial) filial, min(m.criado_em) primeira
    from mensagens_whatsapp m left join leads_inscricoes l on l."pessoaIdentificador" = m."pessoaIdentificador"
    where m.direcao = 'saida' and coalesce(m.wa_status, '') <> 'falhou' and m.criado_em >= p_desde and m."pessoaIdentificador" is not null
    group by 1, 2
),
resp as (
    select s.pid, s.filial, min(m.criado_em) primeira
    from saida s join mensagens_whatsapp m on m."pessoaIdentificador" = s.pid and m.direcao = 'entrada' and m.criado_em > s.primeira
    group by 1, 2
),
inscr as (
    select l.filial, el."pessoaIdentificador" pid, el.criado_em
    from evento_leads el join leads_inscricoes l on l."pessoaIdentificador" = el."pessoaIdentificador"
    where el.origem = 'ulisses' and el.criado_em >= p_desde
      and exists (select 1 from mensagens_whatsapp m where m."pessoaIdentificador" = el."pessoaIdentificador"
                   and m.direcao = 'saida' and coalesce(m.wa_status, '') <> 'falhou' and m.criado_em < el.criado_em)
),
funil as (
    select l.filial, l.funil_agencia, count(*) n from leads_inscricoes l join fs on fs.nome = l.filial
    where l.lixeira_em is null group by 1, 2
),
matr as (
    select filial, competencia, count(*) n from mercurio_alunos
    where conta_remuneracao and competencia >= to_char(p_desde - interval '1 month', 'YYYY-MM')
    group by 1, 2
),
turmas as (
    -- O Ulisses às vezes tem dois cadastros para a mesma atividade na mesma escola: junta.
    select e.filial, e.nome, e.tipo, e.data, min(e.hora) hora, max(e.capacidade) capacidade, min(e.link_inscricao) link_inscricao,
        (select count(distinct el."pessoaIdentificador") from evento_leads el where el.evento_id = any(array_agg(e.id)) and el.origem = 'ulisses') inscritos,
        (select count(distinct el."pessoaIdentificador") from evento_leads el where el.evento_id = any(array_agg(e.id)) and el.origem = 'crm') convidados_crm,
        (select count(distinct el."pessoaIdentificador") from evento_leads el where el.evento_id = any(array_agg(e.id)) and el.compareceu) compareceram
    from eventos e join fs on fs.nome = e.filial
    where e.ativo and e.tipo in ('Abertura de Turma', 'Aula Inaugural')
      and e.data between current_date - 30 and current_date + 60
    group by e.filial, e.nome, e.tipo, e.data
)
select jsonb_build_object(
    'desde', p_desde,
    'escolas', (select coalesce(jsonb_agg(jsonb_build_object(
        'escola', fs.nome,
        'contatados', (select count(distinct pid) from saida s where s.filial = fs.nome),
        'responderam', (select count(distinct pid) from resp r where r.filial = fs.nome),
        'inscricoes_apos_contato', (select count(distinct pid) from inscr i where i.filial = fs.nome),
        'funil', (select coalesce(jsonb_object_agg(coalesce(funil_agencia, 'Frios'), n), '{}') from funil f where f.filial = fs.nome),
        'matriculas', (select coalesce(jsonb_object_agg(competencia, n), '{}') from matr m where m.filial = fs.nome),
        'informado', (select coalesce(jsonb_object_agg(mes, quantidade), '{}') from conciliacao_matriculas_informado ci where ci.filial = fs.nome)
    ) order by fs.nome), '[]') from fs),
    'turmas', (select coalesce(jsonb_agg(to_jsonb(t) order by t.data, t.filial), '[]') from turmas t),
    'por_semana', (select coalesce(jsonb_agg(x order by semana), '[]') from (
        select w::date semana,
            (select count(distinct pid) from saida s where s.primeira >= w and s.primeira < w + interval '7 days') contatados,
            (select count(distinct pid) from resp r where r.primeira >= w and r.primeira < w + interval '7 days') responderam
        from generate_series(date_trunc('week', p_desde::timestamp), date_trunc('week', now()), interval '7 days') w) x),
    'atualizado_em', now()
)
$$;

revoke all on function painel_campanha(text) from public, anon, authenticated;
revoke all on function painel_escolas(text[], date) from public, anon, authenticated;
revoke all on function campanha_banco_resumo(bigint) from public, anon, authenticated;
grant execute on function painel_campanha(text) to service_role;
grant execute on function painel_escolas(text[], date) to service_role;
grant execute on function campanha_banco_resumo(bigint) to service_role;

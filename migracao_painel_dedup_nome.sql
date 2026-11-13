-- Painel (13/11/2026): pessoas inscritas eram contadas juntando inscrições pelo telefone. Duas pessoas diferentes
-- com o mesmo celular (família) viravam uma só (DMF: Háryan/Vinnicyus, Karla/Núbia). Agora junta por telefone +
-- primeiro nome; a mesma pessoa inscrita duas vezes (Juliana, Raquel) continua contando uma vez.
CREATE OR REPLACE FUNCTION public.painel_campanha(p_slug text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
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
-- Quando o robô marcou interesse ("vai", "talvez", "quer informação") pela primeira vez.
interesse as (
    select b."pessoaIdentificador", min(coalesce(b.respondido_em, b.criado_em)) em
    from campanha_respostas_bot b join c on c.id = b.campanha_id
    where b.decisao->>'situacao' in ('vai', 'talvez', 'quer_info')
    group by 1
),
-- Telefones de alunos ativos (qualquer escola), para separar alunos de público de fora.
alunos_tel as (
    select distinct campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero") tel
    from leads_inscricoes l
    where l.tags::text like '%Ativo: %' or l.tags::text like '%"Ativo"%' or l.tags::text like '%Aluno Ativo%'
),
-- Lista do Ulisses (12/11/2026): quando a sincronização já gravou os inscritos do evento,
-- conta por ela (todas as inscrições, mesmo de quem não tem cadastro nesta escola).
ui as (
    select u.* from ulisses_inscricoes_evento u join ev on u.evento_id_ulisses = ev.evento_id_ulisses
    where u.removido_em is null
),
inscritos as (
    select u."pessoaIdentificador", coalesce(u.inscrito_em, u.visto_primeiro_em) criado_em, u.compareceu,
           u.nome, coalesce(l.filial, (select filial from ev)) filial, u.ddd, u.telefone num,
           campanha_telefone_chave(u.ddd, u.telefone) tel, nullif(lower(trim(u.email)), '') email,
           coalesce(campanha_telefone_chave(u.ddd, u.telefone) || ':' || split_part(nome_normalizado(u.nome), ' ', 1), nullif(lower(trim(u.email)), ''), u.pessoa_id_ulisses, u.email_evento_id::text) chave,
           u.pessoa_id_ulisses uid, u.sugestao_aluno
    from ui u left join leads_inscricoes l on l."pessoaIdentificador" = u."pessoaIdentificador"
    union all
    select el."pessoaIdentificador", el.criado_em, el.compareceu, l."pessoaNome", l.filial,
           l."pessoaTelefoneDDD", l."pessoaTelefoneNumero",
           campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero"), nullif(lower(trim(l."pessoaEmail")), ''),
           coalesce(campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero"), el."pessoaIdentificador"),
           null::text, null::jsonb
    from evento_leads el join ev on ev.id = el.evento_id
    join leads_inscricoes l on l."pessoaIdentificador" = el."pessoaIdentificador"
    where el.origem = 'ulisses' and not exists (select 1 from ui)
),
inscritos_class as (
    select i.*, coalesce(case when cf.eh_aluno then cf.escola end, mp.filial) filial_aluno, cf.eh_aluno confirmado, cf.autor confirmado_por,
        case when cf.eh_aluno is not null then cf.eh_aluno
             else (mp.filial is not null or (i.uid is null and i.tel is not null and i.tel in (select tel from alunos_tel where tel is not null))) end aluno,
        exists (select 1 from convidados cv where (cv.telefone_chave = i.tel or cv."pessoaIdentificador" = i."pessoaIdentificador")
                  and i.criado_em >= cv.enviado_em - interval '10 minutes') via_convite
    from (select distinct on (chave) * from inscritos order by chave, criado_em) i
    -- Aluno ativo no Mercúrio (qualquer escola) pelo e-mail ou celular da inscrição.
    -- Exige o mesmo primeiro nome: família costuma dividir telefone e e-mail.
    left join lateral (select m.filial from mercurio_pessoas m where m.situacao = 'ATI'
        and ((i.tel is not null and m.tel_chave = i.tel) or (i.email is not null and lower(m.email) = i.email))
        and split_part(nome_normalizado(m.nome), ' ', 1) = split_part(nome_normalizado(i.nome), ' ', 1) limit 1) mp on true
    -- Confirmação feita no painel (com PIN) vence a identificação automática.
    left join painel_aluno_confirmado cf on cf.pessoa_id_ulisses = i.uid
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
        'inscricoes_ulisses', (select count(*) from ui),
        'inscritos_alunos', (select count(*) from inscritos_class where aluno),
        'possiveis_alunos', (select count(*) from inscritos_class where not aluno and confirmado is null and sugestao_aluno is not null),
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
    'inscritos', (select coalesce(jsonb_agg(jsonb_build_object('pid', "pessoaIdentificador", 'nome', nome, 'telefone', painel_tel_formatado(ddd, num), 'escola', coalesce(filial_aluno, filial),
            'aluno', aluno, 'uid', uid, 'confirmado', confirmado, 'confirmado_por', confirmado_por,
            'sugestao', case when not aluno and confirmado is null then sugestao_aluno end, 'via_convite', via_convite, 'em', criado_em, 'compareceu', compareceu) order by criado_em desc), '[]') from inscritos_class),
    'contatados', (select coalesce(jsonb_agg(jsonb_build_object('pid', cv."pessoaIdentificador", 'nome', cv.nome, 'telefone', painel_tel_formatado(cv.ddd, cv.num), 'escola', cv.filial,
            'enviado_em', cv.enviado_em, 'entrega', cv.wa_status, 'respondeu', r.primeira is not null,
            'interesse_em', coalesce(it.em, r.primeira),
            'situacao', (select t from unnest(cv.tags) t where t like 'Campanha: %' limit 1),
            'parar', 'Não Contatar' = any(cv.tags)) order by cv.enviado_em desc), '[]')
        from convidados cv left join respostas r on r."pessoaIdentificador" = cv."pessoaIdentificador"
        left join interesse it on it."pessoaIdentificador" = cv."pessoaIdentificador"),
    'atualizado_em', now()
)
$function$
;

select painel_cache_atualizar();

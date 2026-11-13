-- Painel de números da recepção (13/11/2026): chegadas por horário, canal de check-in, perfil de quem usou cada
-- canal, comparecimento por perfil e por antecedência da inscrição. Lido pela Edge recepcao-evento (acao "numeros").
create or replace function public.recepcao_numeros(p_evento_id_ulisses bigint)
returns jsonb
language sql stable
set search_path = public
as $$
with
-- Inscritos (lista da porta: aluno, escola, presença) + se receberam convite da campanha antes de se inscrever.
ins as (
    select l.*, u.pessoa_id_ulisses, u.inscrito_em ins_em, u.bruto,
           exists (select 1 from campanha_fila f join campanhas_whatsapp c on c.id = f.campanha_id
                   join recepcao_links rl on rl.campanha_slug = c.slug and rl.evento_id_ulisses = p_evento_id_ulisses
                   where f.status = 'enviado' and f.telefone_chave = campanha_telefone_chave(u.ddd, u.telefone)) convidado
    from recepcao_lista(p_evento_id_ulisses) l
    join ulisses_inscricoes_evento u on u.email_evento_id = l.email_evento_id
),
-- Chegada registrada de cada pessoa (inscrição na porta ou presença), com o canal.
reg as (
    select distinct on (coalesce(r.email_evento_id::text, r.client_id::text))
           coalesce(r.email_evento_id::text, r.client_id::text) chave, r.email_evento_id, r.tipo, r.status,
           -- Hora da chegada: a do aparelho (vale para o que foi feito sem internet e enviado depois), se for plausível.
           case when r.criado_no_aparelho between r.criado_em - interval '12 hours' and r.criado_em + interval '5 minutes'
                then r.criado_no_aparelho else r.criado_em end criado_em,
           r.veio_com, r.interesse_curso,
           case when r.autor like 'Check-in pelo celular%' then 'QR check-in'
                when r.autor like 'Inscrição pelo celular%' then 'QR inscrição'
                when r.autor like '%Autoatendimento%' then 'Autoatendimento (tablet)'
                else 'Recepção (atendente)' end canal,
           case when r.tipo = 'inscricao' then true else false end na_porta
    from recepcao_registros r
    where r.evento_id_ulisses = p_evento_id_ulisses and r.tipo in ('presenca', 'inscricao') and r.status in ('ok', 'reservado', 'pendente')
    -- A chegada que vale é a mais recente (depois de um "desfazer", a pessoa pode ter entrado por outro canal).
    order by coalesce(r.email_evento_id::text, r.client_id::text), r.criado_em desc
),
-- Quem desfez a presença depois não conta.
desfeitos as (
    select r.email_evento_id from recepcao_registros r
    where r.evento_id_ulisses = p_evento_id_ulisses and r.status in ('ok', 'pendente') and r.email_evento_id is not null
    group by r.email_evento_id
    having max(r.criado_em) filter (where r.tipo = 'desfazer') > coalesce(max(r.criado_em) filter (where r.tipo in ('presenca', 'inscricao')), '-infinity')
),
chegadas as (
    select g.*, i.aluno, i.escola, coalesce(i.convidado, false) convidado, i.ins_em,
           (g.criado_em at time zone 'America/Sao_Paulo') local_em
    from reg g left join ins i on i.email_evento_id = g.email_evento_id
    where g.email_evento_id is null or g.email_evento_id not in (select email_evento_id from desfeitos)
),
-- Presentes marcados direto no Ulisses (fora desta página).
so_ulisses as (
    select i.* from ins i where i.compareceu and not exists (select 1 from chegadas c where c.email_evento_id = i.email_evento_id)
)
select jsonb_build_object(
    'resumo', jsonb_build_object(
        'inscritos', (select count(*) from ins) + (select count(*) from chegadas where email_evento_id is null),
        'presentes', (select count(*) from chegadas) + (select count(*) from so_ulisses),
        'presentes_alunos', (select count(*) from chegadas where aluno) + (select count(*) from so_ulisses where aluno),
        'presentes_fora', (select count(*) from chegadas where not coalesce(aluno, false)) + (select count(*) from so_ulisses where not aluno),
        'inscritos_na_porta', (select count(*) from chegadas where na_porta),
        'reservados_sem_email', (select count(*) from chegadas where status = 'reservado'),
        'marcados_no_ulisses', (select count(*) from so_ulisses),
        'veio_acompanhado', (select count(*) from chegadas where veio_com is not null),
        'querem_info_curso', (select count(*) from chegadas where interesse_curso),
        'nao_querem_info', (select count(*) from chegadas where interesse_curso = false),
        'faltaram', (select count(*) from ins where not coalesce(compareceu, false) and not exists (select 1 from chegadas c where c.email_evento_id = ins.email_evento_id)),
        'primeira', (select min(local_em) from chegadas), 'ultima', (select max(local_em) from chegadas)),
    -- Chegadas a cada 15 minutos, por canal.
    'por_horario', coalesce((select jsonb_agg(jsonb_build_object('faixa', faixa, 'total', total, 'canais', canais) order by faixa) from (
        select faixa, sum(n) total, jsonb_object_agg(canal, n) canais from (
            select to_char(date_trunc('hour', local_em) + floor(extract(minute from local_em) / 15) * interval '15 min', 'HH24:MI') faixa, canal, count(*) n
            from chegadas group by 1, 2) a
        group by faixa) t), '[]'),
    -- Perfil por canal: alunos, de fora, convidados pela campanha, inscritos na porta, interesse no curso.
    'por_canal', coalesce((select jsonb_agg(to_jsonb(t) order by t.total desc) from (
        select canal, count(*) total, count(*) filter (where aluno) alunos, count(*) filter (where not coalesce(aluno, false)) fora,
               count(*) filter (where convidado) convidados, count(*) filter (where na_porta) na_porta,
               count(*) filter (where interesse_curso) querem_info
        from chegadas group by canal) t), '[]'),
    -- Comparecimento por perfil e por antecedência da inscrição.
    'comparecimento', jsonb_build_object(
        'por_perfil', coalesce((select jsonb_agg(jsonb_build_object('perfil', perfil, 'inscritos', n, 'presentes', p) order by perfil) from (
            select case when aluno then 'Alunos' when convidado then 'De fora, convidados pela campanha' else 'De fora, outros canais' end perfil,
                   count(*) n, count(*) filter (where compareceu or exists (select 1 from chegadas c where c.email_evento_id = ins.email_evento_id)) p
            from ins group by 1) t), '[]'),
        'por_antecedencia', coalesce((select jsonb_agg(jsonb_build_object('faixa', faixa, 'inscritos', n, 'presentes', p) order by ordem) from (
            select case when d is null then 'sem data' when d < 1 then 'no dia' when d < 3 then '1 a 2 dias antes' when d < 8 then '3 a 7 dias antes' else 'mais de 7 dias antes' end faixa,
                   case when d is null then 9 when d < 1 then 1 when d < 3 then 2 when d < 8 then 3 else 4 end ordem,
                   count(*) n, count(*) filter (where compareceu or exists (select 1 from chegadas c where c.email_evento_id = x.email_evento_id)) p
            from (select ins.*, (select e.data from eventos e where e.evento_id_ulisses = p_evento_id_ulisses limit 1) - (ins_em at time zone 'America/Sao_Paulo')::date d from ins) x
            group by 1, 2) t), '[]')),
    -- Jornada medida: do check-in (QR code) ou da entrega do cartão até a leitura na segurança.
    'jornada', coalesce((select jsonb_agg(jsonb_build_object('entrada', entrada, 'pessoas', n, 'mediana_seg', med, 'p90_seg', p90, 'max_seg', mx) order by entrada) from (
        select entrada, count(*) n, round(percentile_cont(0.5) within group (order by seg)) med,
               round(percentile_cont(0.9) within group (order by seg)) p90, round(max(seg)) mx
        from (select case when r.tipo = 'cartao_lido' then 'Cartão (mesa da recepção)' else 'QR code no celular' end entrada,
                     extract(epoch from (coalesce(r.criado_no_aparelho, r.criado_em) - r.inicio_em)) seg
              from recepcao_registros r
              where r.evento_id_ulisses = p_evento_id_ulisses and r.tipo in ('validado', 'cartao_lido') and r.inicio_em is not null) x
        where seg between 0 and 4 * 3600
        group by entrada) t), '[]'),
    'validacoes', (select count(*) from recepcao_registros r where r.evento_id_ulisses = p_evento_id_ulisses and r.tipo in ('validado', 'cartao_lido')),
    -- Registros que ainda não chegaram ao Ulisses (reenviados sozinhos) e vagas reservadas a completar depois.
    'pendentes_ulisses', (select count(*) from recepcao_registros r where r.evento_id_ulisses = p_evento_id_ulisses and r.status = 'pendente' and r.tipo in ('presenca', 'desfazer', 'inscricao')),
    'reservas_com_email', (select count(*) from recepcao_registros r where r.evento_id_ulisses = p_evento_id_ulisses and r.status = 'reservado' and r.email is not null),
    -- Escolas de origem de quem chegou (só alunos têm escola).
    'por_escola', coalesce((select jsonb_agg(jsonb_build_object('escola', escola, 'presentes', n) order by n desc) from (
        select coalesce(escola, 'De fora') escola, count(*) n from chegadas group by 1) t), '[]')
)
$$;
revoke all on function public.recepcao_numeros(bigint) from public, anon, authenticated;

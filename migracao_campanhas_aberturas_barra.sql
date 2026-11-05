-- Campanhas simultâneas (04/11/2026, pedido do usuário): 200 convites/dia para o
-- DMF de Goiânia e o restante do limite da Meta para as aberturas de turma das
-- escolas participantes e para o DMF de Barra do Garças (18/11). Depois do DMF
-- (14/11) a ideia é reduzir o DMF e focar nas aberturas.
--
-- 1) Instruções específicas de cada campanha vão em config.instrucoes (o robô
--    de resposta deixou de ter o DMF da PUC escrito no texto fixo).
-- 2) campanha_candidatos: padrões do grupo A e da inscrição vêm da campanha;
--    quem está na fila de QUALQUER campanha ativa não entra em outra.
-- 3) campanha_checagens: registro da pergunta "Deu certo sua inscrição?".

-- ---------------------------------------------------------------- DMF Goiânia
update campanhas_whatsapp set cota_diaria = 200,
  config = config || jsonb_build_object(
    'padrao_grupo_a', '%mundial da filosofia%',
    'padrao_inscrito', '%mundial da filosofia%', 'padrao_inscrito_data', '%/11/2026%',
    'instrucoes', $t$- O que é: uma tarde de palestras sobre filosofia e ciência, com apresentações artísticas, no Auditório da Área 4 da PUC Goiás, Setor Universitário. Entrada franca (gratuita).
- Vagas limitadas: é importante garantir a vaga pelo link de inscrição.
- Programação: quando ajudar a despertar interesse, cite 1 ou 2 palestras, com o tema e quem fala, escolhendo as que mais combinam com a pessoa (atividades que já frequentou, profissão, etiquetas, o que disse na conversa). Ex.: quem é da saúde -> "A Ciência da Saúde", com o médico e filósofo Dr. Hugo Cerveira; quem fala de falta de tempo ou rotina -> "A Ciência do Tempo", com João Guilherme Nalon; quem gosta de mitologia, histórias ou literatura -> "A Ciência do Mito", com Alice Amaral; quem gosta de ciência ou meio ambiente -> o diálogo final com o Prof. Antônio Pasqualetto, cientista, e o Prof. Jean Cesar Antunes. Sem pista nenhuma, cite a programação de forma geral (palestras sobre saúde, tempo e mito, apresentações artísticas e um diálogo entre filosofia e ciência). Se a pessoa pedir a programação completa, mande-a com os horários.
- Horário de término: não existe nos dados. A última atividade começa às 19h. Nunca diga a que horas termina; se perguntarem, diga que a última atividade começa às 19h e marque "precisa_humano": true.
- Endereço exato da PUC Área 4 não está nos dados: diga "Auditório da Área 4 da PUC Goiás, no Setor Universitário"; se pedirem o endereço exato, diga que vai confirmar ("precisa_humano": true).$t$)
where slug = 'dmf-2026';

-- ---------------------------------------------------------------- DMF Barra
insert into campanhas_whatsapp (slug, nome, evento_id, filiais, template_convite, template_followup, template_idioma, atendente,
    evento_com_artigo, evento_data_curta, cota_diaria, janela_inicio, janela_fim, inicio, fim_convites, fim_followup, ativa, config)
select 'dmf-barra-2026', 'Dia Mundial da Filosofia 2026 - Barra do Garças', 793, array['Barra do Garças/MT'],
    'convite_palestra', 'contato_inicial', 'pt_BR', 'Henrique', 'o Dia Mundial da Filosofia', '18/11', 10,
    '08:30', '20:00', date '2026-11-05', date '2026-11-17', date '2026-11-17', true,
    jsonb_build_object('corpos', d.config->'corpos', 'percentual_maximo_followup', 0.4,
      'padrao_grupo_a', '%mundial da filosofia%',
      'padrao_inscrito', '%mundial da filosofia%', 'padrao_inscrito_data', '%/11/2026%',
      'instrucoes', $t$- O evento acontece na própria escola de Barra do Garças: Rua Simião Arraya, 305, Centro, Barra do Garças/MT. Quarta-feira, 18/11, às 19h30.
- São duas palestras: "Saúde e Filosofia: Por que adoecemos tanto?" e "Alquimia: a união entre Ciência e Filosofia". Cite a que mais combinar com a pessoa.
- Entrada franca (gratuita). Vagas limitadas (o auditório é pequeno): é importante garantir a vaga pelo link de inscrição.
- Contato da escola, se a pessoa pedir: (66) 3199-3188 ou Instagram @novaacropolebg.
- Este evento NÃO é o de Goiânia (PUC, dia 14/11). Nunca fale do evento de Goiânia.$t$)
from campanhas_whatsapp d where d.slug = 'dmf-2026'
on conflict (slug) do nothing;

-- ---------------------------------------------------------------- Aberturas de turma
-- Uma campanha por escola: convite para a última turma de 2026, com a aula
-- experimental gratuita da semana anterior como primeiro passo.
with t(slug, filial, turma, aula) as (values
    ('turma-alto-da-gloria-2026', 'Goiânia - Alto da Glória', 787, 774),
    ('turma-eldorado-2026',       'Goiânia - Eldorado',       788, 775),
    ('turma-jardim-america-2026', 'Goiânia - Jardim América', 790, 779),
    ('turma-setor-oeste-2026',    'Goiânia - Setor Oeste',    791, 782),
    ('turma-universitario-2026',  'Goiânia - Setor Universitário', 792, 786),
    ('turma-goiania-ii-2026',     'Goiânia II',               789, 777)
), dados as (
    select t.*, et.data turma_data, et.hora turma_hora, et.link_inscricao turma_link,
           ea.data aula_data, ea.hora aula_hora, ea.link_inscricao aula_link,
           f.nome_com_preposicao, f.endereco
    from t join eventos et on et.id = t.turma join eventos ea on ea.id = t.aula
    join filiais f on f.nome = t.filial
)
insert into campanhas_whatsapp (slug, nome, evento_id, filiais, template_convite, template_followup, template_idioma, atendente,
    evento_com_artigo, evento_data_curta, cota_diaria, janela_inicio, janela_fim, inicio, fim_convites, fim_followup, ativa, config)
select x.slug, 'Nova turma do Curso de Filosofia para Viver - ' || replace(x.filial, 'Goiânia - ', ''), x.turma, array[x.filial],
    'convite_palestra', 'contato_inicial', 'pt_BR', 'Henrique',
    'a nova turma do Curso de Filosofia para Viver', to_char(x.turma_data, 'DD/MM'), 6,
    '08:30', '20:00', date '2026-11-05', x.turma_data - 1, x.turma_data - 1, true,
    jsonb_build_object('corpos', d.config->'corpos', 'percentual_maximo_followup', 0.4,
      'padrao_grupo_a', '%filosofia para viver%',
      'instrucoes', format($t$- A campanha convida para a última turma de 2026 do Curso de Filosofia para Viver na Nova Acrópole %s: primeira aula em %s, às %s. Matrículas abertas. Vagas limitadas.
- Primeiro passo recomendado: a AULA EXPERIMENTAL gratuita na mesma escola, em %s, às %s, para conhecer o curso sem compromisso. Inscrição da aula experimental: %s. Quem demonstrar interesse, hesitar ou quiser conhecer antes deve ser convidado para a aula experimental e receber esse link.
- Link de inscrição da turma: %s.
- O curso: ensinamentos de grandes filósofos do Oriente e do Ocidente aplicados à vida cotidiana (autoconhecimento, valores humanos, vida com mais consciência e propósito).
- Duração do curso: de 4 a 6 meses, com aulas uma vez por semana, de 2 horas, com intervalo de 20 minutos.
- Valores do curso: nunca informe; diga que vai ver isso e já passa (uma pessoa responde na mesma conversa) e que na aula experimental dá para conhecer tudo com calma.
- A aula experimental é gratuita. Não diga que o curso é gratuito. Chame sempre de "aula experimental", nunca de "primeira aula" (a primeira aula é a da turma).
- Local: a própria escola%s.$t$,
        x.nome_com_preposicao, to_char(x.turma_data, 'DD/MM'), replace(to_char(date '2000-01-01' + x.turma_hora, 'HH24"h"MI'), 'h00', 'h'),
        to_char(x.aula_data, 'DD/MM'), replace(to_char(date '2000-01-01' + x.aula_hora, 'HH24"h"MI'), 'h00', 'h'), x.aula_link, x.turma_link,
        case when x.endereco is not null then ' (' || x.endereco || ')' else '' end))
from dados x, campanhas_whatsapp d where d.slug = 'dmf-2026'
on conflict (slug) do nothing;

-- ---------------------------------------------------------------- Checagem de inscrição
create table if not exists campanha_checagens (
    campanha_id bigint not null references campanhas_whatsapp(id),
    "pessoaIdentificador" text not null,
    tipo text not null default 'inscricao',
    criado_em timestamptz not null default now(),
    status text,
    primary key (campanha_id, "pessoaIdentificador", tipo)
);
alter table campanha_checagens enable row level security;
drop policy if exists campanha_checagens_leitura on campanha_checagens;
create policy campanha_checagens_leitura on campanha_checagens for select using (true);

-- Quem disse que vai (robô marcou situação "vai") entre 12h e 23h atrás, não
-- escreveu mais nada depois, ainda não aparece inscrito no Ulisses e ainda não
-- recebeu a pergunta. A janela de 24h ainda está aberta (última mensagem dela
-- tem menos de 23h).
create or replace function campanha_checagens_inscricao(p_limite int)
returns table (pessoa text, campanha_id bigint, evento_id bigint)
language sql stable as $$
select distinct on (r."pessoaIdentificador") r."pessoaIdentificador", r.campanha_id, c.evento_id
from campanha_respostas_bot r
join campanhas_whatsapp c on c.id = r.campanha_id and c.ativa and c.evento_id is not null
join mensagens_whatsapp m on m.id = r.mensagem_id
where r.decisao->>'situacao' = 'vai'
  and m.criado_em between now() - interval '23 hours' and now() - interval '12 hours'
  and not exists (select 1 from mensagens_whatsapp x where x."pessoaIdentificador" = r."pessoaIdentificador"
                  and x.direcao = 'entrada' and x.criado_em > m.criado_em)
  and not exists (select 1 from evento_leads el where el.evento_id = c.evento_id
                  and el."pessoaIdentificador" = r."pessoaIdentificador" and el.origem = 'ulisses')
  and not exists (select 1 from campanha_checagens k where k.campanha_id = r.campanha_id
                  and k."pessoaIdentificador" = r."pessoaIdentificador" and k.tipo = 'inscricao')
order by r."pessoaIdentificador", m.criado_em desc
limit p_limite
$$;
revoke all on function campanha_checagens_inscricao(int) from public, anon, authenticated;
grant execute on function campanha_checagens_inscricao(int) to service_role;

-- ---------------------------------------------------------------- Candidatos
-- Grupo A e "já inscrito" pelos padrões da campanha (config.padrao_grupo_a,
-- padrao_inscrito, padrao_inscrito_data); fila de outra campanha ativa bloqueia.
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
                 where e->>'evento' ilike coalesce((select config->>'padrao_grupo_a' from c), '%mundial da filosofia%')
                   and coalesce(e->>'data', '') not like '%/2026%') ja_foi_dmf,
        exists (select 1 from jsonb_array_elements(case when jsonb_typeof(b.h) = 'array' then b.h else '[]' end) e
                 where (select config->>'padrao_inscrito' from c) is not null
                   and e->>'evento' ilike (select config->>'padrao_inscrito' from c)
                   and e->>'data' like coalesce((select config->>'padrao_inscrito_data' from c), '%')) inscrito_dmf
    from base b
),
-- Telefones que não podem receber: aluno ativo, pedido de não contato,
-- inscrito no evento, já está na campanha, conversa nos últimos 7 dias.
bloqueados as (
    select tel from com_eventos
    where tel is not null and (
        inscrito_dmf
        or 'Não Contatar' = any(tags) or 'Contato em conferência' = any(tags)
        -- número de outra pessoa ("não sei quem é Fulano"): convite com o nome do cadastro seria errado
        or 'Campanha: Nome a conferir' = any(tags)
        or exists (select 1 from unnest(tags) t where t like 'Ativo: %' or t in ('Ativo', 'Aluno Ativo'))
        or a->>'contato' = 'nao_contatar' or a->>'relacao' = 'ativo'
    )
    union
    -- já está nesta campanha, ou na fila (ainda não enviado) de qualquer campanha ativa
    select f.telefone_chave from campanha_fila f join c on f.campanha_id = c.id where f.telefone_chave is not null and f.status <> 'cancelado'
    union
    select f.telefone_chave from campanha_fila f join campanhas_whatsapp c2 on c2.id = f.campanha_id
    where c2.ativa and f.telefone_chave is not null and f.status in ('pendente', 'enviando')
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

-- ---------------------------------------------------------------- Painel: "veio pelo convite"
-- Só conta quem se inscreveu no Ulisses DEPOIS do nosso convite (margem de 10 min
-- pelo horário de envio). Antes, bastava o telefone bater com um convidado.
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
        exists (select 1 from convidados cv where (cv.telefone_chave = i.tel or cv."pessoaIdentificador" = i."pessoaIdentificador")
                  and i.criado_em >= cv.enviado_em - interval '10 minutes') via_convite
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

-- ---------------------------------------------------------------- Cotas (04/11)
-- Limite da Meta 245/dia: DMF 200, Barra 10, aberturas 35 (por tamanho do banco, mínimo 3).
update campanhas_whatsapp set cota_diaria = v.cota from (values
    ('turma-jardim-america-2026', 12), ('turma-universitario-2026', 8), ('turma-alto-da-gloria-2026', 4),
    ('turma-setor-oeste-2026', 4), ('turma-goiania-ii-2026', 4), ('turma-eldorado-2026', 3)) v(slug, cota)
where campanhas_whatsapp.slug = v.slug;

-- Ajuste (04/11): "aula experimental", nunca "primeira aula".
update campanhas_whatsapp set config = jsonb_set(config, '{instrucoes}', to_jsonb(replace(config->>'instrucoes',
    '- A aula experimental é gratuita. Não diga que o curso é gratuito.',
    '- A aula experimental é gratuita. Não diga que o curso é gratuito. Chame sempre de "aula experimental", nunca de "primeira aula" (a primeira aula é a da turma).')))
where slug like 'turma-%-2026' and config->>'instrucoes' not like '%nunca de "primeira aula"%';

-- Link usado quando o robô pergunta "quer o link?" sem mandar (ver trocarPerguntaDoLink):
-- nas turmas, o primeiro passo é a aula experimental.
update campanhas_whatsapp c set config = c.config || jsonb_build_object('link_convite', ea.link_inscricao)
from (values ('turma-alto-da-gloria-2026', 774), ('turma-eldorado-2026', 775), ('turma-jardim-america-2026', 779),
             ('turma-setor-oeste-2026', 782), ('turma-universitario-2026', 786), ('turma-goiania-ii-2026', 777)) v(slug, aula)
join eventos ea on ea.id = v.aula
where c.slug = v.slug;

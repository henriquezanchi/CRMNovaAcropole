-- Aula experimental de novembro: o evento 24697 foi inativado no Ulisses (o link mostra
-- "Este evento foi inativado") e substituído pelo 24698, mesmo nome e mesmas datas por escola.
-- O CRM tinha linhas duplicadas por escola (umas com 24697, outras com 24698) e 4 campanhas de
-- turma mandavam o link inativado. Fica 1 linha por escola com o 24698; as inscrições das
-- duplicadas vão para ela; as demais ficam ativo=false (nada é apagado).
with alvo as (
  select id, filial, evento_id_ulisses,
         row_number() over (partition by filial order by (evento_id_ulisses = 24698) desc, id) as ordem
  from eventos
  where evento_id_ulisses in (24697, 24698) and data >= date '2026-11-17'
),
manter as (select filial, id from alvo where ordem = 1)
insert into evento_leads (evento_id, "pessoaIdentificador", resposta_convite, compareceu, nota, matriculado, origem)
select m.id, el."pessoaIdentificador", el.resposta_convite, el.compareceu, el.nota, el.matriculado, el.origem
from alvo a join manter m on m.filial = a.filial and m.id <> a.id
join evento_leads el on el.evento_id = a.id
on conflict (evento_id, "pessoaIdentificador") do nothing;

with alvo as (
  select id, filial,
         row_number() over (partition by filial order by (evento_id_ulisses = 24698) desc, id) as ordem
  from eventos
  where evento_id_ulisses in (24697, 24698) and data >= date '2026-11-17'
)
update eventos e set
  evento_id_ulisses = 24698,
  link_inscricao = 'https://inscricao.acropolebrasil.com.br/?eventoId=24698',
  ativo = (a.ordem = 1)
from alvo a where e.id = a.id;

update campanhas_whatsapp
set config = jsonb_set(config, '{instrucoes}', to_jsonb(replace(config->>'instrucoes', 'eventoId=24697', 'eventoId=24698')))
where config->>'instrucoes' like '%eventoId=24697%';

insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'aula_experimental_link_corrigido', 'Claude (evento 24697 inativado no Ulisses)',
        jsonb_build_object('de', 24697, 'para', 24698));

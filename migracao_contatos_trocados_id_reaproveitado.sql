-- Contatos trocados por número reaproveitado (achado em 06/11/2026, caso Rosemary x Paula, Barra do Garças).
-- Até a troca por idSinteticoEstavel() (js/importador.js), o número sintético de quem vinha só do Mercúrio
-- (900M/950M) era um contador por importação: o mesmo número passava de uma pessoa para a vizinha na ordem
-- alfabética, e a importação só-Mercúrio trocava o nome mas preservava telefone, e-mail e eventos do Ulisses
-- da pessoa anterior. Resultado: 128 cadastros com e-mail E telefone de outra pessoa da mesma escola.
--
-- Critério (conservador): o e-mail E o telefone do cadastro são de OUTRA matrícula do Mercúrio da mesma
-- unidade, com outro primeiro nome, e o Mercúrio tem um e-mail diferente para a própria pessoa.
-- Correção: contato volta a ser o do Mercúrio; eventos idênticos (até o segundo) aos da dona do contato saem
-- do histórico; conversas de WhatsApp vão para o cadastro da dona do telefone; nada é apagado de outra pessoa.

create temp table contaminados on commit drop as
with l as (
  select l."pessoaIdentificador" pid, l.filial, lower(nullif(l."pessoaEmail",'')) email,
    nullif(campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero"),'') tel,
    lower(mp.email) mp_email, mp.tel_chave mp_tel, mp.unidade, mp.matricula, mp.nome mp_nome
  from leads_inscricoes l join mercurio_pessoas mp on mp.pessoa_identificador = l."pessoaIdentificador"
  where l.lixeira_em is null)
select distinct on (l.pid) l.pid, l.filial, l.email, l.tel, l.mp_email, l.mp_tel, o.pessoa_identificador dono
from l join mercurio_pessoas o on o.unidade = l.unidade and o.matricula <> l.matricula
  and lower(o.email) = l.email and o.tel_chave = l.tel
where l.mp_email is not null and l.mp_email <> l.email and l.tel is distinct from l.mp_tel
  and split_part(o.nome,' ',1) <> split_part(l.mp_nome,' ',1)
order by l.pid, o.matricula;

-- 1. Conversas de WhatsApp vão para a dona do telefone (quando ela tem cadastro no CRM).
update mensagens_whatsapp m set "pessoaIdentificador" = c.dono
from contaminados c
where m."pessoaIdentificador" = c.pid and c.dono is not null
  and exists (select 1 from leads_inscricoes d where d."pessoaIdentificador" = c.dono and d.lixeira_em is null);

-- 2. Vínculos de evento que vieram com o histórico da outra pessoa (ela também tem o vínculo).
delete from evento_leads el using contaminados c
where el."pessoaIdentificador" = c.pid and el.origem = 'ulisses'
  and exists (select 1 from evento_leads d where d."pessoaIdentificador" = c.dono and d.evento_id = el.evento_id);

-- 3. Histórico: sai o evento idêntico (nome e data até o segundo) a um do histórico da dona do contato.
update leads_inscricoes l set historico_eventos = coalesce((
    select jsonb_agg(e) from jsonb_array_elements(coalesce(l.historico_eventos,'[]'::jsonb)) e
    where not exists (
      select 1 from leads_inscricoes d, jsonb_array_elements(coalesce(d.historico_eventos,'[]'::jsonb)) de
      where d."pessoaIdentificador" = c.dono and de->>'evento' = e->>'evento' and de->>'data' = e->>'data')), '[]'::jsonb)
from contaminados c where l."pessoaIdentificador" = c.pid;

-- 4. Contato volta a ser o do Mercúrio (sem telefone no Mercúrio = fica sem telefone).
update leads_inscricoes l set
  "pessoaEmail" = case when c.mp_email ~ '^n[aã]o(possui|tem)' then null else c.mp_email end,
  "pessoaTelefoneDDD" = case when c.mp_tel is null then null else substr(c.mp_tel,1,2) end,
  "pessoaTelefoneNumero" = case when c.mp_tel is null then null else substr(c.mp_tel,3) end,
  tags = to_jsonb((
    select coalesce(jsonb_agg(t), '[]'::jsonb)::text from (
      select t from jsonb_array_elements_text(coalesce(nullif(l.tags #>> '{}',''),'[]')::jsonb) t
      where t not in ('Sem Telefone','Sem E-mail','WhatsApp não entrega','Telefone Inválido','Conferir Telefone')
      union all select 'Sem Telefone' where c.mp_tel is null
      union all select 'Sem E-mail' where c.mp_email ~ '^n[aã]o(possui|tem)') x))
from contaminados c where l."pessoaIdentificador" = c.pid;

insert into log_atividade (filial, acao, autor, pessoa_ids, detalhes)
select 'GLOBAL', 'correcao_contato_trocado', 'Claude (número sintético reaproveitado)',
  jsonb_agg(pid), jsonb_build_object('quantidade', count(*),
    'motivo', 'e-mail e telefone de outra matrícula da mesma escola; contato volta ao do Mercúrio')
from contaminados;

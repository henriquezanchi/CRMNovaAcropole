-- Varredura completa CRM x Mercúrio (06/11/2026), 2ª rodada — complementa
-- migracao_contatos_trocados_id_reaproveitado.sql (mesma origem: número sintético reaproveitado).
-- Entra quem tem e-mail e/ou telefone de OUTRA matrícula da mesma unidade (outro primeiro nome) e:
--   (a) os dois de outra pessoa; ou
--   (b) só um deles, cadastro sintético (>= 900M) e o Mercúrio tem valor próprio diferente.
-- Cada campo contaminado volta ao valor do Mercúrio; sem valor no Mercúrio, fica vazio (nunca o de outra
-- pessoa). Mensagens de WhatsApp do telefone trocado vão para a dona do número. Nada é apagado.

create temp table contaminados2 on commit drop as
with l as materialized (
  select l."pessoaIdentificador" pid, l.filial, lower(nullif(l."pessoaEmail",'')) email,
    nullif(campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero"),'') tel,
    lower(nullif(mp.email,'')) mp_email, mp.tel_chave mp_tel, mp.unidade, mp.matricula, mp.nome mp_nome
  from leads_inscricoes l join mercurio_pessoas mp on mp.pessoa_identificador = l."pessoaIdentificador"
  where l.lixeira_em is null),
o as materialized (select lower(nullif(email,'')) email, tel_chave, unidade, matricula, pessoa_identificador, split_part(nome,' ',1) pn from mercurio_pessoas),
c as (
 select l.*,
  (l.email is not null and l.email<>coalesce(l.mp_email,'') and exists(select 1 from o where o.unidade=l.unidade and o.matricula<>l.matricula and o.email=l.email and o.pn<>split_part(l.mp_nome,' ',1))) email_de_outro,
  (l.tel is not null and l.tel<>coalesce(l.mp_tel,'') and exists(select 1 from o where o.unidade=l.unidade and o.matricula<>l.matricula and o.tel_chave=l.tel and o.pn<>split_part(l.mp_nome,' ',1))) tel_de_outro,
  (select o.pessoa_identificador from o where o.unidade=l.unidade and o.matricula<>l.matricula and o.tel_chave=l.tel and o.pn<>split_part(l.mp_nome,' ',1) order by o.matricula limit 1) dono_tel
 from l)
select pid, filial, email, tel, mp_email, mp_tel, dono_tel,
  (email_de_outro and (tel_de_outro or (pid::bigint >= 900000000 and mp_email is not null))) corrigir_email,
  (tel_de_outro and (email_de_outro or (pid::bigint >= 900000000 and mp_tel is not null))) corrigir_tel
from c where (email_de_outro and tel_de_outro)
   or (email_de_outro and pid::bigint >= 900000000 and mp_email is not null)
   or (tel_de_outro and pid::bigint >= 900000000 and mp_tel is not null);

-- Conversas do telefone trocado vão para a dona do número (se ela tem cadastro).
update mensagens_whatsapp m set "pessoaIdentificador" = c.dono_tel
from contaminados2 c
where c.corrigir_tel and m."pessoaIdentificador" = c.pid and c.dono_tel is not null
  and exists (select 1 from leads_inscricoes d where d."pessoaIdentificador" = c.dono_tel and d.lixeira_em is null);

update leads_inscricoes l set
  "pessoaEmail" = case when not c.corrigir_email then l."pessoaEmail"
                       when c.mp_email is null or c.mp_email ~ '^n[aã]o(possui|tem)' then null else c.mp_email end,
  "pessoaTelefoneDDD" = case when not c.corrigir_tel then l."pessoaTelefoneDDD" when c.mp_tel is null then null else substr(c.mp_tel,1,2) end,
  "pessoaTelefoneNumero" = case when not c.corrigir_tel then l."pessoaTelefoneNumero" when c.mp_tel is null then null
                                when length(substr(c.mp_tel,3)) = 8 and substr(c.mp_tel,3) ~ '^[6-9]' then '9' || substr(c.mp_tel,3)
                                else substr(c.mp_tel,3) end,
  tags = to_jsonb((
    select coalesce(jsonb_agg(t), '[]'::jsonb)::text from (
      select t from jsonb_array_elements_text(coalesce(nullif(l.tags #>> '{}',''),'[]')::jsonb) t
      where t not in ('Sem Telefone','Sem E-mail','WhatsApp não entrega','Telefone Inválido','Conferir Telefone')
      union all select 'Sem Telefone' where (c.corrigir_tel and c.mp_tel is null) or (not c.corrigir_tel and l."pessoaTelefoneNumero" is null)
      union all select 'Sem E-mail' where (c.corrigir_email and (c.mp_email is null or c.mp_email ~ '^n[aã]o(possui|tem)')) or (not c.corrigir_email and nullif(l."pessoaEmail",'') is null)) x))
from contaminados2 c where l."pessoaIdentificador" = c.pid;

insert into log_atividade (filial, acao, autor, pessoa_ids, detalhes)
select 'GLOBAL', 'correcao_contato_trocado', 'Claude (varredura CRM x Mercúrio, 2ª rodada)',
  jsonb_agg(pid), jsonb_build_object('quantidade', count(*), 'emails', count(*) filter (where corrigir_email),
    'telefones', count(*) filter (where corrigir_tel), 'motivo', 'contato de outra matrícula da mesma escola; volta ao do Mercúrio')
from contaminados2;

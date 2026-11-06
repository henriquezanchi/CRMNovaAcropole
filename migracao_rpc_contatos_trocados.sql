-- Detecção contínua de contato trocado (06/11/2026): cadastro ligado ao Mercúrio cujo e-mail ou telefone
-- pertence a OUTRA matrícula da mesma unidade (outro primeiro nome) enquanto o Mercúrio tem o valor próprio
-- diferente. Mesmo critério das correções migracao_contatos_trocados_*.sql. Usada pelo Diagnóstico de Saúde
-- (ia-diagnostico-saude), todo dia, para isso não voltar a ficar escondido.
create or replace function crm_contatos_trocados_mercurio(p_filial text default null)
returns table (pid text, filial text, campo text, valor_crm text, valor_mercurio text, dono text)
language sql stable as $$
with l as materialized (
  select l."pessoaIdentificador" pid, l.filial, lower(nullif(l."pessoaEmail",'')) email,
    nullif(campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero"),'') tel,
    lower(nullif(mp.email,'')) mp_email, mp.tel_chave mp_tel, mp.unidade, mp.matricula, split_part(mp.nome,' ',1) pn
  from leads_inscricoes l join mercurio_pessoas mp on mp.pessoa_identificador = l."pessoaIdentificador"
  where l.lixeira_em is null and (p_filial is null or l.filial = p_filial)
    -- Só cadastro sintético (criado pelo CRM a partir do Mercúrio): com ID real do Ulisses foi a própria
    -- pessoa que informou o contato (família dividindo telefone/e-mail não é erro do CRM).
    and l."pessoaIdentificador"::bigint >= 900000000),
o as materialized (select lower(nullif(email,'')) email, tel_chave, unidade, matricula, nome, split_part(nome,' ',1) pn from mercurio_pessoas)
select l.pid, l.filial, 'email', l.email, l.mp_email, o.nome
from l join o on o.unidade = l.unidade and o.matricula <> l.matricula and o.email = l.email and o.pn <> l.pn
where l.mp_email is not null and l.email <> l.mp_email
union all
select l.pid, l.filial, 'telefone', l.tel, l.mp_tel, o.nome
from l join o on o.unidade = l.unidade and o.matricula <> l.matricula and o.tel_chave = l.tel and o.pn <> l.pn
where l.mp_tel is not null and l.tel <> l.mp_tel;
$$;
grant execute on function crm_contatos_trocados_mercurio(text) to anon, authenticated, service_role;

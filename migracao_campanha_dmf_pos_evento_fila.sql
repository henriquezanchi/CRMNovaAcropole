-- Fila do pós-evento do DMF Goiânia (16/11/2026). Rodar depois de migracao_campanha_dmf_pos_evento.sql.
-- Inscritos no DMF (Ulisses 24664) sem presença marcada, não alunos, com cadastro e telefone,
-- sem "Não Contatar"/"WhatsApp não entrega"/aluno ativo e sem conversa desde o evento.
-- Um envio a cada 3 minutos a partir de agora; um por telefone.
with u as (
    select u.*, campanha_telefone_chave(u.ddd, u.telefone) tel, nullif(lower(trim(u.email)), '') em
    from ulisses_inscricoes_evento u
    where u.evento_id_ulisses = 24664 and u.removido_em is null and u.compareceu is not true and u."pessoaIdentificador" is not null
),
alvo as (
    select distinct on (campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero"))
        l."pessoaIdentificador" pid, l.filial, campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero") tel
    from u
    join leads_inscricoes l on l."pessoaIdentificador" = u."pessoaIdentificador" and l.lixeira_em is null
    left join painel_aluno_confirmado cf on cf.pessoa_id_ulisses = u.pessoa_id_ulisses
    where campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero") is not null
      and not coalesce(cf.eh_aluno, exists (select 1 from mercurio_pessoas m where m.situacao = 'ATI'
            and ((u.tel is not null and m.tel_chave = u.tel) or (u.em is not null and lower(m.email) = u.em))
            and split_part(nome_normalizado(m.nome), ' ', 1) = split_part(nome_normalizado(u.nome), ' ', 1)))
      and l.tags::text not like '%Não Contatar%'
      and l.tags::text not like '%WhatsApp não entrega%'
      and l.tags::text not like '%Ativo: %'
      and not exists (select 1 from mensagens_whatsapp m where m."pessoaIdentificador" = l."pessoaIdentificador"
            and m.criado_em > '2026-11-14T18:00:00Z' and coalesce(m.wa_status, '') <> 'falhou')
    order by campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero"), l."pessoaIdentificador"
)
insert into campanha_fila (campanha_id, "pessoaIdentificador", filial, telefone_chave, grupo, prioridade, tipo, agendado_para, status)
select c.id, a.pid, a.filial, a.tel, 'P', 0, 'convite',
       now() + interval '2 minutes' + (row_number() over (order by a.filial, a.pid) - 1) * interval '3 minutes', 'pendente'
from alvo a, campanhas_whatsapp c
where c.slug = 'dmf-2026-pos'
on conflict (campanha_id, "pessoaIdentificador", tipo) do nothing;

insert into log_atividade (filial, acao, autor, detalhes)
select 'GLOBAL', 'campanha_criada', 'Claude (pedido do usuário)',
       jsonb_build_object('campanha', 'dmf-2026-pos', 'fila', (select count(*) from campanha_fila f join campanhas_whatsapp c on c.id = f.campanha_id where c.slug = 'dmf-2026-pos'),
                          'modelo', 'contato_ulisses_saida');

select f.filial, count(*), min(agendado_para), max(agendado_para)
from campanha_fila f join campanhas_whatsapp c on c.id = f.campanha_id where c.slug = 'dmf-2026-pos' group by 1;

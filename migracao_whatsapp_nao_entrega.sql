-- "WhatsApp não entrega" (06/11/2026, pedido do usuário depois do aviso de spam da Meta).
-- A API da Meta não testa número antes do envio; o histórico é o teste: número que já
-- voltou com erro 131026 ("Message undeliverable") ganha a etiqueta e sai dos disparos
-- em massa. O telefone NÃO é apagado (pode servir para ligação). Em 06/11: 498 números
-- com o erro, 60 receberam outra mensagem mesmo assim, nenhum jamais respondeu.

-- 1) Etiqueta em quem já falhou (cadastro da própria mensagem ou de mesmo telefone).
with falhos as (
    select distinct "pessoaIdentificador" pid, telefone_whatsapp tel from mensagens_whatsapp
    where direcao = 'saida' and wa_status_erro->0->>'code' = '131026'
), alvo as (
    select l."pessoaIdentificador" pid, l.tags from leads_inscricoes l
    where l."pessoaIdentificador" in (select pid from falhos where pid is not null)
       or campanha_telefone_chave(l."pessoaTelefoneDDD", l."pessoaTelefoneNumero") in
          (select campanha_telefone_chave(substr(tel, 3, 2), substr(tel, 5)) from falhos where tel like '55%')
)
update leads_inscricoes l
set tags = to_jsonb(((coalesce(nullif(l.tags #>> '{}', ''), '[]')::jsonb) || '["WhatsApp não entrega"]'::jsonb)::text)
from alvo
where l."pessoaIdentificador" = alvo.pid
  and not ((coalesce(nullif(l.tags #>> '{}', ''), '[]')::jsonb) ? 'WhatsApp não entrega');

-- 2) Campanhas: telefone com a etiqueta fica bloqueado.
CREATE OR REPLACE FUNCTION public.campanha_candidatos(p_campanha bigint, p_limite integer)
 RETURNS TABLE(pessoa text, filial text, telefone_chave text, grupo text, prioridade numeric)
 LANGUAGE sql
 STABLE
AS $function$
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
        -- número que já voltou como "Message undeliverable" (131026): não insiste (06/11/2026)
        or 'WhatsApp não entrega' = any(tags)
        or exists (select 1 from unnest(tags) t where t like 'Ativo: %' or t in ('Ativo', 'Aluno Ativo'))
        or a->>'contato' = 'nao_contatar' or a->>'relacao' = 'ativo'
    )
    union
    -- já está nesta campanha, ou já foi convidado (ou está na fila) de qualquer campanha ativa:
    -- quem recebeu o convite do DMF não recebe outro da turma como se fôssemos outra entidade;
    -- a aula experimental é divulgada na própria conversa pelo robô (05/11/2026).
    select f.telefone_chave from campanha_fila f join c on f.campanha_id = c.id where f.telefone_chave is not null and f.status <> 'cancelado'
    union
    select f.telefone_chave from campanha_fila f join campanhas_whatsapp c2 on c2.id = f.campanha_id
    where c2.ativa and f.telefone_chave is not null and f.status in ('pendente', 'enviando', 'enviado')
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
$function$
;

insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'whatsapp_nao_entrega_backfill', 'Claude', jsonb_build_object('motivo', 'números com erro 131026 saem dos disparos em massa'));

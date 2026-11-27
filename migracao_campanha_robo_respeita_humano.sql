-- Robô da campanha respeita o botão "IA desativada nesta conversa" e sai de cena
-- quando um humano assumiu (27/11/2026, caso real: Rayssa).
--   1. leads_inscricoes.ia_sugestao_resposta = false (seletor "IA" no cabeçalho da
--      conversa, Mensagens) deixa o robô de campanha fora dessa conversa.
--   2. Se a última mensagem NOSSA na conversa foi de uma pessoa (atendente_nome = conta
--      ativa de usuarios_crm; robôs e campanhas gravam outros nomes) nas últimas 48 h,
--      o robô não responde: quem assumiu continua.
create or replace function campanha_conversas_aguardando(p_espera_segundos int, p_limite int)
returns table (pessoa text, mensagem_id bigint, campanha_id bigint, recebida_em timestamptz)
language sql stable as $$
with leads as (
    select distinct on (f."pessoaIdentificador") f."pessoaIdentificador" pid, f.campanha_id
    from campanha_fila f join campanhas_whatsapp c on c.id = f.campanha_id
    where c.ativa and f.status = 'enviado'
    order by f."pessoaIdentificador", f.enviado_em desc
),
ultima as (
    select l.pid, l.campanha_id, m.id, m.direcao, m.criado_em
    from leads l
    cross join lateral (
        select id, direcao, criado_em from mensagens_whatsapp m
        where m."pessoaIdentificador" = l.pid and coalesce(m.wa_status, '') <> 'falhou'
        order by criado_em desc limit 1
    ) m
)
select u.pid, u.id, u.campanha_id, u.criado_em
from ultima u
where u.direcao = 'entrada'
  and u.criado_em < now() - make_interval(secs => p_espera_segundos)
  and u.criado_em > now() - interval '23 hours'
  and not exists (select 1 from campanha_respostas_bot r where r.mensagem_id = u.id
                  and not (r.status = 'processando' and r.criado_em < now() - interval '5 minutes'))
  and coalesce((select l.ia_sugestao_resposta from leads_inscricoes l where l."pessoaIdentificador" = u.pid), true) = true
  and not exists (
      select 1 from mensagens_whatsapp s
      where s."pessoaIdentificador" = u.pid and s.direcao = 'saida'
        and coalesce(s.wa_status, '') <> 'falhou'
        and s.criado_em > now() - interval '48 hours'
        and s.criado_em = (select max(s2.criado_em) from mensagens_whatsapp s2
                           where s2."pessoaIdentificador" = u.pid and s2.direcao = 'saida' and coalesce(s2.wa_status, '') <> 'falhou')
        and s.atendente_nome in (select u.nome from usuarios_crm u where u.ativo and u.nome <> 'Scraper Automatico')
  )
order by u.criado_em
limit p_limite
$$;

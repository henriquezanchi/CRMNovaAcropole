-- Reserva presa do robô da campanha (04/11/2026, caso real: Valdete).
-- Se a Edge Function morre no meio (servidor sobrecarregado), a reserva fica
-- "processando" para sempre e a varredura nunca mais pega a mensagem.
-- Agora uma reserva "processando" com mais de 5 minutos não conta.
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
order by u.criado_em
limit p_limite
$$;

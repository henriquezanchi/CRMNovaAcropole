-- 12/11/2026. (1) DMF: para de convidar o Setor Universitário (já tem o maior volume) e foca nas
-- demais escolas — config.excluir_filiais, lido pelo agendador. (2) Reenvio dos convites que a
-- Meta recusou em 11/11 por problema de pagamento da conta (erro 131042; pagamento feito pelo
-- usuário em 12/11): voltam para a fila de hoje, distribuídos até as 20h. Não volta quem falhou
-- por número sem WhatsApp (131026) nem os do Universitário no DMF.
update campanhas_whatsapp set config = config || jsonb_build_object('excluir_filiais', jsonb_build_array('Goiânia - Setor Universitário'))
where slug = 'dmf-2026';

update campanha_fila f set status = 'cancelado', motivo = 'escola fora desta campanha'
from campanhas_whatsapp c
where c.id = f.campanha_id and c.slug = 'dmf-2026' and f.filial = 'Goiânia - Setor Universitário' and f.status = 'pendente';

with alvo as (
    select f.id, row_number() over (order by f.prioridade desc nulls last, f.id) n, count(*) over () total
    from campanha_fila f join campanhas_whatsapp c on c.id = f.campanha_id
    join mensagens_whatsapp m on m.wa_message_id = f.wa_message_id
    where m.wa_status = 'falhou' and m.wa_status_erro::text like '%131042%' and c.ativa
      and not (c.slug = 'dmf-2026' and f.filial = 'Goiânia - Setor Universitário')
),
janela as (select now() + interval '3 minutes' ini,
                  ((now() at time zone 'America/Sao_Paulo')::date + time '19:45') at time zone 'America/Sao_Paulo' fim)
update campanha_fila f set status = 'pendente', motivo = 'reenvio: pagamento da conta regularizado',
    agendado_para = j.ini + (j.fim - j.ini) * ((a.n - 1)::numeric / greatest(a.total, 1))
from alvo a, janela j where f.id = a.id;

insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'campanha_reenvio_pagamento', 'Claude (pedido do usuário)',
        '{"motivo":"131042 em 11/11","dmf_excluir_filiais":["Goiânia - Setor Universitário"]}');

select c.slug, f.status, count(*), min(to_char(f.agendado_para at time zone 'America/Sao_Paulo','HH24:MI')) de, max(to_char(f.agendado_para at time zone 'America/Sao_Paulo','HH24:MI')) ate
from campanha_fila f join campanhas_whatsapp c on c.id = f.campanha_id
where f.motivo in ('reenvio: pagamento da conta regularizado', 'escola fora desta campanha') group by 1, 2 order by 1;

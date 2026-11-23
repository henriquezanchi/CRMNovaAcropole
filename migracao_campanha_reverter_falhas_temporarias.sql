-- Convite que falhou por motivo TEMPORÁRIO volta para a fila (23/11/2026, pedido do usuário).
-- Bug: a Meta aceita o envio na hora e só depois avisa a falha pelo webhook (ex.: 131042, pagamento pendente).
-- A fila já tinha marcado "enviado" e a pessoa nunca mais era convidada. 21-23/11: ~280 convites perdidos assim.
-- Códigos temporários (mesma lista de mensagens_falhas_retriaveis): 131042 pagamento, 130429/131056 limite de taxa.
-- Número sem WhatsApp (131026) e retenção da Meta (131049) continuam como enviados (não adianta repetir).
-- Roda no começo de cada rodada de envio da campanha-whatsapp e uma vez aqui, para quem já foi atingido.

create or replace function campanha_reverter_falhas_temporarias(p_desde timestamptz default now() - interval '4 days')
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  with alvo as (
    select f.id, f.campanha_id, f."pessoaIdentificador", f.tipo, c.evento_id,
           coalesce(c.fim_convites, current_date) >= (now() at time zone 'America/Sao_Paulo')::date as ainda_convida
      from campanha_fila f
      join campanhas_whatsapp c on c.id = f.campanha_id
      join mensagens_whatsapp m on m.wa_message_id = f.wa_message_id
     where f.status = 'enviado' and f.wa_message_id is not null and f.enviado_em >= p_desde
       and m.wa_status = 'falhou'
       and m.wa_status_erro::text ~ '"code": ?(131042|130429|131056)\M'
  ), apaga_vinculo as (
    delete from evento_leads el using alvo a
     where a.tipo = 'convite' and el.evento_id = a.evento_id and el."pessoaIdentificador" = a."pessoaIdentificador"
       and el.origem = 'crm' and el.resposta_convite = 'pendente'
  ), upd as (
    update campanha_fila f
       set status = case when a.ainda_convida then 'pendente' else 'cancelado' end,
           agendado_para = now() + interval '30 minutes',
           motivo = case when a.ainda_convida then 'reenvio: falha temporária na Meta'
                         else 'falha temporária na Meta; campanha já encerrou os convites' end,
           enviado_em = null, wa_message_id = null
      from alvo a where f.id = a.id
    returning f.id
  )
  select count(*) into n from upd;
  return n;
end $$;

grant execute on function campanha_reverter_falhas_temporarias(timestamptz) to service_role;

-- Quem já foi atingido desde 19/11.
select campanha_reverter_falhas_temporarias('2026-11-19 03:00+00') as revertidos;

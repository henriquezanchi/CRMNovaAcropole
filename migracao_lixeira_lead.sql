-- Lixeira de leads (soft-delete com expiração automática) — pedido do
-- usuário: jogar um lead fora sem apagar na hora, com 30 dias pra
-- restaurar antes de sumir de vez. `lixeira_em` preenchido = "está na
-- lixeira desde esta data"; null = normal (comportamento de sempre).
alter table leads_inscricoes add column if not exists lixeira_em timestamptz;

-- Roda 1x por dia via pg_cron (mesmo padrão já usado pro disparo diário
-- do Mercúrio, migracao_agendamento_mercurio_pgcron.sql) — apaga de vez
-- quem está na lixeira há mais de 30 dias, sem depender de ninguém abrir
-- o CRM pra isso acontecer. Registra 1 linha em log_atividade (filial
-- 'GLOBAL', mesmo padrão já usado por credenciais_scraper/
-- status_sincronizacao_automatica) só quando apaga alguém — não polui o
-- log em dias sem nada a limpar.
create or replace function limpar_lixeira_leads_vencidos()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apagados int;
begin
  with apagados as (
    delete from leads_inscricoes
    where lixeira_em is not null and lixeira_em < now() - interval '30 days'
    returning "pessoaIdentificador"
  )
  select count(*) into v_apagados from apagados;

  if v_apagados > 0 then
    insert into log_atividade (filial, acao, autor, pessoa_ids, detalhes)
    values ('GLOBAL', 'lixeira_expirada_apagada', 'Sistema (cron)', '[]'::jsonb, jsonb_build_object('quantidade', v_apagados));
  end if;
end;
$$;

select cron.schedule('limpar-lixeira-leads-diario', '0 9 * * *', $$select limpar_lixeira_leads_vencidos();$$);

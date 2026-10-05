-- Migração: tags "Contato Recente: 7 dias" / "Contato Recente: 30 dias"
--
-- Pedido do usuário (2026-10-06): "crie uma tag para quem recebeu
-- mensagem nossa nos últimos dias (pode ser nos últimos 7, e ultimos 30
-- dias) e já marque todo mundo que atende a esse critério. Assim
-- evitamos enviar mensagem de novo".
--
-- Diferente de uma tag normal (adicionada uma vez e esquecida), isso
-- precisa ficar sempre em dia — sem isso, a tag viraria uma mentira
-- depois que os 7/30 dias passassem. Em vez de tentar atualizar isso em
-- TODO ponto que manda WhatsApp, a fonte de verdade é a coluna
-- `ultimo_contato_em` (já existe, carimbada automaticamente por
-- whatsapp-send em TODO envio real — ver migracao_whatsapp_snooze_fila_ultimo_contato.sql)
-- + esta função, que recalcula as 2 tags (adiciona OU remove, conforme
-- o caso) pra TODA a base, rodada 1x/dia via pg_cron. `whatsapp-send`
-- também já adiciona as 2 tags na hora do envio (sem esperar o cron do
-- dia seguinte) — o cron aqui é só quem CUIDA DA REMOÇÃO quando o prazo
-- vence (nenhum evento "dispara" a remoção sozinho, só o tempo passando).
--
-- `tags` é jsonb, mas guardado como uma STRING jsonb contendo o JSON do
-- array (confirmado: jsonb_typeof(tags) = 'string') — por isso usa
-- `(tags #>> '{}')::jsonb` pra extrair o array de verdade (mesmo truque
-- já usado em leads_ativos_inativos_da_filial() etc.) e `to_jsonb(...::text)`
-- pra regravar no MESMO formato (nunca muda o formato de armazenamento
-- que o resto do app espera).
create or replace function sincronizar_tags_contato_recente()
returns void
language plpgsql
as $$
declare
  rec record;
  arr jsonb;
  nova_arr jsonb;
  tem_7 boolean;
  tem_30 boolean;
  deve_ter_7 boolean;
  deve_ter_30 boolean;
  total_atualizados int := 0;
begin
  for rec in
    select "pessoaIdentificador", tags, ultimo_contato_em
    from leads_inscricoes
    where lixeira_em is null
  loop
    begin
      arr := coalesce((rec.tags #>> '{}')::jsonb, '[]'::jsonb);
      if jsonb_typeof(arr) <> 'array' then arr := '[]'::jsonb; end if;
    exception when others then
      arr := '[]'::jsonb;
    end;

    deve_ter_7 := rec.ultimo_contato_em is not null and rec.ultimo_contato_em >= now() - interval '7 days';
    deve_ter_30 := rec.ultimo_contato_em is not null and rec.ultimo_contato_em >= now() - interval '30 days';
    tem_7 := arr @> '["Contato Recente: 7 dias"]'::jsonb;
    tem_30 := arr @> '["Contato Recente: 30 dias"]'::jsonb;

    if deve_ter_7 = tem_7 and deve_ter_30 = tem_30 then
      continue; -- já está em dia, nada a fazer
    end if;

    nova_arr := arr;
    if deve_ter_7 and not tem_7 then
      nova_arr := nova_arr || '["Contato Recente: 7 dias"]'::jsonb;
    elsif not deve_ter_7 and tem_7 then
      select coalesce(jsonb_agg(v), '[]'::jsonb) into nova_arr
      from jsonb_array_elements(nova_arr) v
      where v <> '"Contato Recente: 7 dias"'::jsonb;
    end if;

    if deve_ter_30 and not tem_30 then
      nova_arr := nova_arr || '["Contato Recente: 30 dias"]'::jsonb;
    elsif not deve_ter_30 and tem_30 then
      select coalesce(jsonb_agg(v), '[]'::jsonb) into nova_arr
      from jsonb_array_elements(nova_arr) v
      where v <> '"Contato Recente: 30 dias"'::jsonb;
    end if;

    update leads_inscricoes
    set tags = to_jsonb(nova_arr::text)
    where "pessoaIdentificador" = rec."pessoaIdentificador";
    total_atualizados := total_atualizados + 1;
  end loop;

  raise notice 'sincronizar_tags_contato_recente: % lead(s) atualizados', total_atualizados;
end;
$$;

-- Roda 1x/dia (09:05 UTC = 06:05 Brasília — horário próprio, não
-- colide com o cron do Mercúrio às 08:00 UTC nem o de arquivamento de
-- conversas às 11:30 UTC) — mesmo padrão de pg_cron já usado em
-- limpar_lixeira_leads_vencidos()/arquivar_conversas_whatsapp_inativas().
select cron.schedule(
  'sincronizar-tags-contato-recente-diario',
  '5 9 * * *',
  $$select sincronizar_tags_contato_recente();$$
);

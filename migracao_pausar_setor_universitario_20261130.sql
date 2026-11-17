-- Pausa os contatos automáticos do Setor Universitário em 30/11/2026 (pedido do usuário, 17/11/2026:
-- a escola ainda não sabe se vai renovar o contrato). Agenda um job que roda uma vez, às 00:05 de 30/11
-- (Brasília = 03:05 UTC), e se desagenda sozinho.
-- O que para: convites de campanha da escola, robô de campanha, sugestão de resposta por IA e reengajamento
-- automático. Nada é apagado; mensagens que chegarem continuam aparecendo no CRM para resposta manual.
-- Para religar: campanhas ativa=true e os dois campos da filial de volta para true.

create or replace function pausar_contatos_setor_universitario()
returns void language plpgsql security definer set search_path = public as $$
begin
  update campanhas_whatsapp set ativa = false, cota_diaria = 0
   where slug like '%universitario%' and ativa;  -- só as da escola; campanhas de várias escolas (DMF) seguem

  update campanha_fila set status = 'cancelado'
   where status = 'pendente' and filial = 'Goiânia - Setor Universitário';

  update filiais set ia_sugestao_resposta_habilitada = false,
                     ia_reengajamento_janela_habilitado = false
   where nome = 'Goiânia - Setor Universitário';

  insert into log_atividade (filial, acao, autor, detalhes)
  values ('Goiânia - Setor Universitário', 'contatos_pausados', 'Agendamento (pedido do usuário)',
          '{"motivo": "renovação do contrato indefinida", "agendado_em": "2026-11-17"}'::jsonb);

  perform cron.unschedule('pausar-setor-universitario-20261130');
end $$;

select cron.schedule('pausar-setor-universitario-20261130', '5 3 30 11 *',
                     $$ select pausar_contatos_setor_universitario(); $$);

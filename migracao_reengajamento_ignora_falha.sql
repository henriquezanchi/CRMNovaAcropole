-- Reengajamento (bug real, 2026-10-30): a "última mensagem da conversa" contava
-- envios nossos que FALHARAM (ex: lembrete automático recusado pela Meta). Para o
-- lead, nada chegou — ele continua esperando —, mas a conversa sumia da fila do
-- robô. Agora envio com wa_status 'falhou' não conta como resposta.
-- Rodar: npx supabase db query --linked --file migracao_reengajamento_ignora_falha.sql
create or replace function mensagens_candidatas_reengajamento_janela(p_limite int default 20)
returns table (mensagem_id bigint, "pessoaIdentificador" text, filial text)
language sql stable as $$
    select m.id as mensagem_id, m."pessoaIdentificador", l.filial
    from mensagens_whatsapp m
    join leads_inscricoes l on l."pessoaIdentificador" = m."pessoaIdentificador" and l.filial = m.filial and l.lixeira_em is null
    left join filiais f on f.nome = l.filial
    left join sugestoes_resposta_wpp s on s.mensagem_origem_id = m.id
    where m.direcao = 'entrada'
      and m."pessoaIdentificador" is not null
      and m.id = (
          select max(m2.id) from mensagens_whatsapp m2
          where m2."pessoaIdentificador" = m."pessoaIdentificador"
            and not (m2.direcao = 'saida' and coalesce(m2.wa_status, '') = 'falhou')
      )
      and m.criado_em <= now() - interval '12 hours'
      and m.criado_em > now() - interval '24 hours'
      and s.reengajamento_em is null
      and (s.id is null or s.status = 'pendente')
      and coalesce(l.ia_sugestao_resposta, f.ia_reengajamento_janela_habilitado, true) = true
      and not crm_eh_ativo(l.filial, l."pessoaIdentificador", l.tags)
    order by m.criado_em asc
    limit p_limite;
$$;
grant execute on function mensagens_candidatas_reengajamento_janela(int) to service_role;

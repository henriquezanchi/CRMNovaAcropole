-- Linhas em branco em "Pessoas contatadas" (12/11/2026): a pessoa foi convidada e depois o
-- cadastro dela foi mesclado com outro; campanha_fila/campanha_checagens/campanha_respostas_bot
-- continuavam apontando para o cadastro apagado. Toda mesclagem grava crm_leads_mesclados
-- (original -> destino): um gatilho ali religa as tabelas da campanha ao cadastro que ficou.
-- Se o cadastro que ficou já tem uma linha na mesma campanha/tipo, a do apagado sai (duplicada).
create or replace function campanha_religar_mesclado() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from campanha_fila f where f."pessoaIdentificador" = new.original
    and exists (select 1 from campanha_fila g where g.campanha_id = f.campanha_id and g.tipo = f.tipo and g."pessoaIdentificador" = new.destino);
  update campanha_fila set "pessoaIdentificador" = new.destino where "pessoaIdentificador" = new.original;
  delete from campanha_checagens c where c."pessoaIdentificador" = new.original
    and exists (select 1 from campanha_checagens g where g.campanha_id = c.campanha_id and g.tipo = c.tipo and g."pessoaIdentificador" = new.destino);
  update campanha_checagens set "pessoaIdentificador" = new.destino where "pessoaIdentificador" = new.original;
  update campanha_respostas_bot set "pessoaIdentificador" = new.destino where "pessoaIdentificador" = new.original;
  return new;
end $$;

drop trigger if exists campanha_religar_mesclado on crm_leads_mesclados;
create trigger campanha_religar_mesclado after insert or update of destino on crm_leads_mesclados
  for each row execute function campanha_religar_mesclado();

-- Correção das que já existem: reaplica o gatilho para quem está na campanha sem cadastro.
update crm_leads_mesclados m set destino = destino
where exists (select 1 from campanha_fila f where f."pessoaIdentificador" = m.original)
  and not exists (select 1 from leads_inscricoes l where l."pessoaIdentificador" = m.original);

insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'correcao_campanha_mesclados', 'Claude (pedido do usuário)', '{"motivo":"linhas em branco em Pessoas contatadas: convidados mesclados depois do convite"}');

select count(*) sem_cadastro from (select distinct "pessoaIdentificador" p from campanha_fila) f
where not exists (select 1 from leads_inscricoes l where l."pessoaIdentificador" = f.p);

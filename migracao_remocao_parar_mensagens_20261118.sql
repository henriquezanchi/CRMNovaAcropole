-- Remoção a pedido de quem tocou "Parar mensagens" / escreveu "Sair" em 16/11/2026 (pedido do usuário, 18/11).
-- Mesmo efeito do botão de remoção LGPD da gaveta (abrirRemoverLeadLgpd): bloqueio de reimportação
-- (contatos_removidos_lgpd), desativação no Ulisses (fila_desativacao_ulisses, agora com o código do contato,
-- processada pela Edge Function ulisses-nao-perturbe) e exclusão definitiva do cadastro.
-- Lucas Oliveira da Silva (559879) fica de fora: tocou por engano e continuou a conversa.

alter table fila_desativacao_ulisses add column if not exists ulisses_email_id bigint;

create temp table _remover on commit drop as
select l."pessoaIdentificador" pid, l."pessoaNome" nome, l.filial, l."pessoaEmail" email,
       l."pessoaTelefoneDDD" ddd, l."pessoaTelefoneNumero" num
  from leads_inscricoes l
 where l."pessoaIdentificador" in ('564291','560112','564379','564510','312874','528442','343572');

insert into contatos_removidos_lgpd (filial, nome, nome_normalizado, telefone_normalizado, email_normalizado, motivo, removido_por)
select filial, nome, upper(regexp_replace(trim(nome), '\s+', ' ', 'g')),
       case when length(regexp_replace(num, '\D', '', 'g')) in (8, 9)
            then regexp_replace(ddd, '\D', '', 'g') || right(regexp_replace(num, '\D', '', 'g'), 8) end,
       nullif(lower(trim(email)), ''), 'Pediu para parar as mensagens (WhatsApp, 16/11/2026)', 'Claude (pedido do usuário)'
  from _remover;

insert into fila_desativacao_ulisses (filial, nome, telefone_busca, status, ulisses_email_id)
select filial, nome, nullif(coalesce(ddd, '') || coalesce(num, ''), ''), 'pendente', pid::bigint from _remover;

insert into log_atividade (filial, acao, autor, pessoa_ids, detalhes)
select filial, 'remocao_lgpd', 'Claude (pedido do usuário)', jsonb_build_array(pid),
       jsonb_build_object('nome', nome, 'telefone', coalesce(ddd, '') || coalesce(num, ''), 'email', email,
                          'motivo', 'Parar mensagens (16/11/2026)')
  from _remover;

delete from leads_inscricoes where "pessoaIdentificador" in (select pid from _remover);

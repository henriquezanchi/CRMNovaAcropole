-- 04/11/2026, pedido do usuário: Rio Verde, Jataí, Eldorado, Cidade Jardim, Catalão
-- e Barra do Garças participam agora; Anápolis sai em definitivo (reincluir só a pedido).
update filiais set ativo = true where nome in ('Rio Verde', 'Jataí');
update filiais set ativo = false, modulo2_contratado = false where nome = 'Anápolis';
select cron.alter_job((select jobid from cron.job where jobname = 'mercurio-db-sincronizar-Rio Verde'), active := true);
select cron.alter_job((select jobid from cron.job where jobname = 'mercurio-db-sincronizar-Anápolis'), active := false);
insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'filiais_participantes', 'Claude (pedido do usuário)',
        jsonb_build_object('ativadas', jsonb_build_array('Rio Verde', 'Jataí'), 'removida', 'Anápolis'));

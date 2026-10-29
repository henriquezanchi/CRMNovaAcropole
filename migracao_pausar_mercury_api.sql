-- Pausa a sincronização pela API do Mercury (2026-10-29, pedido do usuário:
-- "desative a sincronização do Mercury por enquanto, não precisamos dela").
-- Ela gravava a etiqueta Ativo/Inativo pelo campo "active" da API, que diverge
-- do banco do Mercúrio (marcava como ativos 411 leads que o banco não considera).
-- Só desliga os agendamentos (active=false), sem apagar: para religar, rode o
-- mesmo bloco com active := true. O banco do Mercúrio (mercurio-db-sincronizar)
-- continua rodando normalmente.
select cron.alter_job(jobid, active := false)
from cron.job
where command ilike '%mercury-sincronizar%' and active;

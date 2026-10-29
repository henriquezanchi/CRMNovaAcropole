-- Kanban por tarefa: o banco reorganiza os cards a cada 15 minutos (2026-10-29).
-- Não mexe em Matriculados/Truncados nem em card movido à mão nos últimos 3 dias.
select cron.unschedule(jobid) from cron.job where jobname = 'kanban-reorganizar';
select cron.schedule('kanban-reorganizar', '*/15 * * * *', $$select crm_reorganizar_kanban(false, true)$$);

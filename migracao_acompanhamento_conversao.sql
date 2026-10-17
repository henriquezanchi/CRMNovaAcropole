-- Aditiva. Não executar automaticamente contra produção.
-- Mantém as políticas existentes; NÃO corrige a autenticação legada.
-- Não adicionar documentos, tokens ou dados sensíveis nesse JSON.
begin;
alter table leads_inscricoes add column if not exists acompanhamento jsonb not null default '{}'::jsonb;
do $$ begin
    if not exists (select 1 from pg_constraint where conrelid = 'leads_inscricoes'::regclass and conname = 'acompanhamento_objeto') then
        alter table leads_inscricoes add constraint acompanhamento_objeto check (jsonb_typeof(acompanhamento) = 'object');
    end if;
end $$;
alter table eventos add column if not exists planejamento_conteudo jsonb not null default '{}'::jsonb;
do $$ begin
    if not exists (select 1 from pg_constraint where conrelid = 'eventos'::regclass and conname = 'planejamento_conteudo_objeto') then
        alter table eventos add constraint planejamento_conteudo_objeto check (jsonb_typeof(planejamento_conteudo) = 'object');
    end if;
end $$;
comment on column leads_inscricoes.acompanhamento is 'Origem declarada, intenção, responsável, preferência e próximo passo; sem decisões comerciais automáticas.';
-- O nome é o padrão gerado pela migração original; inspecionar o esquema antes de aplicar.
alter table evento_leads drop constraint if exists evento_leads_resposta_convite_check;
alter table evento_leads add constraint evento_leads_resposta_convite_check
    check (resposta_convite in ('pendente','talvez','confirmado','recusado'));
commit;

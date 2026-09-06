-- ============================================================
-- Migração: eventos multi-filial + conteúdo mais rico (imagem/descrição)
-- Rodar manualmente no SQL Editor do Supabase, depois de migracao_eventos.sql.
--
-- Pensado pro caso de "ciclo de abertura de turma unificada": a
-- divulgação (Instagram etc.) é feita pra um grupo de escolas da mesma
-- região como se fosse UM evento só, mas cada escola tem sua própria data/
-- vagas — e o time quer decidir, por evento, se a lista de participantes é
-- compartilhada entre as filiais do grupo ou separada por filial.
--
-- Continua 1 linha de `eventos` por FILIAL (mesmo modelo de sempre — não
-- virou uma tabela de "instâncias por filial" separada), só que agora
-- várias linhas podem compartilhar o mesmo grupo_evento_id pra indicar
-- que são a "mesma" campanha. Evento de filial única continua funcionando
-- exatamente igual, com grupo_evento_id = null.
-- ============================================================

alter table eventos add column if not exists imagem_url text;
alter table eventos add column if not exists descricao text;
alter table eventos add column if not exists grupo_evento_id text;
alter table eventos add column if not exists participantes_unificados boolean not null default false;

create index if not exists idx_eventos_grupo
    on eventos (grupo_evento_id)
    where grupo_evento_id is not null;

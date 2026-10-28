-- Memória da conversa para a IA de qualificação (2026-10-28).
-- A IA lê a conversa inteira uma vez e grava um resumo datado + perfil com prova.
-- Nas leituras seguintes, recebe o resumo e só as mensagens posteriores ao ponto de corte.
begin;
create table if not exists crm_memoria_conversa (
 filial text not null,
 pessoa text not null,
 resumo text,
 perfil jsonb not null default '{}'::jsonb,
 proximo_passo text,
 qualificacao jsonb,
 ate_mensagem_id bigint not null default 0,
 qtd_ate int not null default 0,
 transcritas jsonb not null default '[]'::jsonb,
 incrementos int not null default 0,
 modo text,
 versao text,
 gerado_em timestamptz,
 atualizado_em timestamptz not null default now(),
 primary key (filial, pessoa)
);
alter table crm_memoria_conversa enable row level security;
drop policy if exists crm_memoria_conversa_leitura on crm_memoria_conversa;
create policy crm_memoria_conversa_leitura on crm_memoria_conversa for select using (true);
-- Escrita apenas pelas Edge Functions (service_role); sem policy de escrita pública.

-- Mais fôlego diário: a leitura incremental gasta bem menos por conversa.
update crm_ia_config set limite_caracteres_dia = greatest(limite_caracteres_dia, 800000),
 limite_audios_dia = greatest(limite_audios_dia, 60) where id;

-- Fila por especialidade passa a considerar a etapa provável quando não há etapa confirmada.
create or replace view crm_fila_especialistas as
select q.*,l."pessoaNome" as nome,l.acompanhamento,
 case
 when (crm_tags_lista(l.tags)?'Contato em conferência'or crm_tags_lista(l.tags)?'Histórico em conferência')then'interno'
 when crm_tags_lista(l.tags)?'Não Contatar'or l.acompanhamento->>'contato'in('nao_contatar','pausado')or l.acompanhamento->>'intencao'in('nao','depois')or q.resultado#>>'{restricao,tipo}'in('nao_contatar','pausa')then'interno'
 when crm_retorno_futuro(l.acompanhamento)then'interno'
 when l.acompanhamento->>'proximo'='conferir'or l.acompanhamento->>'inscricao'='aguardando_registro'then'interno'
 when l.acompanhamento->>'relacao'='ativo'or crm_tags_lista(l.tags)?'Ativo'or crm_tags_lista(l.tags)?'Aluno Ativo'then'acolhimento'
 else coalesce(nullif(q.resultado->>'etapa','qualificacao'),q.resultado->>'etapa_provavel',q.resultado->>'etapa','qualificacao')end as agente
from crm_qualificacoes q join leads_inscricoes l on l."pessoaIdentificador"=q.pessoa and l.filial=q.filial and l.lixeira_em is null;

-- Releitura com as regras novas para quem já conversou (inclui as conversas travadas em erro).
update crm_qualificacoes q set versao=versao+1,estado='pendente',proxima_em=now(),erro=null,tentativas=0,atualizado_em=now()
where q.estado in ('erro','limite')
 or exists(select 1 from mensagens_whatsapp m where m.filial=q.filial and m."pessoaIdentificador"=q.pessoa and m.direcao='entrada' and m.tipo in ('texto','botao','audio'));
commit;

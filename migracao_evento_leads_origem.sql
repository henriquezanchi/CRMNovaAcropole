-- ============================================================
-- Migração: coluna `origem` em evento_leads — distingue quem CRIOU o
-- vínculo: 'ulisses' (a pessoa se inscreveu de verdade no site do
-- Ulisses/Recepção — sinal real, vindo de vincularEventoLeadsAutomaticamente()
-- em js/importador.js, ou de sincronizarComparecimentoNoCrm() em
-- scraper/ulisses.js) vs 'crm' (fomos NÓS que criamos a pendência —
-- convite manual na gaveta, vínculo manual no modal de Participantes, ou
-- convite em massa via wa.me — a pessoa ainda não necessariamente se
-- inscreveu de verdade no Ulisses).
--
-- Motivo (pedido do usuário, 2026-09-21): a contagem de "N leads
-- vinculados"/"inscritos" no card do evento e na gaveta do lead misturava
-- os dois sem distinção — SDRs ligaram oferecendo matrícula pra quem já
-- tinha se inscrito de verdade (achando que era só uma pendência nossa),
-- e uma filial mostrou "500 inscritos" numa Aula Experimental que na
-- real eram, em grande parte, convites nossos ainda sem resposta.
--
-- Rodar manualmente no SQL Editor do Supabase (ou via
-- `supabase db query --linked --file`), depois de migracao_evento_leads.sql.
-- ============================================================

alter table evento_leads
    add column if not exists origem text not null default 'crm'
        check (origem in ('ulisses', 'crm'));

comment on column evento_leads.origem is
    '''ulisses'' = inscrição real, casada a partir de dado do Ulisses (histórico de eventos ou Recepção). ''crm'' = convite/pendência criada por nós (gaveta, Participantes, convite em massa) — ainda não é inscrição confirmada no Ulisses.';

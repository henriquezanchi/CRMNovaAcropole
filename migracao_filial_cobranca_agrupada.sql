-- Jataí opera separadamente no CRM/Ulisses, mas compartilha a base
-- acadêmica de Rio Verde. Não duplica membros nem comissões importadas.
begin;
alter table public.filiais add column if not exists filial_cobranca_id bigint references public.filiais(id);
comment on column public.filiais.filial_cobranca_id is 'Filial que concentra a cobrança e a base acadêmica compartilhada; null significa cobrança própria. Não copiar membros para a filial vinculada.';
update public.filiais set filial_cobranca_id=(select id from public.filiais where nome='Rio Verde') where nome='Jataí';
commit;

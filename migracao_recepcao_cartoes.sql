-- Cartões de entrada reutilizáveis (13/11/2026): poucos cartões impressos (24), a recepção vincula o número ao
-- participante que não tem celular, a segurança lê, recolhe e devolve à recepção. A leitura libera o cartão.
alter table public.recepcao_registros drop constraint if exists recepcao_registros_tipo_check;
alter table public.recepcao_registros add constraint recepcao_registros_tipo_check
    check (tipo in ('presenca', 'desfazer', 'inscricao', 'cartao', 'cartao_lido'));
alter table public.recepcao_registros add column if not exists cartao_numero int;
create index if not exists recepcao_registros_cartao on public.recepcao_registros (evento_id_ulisses, cartao_numero, criado_em desc)
    where cartao_numero is not null;

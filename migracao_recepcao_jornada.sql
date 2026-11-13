-- Tempo da jornada na entrada (13/11/2026): a segurança registra cada leitura (QR code do celular ou cartão) e o
-- painel mede quanto tempo passou do check-in/entrega do cartão até a entrada no espaço do evento.
alter table public.recepcao_registros drop constraint if exists recepcao_registros_tipo_check;
alter table public.recepcao_registros add constraint recepcao_registros_tipo_check
    check (tipo in ('presenca', 'desfazer', 'inscricao', 'cartao', 'cartao_lido', 'validado'));
alter table public.recepcao_registros add column if not exists inicio_em timestamptz;

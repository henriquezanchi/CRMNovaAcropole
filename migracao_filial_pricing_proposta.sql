-- Pedido do usuário (2026-10-08), com a planilha real de referência:
-- "R$ Fixo" = SÓ o Módulo 2 (Máquina/SDR — o que este CRM cobre; Módulo 1
-- "Vitrine"/redes sociais é faturado à parte, fora deste sistema).
-- "Membros" NÃO é o mesmo que "Ativo" nem "Ativo+tag Membro" (testado:
-- não bateu) — é um número que a Mercúrio categoriza à parte (menu
-- "Membros" do próprio Mercúrio, ainda não scrapado por nós) — por isso
-- fica como campo MANUAL aqui, atualizado periodicamente pelo usuário,
-- em vez de calculado por heurística de tag.
--
-- Faixa do Fixo (Módulo 2), por quantidade de membros:
--   <=30 membros  => R$250
--   <=80 membros  => R$450
--   >80  membros  => R$600
-- (confirmado batendo exato com a planilha real: Jardim América 252 =>
-- R$600; Garavelo 25 => R$250; Setor Oeste 45 => R$450; Goiânia II 31
-- => R$450.)

alter table filiais add column if not exists membros integer;

-- Campos da versão anterior desta migração (modulo1_contratado,
-- desconto_pacote_pct) removidos — Módulo 1 não entra neste relatório.
alter table filiais drop column if exists modulo1_contratado;
alter table filiais drop column if exists desconto_pacote_pct;

-- Renomeado de "cobra_comissao" — mesmo campo, nome mais claro: gate do
-- fixo por faixa E da taxa de sucesso de 30%, exatamente como já era.
alter table filiais rename column cobra_comissao to modulo2_contratado;

comment on column filiais.valor_fixo_mensal_agencia is 'Override manual (R$) — se preenchido, SUBSTITUI o cálculo automático por faixa de membros. Vazio = calculado pela faixa (<=30=>R$250, <=80=>R$450, >80=>R$600).';
comment on column filiais.membros is 'Quantidade de membros (categoria própria do Mercúrio, NÃO é o mesmo que contagem de "Ativo" no CRM) — manual, atualizado periodicamente. Base da faixa de preço do Módulo 2 (Máquina/SDR).';

update filiais set membros = 252 where nome = 'Goiânia - Jardim América';
update filiais set membros = 25  where nome = 'Goiânia - Garavelo';
update filiais set membros = 45  where nome = 'Goiânia - Setor Oeste';
update filiais set membros = 31  where nome = 'Goiânia II';

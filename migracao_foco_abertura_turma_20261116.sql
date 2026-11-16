-- Foco total na abertura de turma (pedido do usuário, 16/11/2026).
-- O teto diário de campanhas (campanha_parametros.teto_diario = 100) passa a ir só para os
-- convites das aberturas de turma, pesando mais quem tem a abertura mais cedo e mais gente a convidar.
-- As outras campanhas continuam ativas (o robô segue respondendo quem já foi convidado),
-- só não planejam convites novos.
update campanhas_whatsapp set cota_diaria = case slug
    when 'turma-universitario-2026'  then 24  -- abertura 24/11, base grande
    when 'turma-jardim-america-2026' then 24  -- 26/11, base grande
    when 'turma-goiania-ii-2026'     then 14  -- 24/11
    when 'turma-setor-oeste-2026'    then 14  -- 26/11
    when 'turma-eldorado-2026'       then 12  -- 25/11
    when 'turma-catalao-2026'        then 12  -- 25/11
    else 0 end
where slug in ('turma-universitario-2026','turma-jardim-america-2026','turma-goiania-ii-2026','turma-setor-oeste-2026',
               'turma-eldorado-2026','turma-catalao-2026',
               'relacionamento-garavelo-2026-11','evento-cidade-jardim-cafe-2026','evento-cidade-jardim-cavaleiro-2026',
               'dmf-barra-2026','dmf-rio-verde-2026','dmf-2026');
-- Convites pendentes de campanhas que não são de turma: cancelados (voltam a ser candidatos se a campanha for religada).
update campanha_fila set status = 'cancelado'
where status = 'pendente' and campanha_id in (select id from campanhas_whatsapp where slug in
    ('relacionamento-garavelo-2026-11','evento-cidade-jardim-cafe-2026','evento-cidade-jardim-cavaleiro-2026','dmf-barra-2026','dmf-rio-verde-2026'));
insert into log_atividade (filial, acao, autor, detalhes)
values ('GLOBAL', 'campanhas_foco_abertura_turma', 'Claude (pedido do usuário)',
        jsonb_build_object('teto_diario', 100, 'cotas', (select jsonb_object_agg(slug, cota_diaria) from campanhas_whatsapp where cota_diaria > 0)));
select slug, cota_diaria from campanhas_whatsapp where cota_diaria > 0 order by cota_diaria desc;

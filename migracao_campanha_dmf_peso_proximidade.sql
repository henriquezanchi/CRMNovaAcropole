-- 04/11/2026, pedido do usuário: a partir de 05/11, peso maior para leads de escolas perto do local do DMF
-- (Auditório da Área 4 da PUC Goiás, Setor Leste Universitário). Distâncias em linha reta pelas coordenadas
-- dos mapas cadastrados nas escolas. O bônus vale "dias de recência" somados à prioridade: só reordena DENTRO
-- de cada grupo (A..X valem 100000 cada), nunca exclui. Fórmula: (5 - km) / 4,5 x 180 dias, zero a partir de 5 km.
-- Simulação na base de 04/11: escolas a menos de 5 km passam de 75% para 86% dos convites de 7 dias;
-- Setor Universitário de 187 para 303; as distantes continuam recebendo convites.
-- Um peso maior (meio grupo ou mais) foi testado e descartado: as escolas distantes ficavam sem nenhum convite.
update campanhas_whatsapp set config = config || jsonb_build_object(
    'peso_filial', jsonb_build_object(
        'Goiânia - Setor Universitário', 180,  -- ~0,5 km
        'Goiânia - Setor Oeste', 100,          -- ~2,5 km
        'Goiânia - Alto da Glória', 56,        -- ~3,6 km
        'Goiânia - Jardim América', 20,        -- ~4,5 km
        'Goiânia II', 0, 'Goiânia - Cidade Jardim', 0, 'Goiânia - Eldorado', 0, 'Goiânia - Garavelo', 0),
    'distancia_km', jsonb_build_object('Goiânia - Setor Universitário', 0.5, 'Goiânia - Setor Oeste', 2.5,
        'Goiânia - Alto da Glória', 3.6, 'Goiânia - Jardim América', 4.5, 'Goiânia II', 6.6,
        'Goiânia - Cidade Jardim', 7.5, 'Goiânia - Eldorado', 8.8, 'Goiânia - Garavelo', 13))
where slug = 'dmf-2026';

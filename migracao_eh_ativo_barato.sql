-- Incidente de 29/10/2026 ~17h: banco sobrecarregado (consultas simples à tabela de
-- leads com statement timeout). crm_eh_ativo() foi posta, horas antes, nas filas da
-- IA que rodam a cada 1 e 2 minutos, avaliada linha a linha; ela chamava
-- crm_tags_lista() (plpgsql com bloco de exceção = subtransação por linha) e ainda
-- consultava filiais. Versão barata: a etiqueta "Ativo: <filial>" é a fonte (recalculada
-- pela requalificação), então basta procurar o texto. Sem filial sem código do Mercúrio
-- ativa hoje; a etiqueta antiga "Ativo" não é mais considerada.
create or replace function crm_eh_ativo(p_filial text, p_pessoa text, p_tags jsonb)
returns boolean language sql immutable parallel safe as $$
 select strpos(coalesce(p_tags::text, ''), 'Ativo: ') > 0;
$$;

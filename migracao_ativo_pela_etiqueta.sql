-- Aplicar SÓ DEPOIS da 1ª rodada de crm_requalificar_leads() (ver
-- migracao_requalificacao_mercurio.sql): antes disso ninguém tem "Ativo: <filial>"
-- e o Kanban automático tiraria todos os alunos da coluna Alunos.
begin;
-- "É aluno ativo?" passa a ler a etiqueta recalculada acima (que já considera
-- a própria filial e as outras). Filial sem código do Mercúrio: etiqueta antiga.
create or replace function crm_eh_ativo(p_filial text, p_pessoa text, p_tags jsonb)
returns boolean language sql stable set search_path=public,pg_temp as $$
 select exists(select 1 from jsonb_array_elements_text(crm_tags_lista(p_tags)) t where t like 'Ativo: %')
  or (not exists(select 1 from filiais f where f.nome=p_filial and nullif(trim(f.mercurio_unidade),'') is not null)
      and coalesce(crm_tags_lista(p_tags) ?| array['Ativo','Aluno Ativo'],false));
$$;

commit;

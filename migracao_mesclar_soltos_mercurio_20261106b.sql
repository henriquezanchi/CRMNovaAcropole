-- Complemento de migracao_mesclar_soltos_mercurio_20261106.sql: 5 dos 6 pares deixados para revisão eram
-- a mesma pessoa (conferido pelo telefone/e-mail iguais aos da ficha do Mercúrio, 06/11/2026). O 6º par
-- (nomes diferentes, e-mail diferente) ficou de fora.
do $$
declare g record; r jsonb; ok int := 0; falhas jsonb := '[]';
begin
  for g in select * from (values
    ('1040048249', '518081'), ('951001699', '241292'), ('951001200', '344808'), ('951000981', '357171'), ('1041014549', '342876')
  ) v(principal, outro) loop
    begin
      r := crm_mesclar_cadastros(g.principal, array[g.outro], 'Claude (cadastro solto = ficha do Mercúrio, revisado, 06/11/2026)');
      if (r->>'ok')::boolean then ok := ok + 1; else falhas := falhas || jsonb_build_object('principal', g.principal, 'motivo', r->>'motivo'); end if;
    exception when others then falhas := falhas || jsonb_build_object('principal', g.principal, 'motivo', sqlerrm);
    end;
  end loop;
  insert into log_atividade (filial, acao, autor, detalhes)
  values ('GLOBAL', 'mesclagem_soltos_mercurio', 'Claude (cadastro solto = ficha do Mercúrio, revisado, 06/11/2026)',
          jsonb_build_object('mesclados', ok, 'falhas', falhas));
end $$;

-- 951000981 estava com telefone/e-mail que não são os dela; passa a usar os da ficha do Mercúrio
-- e o contato anterior fica como nota.
update leads_inscricoes set
  resumo_ia = concat_ws(E'\n---\n', nullif(resumo_ia, ''), 'Contato anterior no CRM (não confere com o Mercúrio): '
              || concat_ws(' ', "pessoaTelefoneDDD", "pessoaTelefoneNumero") || ' / ' || coalesce("pessoaEmail", '')),
  "pessoaTelefoneDDD" = '62', "pessoaTelefoneNumero" = '984893465',
  "pessoaEmail" = (select email from mercurio_pessoas where matricula = 23076 and pessoa_identificador = '951000981' limit 1)
where "pessoaIdentificador" = '951000981' and "pessoaTelefoneNumero" is distinct from '984893465';

select detalhes::text from log_atividade where acao = 'mesclagem_soltos_mercurio' order by criado_em desc limit 1;

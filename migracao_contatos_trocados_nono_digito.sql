-- Complemento de migracao_contatos_trocados_id_reaproveitado.sql: o telefone veio de
-- mercurio_pessoas.tel_chave, que é a chave SEM o nono dígito. Celular de 8 dígitos
-- começando em 6-9 recebe o 9 de volta; fixo (2-5) fica como está.
update leads_inscricoes
set "pessoaTelefoneNumero" = '9' || "pessoaTelefoneNumero"
where "pessoaIdentificador" in (select jsonb_array_elements_text(pessoa_ids) from log_atividade where acao = 'correcao_contato_trocado')
  and length("pessoaTelefoneNumero") = 8 and "pessoaTelefoneNumero" ~ '^[6-9]';

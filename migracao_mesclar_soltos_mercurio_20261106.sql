-- Cadastros sem vínculo com o Mercúrio que são a mesma pessoa de uma ficha da MESMA escola (06/11/2026).
-- Achados cruzando telefone/e-mail com mercurio_pessoas (mesma técnica do caso "Teste Fernanda").
-- Ficaram fora, para revisão humana: nomes que podem ser parentes (gênero trocado, primeiro nome
-- diferente, sobrenome diferente).

-- 1. Mesma pessoa, já existe o cadastro ligado à ficha: o cadastro solto é mesclado nele.
do $$
declare g record; r jsonb; ok int := 0; falhas jsonb := '[]';
begin
  for g in select * from (values
    ('1039032321', '418302'), ('1040035198', '426660'), ('951001517', '284680'), ('951001245', '343291'),
    ('951000809', '371164'), ('1041026898', '377876'), ('1041032372', '415874'), ('1041009558', '298915'),
    ('1041024974', '366894'), ('1041023907', '360251'), ('940000015', '549788')
  ) v(principal, outro) loop
    begin
      r := crm_mesclar_cadastros(g.principal, array[g.outro], 'Claude (cadastro solto = ficha do Mercúrio, 06/11/2026)');
      if (r->>'ok')::boolean then ok := ok + 1; else falhas := falhas || jsonb_build_object('principal', g.principal, 'motivo', r->>'motivo'); end if;
    exception when others then falhas := falhas || jsonb_build_object('principal', g.principal, 'motivo', sqlerrm);
    end;
  end loop;
  insert into log_atividade (filial, acao, autor, detalhes)
  values ('GLOBAL', 'mesclagem_soltos_mercurio', 'Claude (cadastro solto = ficha do Mercúrio, 06/11/2026)',
          jsonb_build_object('mesclados', ok, 'falhas', falhas));
end $$;

-- 2. Ficha do Mercúrio sem nenhum cadastro ligado: o cadastro solto recebe a matrícula (a
--    sincronização das 03:00 faz o vínculo e a requalificação aplica as etiquetas).
update leads_inscricoes l set matricula_mercurio = v.matr
from (values ('487044', 52914), ('554952', 52917), ('558577', 53386), ('559992', 53385)) v(pid, matr)
where l."pessoaIdentificador" = v.pid and l.matricula_mercurio is null
  and not exists (select 1 from leads_inscricoes x where x.filial = l.filial and x.matricula_mercurio = v.matr);

insert into log_atividade (filial, acao, autor, pessoa_ids, detalhes)
values ('GLOBAL', 'vincular_matricula_mercurio', 'Claude (cadastro solto = ficha do Mercúrio, 06/11/2026)',
        '["487044","554952","558577","559992"]'::jsonb, jsonb_build_object('matriculas', '[52914,52917,53386,53385]'::jsonb));

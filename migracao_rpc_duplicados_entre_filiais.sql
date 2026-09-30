-- Detecção (só leitura, não mescla nada sozinho) de leads com o MESMO
-- telefone cadastrados em 2+ FILIAIS diferentes — gap já documentado no
-- CLAUDE.md ("Duplicado CROSS-FILIAL não é coberto por esta tela", achado
-- investigando o caso real "Giorgia Tomitão Mário"/"Giorgia Tomitao
-- Mario", a mesma pessoa em Jardim América e Goiânia II). Pedido do
-- usuário (2026-09-30, "o que pode melhorar"): "Duplicados cross-filial
-- residuais... ainda depende do histórico de mensagem pra desambiguar
-- sozinho" — isso resolve a AMBIGUIDADE de mensagem (whatsapp-webhook,
-- resolverAmbiguidadePorHistorico()) só depois que alguém já mandou
-- mensagem; esta função dá VISIBILIDADE antes disso, pra revisão manual
-- (mesclar ou não é decisão do time — pessoas diferentes podem
-- legitimamente compartilhar telefone, ex: cônjuges).
--
-- Normaliza o telefone tirando o 9º dígito de celular (mesma lógica de
-- normalizarTelefoneParaChave(), js/importador.js) — sem isso, "com 9" e
-- "sem 9" do MESMO número em filiais diferentes não bateriam.
--
-- Rodar manualmente: npx supabase db query --linked --file migracao_rpc_duplicados_entre_filiais.sql
create or replace function duplicados_entre_filiais(p_limite int default 100)
returns table (
    chave_telefone text,
    total_membros int,
    membros jsonb
)
language sql
stable
as $$
    select
        l."pessoaTelefoneDDD" || '-' || (
            case when length(l."pessoaTelefoneNumero") = 9 then right(l."pessoaTelefoneNumero", 8) else l."pessoaTelefoneNumero" end
        ) as chave_telefone,
        count(*)::int as total_membros,
        jsonb_agg(jsonb_build_object(
            'pessoaIdentificador', l."pessoaIdentificador",
            'pessoaNome', l."pessoaNome",
            'filial', l.filial,
            'tags', l.tags,
            'telefone', l."pessoaTelefoneDDD" || l."pessoaTelefoneNumero"
        ) order by l.filial) as membros
    from leads_inscricoes l
    where l.lixeira_em is null
      and l."pessoaTelefoneDDD" is not null and l."pessoaTelefoneDDD" <> ''
      and l."pessoaTelefoneNumero" is not null and length(l."pessoaTelefoneNumero") >= 8
      -- Exclui telefone "placeholder" (todos os dígitos iguais, ex:
      -- "000000000"/"999999999") — achado real testando: um número assim
      -- juntava 4 pessoas completamente sem relação (Maria do Carmo,
      -- Thaynara, Marcos, Arciune), só porque a planilha original usou o
      -- mesmo valor genérico pra "sem telefone de verdade".
      and l."pessoaTelefoneNumero" !~ '^(\d)\1*$'
    group by 1
    having count(distinct l.filial) > 1
    order by count(*) desc
    limit p_limite;
$$;

grant execute on function duplicados_entre_filiais(int) to anon, authenticated;

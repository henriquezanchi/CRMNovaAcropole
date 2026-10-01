-- Pedido do usuário (2026-10-01): disparar o convite novo (convite_palestra)
-- pra TODOS os leads de cada filial com evento hoje, EXCETO quem já é
-- Ativo — o inverso de leads_por_tag_filial() (que filtra POR tag). Sem
-- isso, o PostgREST exige buscar tudo no navegador e filtrar lá (lento e
-- sujeito ao limite de 1000 linhas por página, mesmo risco já documentado
-- várias vezes neste projeto). Mesma técnica de cast jsonb já usada em
-- leads_ativos_inativos_da_filial()/leads_por_tag_filial().
--
-- Exclui, além de quem tem qualquer tag da lista (`p_tags_excluir`, pra
-- cobrir "Ativo" E o nome antigo "Aluno Ativo"): quem está na lixeira,
-- quem não tem telefone cadastrado (não dá pra mandar WhatsApp mesmo),
-- quem já confirmou presença no evento passado em `p_evento_id` (mesma
-- regra já usada em "Convidar (API)"/gerarPreviaConviteApiLote() — nunca
-- convida de novo quem já vai), e quem já foi CONTATADO HOJE
-- (`ultimo_contato_em`) — adicionado depois do disparo real de 2026-10-01
-- ter travado na metade (bug + "Spam Rate limit hit" da Meta): sem isso,
-- relançar o script pra retomar as filiais que faltaram reenviaria pros
-- mesmos ~244 leads que já receberam a mensagem na 1ª leva.
create or replace function leads_excluindo_tags_filial(
    p_filial text,
    p_tags_excluir text[],
    p_evento_id bigint default null,
    p_limite int default 1000,
    p_offset int default 0
)
returns table (
    "pessoaIdentificador" text,
    "pessoaNome" text,
    "pessoaTelefoneDDD" text,
    "pessoaTelefoneNumero" text,
    filial text
)
language sql
stable
as $$
    select l."pessoaIdentificador", l."pessoaNome", l."pessoaTelefoneDDD", l."pessoaTelefoneNumero", l.filial
    from leads_inscricoes l
    where l.filial = p_filial
      and l.lixeira_em is null
      and l."pessoaTelefoneNumero" is not null
      and l."pessoaTelefoneNumero" <> ''
      and not ((l.tags #>> '{}')::jsonb ?| p_tags_excluir)
      and (l.ultimo_contato_em is null or l.ultimo_contato_em::date <> current_date)
      and (
          p_evento_id is null
          or not exists (
              select 1 from evento_leads el
              where el.evento_id = p_evento_id
                and el."pessoaIdentificador" = l."pessoaIdentificador"
                and el.resposta_convite = 'confirmado'
          )
      )
    order by l."pessoaIdentificador"
    limit p_limite offset p_offset;
$$;

grant execute on function leads_excluindo_tags_filial(text, text[], bigint, int, int) to anon, authenticated;

-- Contagem rápida, sem paginar — só pra mostrar o tamanho do lote antes
-- de disparar (evita ter que paginar tudo só pra contar).
create or replace function contagem_leads_excluindo_tags_filial(
    p_filial text,
    p_tags_excluir text[],
    p_evento_id bigint default null
)
returns bigint
language sql
stable
as $$
    select count(*)
    from leads_inscricoes l
    where l.filial = p_filial
      and l.lixeira_em is null
      and l."pessoaTelefoneNumero" is not null
      and l."pessoaTelefoneNumero" <> ''
      and not ((l.tags #>> '{}')::jsonb ?| p_tags_excluir)
      and (l.ultimo_contato_em is null or l.ultimo_contato_em::date <> current_date)
      and (
          p_evento_id is null
          or not exists (
              select 1 from evento_leads el
              where el.evento_id = p_evento_id
                and el."pessoaIdentificador" = l."pessoaIdentificador"
                and el.resposta_convite = 'confirmado'
          )
      );
$$;

grant execute on function contagem_leads_excluindo_tags_filial(text, text[], bigint) to anon, authenticated;

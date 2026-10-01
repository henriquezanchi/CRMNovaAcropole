-- Pedido do usuário (2026-10-01): "os responsáveis pela conversa também
-- estão errados... A Edilene está como responsável por algumas
-- conversas, mas nem no crm ela entrou ainda". Causa raiz: a fila
-- automática antiga (`atribuirAtendenteSeNecessario()`,
-- whatsapp-webhook) escolhia por "menor carga" entre QUALQUER usuário
-- com módulo tab-whatsapp ativo em `usuarios_crm` — inclusive contas
-- criadas mas nunca logadas. Removida do código (ver whatsapp-webhook/
-- index.ts) e substituída por atribuição baseada em ATIVIDADE REAL,
-- feita direto em whatsapp-send a partir de agora.
--
-- Esta migração só CORRIGE o que já está errado no banco, recalculando
-- `wpp_atendente_responsavel` a partir da ÚLTIMA mensagem de SAÍDA real
-- de cada lead:
--   - último envio foi um TEMPLATE (tipo='template') → quase sempre
--     origem de disparo em massa/automático → "API".
--   - último envio foi TEXTO (tipo='texto', resposta de verdade digitada
--     por alguém) → nome de quem mandou (atendente_nome).
--   - lead nunca recebeu nenhuma mensagem de saída → limpa (null), não
--     inventa responsável pra conversa que ninguém nunca tocou.
with ultima_saida as (
    select distinct on (m."pessoaIdentificador")
        m."pessoaIdentificador", m.tipo, m.atendente_nome
    from mensagens_whatsapp m
    where m.direcao = 'saida' and m."pessoaIdentificador" is not null
    order by m."pessoaIdentificador", m.criado_em desc
)
update leads_inscricoes l
set wpp_atendente_responsavel = case
    when u.tipo = 'template' then 'API'
    when u.tipo = 'texto' and u.atendente_nome is not null and u.atendente_nome <> '' then u.atendente_nome
    else null
end
from ultima_saida u
where u."pessoaIdentificador" = l."pessoaIdentificador";

-- Leads com responsável gravado mas SEM nenhuma mensagem de saída de
-- verdade (resíduo puro da fila antiga, nunca tiveram envio nenhum) —
-- limpa.
update leads_inscricoes l
set wpp_atendente_responsavel = null
where wpp_atendente_responsavel is not null
  and not exists (
      select 1 from mensagens_whatsapp m
      where m."pessoaIdentificador" = l."pessoaIdentificador" and m.direcao = 'saida'
  );

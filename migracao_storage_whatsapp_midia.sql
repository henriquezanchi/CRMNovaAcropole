-- ============================================================
-- Migração: bucket de Storage pra anexos livres do WhatsApp (foto ou
-- documento escolhido pelo SDR no compose bar, ver enviarComAnexo(),
-- js/whatsapp.js) — pedido do usuário (2026-09-28), primeira vez que o
-- projeto usa Supabase Storage (até aqui era 100% sem servidor de
-- arquivo próprio, decisão deliberada — ver CLAUDE.md).
--
-- PÚBLICO de propósito, mesmo padrão de `eventos.imagem_url` (também
-- uma URL pública, vinda do Ulisses ou colada na mão): a Meta busca o
-- arquivo POR LINK antes de mandar a mensagem (`whatsapp-send` só passa
-- `{link: url}` pra Graph API, nunca faz upload de mídia de verdade) —
-- sem o bucket ser público, a Meta não conseguiria buscar o arquivo.
-- Mesmo modelo de confiança já documentado pro resto do projeto ("não é
-- proteção contra atacante determinado, e sim manter gente honesta
-- honesta") — qualquer um com o link direto do arquivo consegue abrir,
-- igual qualquer imagem hoje já hospedada externamente.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('whatsapp-midia', 'whatsapp-midia', true)
on conflict (id) do nothing;

-- Mesmo padrão de acesso público de TODA outra tabela do projeto (RLS
-- using(true) with check(true)) — a chave publishable do navegador já
-- upload/lê tudo mais, sem policy nenhuma isto ficaria bloqueado (RLS
-- do Storage nega por padrão sem policy).
drop policy if exists "acesso publico storage whatsapp-midia" on storage.objects;
create policy "acesso publico storage whatsapp-midia"
    on storage.objects for all
    using (bucket_id = 'whatsapp-midia')
    with check (bucket_id = 'whatsapp-midia');

-- Pin/fixar e arquivar conversa + ocultar mensagem enviada (só na nossa
-- tela) — pedido do usuário (2026-09-30): "implemente tudo que falta no
-- WhatsApp, igual no whatsapp real" (feature parity, itens que ainda
-- faltavam: pin/arquivar conversa; apagar mensagem enviada — a Meta Cloud
-- API não tem endpoint pra editar/apagar de verdade uma mensagem já
-- entregue, então "apagar" aqui é sempre um OCULTAR só na nossa
-- visualização, nunca no celular do lead).
--
-- Rodar manualmente: npx supabase db query --linked --file migracao_whatsapp_pin_arquivar_ocultar.sql

-- 1) Pin/arquivar — cada lead tem no máximo 1 conversa de WhatsApp (1:1),
--    então vive direto em leads_inscricoes, mesmo padrão de qualquer outro
--    campo simples do lead. A tabela já tem RLS pública (using(true) with
--    check(true)) de uma migração anterior — colunas novas herdam a MESMA
--    policy automaticamente (RLS é por LINHA, não por coluna), então não
--    precisa de nenhuma policy nova aqui.
alter table leads_inscricoes add column if not exists wpp_fixado boolean not null default false;
alter table leads_inscricoes add column if not exists wpp_arquivado boolean not null default false;

-- 2) Ocultar mensagem enviada — `mensagens_whatsapp` só tinha 1 policy de
--    UPDATE bem restrita (só libera linha com pessoaIdentificador ainda
--    nulo, pra "vincular conversa não identificada" — ver migracao_whatsapp.sql).
--    "Ocultar" precisa mexer em QUALQUER mensagem de saída já vinculada,
--    então precisa de uma policy própria — mesmo modelo de acesso já usado
--    em todo o resto do projeto (a chave publishable já dá acesso total a
--    quem tiver o código-fonte, com ou sem essa policy extra; não é uma
--    proteção nova nem uma remoção de proteção existente).
alter table mensagens_whatsapp add column if not exists oculta_em timestamptz;

drop policy if exists "ocultar mensagem enviada" on mensagens_whatsapp;
create policy "ocultar mensagem enviada"
    on mensagens_whatsapp for update
    using (true)
    with check (true);

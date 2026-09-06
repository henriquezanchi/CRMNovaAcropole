-- ============================================================
-- Migração: coluna "familia" em tags_sugeridas (grupo editável)
-- Rodar manualmente no SQL Editor do Supabase (mesmo fluxo das migrações
-- anteriores). Antes, o grupo de cada tag do catálogo era decidido só
-- automaticamente por padrão de texto — agora dá pra escolher/mover o
-- grupo manualmente em "Gerenciar Tags". Tags SEM família aqui continuam
-- caindo no padrão automático (classeVisualTag()/FAMILIAS_TAG em
-- js/app.js) — essa coluna é só um jeito de SOBRESCREVER isso quando
-- quiser.
-- ============================================================

alter table tags_sugeridas add column if not exists familia text;

-- Preenche a família inicial das tags já semeadas por migracao_tags_sugeridas.sql,
-- batendo com a classificação automática que elas já tinham — assim nada
-- muda de cor até alguém mover manualmente pelo "Gerenciar Tags". Se uma
-- tag já tiver família definida (por já ter sido movida manualmente antes
-- de rodar essa migração, cenário raro), não mexe nela.
update tags_sugeridas set familia = 'Engajamento / SDR'
    where familia is null and tag in (
        'Não Atende / Caixa Postal', 'Não responde mensagens', 'Ligar à Noite',
        'Ligar no Sábado', 'WhatsApp Inválido', 'No-Show', 'Lista de Espera'
    );

update tags_sugeridas set familia = 'Objeções'
    where familia is null and tag in (
        'Objeção: Tempo', 'Objeção: Filhos pequenos', 'Objeção: Financeiro', 'Objeção: Distância/Trânsito'
    );

update tags_sugeridas set familia = 'Interesses / Origem'
    where familia is null and tag in (
        'Interesse: Estoicismo', 'Interesse: Platão / Filosofia Clássica', 'Interesse: Mitologia / A Odisseia',
        'Busca Autoconhecimento', 'Sábado Filosófico', 'Filosofilme', 'Voluntariado', 'Indicação de Aluno'
    );

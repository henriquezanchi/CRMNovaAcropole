-- ============================================================
-- Migração: critérios configuráveis de pontuação do "Lead Forte"
-- Rodar manualmente no SQL Editor do Supabase (mesmo fluxo das migrações
-- anteriores). Linha única (id = 1) — os pesos ficam em DADOS, não em
-- código, pra dar pra ajustar depois (ex: após analisar estatisticamente
-- quem realmente converteu em aluno) sem precisar editar js/importador.js.
-- ============================================================

create table if not exists config_pontuacao_lead_forte (
    id                          int primary key default 1,
    pontos_por_evento           int not null default 10, -- pontos por evento que a pessoa participou
    pontos_por_tipo_distinto    int not null default 5,  -- bônus por TIPO distinto de evento (Palestra, Curso, Oficina...) — recompensa diversidade, não só quantidade
    pontos_evento_recente_dias  int not null default 90, -- janela (em dias) considerada "engajamento recente"
    bonus_evento_recente        int not null default 15, -- bônus se o evento mais recente da pessoa caiu dentro dessa janela
    limite_nivel_1              int not null default 40, -- pontuação mínima pra virar "Lead Forte 1" (mais propenso a matricular)
    limite_nivel_2              int not null default 20, -- pontuação mínima pra virar "Lead Forte 2" (abaixo disso = "Lead Forte 3")
    atualizado_em               timestamptz not null default now(),
    constraint id_fixo check (id = 1) -- garante que a tabela nunca tenha mais de 1 linha
);

insert into config_pontuacao_lead_forte (id) values (1)
    on conflict (id) do nothing;

alter table config_pontuacao_lead_forte enable row level security;

-- Leitura e escrita públicas — mesmo modelo de acesso do resto do app
-- (chave publishable, sem login). A tela "Configurar critérios de Lead
-- Forte" (aba Importar) escreve direto nesta tabela pelo navegador.
drop policy if exists "acesso publico config_pontuacao_lead_forte" on config_pontuacao_lead_forte;
create policy "acesso publico config_pontuacao_lead_forte"
    on config_pontuacao_lead_forte for all
    using (true)
    with check (true);

-- ============================================================
-- SUPERSEDIDA por migracao_tipos_evento_trilha.sql (abaixo/na raiz do
-- projeto) — mantida só como histórico, NÃO RODAR se ainda não rodou.
--
-- Por quê: esta migração criava uma tabela SEPARADA (trilhas_tipo_evento)
-- com um vocabulário de tipos INDEPENDENTE do catálogo tipos_evento da
-- Agenda de Eventos. O usuário pediu explicitamente que a lista de tipos
-- de evento seja UMA SÓ — gerenciada inteiramente pela tela "Gerenciar
-- Tipos" da Agenda — e que qualquer edição lá (nome, trilha) se reflita
-- em todos os lugares, inclusive na classificação automática da
-- importação. A solução virou 2 colunas novas (trilha, palavras_chave)
-- direto na tabela tipos_evento, não uma tabela nova. Ver
-- migracao_tipos_evento_trilha.sql.
--
-- Se você já rodou esta migração antes de ler isto, sem problema: a
-- tabela trilhas_tipo_evento fica só sem uso (nada no código a referencia
-- mais), pode ignorar ou apagar manualmente.
-- ============================================================

create table if not exists trilhas_tipo_evento (
    tipo_evento text primary key,
    trilha      text
);

insert into trilhas_tipo_evento (tipo_evento, trilha) values
    ('Palestra', 'Filosófica'),
    ('Workshop', null),
    ('Oficina', 'Artes'),
    ('Curso', 'Desenvolvimento Pessoal'),
    ('Mostra / Aula Experimental', 'Filosófica'),
    ('Clube do Livro', 'Filosófica'),
    ('Filosofilme', 'Filosófica'),
    ('Café Cultural', 'Filosófica'),
    ('Outro', null)
on conflict (tipo_evento) do nothing;

alter table trilhas_tipo_evento enable row level security;

drop policy if exists "acesso publico trilhas_tipo_evento" on trilhas_tipo_evento;
create policy "acesso publico trilhas_tipo_evento"
    on trilhas_tipo_evento for all
    using (true)
    with check (true);

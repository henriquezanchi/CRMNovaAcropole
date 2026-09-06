-- ============================================================
-- Migração: Trilha + Palavras-chave em tipos_evento (classificação
-- automática unificada). Rodar manualmente no SQL Editor do Supabase,
-- depois de migracao_tipos_evento.sql. SUPERSEDE migracao_trilhas_tipo_evento.sql
-- (não rode aquela se ainda não rodou).
--
-- Duas colunas novas na tabela tipos_evento (o MESMO catálogo editável em
-- "Gerenciar Tipos" na Agenda de Eventos):
--
--   trilha         -> "Filosófica" / "Desenvolvimento Pessoal" / "Artes" / null.
--                     Base do sistema de follow-up (Trilhas de Interesse +
--                     Estágio da Jornada, ver CLAUDE.md) — cada lead ganha
--                     uma tag "Trilha: X" por trilha já frequentada.
--
--   palavras_chave -> lista separada por vírgula de palavras/frases que,
--                     se encontradas (sem distinção de maiúsculas) no NOME
--                     do evento vindo da planilha de Inscrições, classificam
--                     aquele evento como este tipo na hora da importação
--                     (historico_eventos[].tipo). Substitui o classificador
--                     hardcoded antigo (REGRAS_TIPO_EVENTO, js/importador.js)
--                     — agora é 100% dirigido por dados, editável em
--                     "Gerenciar Tipos" sem precisar de código novo. Um
--                     tipo sem palavras-chave nunca é atingido
--                     automaticamente (só serve pra cadastro manual na
--                     Agenda) — é o caso de "Outro", que já era o fallback.
--
-- IMPORTANTE — antes desta migração, o classificador (REGRAS_TIPO_EVENTO)
-- e o catálogo tipos_evento tinham vocabulários PARECIDOS mas não
-- idênticos (ex: "Mostra / Aula Experimental" vs. "Aula Inaugural",
-- "Clube do Livro" vs. "Leitura Comentada"). Os valores de palavras_chave
-- abaixo foram escolhidos pra reproduzir EXATAMENTE o comportamento antigo
-- (mesmos eventos classificados da mesma forma), então rodar esta migração
-- não muda a classificação de nenhum evento já existente — a única
-- exceção é "Abertura de Turma", que antes não tinha palavra-chave
-- nenhuma (todo evento assim caía em "Outro") e agora passa a reconhecer
-- o próprio nome.
-- ============================================================

alter table tipos_evento add column if not exists trilha text;
alter table tipos_evento add column if not exists palavras_chave text;

update tipos_evento set trilha = 'Filosófica',              palavras_chave = 'PALESTRA'                where nome = 'Palestra';
update tipos_evento set trilha = null,                       palavras_chave = 'WORKSHOP'                where nome = 'Workshop';
update tipos_evento set trilha = 'Artes',                    palavras_chave = 'OFICINA'                 where nome = 'Oficina';
update tipos_evento set trilha = 'Desenvolvimento Pessoal',  palavras_chave = 'CURSO'                   where nome = 'Curso';
update tipos_evento set trilha = 'Filosófica',              palavras_chave = 'MOSTRA,AULA EXPERIMENTAL' where nome = 'Aula Inaugural';
update tipos_evento set trilha = 'Filosófica',              palavras_chave = 'CLUBE DO LIVRO'           where nome = 'Leitura Comentada';
update tipos_evento set trilha = 'Filosófica',              palavras_chave = 'FILOSOFILME'              where nome = 'Filosofilme';
update tipos_evento set trilha = 'Filosófica',              palavras_chave = 'CAFÉ COM,CAFE COM'        where nome = 'Café Cultural';
update tipos_evento set trilha = 'Filosófica',              palavras_chave = 'ABERTURA DE TURMA'        where nome = 'Abertura de Turma';
update tipos_evento set trilha = null,                       palavras_chave = null                       where nome = 'Outro';

-- Conserta ulisses-api-semana-evento e ulisses-api-reta-final (31/10/2026).
-- Desde 29/10 os dois falhavam toda vez com "query has no destination for result data": o comando copiado do
-- ulisses-api-diario começa com uma quebra de linha, então o "^select" de migracao_ulisses_api_nuvem.sql nunca
-- casava e o "select net.http_post(...)" ficava dentro do bloco PL/pgSQL, onde precisa ser "perform".
-- Só troca esse trecho no comando que já está agendado; horário e regra continuam iguais.
update cron.job
set command = regexp_replace(command, 'then\s+select\s+net\.http_post', 'then perform net.http_post')
where jobname in ('ulisses-api-semana-evento', 'ulisses-api-reta-final')
  and command ~ 'then\s+select\s+net\.http_post';

select jobname, command ~ 'then perform net\.http_post' as corrigido from cron.job
where jobname in ('ulisses-api-semana-evento', 'ulisses-api-reta-final');

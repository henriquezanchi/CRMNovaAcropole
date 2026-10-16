-- Alarga a constraint de `sistema` em status_sincronizacao_automatica
-- pra aceitar 'mercury_api' (API externa do Mercury v2, ver
-- mercury-sincronizar) — mesmo padrão já usado várias vezes pra
-- credenciais_scraper.sistema (mercurio_http/crm_acesso/ulisses_api).
--
-- BUG REAL achado nesta sessão: a Edge Function mercury-sincronizar
-- gravava `sistema: 'mercury_api'` sem nunca checar o erro do `.insert()`
-- — a constraint antiga só aceitava 'ulisses'/'mercurio', então TODA
-- tentativa de log falhava silenciosamente (0 linhas gravadas, nenhum
-- erro visível em lugar nenhum). A sincronização em si funcionou
-- normalmente o tempo todo (o log é só auditoria) — mas sem essa
-- correção, o gatilho 5 da Central de Notificações / qualquer
-- diagnóstico futuro nunca saberia que esse sistema existe.
alter table status_sincronizacao_automatica
    drop constraint status_sincronizacao_automatica_sistema_check;

alter table status_sincronizacao_automatica
    add constraint status_sincronizacao_automatica_sistema_check
    check (sistema = any (array['ulisses', 'mercurio', 'mercury_api']));

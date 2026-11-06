-- Pausa os convites da abertura de turma do Alto da Glória (a escola ainda não aderiu
-- oficialmente, pedido do usuário 06/11/2026). A campanha continua ativa para o robô
-- seguir respondendo quem já foi convidado; só não planeja nem envia convites novos.
-- Para retomar: cota_diaria de volta a 4.
update campanhas_whatsapp set cota_diaria = 0 where slug = 'turma-alto-da-gloria-2026';
update campanha_fila set status = 'cancelado'
where status = 'pendente' and campanha_id = (select id from campanhas_whatsapp where slug = 'turma-alto-da-gloria-2026');
select slug, cota_diaria, (select count(*) from campanha_fila f where f.campanha_id = c.id and f.status = 'cancelado') cancelados,
       (select count(*) from campanha_fila f where f.campanha_id = c.id and f.status = 'enviado') enviados
from campanhas_whatsapp c where slug = 'turma-alto-da-gloria-2026';

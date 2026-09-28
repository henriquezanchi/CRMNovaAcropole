-- Pedido do usuário (2026-09-28, depois de reunião com a Ediliene): "as
-- pessoas duplicadas ficam com problemas nas tags... isso dificulta o
-- contato mais assertivo" — hoje o card de grupo em "Leads a Tratar" só
-- mostra nome/telefone/e-mail de cada membro, nunca as tags, então dava
-- pra decidir mesclar sem perceber que os dois lados têm tags diferentes
-- (ex: um "Ativo", outro "Lead Forte 1"). Guarda um snapshot das tags de
-- cada membro no momento da varredura (mesmo espírito de pessoa_nome/
-- pessoa_telefone/pessoa_email, que já são snapshot, não live).
alter table leads_a_tratar add column if not exists pessoa_tags text;

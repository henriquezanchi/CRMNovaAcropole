-- Coluna link_inscricao em eventos: URL pública de inscrição (Ulisses ou
-- outra), pra virar {linkInscricao} nas mensagens de convite/divulgação —
-- editável no mesmo modal de Evento onde já ficam imagem_url/ingresso.
-- Sem isso, o link tinha que ser colado manualmente toda vez numa mensagem.
alter table eventos add column if not exists link_inscricao text;

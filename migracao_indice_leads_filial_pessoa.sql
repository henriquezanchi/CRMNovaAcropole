-- Índice para a busca paginada "leads desta filial, em ordem de pessoaIdentificador"
-- (importação, Kanban, Leads a Tratar, matrícula). Sem ele o banco varria a tabela
-- inteira pelo índice de pessoaIdentificador e descartava as outras filiais:
-- 1,7 s por página em Jardim América. Em 30/10/2026 isso estourou o limite de tempo
-- da importação automática do Ulisses ("statement timeout") justamente nessa filial.
create index concurrently if not exists idx_leads_filial_pessoa
    on public.leads_inscricoes (filial, "pessoaIdentificador");

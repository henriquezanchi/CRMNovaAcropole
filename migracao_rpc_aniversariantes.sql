-- Bug real achado em produção (2026-09-10): a Agenda do Dia (Todas as
-- Filiais) buscava aniversariantes de hoje com um `.select()` simples,
-- sem filtro de mês/dia no servidor — só filtrava DEPOIS de baixar tudo
-- pro navegador. Com 2962 leads já tendo data_nascimento preenchida
-- (bem acima do limite PADRÃO de 1000 linhas por página do PostgREST),
-- o resultado vinha truncado e 3 dos 6 aniversariantes reais do dia
-- simplesmente nunca chegavam ao navegador — sem erro nenhum, silencioso.
--
-- Resolvido com uma função SQL que filtra por MÊS (e opcionalmente por
-- filial) direto no banco — usada tanto pela Agenda do Dia (todas as
-- filiais, filtra o DIA certo depois, client-side, sobre um resultado já
-- pequeno) quanto pelo card "Aniversariantes do Mês" do Dashboard
-- (por filial).
-- 2026-09-28: ganhou como_prefere_ser_chamado — sem isso, o botão
-- "Enviar" rápido (enviarAniversarioRapido()) só tinha o pessoaNome CRU
-- (geralmente TUDO EM CAIXA ALTA, vindo da planilha) pra mandar no
-- template, produzindo uma mensagem com cara de "copiado e colado"
-- (nome completo, sem formatação natural) — pedido do usuário pra usar
-- a MESMA política de nomeParaChamar()/primeiroNomeFormatado() (js/app.js)
-- já usada em todo outro {nome} automático do app.
create or replace function aniversariantes_por_mes(p_mes int, p_filial text default null)
returns table (
    "pessoaIdentificador" text,
    "pessoaNome" text,
    filial text,
    data_nascimento date,
    como_prefere_ser_chamado text
)
language sql
stable
as $$
    select "pessoaIdentificador", "pessoaNome", filial, data_nascimento, como_prefere_ser_chamado
    from leads_inscricoes
    where data_nascimento is not null
      and extract(month from data_nascimento) = p_mes
      and (p_filial is null or filial = p_filial)
    order by extract(day from data_nascimento);
$$;

grant execute on function aniversariantes_por_mes(int, text) to anon, authenticated;

-- PIN do diretor no painel de resultados (05/11/2026, pedido do usuário).
-- Só com o link, os dados pessoais ficam borrados (nome abreviado, telefone
-- mascarado — o borrão é feito no servidor, em painel-resultados). Com o PIN da
-- escola, o diretor vê tudo e pode agir: marcar "Não Contatar", escrever uma
-- observação no lead, mudar a data limite de uma abertura de turma. O PIN é
-- definido/redefinido pelo administrador em "Gerenciar Filiais" (CRM).

alter table painel_resultados_links
    add column if not exists pin_hash text,
    add column if not exists pin_definido_em timestamptz,
    add column if not exists pin_tentativas int not null default 0,
    add column if not exists pin_bloqueado_ate timestamptz;

-- Sessão do diretor: 12 h no aparelho. Guarda só o hash do token.
create table if not exists painel_sessoes (
    id bigserial primary key,
    link_id bigint not null references painel_resultados_links(id) on delete cascade,
    token_hash text unique not null,
    expira_em timestamptz not null,
    criado_em timestamptz not null default now()
);
alter table painel_sessoes enable row level security; -- sem policy: só service_role
create index if not exists painel_sessoes_expira_idx on painel_sessoes (expira_em);

-- Definir/redefinir o PIN pelo CRM. A chave publishable já dá acesso ao banco,
-- então a trava aqui é a mesma do CRM: nome + hash da senha de um admin ativo.
create or replace function painel_definir_pin(p_filial text, p_pin text, p_usuario text, p_senha_hash text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_link bigint;
begin
    if not exists (select 1 from usuarios_crm u where u.nome = p_usuario and u.senha_hash = p_senha_hash and u.eh_admin and u.ativo) then
        return jsonb_build_object('ok', false, 'erro', 'Usuário ou senha incorretos, ou sem permissão de administrador.');
    end if;
    if p_pin !~ '^[0-9]{6}$' then
        return jsonb_build_object('ok', false, 'erro', 'O PIN precisa ter exatamente 6 números.');
    end if;
    select id into v_link from painel_resultados_links
    where revogado_em is null and filiais = array[p_filial] order by id limit 1;
    if v_link is null then
        return jsonb_build_object('ok', false, 'erro', 'Esta escola ainda não tem painel.');
    end if;
    update painel_resultados_links
       set pin_hash = encode(extensions.digest(v_link::text || ':' || p_pin, 'sha256'), 'hex'),
           pin_definido_em = now(), pin_tentativas = 0, pin_bloqueado_ate = null
     where id = v_link;
    delete from painel_sessoes where link_id = v_link; -- PIN novo derruba sessões antigas
    insert into log_atividade (filial, acao, autor, pessoa_ids, detalhes)
    values (p_filial, 'painel_pin_definido', p_usuario, '[]'::jsonb, jsonb_build_object('link_id', v_link));
    return jsonb_build_object('ok', true, 'definido_em', now());
end $$;
revoke all on function painel_definir_pin(text, text, text, text) from public;
grant execute on function painel_definir_pin(text, text, text, text) to anon, authenticated, service_role;

-- Só metadados (quando o PIN foi definido), para a tela "Gerenciar Filiais".
create or replace function painel_pin_status()
returns table (filial text, pin_definido_em timestamptz, bloqueado_ate timestamptz)
language sql security definer set search_path = public as $$
    select l.filiais[1], l.pin_definido_em, l.pin_bloqueado_ate
    from painel_resultados_links l
    where l.revogado_em is null and array_length(l.filiais, 1) = 1
$$;
revoke all on function painel_pin_status() from public;
grant execute on function painel_pin_status() to anon, authenticated, service_role;

-- Configuração da abertura de turma pelo diretor (vagas por turma, quantas
-- turmas abrem juntas). A data limite para retardatários fica em
-- eventos.data_limite_inscricao, que o CRM já usa.
create table if not exists painel_turma_config (
    evento_id bigint primary key references eventos(id) on delete cascade,
    vagas_por_turma int,
    qtd_turmas int not null default 1,
    atualizado_por text,
    atualizado_em timestamptz not null default now()
);
alter table painel_turma_config enable row level security;
drop policy if exists painel_turma_config_leitura on painel_turma_config;
create policy painel_turma_config_leitura on painel_turma_config for select using (true);

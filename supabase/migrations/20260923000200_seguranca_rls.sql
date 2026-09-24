-- =============================================================================
-- SaaS Barbearias — 2/4: segurança (funções auxiliares, RLS e grants)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funções auxiliares (security definer para não recursar na RLS de perfis)
-- -----------------------------------------------------------------------------
create or replace function private.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.papel = 'superadmin' from public.perfis p where p.id = auth.uid()),
    false
  );
$$;

-- Barbearia do usuário logado (nula para superadmin ou usuário sem perfil).
create or replace function private.minha_barbearia_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.barbearia_id
    from public.perfis p
   where p.id = auth.uid()
     and p.papel in ('dono', 'barbeiro');
$$;

create or replace function private.meu_papel()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.papel from public.perfis p where p.id = auth.uid();
$$;

create or replace function private.barbearia_ativa(p_barbearia_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.barbearias b where b.id = p_barbearia_id and b.ativo
  );
$$;

-- -----------------------------------------------------------------------------
-- Proteções contra escalada de privilégio
-- (auth.uid() nulo = service_role / SQL editor, que pode tudo)
-- -----------------------------------------------------------------------------
create or replace function private.perfis_proteger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.is_superadmin() then
    if new.papel is distinct from old.papel
       or new.barbearia_id is distinct from old.barbearia_id
       or new.id is distinct from old.id then
      raise exception 'Apenas o superadmin pode alterar papel ou barbearia de um perfil.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger perfis_proteger
  before update on public.perfis
  for each row execute function private.perfis_proteger();

create or replace function private.barbearias_proteger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.is_superadmin() then
    if new.ativo is distinct from old.ativo or new.id is distinct from old.id then
      raise exception 'Apenas o superadmin pode ativar ou desativar uma barbearia.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger barbearias_proteger
  before update on public.barbearias
  for each row execute function private.barbearias_proteger();

-- -----------------------------------------------------------------------------
-- Habilita RLS em todas as tabelas
-- -----------------------------------------------------------------------------
alter table public.barbearias               enable row level security;
alter table public.perfis                   enable row level security;
alter table public.profissionais            enable row level security;
alter table public.servicos                 enable row level security;
alter table public.catalogo_servicos_padrao enable row level security;
alter table public.disponibilidade          enable row level security;
alter table public.bloqueios                enable row level security;
alter table public.clientes                 enable row level security;
alter table public.agendamentos             enable row level security;

-- -----------------------------------------------------------------------------
-- Grants (defesa em profundidade: anon só enxerga o que é público)
-- -----------------------------------------------------------------------------
revoke all on public.barbearias, public.perfis, public.profissionais, public.servicos,
              public.catalogo_servicos_padrao, public.disponibilidade, public.bloqueios,
              public.clientes, public.agendamentos
  from anon, authenticated;

grant select, insert, update, delete
   on public.barbearias, public.perfis, public.profissionais, public.servicos,
      public.catalogo_servicos_padrao, public.disponibilidade, public.bloqueios,
      public.clientes, public.agendamentos
   to authenticated;

-- Público: somente colunas não sensíveis da barbearia.
-- (use select('id,slug,nome,...') — select('*') como anon retorna erro de permissão)
grant select (id, slug, nome, whatsapp, endereco, cidade, instagram, horario_funcionamento, tema)
   on public.barbearias to anon;
grant select on public.profissionais, public.servicos, public.catalogo_servicos_padrao to anon;

grant usage on schema private to anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_superadmin(), private.minha_barbearia_id(),
                          private.meu_papel(), private.barbearia_ativa(uuid),
                          private.tema_padrao(), private.tema_valido(jsonb)
   to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Políticas: barbearias
-- -----------------------------------------------------------------------------
create policy "barbearias: publico le ativas"
  on public.barbearias for select to anon
  using (ativo);

create policy "barbearias: equipe le a propria"
  on public.barbearias for select to authenticated
  using ((select private.is_superadmin()) or id = (select private.minha_barbearia_id()));

create policy "barbearias: equipe edita a propria"
  on public.barbearias for update to authenticated
  using ((select private.is_superadmin()) or id = (select private.minha_barbearia_id()))
  with check ((select private.is_superadmin()) or id = (select private.minha_barbearia_id()));

create policy "barbearias: superadmin cria"
  on public.barbearias for insert to authenticated
  with check ((select private.is_superadmin()));

create policy "barbearias: superadmin exclui"
  on public.barbearias for delete to authenticated
  using ((select private.is_superadmin()));

-- -----------------------------------------------------------------------------
-- Políticas: perfis
-- -----------------------------------------------------------------------------
create policy "perfis: le o proprio e os da barbearia"
  on public.perfis for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_superadmin())
    or barbearia_id = (select private.minha_barbearia_id())
  );

-- Cada um edita o próprio perfil; o dono edita os perfis da sua barbearia.
-- Papel e barbearia_id só mudam pelo superadmin (trigger perfis_proteger).
create policy "perfis: edita o proprio ou (dono) os da barbearia"
  on public.perfis for update to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_superadmin())
    or ((select private.meu_papel()) = 'dono' and barbearia_id = (select private.minha_barbearia_id()))
  )
  with check (
    id = (select auth.uid())
    or (select private.is_superadmin())
    or ((select private.meu_papel()) = 'dono' and barbearia_id = (select private.minha_barbearia_id()))
  );

create policy "perfis: superadmin cria"
  on public.perfis for insert to authenticated
  with check ((select private.is_superadmin()));

create policy "perfis: superadmin exclui"
  on public.perfis for delete to authenticated
  using ((select private.is_superadmin()));

-- -----------------------------------------------------------------------------
-- Políticas: catálogo global
-- -----------------------------------------------------------------------------
create policy "catalogo: todos leem"
  on public.catalogo_servicos_padrao for select to anon, authenticated
  using (true);

create policy "catalogo: superadmin cria"
  on public.catalogo_servicos_padrao for insert to authenticated
  with check ((select private.is_superadmin()));

create policy "catalogo: superadmin edita"
  on public.catalogo_servicos_padrao for update to authenticated
  using ((select private.is_superadmin()))
  with check ((select private.is_superadmin()));

create policy "catalogo: superadmin exclui"
  on public.catalogo_servicos_padrao for delete to authenticated
  using ((select private.is_superadmin()));

-- -----------------------------------------------------------------------------
-- Políticas: tabelas por barbearia (equipe vê/edita só a sua; superadmin tudo)
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['profissionais', 'servicos', 'disponibilidade', 'bloqueios', 'clientes', 'agendamentos']
  loop
    execute format($f$
      create policy "%1$s: equipe da barbearia gerencia"
        on public.%1$I for all to authenticated
        using ((select private.is_superadmin()) or barbearia_id = (select private.minha_barbearia_id()))
        with check ((select private.is_superadmin()) or barbearia_id = (select private.minha_barbearia_id()))
    $f$, t);
  end loop;
end $$;

-- Público lê somente profissionais e serviços ativos de barbearias ativas.
create policy "profissionais: publico le ativos"
  on public.profissionais for select to anon
  using (ativo and private.barbearia_ativa(barbearia_id));

create policy "servicos: publico le ativos"
  on public.servicos for select to anon
  using (ativo and private.barbearia_ativa(barbearia_id));

-- disponibilidade, bloqueios, clientes e agendamentos: nenhuma política para anon
-- (e nenhum grant) → acesso público só pelas funções RPC.

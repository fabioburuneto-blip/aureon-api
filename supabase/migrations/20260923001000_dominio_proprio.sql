-- =============================================================================
-- SaaS Barbearias — 10: domínio próprio por barbearia (plano mais caro)
-- =============================================================================

alter table public.barbearias
  add column dominio_proprio text unique;

alter table public.barbearias
  add constraint barbearias_dominio_formato check (
    dominio_proprio is null
    or dominio_proprio ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  );

comment on column public.barbearias.dominio_proprio is 'Domínio próprio do plano premium (ex.: neguinbarbershop.com.br), sem protocolo nem barra. O dono aponta o DNS e adiciona o domínio no projeto da Vercel; aqui só mapeia domínio → barbearia.';

-- normaliza o domínio (minúsculo, sem espaços) junto com o slug
create or replace function private.barbearias_normalizar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.slug := lower(btrim(new.slug));
  new.dominio_proprio := nullif(lower(btrim(coalesce(new.dominio_proprio, ''))), '');
  new.tema := private.tema_padrao() || coalesce(new.tema, '{}'::jsonb);
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- barbearia_por_dominio(dominio): resolve o domínio próprio para o slug,
-- usado pelo middleware para reescrever a URL. Só domínios de barbearias ativas.
-- -----------------------------------------------------------------------------
create or replace function public.barbearia_por_dominio(p_dominio text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select b.slug
    from public.barbearias b
   where b.dominio_proprio = lower(btrim(p_dominio))
     and b.ativo;
$$;

revoke execute on function public.barbearia_por_dominio(text) from public;
grant execute on function public.barbearia_por_dominio(text) to anon, authenticated;

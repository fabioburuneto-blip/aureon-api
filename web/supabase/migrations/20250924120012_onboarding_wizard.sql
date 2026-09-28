-- =========================================================================
-- Onboarding wizard (Etapa 1): consolidates business creation into a
-- resumable, multi-step flow (negócio -> serviços -> horários -> aparência
-- -> publicar) instead of the single name/slug/segment form that existed
-- before. Adds the two public-contact fields the wizard collects
-- (whatsapp/instagram -- distinct from business_settings.whatsapp_phone,
-- which is where the OWNER receives notifications, not what a customer
-- sees on the public page) and a step counter so a page refresh mid-wizard
-- resumes instead of losing progress or creating a duplicate business.
-- =========================================================================

alter table public.businesses
  add column whatsapp text,
  add column instagram text,
  add column onboarding_step smallint not null default 1
    check (onboarding_step between 1 and 5);

-- -------------------------------------------------------------------------
-- is_slug_reserved: the reserved-word list used to live only inside
-- create_business(). Extracted so the new is_slug_available() check below
-- (used for live availability feedback while typing) can never drift out
-- of sync with what create_business() itself actually rejects.
-- -------------------------------------------------------------------------
create or replace function public.is_slug_reserved(p_slug text)
returns boolean
language sql
immutable
as $$
  select p_slug in (
    'login', 'signup', 'criar-conta', 'dashboard', 'onboarding', 'auth',
    'api', 'admin', 'public', 'assets', 'static'
  );
$$;

-- -------------------------------------------------------------------------
-- is_slug_available: live availability check for the onboarding form.
-- SECURITY DEFINER because it must see every business's slug, not just
-- published ones -- two people onboarding at the same moment must not be
-- able to both "reserve" the same not-yet-published slug. Returns false
-- (never raises) for invalid format/reserved/taken, so the client only
-- needs one boolean to render "disponível"/"indisponível", never a second
-- validation path duplicating create_business()'s own format check.
-- -------------------------------------------------------------------------
create or replace function public.is_slug_available(p_slug text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    p_slug is not null
    and p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and length(p_slug) >= 3
    and not public.is_slug_reserved(p_slug)
    and not exists (select 1 from public.businesses where slug = p_slug);
$$;

grant execute on function public.is_slug_available(text) to anon, authenticated;

-- -------------------------------------------------------------------------
-- create_business: now also accepts whatsapp/instagram (both optional --
-- the wizard's own step schema requires neither), and defers to
-- is_slug_reserved() instead of its own inline copy of the list. Otherwise
-- identical to the version in 20250924120008_billing.sql.
-- -------------------------------------------------------------------------
create or replace function public.create_business(
  p_name text,
  p_slug text,
  p_segment text,
  p_timezone text default 'America/Sao_Paulo',
  p_whatsapp text default null,
  p_instagram text default null
) returns public.businesses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business public.businesses%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required' using errcode = '22023';
  end if;

  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_slug) < 3 then
    raise exception 'invalid slug format' using errcode = '22023';
  end if;

  if public.is_slug_reserved(p_slug) then
    raise exception 'slug is reserved' using errcode = '22023';
  end if;

  if p_segment not in (
    'barbershop', 'hair_salon', 'nails', 'aesthetics',
    'tattoo', 'massage', 'personal_trainer', 'other'
  ) then
    raise exception 'invalid segment' using errcode = '22023';
  end if;

  insert into public.businesses (
    owner_id, name, slug, segment, timezone, whatsapp, instagram
  )
  values (
    auth.uid(), trim(p_name), p_slug, p_segment,
    coalesce(p_timezone, 'America/Sao_Paulo'),
    nullif(trim(coalesce(p_whatsapp, '')), ''),
    nullif(trim(coalesce(p_instagram, '')), '')
  )
  returning * into v_business;

  insert into public.business_members (business_id, user_id, role)
  values (v_business.id, auth.uid(), 'owner');

  insert into public.business_settings (business_id) values (v_business.id);
  insert into public.themes (business_id) values (v_business.id);

  insert into public.subscriptions (
    business_id, provider, plan_id, status,
    current_period_start, current_period_end
  ) values (
    v_business.id, 'local', 'start', 'trialing',
    now(), now() + interval '14 days'
  );

  return v_business;
end;
$$;

grant execute on function public.create_business(text, text, text, text, text, text) to authenticated;

-- The previous 4-argument overload is superseded (never called with only 4
-- positional args from the app anymore) -- drop it so there is exactly one
-- create_business() signature to keep in sync going forward.
drop function if exists public.create_business(text, text, text, text);

-- -------------------------------------------------------------------------
-- businesses grant (authenticated): onboarding_step, whatsapp and
-- instagram join the same safe column list from
-- 20250924120010_fix_businesses_authenticated_grant.sql. None of the
-- three are sensitive (unlike owner_id/phone/email, still excluded) --
-- whatsapp/instagram are meant to be public-facing contact info shown on
-- the storefront, and onboarding_step only gates which wizard step a
-- member's own dashboard resumes on.
-- -------------------------------------------------------------------------
revoke select on public.businesses from authenticated;
grant select (
  id, name, slug, segment, description, timezone, logo_url, cover_url,
  is_published, created_at, updated_at, whatsapp, instagram, onboarding_step
) on public.businesses to authenticated;

-- -------------------------------------------------------------------------
-- businesses grant (anon): whatsapp/instagram are exactly what a public
-- storefront visitor is meant to see (the point of collecting them in the
-- wizard is to show them on /[slug]) -- same safe-column pattern as
-- 20250924120009_audit_hardening.sql, just two columns wider.
-- onboarding_step is deliberately NOT added here: it has no meaning to an
-- anonymous visitor.
-- -------------------------------------------------------------------------
revoke select on public.businesses from anon;
grant select (
  id, name, slug, segment, description, timezone, logo_url, cover_url,
  is_published, created_at, updated_at, whatsapp, instagram
) on public.businesses to anon;

-- -------------------------------------------------------------------------
-- greatest_onboarding_step: advances the wizard's resume point without
-- ever regressing it -- going back to review an earlier step and
-- re-submitting must not undo progress from a later one. SECURITY DEFINER
-- so it can write to onboarding_step regardless of the narrower column
-- grant above; re-checks is_business_member() itself rather than trusting
-- RLS alone, since the whole point of this function existing is to do a
-- write plain PostgREST can't express (set to the greater of two values).
-- -------------------------------------------------------------------------
create or replace function public.greatest_onboarding_step(
  p_business_id uuid,
  p_step integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'you do not have access to this business' using errcode = '42501';
  end if;

  update public.businesses
    set onboarding_step = greatest(onboarding_step, least(greatest(p_step, 1), 5))
    where id = p_business_id;
end;
$$;

grant execute on function public.greatest_onboarding_step(uuid, integer) to authenticated;

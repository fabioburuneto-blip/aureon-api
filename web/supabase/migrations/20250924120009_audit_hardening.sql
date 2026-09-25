-- =========================================================================
-- Hardening from the security/correctness audit in docs/AUDIT.md. Every
-- change here closes a gap that existed independently of how carefully
-- the Next.js app itself behaves -- RLS restricts which *rows* a role can
-- see, not which *columns*, and the app's own query shape is not a
-- substitute for that at the database/REST layer.
-- =========================================================================

-- -------------------------------------------------------------------------
-- businesses: anon (an unauthenticated storefront visitor) previously had
-- blanket column access to every published business's full row via
-- `grant select on public.businesses to anon` -- including owner_id,
-- phone and email. The app's own /[slug] page was already careful to
-- never render those fields, but that carefulness is irrelevant to
-- someone querying PostgREST directly with the public anon key
-- (`.../rest/v1/businesses?select=owner_id,phone,email&slug=eq....`),
-- which bypasses the Next.js app entirely. Column-level grants close this
-- at the only layer that actually enforces it, without touching RLS (row
-- visibility for published businesses is correct and unchanged) or the
-- `authenticated` role (a business owner's own dashboard still needs
-- full-column access to their own row via getCurrentBusiness()).
-- -------------------------------------------------------------------------
revoke select on public.businesses from anon;
grant select (
  id, name, slug, segment, description, timezone,
  logo_url, cover_url, is_published, created_at, updated_at
) on public.businesses to anon;

-- -------------------------------------------------------------------------
-- appointments / business_hours / professional_hours: DELETE was granted
-- to `authenticated` from the original schema but the app never calls
-- .delete() on any of the three (appointments are cancelled via a status
-- change, never removed; hours are always upserted). Revoking the unused
-- grant means a compromised or overly-curious member session can no
-- longer permanently erase appointment history (which would also orphan
-- the notification_deliveries/notifications rows pointing at it) or wipe
-- a business's operating hours by calling the REST API directly instead
-- of going through the app -- zero functional change for the app itself.
-- -------------------------------------------------------------------------
revoke delete on public.appointments from authenticated;
revoke delete on public.business_hours from authenticated;
revoke delete on public.professional_hours from authenticated;

-- -------------------------------------------------------------------------
-- business-assets storage bucket: file type/size were only checked
-- client-side (ImageUploader) before this -- trivially bypassed by anyone
-- calling the Storage API directly with the browser-exposed anon key,
-- since the RLS policy only checks *ownership of the path*, not what's in
-- the file. This is enforced by Storage itself now, independent of the
-- app. 5MB matches the client-side check the uploader already had.
-- -------------------------------------------------------------------------
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'business-assets';

-- -------------------------------------------------------------------------
-- create_public_appointment(): under genuine concurrent load, two requests
-- racing for the exact same slot don't always surface as the friendly,
-- already-handled `exclusion_violation` -- proven by firing two real
-- simultaneous connections at the same slot repeatedly (see docs/AUDIT.md
-- "Race conditions no agendamento"), which intermittently raised a raw
-- `deadlock_detected` instead (Postgres's GIST exclusion-constraint check
-- can make each transaction wait on a lock the other holds). That error
-- was never caught, so the customer booking on a popular slot at the same
-- moment as someone else would occasionally see a raw Postgres error
-- ("deadlock detected...") instead of "escolha outro horário". Redefined
-- only to add that branch; the rest of the function is unchanged from
-- 20250924120007_notifications.sql.
-- -------------------------------------------------------------------------
create or replace function public.create_public_appointment(
  p_business_slug text,
  p_service_id uuid,
  p_professional_id uuid,
  p_starts_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text default null,
  p_notes text default null
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business public.businesses%rowtype;
  v_service public.services%rowtype;
  v_professional public.professionals%rowtype;
  v_settings public.business_settings%rowtype;
  v_customer public.customers%rowtype;
  v_ends_at timestamptz;
  v_appointment public.appointments%rowtype;
begin
  if p_customer_name is null or length(trim(p_customer_name)) = 0 then
    raise exception 'customer name is required' using errcode = '22023';
  end if;

  if p_customer_phone is null or length(trim(p_customer_phone)) = 0 then
    raise exception 'customer phone is required' using errcode = '22023';
  end if;

  select * into v_business from public.businesses
    where slug = p_business_slug and is_published = true;
  if not found then
    raise exception 'business not found' using errcode = 'P0002';
  end if;

  select * into v_service from public.services
    where id = p_service_id and business_id = v_business.id and is_active = true;
  if not found then
    raise exception 'service not found' using errcode = 'P0002';
  end if;

  select * into v_professional from public.professionals
    where id = p_professional_id and business_id = v_business.id and is_active = true;
  if not found then
    raise exception 'professional not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.professional_services
    where professional_id = v_professional.id and service_id = v_service.id
  ) then
    raise exception 'professional does not offer this service' using errcode = 'P0002';
  end if;

  select * into v_settings from public.business_settings
    where business_id = v_business.id;

  if p_starts_at < now() + make_interval(mins => coalesce(v_settings.min_notice_minutes, 60)) then
    raise exception 'starts_at does not respect the minimum notice window' using errcode = '22023';
  end if;

  if p_starts_at > now() + make_interval(days => coalesce(v_settings.booking_window_days, 30)) then
    raise exception 'starts_at is beyond the booking window' using errcode = '22023';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_minutes);

  if exists (
    select 1 from public.blocked_times bt
    where bt.business_id = v_business.id
      and (bt.professional_id is null or bt.professional_id = v_professional.id)
      and tstzrange(bt.starts_at, bt.ends_at) && tstzrange(p_starts_at, v_ends_at)
  ) then
    raise exception 'slot is blocked' using errcode = 'P0001';
  end if;

  select * into v_customer from public.customers
    where business_id = v_business.id and phone = p_customer_phone;

  if not found then
    insert into public.customers (business_id, name, phone, email)
    values (v_business.id, trim(p_customer_name), p_customer_phone, nullif(trim(coalesce(p_customer_email, '')), ''))
    returning * into v_customer;
  else
    update public.customers
      set name = trim(p_customer_name),
          email = coalesce(nullif(trim(coalesce(p_customer_email, '')), ''), email)
      where id = v_customer.id
      returning * into v_customer;
  end if;

  -- The EXCLUDE constraint on appointments raises on overlap, closing the
  -- race window between the availability check above and this insert.
  -- trg_appointments_notify fires on this insert and takes care of the
  -- in-app notification + any outbound deliveries.
  insert into public.appointments (
    business_id, customer_id, professional_id, service_id,
    starts_at, ends_at, status, notes
  )
  values (
    v_business.id, v_customer.id, v_professional.id, v_service.id,
    p_starts_at, v_ends_at, 'pending', nullif(trim(coalesce(p_notes, '')), '')
  )
  returning * into v_appointment;

  return v_appointment;
exception
  when exclusion_violation then
    raise exception 'slot is no longer available' using errcode = '23P01';
  when deadlock_detected then
    raise exception 'slot is no longer available' using errcode = '23P01';
end;
$$;

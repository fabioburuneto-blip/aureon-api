-- =========================================================================
-- Auto-create a profile row whenever a new auth.users row is created.
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- create_business: the only way to create a tenant. Runs as SECURITY
-- DEFINER so it can atomically create the business, its owner membership,
-- default settings, theme and subscription in one transaction, while still
-- validating everything server-side (never trusts a client-supplied owner).
-- =========================================================================
create or replace function public.create_business(
  p_name text,
  p_slug text,
  p_segment text,
  p_timezone text default 'America/Sao_Paulo'
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

  if p_slug in (
    'login', 'signup', 'dashboard', 'onboarding', 'auth',
    'api', 'admin', 'public', 'assets', 'static'
  ) then
    raise exception 'slug is reserved' using errcode = '22023';
  end if;

  if p_segment not in (
    'barbershop', 'hair_salon', 'nails', 'aesthetics',
    'tattoo', 'massage', 'personal_trainer', 'other'
  ) then
    raise exception 'invalid segment' using errcode = '22023';
  end if;

  insert into public.businesses (owner_id, name, slug, segment, timezone)
  values (auth.uid(), trim(p_name), p_slug, p_segment, coalesce(p_timezone, 'America/Sao_Paulo'))
  returning * into v_business;

  insert into public.business_members (business_id, user_id, role)
  values (v_business.id, auth.uid(), 'owner');

  insert into public.business_settings (business_id) values (v_business.id);
  insert into public.themes (business_id) values (v_business.id);
  insert into public.subscriptions (business_id) values (v_business.id);

  return v_business;
end;
$$;

grant execute on function public.create_business(text, text, text, text) to authenticated;

-- =========================================================================
-- get_available_slots: computes bookable slots for a service + professional
-- on a given date, honoring professional_hours (falls back to
-- business_hours), blocked_times and existing appointments. Returns only
-- the derived slot list so anon callers never see the underlying rows.
-- =========================================================================
create or replace function public.get_available_slots(
  p_business_slug text,
  p_service_id uuid,
  p_professional_id uuid,
  p_date date
) returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_business public.businesses%rowtype;
  v_service public.services%rowtype;
  v_professional public.professionals%rowtype;
  v_settings public.business_settings%rowtype;
  v_dow smallint;
  v_hours_start time;
  v_hours_end time;
  v_is_closed boolean;
  v_found boolean;
  v_slot_interval int;
  v_min_notice interval;
  v_cursor timestamptz;
  v_day_end timestamptz;
  v_slot_end timestamptz;
begin
  select * into v_business from public.businesses
    where slug = p_business_slug and is_published = true;
  if not found then
    return;
  end if;

  select * into v_service from public.services
    where id = p_service_id and business_id = v_business.id and is_active = true;
  if not found then
    return;
  end if;

  select * into v_professional from public.professionals
    where id = p_professional_id and business_id = v_business.id and is_active = true;
  if not found then
    return;
  end if;

  if not exists (
    select 1 from public.professional_services
    where professional_id = v_professional.id and service_id = v_service.id
  ) then
    return;
  end if;

  select * into v_settings from public.business_settings
    where business_id = v_business.id;

  if p_date > (now() at time zone v_business.timezone)::date
    + coalesce(v_settings.booking_window_days, 30) then
    return;
  end if;

  v_slot_interval := coalesce(v_settings.slot_interval_minutes, 30);
  v_min_notice := make_interval(mins => coalesce(v_settings.min_notice_minutes, 60));
  v_dow := extract(dow from p_date)::smallint;

  select start_time, end_time, is_closed
    into v_hours_start, v_hours_end, v_is_closed
    from public.professional_hours
    where professional_id = v_professional.id and day_of_week = v_dow;
  v_found := found;

  if not v_found then
    select start_time, end_time, is_closed
      into v_hours_start, v_hours_end, v_is_closed
      from public.business_hours
      where business_id = v_business.id and day_of_week = v_dow;
    v_found := found;
  end if;

  if not v_found or v_is_closed then
    return;
  end if;

  v_cursor := (p_date + v_hours_start) at time zone v_business.timezone;
  v_day_end := (p_date + v_hours_end) at time zone v_business.timezone;

  while v_cursor + make_interval(mins => v_service.duration_minutes) <= v_day_end loop
    v_slot_end := v_cursor + make_interval(mins => v_service.duration_minutes);

    if v_cursor >= now() + v_min_notice
      and not exists (
        select 1 from public.blocked_times bt
        where bt.business_id = v_business.id
          and (bt.professional_id is null or bt.professional_id = v_professional.id)
          and tstzrange(bt.starts_at, bt.ends_at) && tstzrange(v_cursor, v_slot_end)
      )
      and not exists (
        select 1 from public.appointments a
        where a.professional_id = v_professional.id
          and a.status <> 'cancelled'
          and tstzrange(a.starts_at, a.ends_at) && tstzrange(v_cursor, v_slot_end)
      )
    then
      slot_start := v_cursor;
      slot_end := v_slot_end;
      return next;
    end if;

    v_cursor := v_cursor + make_interval(mins => v_slot_interval);
  end loop;

  return;
end;
$$;

grant execute on function public.get_available_slots(text, uuid, uuid, date) to anon, authenticated;

-- =========================================================================
-- create_public_appointment: the only way an anonymous visitor can create
-- an appointment. Every id is re-validated server-side against the
-- business resolved from the slug -- the client's business/service/
-- professional ids are never trusted at face value. The appointments
-- EXCLUDE constraint is the final, race-condition-proof guard.
-- =========================================================================
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
  insert into public.appointments (
    business_id, customer_id, professional_id, service_id,
    starts_at, ends_at, status, notes
  )
  values (
    v_business.id, v_customer.id, v_professional.id, v_service.id,
    p_starts_at, v_ends_at, 'pending', nullif(trim(coalesce(p_notes, '')), '')
  )
  returning * into v_appointment;

  insert into public.notifications (business_id, type, title, body)
  values (
    v_business.id,
    'new_appointment',
    'Novo agendamento',
    v_customer.name || ' agendou ' || v_service.name
  );

  return v_appointment;
exception
  when exclusion_violation then
    raise exception 'slot is no longer available' using errcode = '23P01';
end;
$$;

grant execute on function public.create_public_appointment(text, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated;

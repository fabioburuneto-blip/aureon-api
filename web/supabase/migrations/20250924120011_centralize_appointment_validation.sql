-- =========================================================================
-- P0 fix: create_public_appointment() never checked business_hours/
-- professional_hours/is_closed -- only get_available_slots() did. Proven
-- live: a booking at 02:00 (hours before opening) and a booking on a day
-- explicitly marked is_closed=true both succeeded through the RPC, even
-- though get_available_slots() correctly never offered either slot. The
-- dashboard's rescheduleAppointment() had the same class of gap for
-- blocked_times: it only relied on the appointments EXCLUDE constraint,
-- never re-checking blocked_times/business hours/professional hours.
--
-- Fix: a single validate_appointment_slot() function is now the one
-- source of truth for "is this slot legal", called by both
-- create_public_appointment() and the new reschedule_appointment(). It
-- intentionally does NOT enforce min_notice_minutes/booking_window_days --
-- those remain public-booking-specific anti-abuse rules (a customer
-- shouldn't book 2 minutes from now or 2 years out), which do not apply to
-- an owner/staff member reschedule in this MVP's scope, so they stay in
-- create_public_appointment() itself rather than the shared validator.
-- =========================================================================

-- -------------------------------------------------------------------------
-- validate_appointment_slot: given a business/service/professional/start
-- time, raises unless the slot is legal, and returns the computed
-- ends_at (derived from the service's own duration, never trusted from a
-- caller) so callers never have to re-derive or duplicate that math.
--
-- p_exclude_appointment_id lets a reschedule check conflicts against every
-- OTHER appointment while ignoring the one being moved.
--
-- Not granted to anon/authenticated: only called from other
-- SECURITY DEFINER functions below, which already run as their owner by
-- the time they call this, so no direct grant is needed or wanted here.
-- -------------------------------------------------------------------------
create or replace function public.validate_appointment_slot(
  p_business_id uuid,
  p_service_id uuid,
  p_professional_id uuid,
  p_starts_at timestamptz,
  p_exclude_appointment_id uuid default null
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business public.businesses%rowtype;
  v_service public.services%rowtype;
  v_professional public.professionals%rowtype;
  v_ends_at timestamptz;
  v_local_date date;
  v_local_start time;
  v_local_end_date date;
  v_local_end time;
  v_dow smallint;
  v_hours_start time;
  v_hours_end time;
  v_is_closed boolean;
  v_found boolean;
begin
  select * into v_business from public.businesses where id = p_business_id;
  if not found then
    raise exception 'business not found' using errcode = 'P0002';
  end if;

  select * into v_service from public.services
    where id = p_service_id and business_id = p_business_id and is_active = true;
  if not found then
    raise exception 'service not found' using errcode = 'P0002';
  end if;

  select * into v_professional from public.professionals
    where id = p_professional_id and business_id = p_business_id and is_active = true;
  if not found then
    raise exception 'professional not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.professional_services
    where professional_id = p_professional_id and service_id = p_service_id
  ) then
    raise exception 'professional does not offer this service' using errcode = 'P0002';
  end if;

  if p_starts_at is null then
    raise exception 'starts_at is required' using errcode = '22023';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_minutes);

  -- Business/professional hours are wall-clock in the business's own
  -- timezone -- compare in that frame, not UTC or the server's local zone.
  v_local_date := (p_starts_at at time zone v_business.timezone)::date;
  v_local_start := (p_starts_at at time zone v_business.timezone)::time;
  v_local_end_date := (v_ends_at at time zone v_business.timezone)::date;
  v_local_end := (v_ends_at at time zone v_business.timezone)::time;
  v_dow := extract(dow from v_local_date)::smallint;

  -- Professional-specific hours take precedence over business hours,
  -- mirroring get_available_slots() exactly -- this is the one set of
  -- rules both functions must always agree on.
  select start_time, end_time, is_closed
    into v_hours_start, v_hours_end, v_is_closed
    from public.professional_hours
    where professional_id = p_professional_id and day_of_week = v_dow;
  v_found := found;

  if not v_found then
    select start_time, end_time, is_closed
      into v_hours_start, v_hours_end, v_is_closed
      from public.business_hours
      where business_id = p_business_id and day_of_week = v_dow;
    v_found := found;
  end if;

  if not v_found or v_is_closed then
    raise exception 'closed on this day' using errcode = 'P0001';
  end if;

  -- A service that would cross local midnight never has a valid same-day
  -- open/close comparison; treat it the same as outside business hours
  -- (get_available_slots never offers a slot like this either, since its
  -- loop bound is same-day v_day_end).
  if v_local_end_date <> v_local_date
     or v_local_start < v_hours_start
     or v_local_end > v_hours_end then
    raise exception 'outside business hours' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.blocked_times bt
    where bt.business_id = p_business_id
      and (bt.professional_id is null or bt.professional_id = p_professional_id)
      and tstzrange(bt.starts_at, bt.ends_at) && tstzrange(p_starts_at, v_ends_at)
  ) then
    raise exception 'slot is blocked' using errcode = 'P0001';
  end if;

  -- Friendly pre-check only -- the appointments EXCLUDE constraint (see
  -- schema.sql) remains the actual concurrency-safe guard at INSERT/UPDATE
  -- time; two callers can both pass this check before either commits, and
  -- the constraint (caught by the callers below) is what decides the
  -- winner under a real race.
  if exists (
    select 1 from public.appointments a
    where a.professional_id = p_professional_id
      and a.status <> 'cancelled'
      and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
      and tstzrange(a.starts_at, a.ends_at) && tstzrange(p_starts_at, v_ends_at)
  ) then
    raise exception 'slot is no longer available' using errcode = '23P01';
  end if;

  return v_ends_at;
end;
$$;

-- -------------------------------------------------------------------------
-- create_public_appointment: now delegates every hours/blocked/conflict/
-- duration check to validate_appointment_slot(). min_notice_minutes and
-- booking_window_days remain here (public-booking-specific, see header).
-- Body otherwise unchanged from 20250924120009_audit_hardening.sql.
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

  select * into v_settings from public.business_settings
    where business_id = v_business.id;

  if p_starts_at < now() + make_interval(mins => coalesce(v_settings.min_notice_minutes, 60)) then
    raise exception 'starts_at does not respect the minimum notice window' using errcode = '22023';
  end if;

  if p_starts_at > now() + make_interval(days => coalesce(v_settings.booking_window_days, 30)) then
    raise exception 'starts_at is beyond the booking window' using errcode = '22023';
  end if;

  -- Every business_hours/professional_hours/is_closed/blocked_times/
  -- conflict/duration rule lives in validate_appointment_slot() now --
  -- this used to be missing entirely, which let a slot outside business
  -- hours (or on a day marked closed) be booked directly through this RPC
  -- even though get_available_slots() never offered it.
  v_ends_at := public.validate_appointment_slot(
    v_business.id, p_service_id, p_professional_id, p_starts_at
  );

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
    v_business.id, v_customer.id, p_professional_id, p_service_id,
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

grant execute on function public.create_public_appointment(text, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated;

-- -------------------------------------------------------------------------
-- reschedule_appointment: the dashboard's only sanctioned way to move an
-- existing appointment. Replaces the plain UPDATE previously issued
-- directly from src/app/dashboard/appointments/actions.ts, which relied
-- only on the appointments EXCLUDE constraint and never re-checked
-- blocked_times/business hours/professional hours -- proven live: an
-- appointment could be moved directly into an active blocked_times window
-- that create_public_appointment() correctly refuses for the same slot.
--
-- SECURITY DEFINER so it can call validate_appointment_slot(), but it
-- re-derives the caller's membership itself first (is_business_member())
-- instead of trusting anything about who's allowed to touch this
-- appointment -- the same authorization create_public_appointment() gets
-- for free from the caller resolving business_id via a verified slug, and
-- that RLS gives every other authenticated write in this app.
-- -------------------------------------------------------------------------
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_starts_at timestamptz
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment public.appointments%rowtype;
  v_ends_at timestamptz;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  if not public.is_business_member(v_appointment.business_id) then
    raise exception 'you do not have access to this business' using errcode = '42501';
  end if;

  v_ends_at := public.validate_appointment_slot(
    v_appointment.business_id,
    v_appointment.service_id,
    v_appointment.professional_id,
    p_starts_at,
    p_exclude_appointment_id => p_appointment_id
  );

  update public.appointments
    set starts_at = p_starts_at, ends_at = v_ends_at
    where id = p_appointment_id
    returning * into v_appointment;

  return v_appointment;
exception
  when exclusion_violation then
    raise exception 'slot is no longer available' using errcode = '23P01';
  when deadlock_detected then
    raise exception 'slot is no longer available' using errcode = '23P01';
end;
$$;

grant execute on function public.reschedule_appointment(uuid, timestamptz) to authenticated;

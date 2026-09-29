-- =========================================================================
-- Etapa 3: motor completo de agendamento do cliente final. Lets a customer
-- who booked anonymously (no account, per the existing model) later look
-- up, cancel, and reschedule that one appointment through an unguessable
-- public token -- never through the internal `appointments.id` UUID,
-- which is sequential-adjacent-enough in practice (and already returned
-- over the wire by create_public_appointment(), see AUDIT-05) to not be
-- treated as a secret.
--
-- Reuses, unchanged: validate_appointment_slot() (the P0 shared
-- validator), the appointments EXCLUDE constraint, get_available_slots(),
-- and create_public_appointment() itself. Nothing here touches any of
-- those -- this migration only adds a new column, a new config value, and
-- three new SECURITY DEFINER functions that sit alongside them.
-- =========================================================================

-- -------------------------------------------------------------------------
-- appointments.client_token: the public identifier. Built from two
-- gen_random_uuid() calls concatenated (64 hex chars, 256 bits of
-- entropy) rather than pulling in the pgcrypto extension for
-- gen_random_bytes() -- gen_random_uuid() is already core-builtin
-- (Postgres 13+, no extension) and is the same primitive every other
-- table in this schema already depends on for its primary key, so this
-- adds zero new extension surface. Not derived from `id` in any way
-- (two independent random UUIDs, not a hash/transform of the row's own
-- id) and not sequential -- knowing one appointment's token or id reveals
-- nothing about any other row's token.
-- -------------------------------------------------------------------------
alter table public.appointments
  add column client_token text not null unique
    default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

create index idx_appointments_client_token on public.appointments (client_token);

-- -------------------------------------------------------------------------
-- business_settings.client_cancellation_min_hours: central, per-business
-- configuration for "how much notice does a customer need to give to
-- cancel or reschedule their own booking" -- named once here and read
-- from this single column everywhere it matters, instead of a literal
-- `24` scattered across functions/components. Reused for both
-- cancellation and reschedule (rescheduling instead of cancelling is
-- otherwise a trivial way to dodge a cancellation cutoff, so both need
-- the same guard). Defaults to 24h; no UI to change it is built in this
-- etapa (out of scope), but the column exists so a future settings screen
-- has somewhere to write to without another migration.
-- -------------------------------------------------------------------------
alter table public.business_settings
  add column client_cancellation_min_hours int not null default 24
    check (client_cancellation_min_hours >= 0);

-- "agendamento" is now a real top-level route (see
-- src/app/agendamento/[token]/page.tsx) -- must be reserved the same way
-- "dashboard"/"onboarding"/etc already are, or a business could pick that
-- exact slug and shadow the client portal at the root level.
create or replace function public.is_slug_reserved(p_slug text)
returns boolean
language sql
immutable
as $$
  select p_slug in (
    'login', 'signup', 'criar-conta', 'dashboard', 'onboarding', 'auth',
    'api', 'admin', 'public', 'assets', 'static', 'agendamento'
  );
$$;

-- -------------------------------------------------------------------------
-- get_public_appointment: the only way to read an appointment's details
-- by token. Returns a deliberately narrow, public-safe projection --
-- never appointment.id/customer_id/business_id, never anything about any
-- OTHER appointment/customer. can_cancel/can_reschedule are computed
-- here (not left to the client to infer from status + a hardcoded hour
-- count) so the UI never has to duplicate this business rule.
-- Nonexistent token: raises the exact same error as every other failure
-- mode below ('appointment not found') -- callers must show one generic
-- message regardless of *why* the lookup failed, never a different
-- message for "token malformed" vs "token well-formed but unknown" vs
-- "token belongs to a different business" (there is no such thing here --
-- a token is global, not scoped by a business the caller supplies).
-- -------------------------------------------------------------------------
create or replace function public.get_public_appointment(p_token text)
returns table (
  business_name text,
  business_slug text,
  business_address text,
  business_city text,
  business_whatsapp text,
  business_timezone text,
  service_id uuid,
  service_name text,
  service_duration_minutes int,
  service_price_cents int,
  professional_id uuid,
  professional_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  can_cancel boolean,
  can_reschedule boolean,
  client_min_notice_hours int
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_appt public.appointments%rowtype;
  v_min_hours int;
  v_eligible boolean;
begin
  if p_token is null or length(p_token) = 0 then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  select * into v_appt from public.appointments where client_token = p_token;
  if not found then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  select coalesce(bs.client_cancellation_min_hours, 24) into v_min_hours
    from public.business_settings bs where bs.business_id = v_appt.business_id;

  v_eligible := v_appt.status in ('pending', 'confirmed')
    and now() + make_interval(hours => coalesce(v_min_hours, 24)) <= v_appt.starts_at;

  return query
    select
      b.name, b.slug, b.address, b.city, b.whatsapp, b.timezone,
      s.id, s.name, s.duration_minutes, s.price_cents,
      p.id, p.name,
      v_appt.starts_at, v_appt.ends_at, v_appt.status,
      v_eligible, v_eligible, coalesce(v_min_hours, 24)
    from public.businesses b, public.services s, public.professionals p
    where b.id = v_appt.business_id
      and s.id = v_appt.service_id
      and p.id = v_appt.professional_id;
end;
$$;

grant execute on function public.get_public_appointment(text) to anon, authenticated;

-- -------------------------------------------------------------------------
-- cancel_public_appointment: the only public write that changes status.
-- Mirrors the eligibility rule in get_public_appointment() exactly (same
-- status check, same min-hours window) -- re-derived here rather than
-- trusting whatever can_cancel the client last saw, since that value can
-- go stale between page load and the click (another customer's earlier
-- reschedule, or the clock simply advancing past the cutoff).
-- -------------------------------------------------------------------------
create or replace function public.cancel_public_appointment(p_token text)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt public.appointments%rowtype;
  v_min_hours int;
begin
  if p_token is null or length(p_token) = 0 then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  select * into v_appt from public.appointments where client_token = p_token;
  if not found then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  if v_appt.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be cancelled' using errcode = 'P0001';
  end if;

  select coalesce(bs.client_cancellation_min_hours, 24) into v_min_hours
    from public.business_settings bs where bs.business_id = v_appt.business_id;

  if now() + make_interval(hours => coalesce(v_min_hours, 24)) > v_appt.starts_at then
    raise exception 'cancellation window has passed' using errcode = 'P0001';
  end if;

  -- Status change only -- history is preserved (no delete), and the slot
  -- is implicitly freed because the appointments EXCLUDE constraint's
  -- `where (status <> 'cancelled')` clause stops counting this row the
  -- instant status flips, exactly like an owner-initiated cancellation
  -- already does today.
  update public.appointments set status = 'cancelled'
    where id = v_appt.id
    returning * into v_appt;

  return v_appt;
end;
$$;

grant execute on function public.cancel_public_appointment(text) to anon, authenticated;

-- -------------------------------------------------------------------------
-- reschedule_public_appointment: business/service/professional are fixed
-- (read from the existing appointment row, never accepted as a
-- parameter) -- only starts_at can move, exactly per spec. Delegates the
-- actual slot legality check to validate_appointment_slot(), the same
-- P0 shared validator create_public_appointment() and the dashboard's
-- reschedule_appointment() already use -- never a second, parallel
-- availability calculation. Also reapplies the same min_notice_minutes/
-- booking_window_days guard create_public_appointment() enforces for a
-- brand-new booking (validate_appointment_slot() deliberately excludes
-- those two -- they are public-booking-specific anti-abuse rules, not
-- part of "is this slot physically legal"), plus the same min-hours
-- window as cancellation, so rescheduling can't be used to dodge the
-- cancellation cutoff.
-- -------------------------------------------------------------------------
create or replace function public.reschedule_public_appointment(
  p_token text,
  p_starts_at timestamptz
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt public.appointments%rowtype;
  v_settings public.business_settings%rowtype;
  v_ends_at timestamptz;
begin
  if p_token is null or length(p_token) = 0 then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  select * into v_appt from public.appointments where client_token = p_token;
  if not found then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  if v_appt.status not in ('pending', 'confirmed') then
    raise exception 'this appointment can no longer be rescheduled' using errcode = 'P0001';
  end if;

  select * into v_settings from public.business_settings where business_id = v_appt.business_id;

  if now() + make_interval(hours => coalesce(v_settings.client_cancellation_min_hours, 24)) > v_appt.starts_at then
    raise exception 'reschedule window has passed' using errcode = 'P0001';
  end if;

  if p_starts_at is null then
    raise exception 'starts_at is required' using errcode = '22023';
  end if;

  if p_starts_at < now() + make_interval(mins => coalesce(v_settings.min_notice_minutes, 60)) then
    raise exception 'starts_at does not respect the minimum notice window' using errcode = '22023';
  end if;

  if p_starts_at > now() + make_interval(days => coalesce(v_settings.booking_window_days, 30)) then
    raise exception 'starts_at is beyond the booking window' using errcode = '22023';
  end if;

  v_ends_at := public.validate_appointment_slot(
    v_appt.business_id,
    v_appt.service_id,
    v_appt.professional_id,
    p_starts_at,
    p_exclude_appointment_id => v_appt.id
  );

  update public.appointments
    set starts_at = p_starts_at, ends_at = v_ends_at
    where id = v_appt.id
    returning * into v_appt;

  return v_appt;
exception
  when exclusion_violation then
    raise exception 'slot is no longer available' using errcode = '23P01';
  when deadlock_detected then
    raise exception 'slot is no longer available' using errcode = '23P01';
end;
$$;

grant execute on function public.reschedule_public_appointment(text, timestamptz) to anon, authenticated;

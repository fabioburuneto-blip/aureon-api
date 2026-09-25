-- =========================================================================
-- Notification system: in-app notifications (synchronous, in-transaction)
-- plus an outbound delivery queue (email/whatsapp) that a separate worker
-- (Edge Function) drains asynchronously. Nothing in this migration ever
-- calls an external API -- it only ever performs local inserts, so an
-- appointment write can NEVER fail or block because a downstream channel
-- (WhatsApp, email) is unavailable. See docs/NOTIFICATIONS.md.
-- =========================================================================

-- -------------------------------------------------------------------------
-- notifications: add recipient + deep link. Existing rows (if any) are
-- backfilled to the business owner before the column is made required.
-- -------------------------------------------------------------------------
alter table public.notifications
  add column recipient_user_id uuid references public.profiles (id) on delete cascade,
  add column appointment_id uuid references public.appointments (id) on delete set null;

update public.notifications n
  set recipient_user_id = b.owner_id
  from public.businesses b
  where b.id = n.business_id
    and n.recipient_user_id is null;

alter table public.notifications
  alter column recipient_user_id set not null;

create index idx_notifications_recipient on public.notifications (recipient_user_id, read_at, created_at desc);

-- Recipient-scoped, not just business-scoped: each user only sees/marks
-- their own notifications (relevant once a business has multiple owners).
drop policy if exists "notifications_select_member" on public.notifications;
drop policy if exists "notifications_update_member" on public.notifications;

create policy "notifications_select_recipient" on public.notifications
  for select using (recipient_user_id = auth.uid());

create policy "notifications_update_recipient" on public.notifications
  for update using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- -------------------------------------------------------------------------
-- business_settings: WhatsApp + email notification configuration. Only the
-- destination phone/email lives here -- provider credentials (WhatsApp
-- access token, phone number id, email API key) are never stored in the
-- database; they live in Edge Function secrets (see docs/NOTIFICATIONS.md).
-- -------------------------------------------------------------------------
alter table public.business_settings
  add column whatsapp_enabled boolean not null default false,
  add column whatsapp_phone text,
  add column notify_email_enabled boolean not null default false,
  add column notify_email_address text,
  add column notify_new_appointment boolean not null default true,
  add column notify_cancellation boolean not null default true,
  add column notify_reschedule boolean not null default true,
  add column notify_reminder_24h boolean not null default true,
  add column notify_reminder_2h boolean not null default true;

-- -------------------------------------------------------------------------
-- appointments: tracks whether each scheduled reminder has already been
-- enqueued, so the reminder worker never double-sends on repeated runs.
-- -------------------------------------------------------------------------
alter table public.appointments
  add column reminder_24h_sent_at timestamptz,
  add column reminder_2h_sent_at timestamptz;

-- -------------------------------------------------------------------------
-- notification_deliveries: one row per (notification, outbound channel)
-- attempt. This is the queue the Edge Function worker polls -- it is pure
-- application data (channel, status, sanitized error), never the provider
-- payload itself and never a credential.
-- -------------------------------------------------------------------------
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  notification_id uuid references public.notifications (id) on delete set null,
  channel text not null check (channel in ('email', 'whatsapp')),
  event_type text not null check (
    event_type in (
      'appointment.created',
      'appointment.confirmed',
      'appointment.cancelled',
      'appointment.rescheduled',
      'appointment.completed',
      'appointment.no_show',
      'appointment.reminder_24h',
      'appointment.reminder_2h'
    )
  ),
  recipient text not null,
  -- Template variables only (names, dates, service) -- never a token, never
  -- a raw provider request/response body.
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (
    status in ('pending', 'sent', 'failed', 'retrying')
  ),
  attempts int not null default 0,
  -- Sanitized, human-readable failure reason only (e.g. "invalid_phone",
  -- "timeout", "provider_unavailable") -- never a stack trace, token or
  -- full provider response.
  last_error text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_notification_deliveries_pending
  on public.notification_deliveries (status, next_attempt_at)
  where status in ('pending', 'retrying');
create index idx_notification_deliveries_business_id
  on public.notification_deliveries (business_id, created_at desc);

create trigger trg_notification_deliveries_set_updated_at
  before update on public.notification_deliveries
  for each row execute function public.set_updated_at();

alter table public.notification_deliveries enable row level security;

-- Read-only for the business owner (e.g. inspecting delivery status in
-- Supabase Studio or a future admin view). All writes go through the
-- SECURITY DEFINER trigger below or the worker's service-role key, neither
-- of which needs a client-facing policy.
create policy "notification_deliveries_select_owner" on public.notification_deliveries
  for select using (public.is_business_owner(business_id));

grant select on public.notification_deliveries to authenticated;

-- =========================================================================
-- notify_appointment_event: the single place that turns an appointment
-- write into (a) an in-app notification for each business owner and (b)
-- pending outbound deliveries for whichever channels the business has
-- enabled for that event. Runs SECURITY DEFINER so it can insert
-- regardless of who performed the triggering write (the public booking RPC
-- as anon, or a dashboard server action as an authenticated member) --
-- exactly like create_public_appointment already does for notifications.
--
-- Every branch below is a local insert; none of it calls an external API,
-- so a WhatsApp/email outage can never fail or roll back the appointment
-- write itself. Actual sending happens later, out-of-band, in the
-- process-notifications Edge Function worker.
-- =========================================================================
create or replace function public.notify_appointment_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
  v_business public.businesses%rowtype;
  v_settings public.business_settings%rowtype;
  v_customer public.customers%rowtype;
  v_service public.services%rowtype;
  v_professional public.professionals%rowtype;
  v_title text;
  v_message text;
  v_date_label text;
  v_time_label text;
  v_owner record;
  v_notification_id uuid;
  v_email_on boolean;
  v_whatsapp_on boolean;
  v_payload jsonb;
begin
  if tg_op = 'INSERT' then
    v_event := 'appointment.created';
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      v_event := case new.status
        when 'confirmed' then 'appointment.confirmed'
        when 'cancelled' then 'appointment.cancelled'
        when 'completed' then 'appointment.completed'
        when 'no_show' then 'appointment.no_show'
        else null
      end;
    elsif new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at then
      v_event := 'appointment.rescheduled';
    end if;
  end if;

  if v_event is null then
    return new;
  end if;

  select * into v_business from public.businesses where id = new.business_id;
  select * into v_settings from public.business_settings where business_id = new.business_id;
  select * into v_customer from public.customers where id = new.customer_id;
  select * into v_service from public.services where id = new.service_id;
  select * into v_professional from public.professionals where id = new.professional_id;

  v_date_label := to_char(new.starts_at at time zone coalesce(v_business.timezone, 'America/Sao_Paulo'), 'DD/MM/YYYY');
  v_time_label := to_char(new.starts_at at time zone coalesce(v_business.timezone, 'America/Sao_Paulo'), 'HH24:MI');

  v_title := case v_event
    when 'appointment.created' then 'Novo agendamento'
    when 'appointment.confirmed' then 'Agendamento confirmado'
    when 'appointment.cancelled' then 'Agendamento cancelado'
    when 'appointment.rescheduled' then 'Agendamento reagendado'
    when 'appointment.completed' then 'Atendimento concluído'
    when 'appointment.no_show' then 'Cliente não compareceu'
  end;

  v_message := coalesce(v_customer.name, 'Cliente') || ' — ' ||
    coalesce(v_service.name, 'serviço') || ' em ' || v_date_label || ' às ' || v_time_label;

  -- Only new/cancelled/rescheduled are wired to outbound channels for now
  -- (matches the message templates the product asked for); completed/
  -- no_show stay in-app only.
  v_email_on := coalesce(v_settings.notify_email_enabled, false) and case v_event
    when 'appointment.created' then coalesce(v_settings.notify_new_appointment, false)
    when 'appointment.cancelled' then coalesce(v_settings.notify_cancellation, false)
    when 'appointment.rescheduled' then coalesce(v_settings.notify_reschedule, false)
    else false
  end;

  v_whatsapp_on := coalesce(v_settings.whatsapp_enabled, false) and case v_event
    when 'appointment.created' then coalesce(v_settings.notify_new_appointment, false)
    when 'appointment.cancelled' then coalesce(v_settings.notify_cancellation, false)
    when 'appointment.rescheduled' then coalesce(v_settings.notify_reschedule, false)
    else false
  end;

  v_payload := jsonb_build_object(
    'customer_name', coalesce(v_customer.name, 'Cliente'),
    'service_name', coalesce(v_service.name, ''),
    'professional_name', coalesce(v_professional.name, ''),
    'date_label', v_date_label,
    'time_label', v_time_label,
    'business_name', coalesce(v_business.name, '')
  );

  for v_owner in
    select user_id from public.business_members
    where business_id = new.business_id and role = 'owner'
  loop
    insert into public.notifications (
      business_id, recipient_user_id, appointment_id, type, title, body
    ) values (
      new.business_id, v_owner.user_id, new.id, v_event, v_title, v_message
    )
    returning id into v_notification_id;

    if v_email_on and coalesce(v_settings.notify_email_address, '') <> '' then
      insert into public.notification_deliveries (
        business_id, appointment_id, notification_id, channel, event_type, recipient, payload
      ) values (
        new.business_id, new.id, v_notification_id, 'email', v_event,
        v_settings.notify_email_address, v_payload
      );
    end if;

    if v_whatsapp_on and coalesce(v_settings.whatsapp_phone, '') <> '' then
      insert into public.notification_deliveries (
        business_id, appointment_id, notification_id, channel, event_type, recipient, payload
      ) values (
        new.business_id, new.id, v_notification_id, 'whatsapp', v_event,
        v_settings.whatsapp_phone, v_payload
      );
    end if;
  end loop;

  return new;
end;
$$;

create trigger trg_appointments_notify
  after insert or update on public.appointments
  for each row execute function public.notify_appointment_event();

-- -------------------------------------------------------------------------
-- create_public_appointment now relies entirely on trg_appointments_notify
-- for notifications (fired by the insert below) -- redefined only to drop
-- the manual notifications insert it used to do, which would otherwise
-- double up with the trigger. Body is otherwise identical to the version
-- in 20250924120005_functions.sql.
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
end;
$$;

grant execute on function public.create_public_appointment(text, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated;

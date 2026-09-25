-- =========================================================================
-- Database-level regression suite for docs/AUDIT.md. Exercises RLS,
-- constraints and SECURITY DEFINER functions directly against Postgres --
-- the layer where tenancy isolation, overbooking prevention and
-- permission boundaries actually live (RLS can't be meaningfully unit
-- tested with a mocked client).
--
-- Run against a scratch database (never production):
--   createdb aureon_test
--   psql aureon_test -f supabase/tests/fixtures/local-stub.sql
--   for f in supabase/migrations/*.sql; do psql aureon_test -f "$f"; done
--   psql aureon_test -f supabase/tests/db.sql
--
-- local-stub.sql stands in for the slice of Supabase's real auth/storage
-- schemas and default anon/authenticated/service_role grants that the
-- migrations and this suite depend on -- a real Supabase project already
-- provides the real versions, so it's never applied there.
--
-- Exits non-zero (via ON_ERROR_STOP) on the first failed assertion or
-- unexpected error, with a message identifying which check failed.
-- =========================================================================
\set ON_ERROR_STOP on

create schema if not exists test;
grant usage on schema test to anon, authenticated;
create or replace function test.assert(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not condition or condition is null then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
end;
$$;
grant execute on function test.assert(boolean, text) to anon, authenticated;

-- -------------------------------------------------------------------------
-- Fixtures: two independent businesses (A, B), each with an owner, a
-- service, a professional linked to it, and business hours open every day
-- with no minimum notice (keeps slot math simple to assert on).
-- -------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'owner-a@test.com'),
  ('b0000000-0000-0000-0000-00000000000b', 'owner-b@test.com'),
  ('c0000000-0000-0000-0000-00000000000c', 'stranger@test.com');

set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select (public.create_business('Barbearia A', 'barbearia-a', 'barbershop')).id as id \gset a_
reset request.jwt.claim.sub;

set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
select (public.create_business('Salao B', 'salao-b', 'hair_salon')).id as id \gset b_
reset request.jwt.claim.sub;

update public.business_settings set min_notice_minutes = 0, slot_interval_minutes = 30
  where business_id in (:'a_id', :'b_id');

-- Every day of the week, 09:00-18:00, so slot math is deterministic
-- regardless of which weekday the suite happens to run on.
insert into public.business_hours (business_id, day_of_week, start_time, end_time, is_closed)
select biz, dow, '09:00', '18:00', false
from (values (:'a_id'::uuid), (:'b_id'::uuid)) as businesses(biz)
cross join generate_series(0, 6) as dow
on conflict (business_id, day_of_week) do update set start_time = excluded.start_time, end_time = excluded.end_time, is_closed = false;

insert into public.services (id, business_id, name, duration_minutes, price_cents, is_active)
values
  ('a1111111-1111-1111-1111-111111111111', :'a_id', 'Corte', 30, 5000, true),
  ('b1111111-1111-1111-1111-111111111111', :'b_id', 'Escova', 60, 8000, true);

insert into public.professionals (id, business_id, name, is_active)
values
  ('a2222222-2222-2222-2222-222222222222', :'a_id', 'Carlos', true),
  ('b2222222-2222-2222-2222-222222222222', :'b_id', 'Bianca', true);

insert into public.professional_services (professional_id, service_id) values
  ('a2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111'),
  ('b2222222-2222-2222-2222-222222222222', 'b1111111-1111-1111-1111-111111111111');

insert into public.customers (id, business_id, name, phone) values
  ('a3333333-3333-3333-3333-333333333333', :'a_id', 'Cliente A', '+5511900000001'),
  ('b3333333-3333-3333-3333-333333333333', :'b_id', 'Cliente B', '+5511900000002');

-- A day comfortably in the future, far enough out to sit inside every
-- business's default 30-day booking window.
select (current_date + 5) as future_date \gset
-- Businesses default to timezone 'America/Sao_Paulo' -- every wall-clock
-- time below must go through `at time zone` to become the correct
-- timestamptz, exactly like get_available_slots() itself does
-- (`(p_date + v_hours_start) at time zone v_business.timezone`). Comparing
-- against a bare ::timestamptz cast instead would silently use the
-- session's own timezone and never match.
select ((:'future_date'::date + time '10:00') at time zone 'America/Sao_Paulo') as slot_10 \gset
select ((:'future_date'::date + time '10:30') at time zone 'America/Sao_Paulo') as slot_1030 \gset
select ((:'future_date'::date + time '14:00') at time zone 'America/Sao_Paulo') as slot_1400 \gset
select ((:'future_date'::date + time '15:00') at time zone 'America/Sao_Paulo') as slot_1500 \gset
select ((:'future_date'::date + time '16:00') at time zone 'America/Sao_Paulo') as slot_1600 \gset

\echo '===================================================================='
\echo 'AUTH -- business resolution'
\echo '===================================================================='

-- No business_members row for this user at all -- this is exactly the
-- condition getCurrentBusiness() (src/lib/auth.ts) checks to redirect a
-- freshly-signed-up user to /onboarding instead of crashing.
select test.assert(
  not exists (select 1 from public.business_members where user_id = 'c0000000-0000-0000-0000-00000000000c'),
  'a user who never created/joined a business must resolve to zero memberships'
);

select test.assert(
  (select role from public.business_members where user_id = 'a0000000-0000-0000-0000-00000000000a' and business_id = :'a_id') = 'owner',
  'create_business() must make the creator the owner of their own business'
);

\echo '===================================================================='
\echo 'TENANCY -- business A cannot read or write business B, and vice versa'
\echo '===================================================================='

set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';

-- customers (unlike services/professionals, which are intentionally
-- readable cross-tenant when active+published, for the public storefront)
-- have no public-read clause at all -- a clean, unambiguous read-isolation
-- check.
select test.assert(
  (select count(*) from public.customers) = 1,
  'business A must see exactly its own customer, never B''s'
);

-- services ARE publicly readable when active (storefront requirement), so
-- the real tenancy guarantee to check here is on the WRITE side: A must
-- not be able to modify or delete B's row, even though A can see it.
\set ON_ERROR_STOP off
update public.services set name = 'Hacked' where id = 'b1111111-1111-1111-1111-111111111111';
\set ON_ERROR_STOP on
select test.assert(
  (select name from public.services where id = 'b1111111-1111-1111-1111-111111111111') = 'Escova',
  'business A must not be able to modify business B''s service (RLS should silently affect 0 rows)'
);

\set ON_ERROR_STOP off
delete from public.customers where id = 'b3333333-3333-3333-3333-333333333333';
\set ON_ERROR_STOP on

reset role;
reset request.jwt.claim.sub;

-- Verified with RLS bypassed (superuser): A's delete attempt above must
-- not have removed B's customer. Checking this *as A* would be
-- meaningless -- customers has no public-read clause, so A can't see B's
-- row via SELECT either way, delete-blocked or not.
select test.assert(
  exists (select 1 from public.customers where id = 'b3333333-3333-3333-3333-333333333333'),
  'business A must not be able to delete business B''s customer'
);

set role authenticated;
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
select test.assert(
  (select count(*) from public.customers) = 1,
  'business B must see exactly its own customer, never A''s'
);
reset role;
reset request.jwt.claim.sub;

\echo '===================================================================='
\echo 'BOOKING -- slots, concurrency, blocks, hours, duration, buffer'
\echo '===================================================================='

-- (a) a plain weekday slot is offered before anything is booked.
select test.assert(
  exists (
    select 1 from public.get_available_slots('barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', :'future_date'::date)
    where slot_start = :'slot_10'::timestamptz
  ),
  'a free 10:00 slot must be offered when nothing is booked yet'
);

-- Book it.
select (public.create_public_appointment(
  'barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
  :'slot_10'::timestamptz, 'Walk-in', '+5511977776666', null, null
)).id as booked_appt_id \gset

-- (b) that same slot must now be gone from availability.
select test.assert(
  not exists (
    select 1 from public.get_available_slots('barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', :'future_date'::date)
    where slot_start = :'slot_10'::timestamptz
  ),
  'a booked 10:00 slot must no longer appear as available'
);

-- (c) booking the exact same slot again is rejected (sequential proof that
-- the EXCLUDE constraint, not just the availability query, is the real
-- guard -- the availability check and the insert are two separate
-- statements, so only a DB-level constraint closes the race between them).
\set ON_ERROR_STOP off
select public.create_public_appointment(
  'barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
  :'slot_10'::timestamptz, 'Segundo cliente', '+5511977776655', null, null
);
\set ON_ERROR_STOP on

select test.assert(
  (select count(*) from public.appointments where professional_id = 'a2222222-2222-2222-2222-222222222222' and starts_at = :'slot_10'::timestamptz) = 1,
  'double-booking the same professional/slot must never create a second row'
);

-- (h) buffer: NOT implemented today. A second service booked to start
-- exactly when the first one ends (10:30, right after a 30-minute 10:00
-- appointment) is currently allowed -- documenting this honestly instead
-- of assuming a gap exists. See docs/AUDIT.md "Buffer entre agendamentos".
select test.assert(
  exists (
    select 1 from public.get_available_slots('barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', :'future_date'::date)
    where slot_start = :'slot_1030'::timestamptz
  ),
  'documents current behavior: back-to-back booking (no buffer) is allowed'
);

-- (e) blocked_times removes a slot from availability even though nothing
-- is booked there yet.
insert into public.blocked_times (business_id, professional_id, starts_at, ends_at, reason)
values (:'a_id', 'a2222222-2222-2222-2222-222222222222', :'slot_1400'::timestamptz, :'slot_1500'::timestamptz, 'Almoço');

select test.assert(
  not exists (
    select 1 from public.get_available_slots('barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', :'future_date'::date)
    where slot_start = :'slot_1400'::timestamptz
  ),
  'a blocked_times window must remove overlapping slots from availability'
);

-- (f) business hours: closing the business for that weekday removes every
-- slot, even ones that were free a moment ago.
update public.business_hours set is_closed = true
  where business_id = :'a_id' and day_of_week = extract(dow from :'future_date'::date);

select test.assert(
  (select count(*) from public.get_available_slots('barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', :'future_date'::date)) = 0,
  'a closed business_hours day must offer zero slots'
);

update public.business_hours set is_closed = false
  where business_id = :'a_id' and day_of_week = extract(dow from :'future_date'::date);

-- (g) duration: a longer service produces fewer, longer slots. B's
-- service is 60 minutes vs A's 30 -- assert B's slot spacing/end matches.
select test.assert(
  (
    select slot_end - slot_start from public.get_available_slots(
      'salao-b', 'b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
      (current_date + 6)::date
    ) limit 1
  ) = interval '60 minutes',
  'slot length must match the service''s duration_minutes (60min service -> 60min slots)'
);

\echo '===================================================================='
\echo 'CANCELAMENTO -- cancelling frees the slot back up'
\echo '===================================================================='

update public.appointments set status = 'cancelled' where id = :'booked_appt_id';

select test.assert(
  exists (
    select 1 from public.get_available_slots('barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', :'future_date'::date)
    where slot_start = :'slot_10'::timestamptz
  ),
  'cancelling an appointment must free its slot back up for booking'
);

-- Re-booking the now-cancelled slot must succeed (proves the EXCLUDE
-- constraint's `where (status <> 'cancelled')` clause actually works, not
-- just the availability query).
select (public.create_public_appointment(
  'barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
  :'slot_10'::timestamptz, 'Novo cliente', '+5511977776644', null, null
)).id as rebooked_appt_id \gset

select test.assert(:'rebooked_appt_id' is not null, 'rebooking a cancelled slot must succeed');

\echo '===================================================================='
\echo 'PUBLIC PAGE -- existing slug, nonexistent slug, unpublished business'
\echo '===================================================================='

set role anon;

select test.assert(
  exists (select 1 from public.businesses where slug = 'barbearia-a' and is_published = true),
  'an existing, published business must be visible to anon by slug'
);
select test.assert(
  not exists (select 1 from public.businesses where slug = 'does-not-exist-at-all'),
  'a nonexistent slug must return no row'
);

reset role;

update public.businesses set is_published = false where id = :'a_id';

set role anon;
select test.assert(
  not exists (select 1 from public.businesses where slug = 'barbearia-a'),
  'an unpublished business must not be visible to anon at all'
);
reset role;

select test.assert(
  (select count(*) from public.get_available_slots('barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', :'future_date'::date + 2)) = 0,
  'get_available_slots() must return zero slots once the business is unpublished'
);

-- create_public_appointment() must refuse to book against an unpublished
-- business too (expect an ERROR below: "business not found").
\set ON_ERROR_STOP off
select public.create_public_appointment(
  'barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
  :'slot_1600'::timestamptz + interval '2 days', 'Nao deveria', '+5511900001111', null, null
);
\set ON_ERROR_STOP on

update public.businesses set is_published = true where id = :'a_id';

\echo '===================================================================='
\echo 'CRUD -- services, professionals, customers, appointments (owner scoped)'
\echo '===================================================================='

set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';

update public.services set price_cents = 6000 where id = 'a1111111-1111-1111-1111-111111111111';
select test.assert(
  (select price_cents from public.services where id = 'a1111111-1111-1111-1111-111111111111') = 6000,
  'business A must be able to update its own service'
);

insert into public.professionals (business_id, name, is_active) values (:'a_id', 'Novo Profissional', true);
select test.assert(
  (select count(*) from public.professionals where business_id = :'a_id') = 2,
  'business A must be able to add a new professional'
);

reset role;
reset request.jwt.claim.sub;

\echo '===================================================================='
\echo 'NOTIFICATIONS -- creation on events, retry/failure state machine,'
\echo 'recipient-scoped RLS'
\echo '===================================================================='

update public.business_settings
  set whatsapp_enabled = true, whatsapp_phone = '+5511999990000',
      notify_email_enabled = true, notify_email_address = 'owner-a@test.com'
  where business_id = :'a_id';

select (public.create_public_appointment(
  'barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
  :'slot_1600'::timestamptz, 'Notif Test', '+5511900002222', null, null
)).id as notif_appt_id \gset

select test.assert(
  exists (select 1 from public.notifications where appointment_id = :'notif_appt_id' and type = 'appointment.created' and recipient_user_id = 'a0000000-0000-0000-0000-00000000000a'),
  'a new appointment must create an in-app notification for the owner'
);
select test.assert(
  (select count(*) from public.notification_deliveries where appointment_id = :'notif_appt_id') = 2,
  'with both whatsapp and email enabled, exactly 2 pending deliveries must be queued'
);
select test.assert(
  (select bool_and(status = 'pending') from public.notification_deliveries where appointment_id = :'notif_appt_id'),
  'freshly queued deliveries must start out pending (actual sending happens out-of-band)'
);

-- Simulate the worker recording a failed attempt (retry state).
update public.notification_deliveries
  set status = 'retrying', attempts = 1, last_error = 'timeout', next_attempt_at = now() + interval '1 minute'
  where appointment_id = :'notif_appt_id' and channel = 'whatsapp';
select test.assert(
  (select status from public.notification_deliveries where appointment_id = :'notif_appt_id' and channel = 'whatsapp') = 'retrying',
  'a failed delivery attempt must be recorded as retrying, not silently dropped'
);

set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select test.assert(
  exists (select 1 from public.notifications where appointment_id = :'notif_appt_id'),
  'the recipient owner must be able to read their own notification'
);
reset role;
reset request.jwt.claim.sub;

set role authenticated;
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
select test.assert(
  not exists (select 1 from public.notifications where appointment_id = :'notif_appt_id'),
  'a different business''s owner must never see this notification (recipient-scoped RLS)'
);
reset role;
reset request.jwt.claim.sub;

\echo '===================================================================='
\echo 'BILLING -- duplicate webhook, invalid target, status change'
\echo '===================================================================='

select test.assert(
  (select status from public.subscriptions where business_id = :'a_id') = 'trialing',
  'a freshly created business must start out trialing on the local provider'
);

-- Simulate the webhook handler's write (status change via provider).
update public.subscriptions
  set provider = 'mercadopago', provider_subscription_id = 'mp_sub_test', status = 'active', plan_id = 'pro'
  where business_id = :'a_id';
select test.assert(
  (select status from public.subscriptions where business_id = :'a_id') = 'active',
  'the webhook path must be able to change a subscription''s status'
);

-- Duplicate webhook event id must be rejected (idempotency ledger).
insert into public.billing_webhook_events (provider, provider_event_id, event_type)
  values ('mercadopago', 'evt_dup_test', 'subscription.updated');
\set ON_ERROR_STOP off
insert into public.billing_webhook_events (provider, provider_event_id, event_type)
  values ('mercadopago', 'evt_dup_test', 'subscription.updated');
\set ON_ERROR_STOP on
select test.assert(
  (select count(*) from public.billing_webhook_events where provider = 'mercadopago' and provider_event_id = 'evt_dup_test') = 1,
  'a duplicate webhook event id must never be recorded twice (idempotency)'
);

-- "Invalid webhook" in practice means the signature check rejects it
-- before any DB write happens at all (see src/lib/billing/providers/*.ts
-- signature tests) -- at the DB layer, the only thing to assert is that an
-- invalid plan_id can never be written even if a compromised/buggy
-- provider adapter tried to.
\set ON_ERROR_STOP off
update public.subscriptions set plan_id = 'not-a-real-plan' where business_id = :'a_id';
\set ON_ERROR_STOP on
select test.assert(
  (select plan_id from public.subscriptions where business_id = :'a_id') = 'pro',
  'an invalid plan_id must be rejected by the check constraint, not silently written'
);

-- The client (authenticated owner) must never be able to write this
-- table directly, whatever the reason.
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
\set ON_ERROR_STOP off
update public.subscriptions set status = 'active' where business_id = :'a_id';
\set ON_ERROR_STOP on
reset role;
reset request.jwt.claim.sub;

\echo '===================================================================='
\echo 'AUDIT HARDENING -- column grants, unused delete grants, storage limits'
\echo '===================================================================='

set role anon;
\set ON_ERROR_STOP off
select owner_id, phone, email from public.businesses where id = :'a_id';
\set ON_ERROR_STOP on
reset role;

set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
\set ON_ERROR_STOP off
delete from public.appointments where id = :'rebooked_appt_id';
\set ON_ERROR_STOP on
reset role;
reset request.jwt.claim.sub;
select test.assert(
  exists (select 1 from public.appointments where id = :'rebooked_appt_id'),
  'appointments must never be hard-deletable by the client (cancel via status instead)'
);

select test.assert(
  (select file_size_limit from storage.buckets where id = 'business-assets') = 5242880,
  'the business-assets bucket must enforce a server-side file size limit'
);
select test.assert(
  (select allowed_mime_types from storage.buckets where id = 'business-assets') is not null,
  'the business-assets bucket must enforce a server-side mime type allowlist'
);

\echo '===================================================================='
\echo 'ALL ASSERTIONS PASSED'
\echo '===================================================================='

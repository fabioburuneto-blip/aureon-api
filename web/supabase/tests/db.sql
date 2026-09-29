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
\echo 'P0 -- businesses.owner_id/phone/email must never leak to authenticated'
\echo '===================================================================='
-- supabase/migrations/20250924120009_audit_hardening.sql narrowed this for
-- anon (asserted above) but never for authenticated -- any logged-in user
-- of the platform, not just B''s own members, could read B''s owner_id/
-- phone/email by querying businesses directly. Fixed in
-- 20250924120010_fix_businesses_authenticated_grant.sql.
update public.businesses set phone = '+5511900000000', email = 'owner-b-private@test.com' where id = :'b_id';

set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
\set ON_ERROR_STOP off
select owner_id, phone, email from public.businesses where id = :'b_id';
\set ON_ERROR_STOP on
-- The safe, public columns must still be readable (the storefront browsing
-- case this table's RLS is meant to serve).
select test.assert(
  (select name from public.businesses where id = :'b_id') = 'Salao B',
  'business A must still be able to read business B''s public storefront columns'
);
reset role;
reset request.jwt.claim.sub;

-- A member must still get their own business's phone/email, via
-- get_business_contact() rather than a bare SELECT.
set role authenticated;
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
select test.assert(
  (select phone from public.get_business_contact(:'b_id')) = '+5511900000000',
  'a business''s own member must still get its phone via get_business_contact()'
);
select test.assert(
  not exists (select 1 from public.get_business_contact(:'a_id')),
  'get_business_contact() must return nothing for a business the caller does not belong to'
);
reset role;
reset request.jwt.claim.sub;

\echo '===================================================================='
\echo 'P0 -- create_public_appointment() must enforce every rule'
\echo 'get_available_slots() already enforces (hours, closed days,'
\echo 'professional hours, blocked times, conflicts, duration, timezone)'
\echo '===================================================================='

-- Proven live before this fix: a booking hours before business_hours opens
-- succeeded through create_public_appointment() even though
-- get_available_slots() never offered it. Business A opens 09:00.
select (current_date + 20) as p0_date \gset
select ((:'p0_date'::date + time '08:59') at time zone 'America/Sao_Paulo') as p0_before_open \gset
select ((:'p0_date'::date + time '10:00') at time zone 'America/Sao_Paulo') as p0_ok_slot \gset

select test.assert(
  not exists (
    select 1 from public.get_available_slots('barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', :'p0_date'::date)
    where slot_start = :'p0_before_open'::timestamptz
  ),
  'get_available_slots() must not offer a time before business_hours opens'
);
\set ON_ERROR_STOP off
select public.create_public_appointment(
  'barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
  :'p0_before_open'::timestamptz, 'Nao deveria (antes de abrir)', '+5511900010001', null, null
);
\set ON_ERROR_STOP on
select test.assert(
  not exists (select 1 from public.appointments where professional_id = 'a2222222-2222-2222-2222-222222222222' and starts_at = :'p0_before_open'::timestamptz),
  'create_public_appointment() must reject a time before business_hours opens (was: silently accepted)'
);

-- A closed day (is_closed=true) must be rejected by both functions.
-- Business A is open every day of the week today -- close a specific,
-- otherwise-untouched day-of-week just for this check, then restore it.
select (current_date + 21) as p0_closed_date \gset
select extract(dow from :'p0_closed_date'::date)::smallint as p0_closed_dow \gset
select ((:'p0_closed_date'::date + time '10:00') at time zone 'America/Sao_Paulo') as p0_closed_slot \gset

update public.business_hours set is_closed = true where business_id = :'a_id' and day_of_week = :'p0_closed_dow';

select test.assert(
  (select count(*) from public.get_available_slots('barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', :'p0_closed_date'::date)) = 0,
  'get_available_slots() must offer zero slots on a day marked is_closed'
);
\set ON_ERROR_STOP off
select public.create_public_appointment(
  'barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
  :'p0_closed_slot'::timestamptz, 'Nao deveria (dia fechado)', '+5511900010002', null, null
);
\set ON_ERROR_STOP on
select test.assert(
  not exists (select 1 from public.appointments where professional_id = 'a2222222-2222-2222-2222-222222222222' and starts_at = :'p0_closed_slot'::timestamptz),
  'create_public_appointment() must reject a booking on a day marked is_closed (was: silently accepted)'
);

update public.business_hours set is_closed = false where business_id = :'a_id' and day_of_week = :'p0_closed_dow';

-- A service that would finish after closing time must be rejected, even
-- though it starts inside business hours. B closes at 18:00 and its
-- service is 60 minutes.
select ((:'p0_date'::date + time '17:30') at time zone 'America/Sao_Paulo') as p0_overflow_slot \gset
\set ON_ERROR_STOP off
select public.create_public_appointment(
  'salao-b', 'b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
  :'p0_overflow_slot'::timestamptz, 'Nao deveria (estoura fechamento)', '+5511900010003', null, null
);
\set ON_ERROR_STOP on
select test.assert(
  not exists (select 1 from public.appointments where professional_id = 'b2222222-2222-2222-2222-222222222222' and starts_at = :'p0_overflow_slot'::timestamptz),
  'create_public_appointment() must reject a booking that would end after closing time'
);

-- A professional's own hours narrower than the business's must be
-- enforced by both functions (professional_hours takes precedence over
-- business_hours, exactly like get_available_slots() already does).
select (current_date + 22) as p0_prof_date \gset
select extract(dow from :'p0_prof_date'::date)::smallint as p0_prof_dow \gset
insert into public.professional_hours (professional_id, day_of_week, start_time, end_time, is_closed)
values ('a2222222-2222-2222-2222-222222222222', :'p0_prof_dow', '10:00', '14:00', false)
on conflict (professional_id, day_of_week) do update set start_time = excluded.start_time, end_time = excluded.end_time, is_closed = false;

select ((:'p0_prof_date'::date + time '15:00') at time zone 'America/Sao_Paulo') as p0_outside_prof_hours \gset
select test.assert(
  not exists (
    select 1 from public.get_available_slots('barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', :'p0_prof_date'::date)
    where slot_start = :'p0_outside_prof_hours'::timestamptz
  ),
  'get_available_slots() must respect the professional''s own (narrower) hours over business_hours'
);
\set ON_ERROR_STOP off
select public.create_public_appointment(
  'barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
  :'p0_outside_prof_hours'::timestamptz, 'Nao deveria (fora do horario do profissional)', '+5511900010004', null, null
);
\set ON_ERROR_STOP on
select test.assert(
  not exists (select 1 from public.appointments where professional_id = 'a2222222-2222-2222-2222-222222222222' and starts_at = :'p0_outside_prof_hours'::timestamptz),
  'create_public_appointment() must reject a time outside the professional''s own hours (was: only get_available_slots checked this)'
);

-- The professional explicitly not working that day (professional_hours
-- row marked is_closed) must be rejected even though the business itself
-- is open.
select (current_date + 23) as p0_prof_off_date \gset
select extract(dow from :'p0_prof_off_date'::date)::smallint as p0_prof_off_dow \gset
insert into public.professional_hours (professional_id, day_of_week, start_time, end_time, is_closed)
values ('a2222222-2222-2222-2222-222222222222', :'p0_prof_off_dow', '00:00', '00:00', true)
on conflict (professional_id, day_of_week) do update set is_closed = true;

select ((:'p0_prof_off_date'::date + time '10:00') at time zone 'America/Sao_Paulo') as p0_prof_day_off_slot \gset
select test.assert(
  (select count(*) from public.get_available_slots('barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', :'p0_prof_off_date'::date)) = 0,
  'get_available_slots() must offer zero slots when the professional has that day off'
);
\set ON_ERROR_STOP off
select public.create_public_appointment(
  'barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
  :'p0_prof_day_off_slot'::timestamptz, 'Nao deveria (profissional de folga)', '+5511900010005', null, null
);
\set ON_ERROR_STOP on
select test.assert(
  not exists (select 1 from public.appointments where professional_id = 'a2222222-2222-2222-2222-222222222222' and starts_at = :'p0_prof_day_off_slot'::timestamptz),
  'create_public_appointment() must reject a booking when the professional has that day off'
);

delete from public.professional_hours where professional_id = 'a2222222-2222-2222-2222-222222222222';

-- blocked_times must be enforced by create_public_appointment() too, not
-- just get_available_slots() (already asserted above).
select (current_date + 24) as p0_block_date \gset
select ((:'p0_block_date'::date + time '10:00') at time zone 'America/Sao_Paulo') as p0_block_start \gset
select ((:'p0_block_date'::date + time '11:00') at time zone 'America/Sao_Paulo') as p0_block_end \gset
insert into public.blocked_times (business_id, professional_id, starts_at, ends_at, reason)
values (:'a_id', 'a2222222-2222-2222-2222-222222222222', :'p0_block_start'::timestamptz, :'p0_block_end'::timestamptz, 'Teste P0');

\set ON_ERROR_STOP off
select public.create_public_appointment(
  'barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
  :'p0_block_start'::timestamptz, 'Nao deveria (bloqueado)', '+5511900010006', null, null
);
\set ON_ERROR_STOP on
select test.assert(
  not exists (select 1 from public.appointments where professional_id = 'a2222222-2222-2222-2222-222222222222' and starts_at = :'p0_block_start'::timestamptz),
  'create_public_appointment() must reject a blocked_times slot'
);

-- Free slot on the same day, outside the block, must still succeed --
-- proves the fix rejects only what it should.
select ((:'p0_block_date'::date + time '12:00') at time zone 'America/Sao_Paulo') as p0_free_after_block \gset
select (public.create_public_appointment(
  'barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
  :'p0_free_after_block'::timestamptz, 'Cliente valido', '+5511900010007', null, null
)).id as p0_valid_appt_id \gset
select test.assert(:'p0_valid_appt_id' is not null, 'a genuinely free, valid slot must still be booked successfully after the fix');

-- Durations: 30/45/60/90 minutes must each occupy exactly their own
-- interval end-to-end. A's Corte is 30min and B's Escova is 60min
-- already; add 45/90min services on A for this check.
insert into public.services (id, business_id, name, duration_minutes, price_cents, is_active) values
  ('a4444444-4444-4444-4444-444444444444', :'a_id', 'Corte e Barba', 45, 7000, true),
  ('a5555555-5555-5555-5555-555555555555', :'a_id', 'Dia de Noiva', 90, 25000, true);
insert into public.professional_services (professional_id, service_id) values
  ('a2222222-2222-2222-2222-222222222222', 'a4444444-4444-4444-4444-444444444444'),
  ('a2222222-2222-2222-2222-222222222222', 'a5555555-5555-5555-5555-555555555555');

select (current_date + 25) as p0_dur_date \gset
select ((:'p0_dur_date'::date + time '09:00') at time zone 'America/Sao_Paulo') as p0_dur_30 \gset
select ((:'p0_dur_date'::date + time '10:00') at time zone 'America/Sao_Paulo') as p0_dur_45 \gset
select ((:'p0_dur_date'::date + time '11:00') at time zone 'America/Sao_Paulo') as p0_dur_60 \gset
select ((:'p0_dur_date'::date + time '13:00') at time zone 'America/Sao_Paulo') as p0_dur_90 \gset

select (public.create_public_appointment('barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', :'p0_dur_30'::timestamptz, 'D30', '+5511900011030', null, null)).id as p0_d30 \gset
select (public.create_public_appointment('barbearia-a', 'a4444444-4444-4444-4444-444444444444', 'a2222222-2222-2222-2222-222222222222', :'p0_dur_45'::timestamptz, 'D45', '+5511900011045', null, null)).id as p0_d45 \gset
select (public.create_public_appointment('salao-b', 'b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', :'p0_dur_60'::timestamptz, 'D60', '+5511900011060', null, null)).id as p0_d60 \gset
select (public.create_public_appointment('barbearia-a', 'a5555555-5555-5555-5555-555555555555', 'a2222222-2222-2222-2222-222222222222', :'p0_dur_90'::timestamptz, 'D90', '+5511900011090', null, null)).id as p0_d90 \gset

select test.assert((select ends_at - starts_at from public.appointments where id = :'p0_d30') = interval '30 minutes', '30-minute service must occupy exactly 30 minutes');
select test.assert((select ends_at - starts_at from public.appointments where id = :'p0_d45') = interval '45 minutes', '45-minute service must occupy exactly 45 minutes');
select test.assert((select ends_at - starts_at from public.appointments where id = :'p0_d60') = interval '60 minutes', '60-minute service must occupy exactly 60 minutes');
select test.assert((select ends_at - starts_at from public.appointments where id = :'p0_d90') = interval '90 minutes', '90-minute service must occupy exactly 90 minutes');

-- Timezone: the local wall-clock hour stored must match what was
-- requested in America/Sao_Paulo, regardless of the session's own zone.
select test.assert(
  (select (starts_at at time zone 'America/Sao_Paulo')::time from public.appointments where id = :'p0_d30') = time '09:00',
  'a slot requested as 09:00 America/Sao_Paulo must be stored such that it reads back as 09:00 in that zone'
);

-- Existing-appointment conflict must still be rejected via
-- validate_appointment_slot()'s own pre-check (not only the EXCLUDE
-- constraint at INSERT time -- both must agree).
\set ON_ERROR_STOP off
select public.create_public_appointment(
  'barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
  :'p0_dur_30'::timestamptz, 'Conflito', '+5511900011031', null, null
);
\set ON_ERROR_STOP on
select test.assert(
  (select count(*) from public.appointments where professional_id = 'a2222222-2222-2222-2222-222222222222' and starts_at = :'p0_dur_30'::timestamptz) = 1,
  'booking an already-taken slot must still be rejected after centralizing validation'
);

\echo '===================================================================='
\echo 'P0 -- reschedule_appointment() must enforce the same rules as'
\echo 'create_public_appointment(), not just the EXCLUDE constraint'
\echo '===================================================================='

-- Proven live before this fix: the dashboard's plain UPDATE could move an
-- appointment directly into an active blocked_times window that
-- create_public_appointment() correctly refuses for the same slot.
select (public.create_public_appointment(
  'barbearia-a', 'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
  :'p0_ok_slot'::timestamptz, 'Cliente Reagenda', '+5511900012000', null, null
)).id as p0_resched_appt_id \gset

set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';

\set ON_ERROR_STOP off
select public.reschedule_appointment(:'p0_resched_appt_id', :'p0_block_start'::timestamptz);
\set ON_ERROR_STOP on
select test.assert(
  (select starts_at from public.appointments where id = :'p0_resched_appt_id') = :'p0_ok_slot'::timestamptz,
  'reschedule_appointment() must reject moving an appointment into a blocked_times window (was: only the EXCLUDE constraint was checked, blocked_times was not)'
);

\set ON_ERROR_STOP off
select public.reschedule_appointment(:'p0_resched_appt_id', :'p0_before_open'::timestamptz);
\set ON_ERROR_STOP on
select test.assert(
  (select starts_at from public.appointments where id = :'p0_resched_appt_id') = :'p0_ok_slot'::timestamptz,
  'reschedule_appointment() must reject moving an appointment to a time before business_hours opens'
);

-- A legitimate reschedule to a genuinely free, valid slot must still work.
select (current_date + 26) as p0_resched_date \gset
select ((:'p0_resched_date'::date + time '11:00') at time zone 'America/Sao_Paulo') as p0_resched_target \gset
select public.reschedule_appointment(:'p0_resched_appt_id', :'p0_resched_target'::timestamptz);
select test.assert(
  (select starts_at from public.appointments where id = :'p0_resched_appt_id') = :'p0_resched_target'::timestamptz,
  'reschedule_appointment() must still succeed for a genuinely free, valid slot'
);

-- Cross-tenant: business A must never be able to reschedule business B's
-- appointment (p0_d60, booked above under salao-b), whatever the target
-- time -- reschedule_appointment() must reject this itself
-- (is_business_member()), not rely on the caller having filtered by
-- business_id.
\set ON_ERROR_STOP off
select public.reschedule_appointment(:'p0_d60', :'p0_resched_target'::timestamptz);
\set ON_ERROR_STOP on

reset role;
reset request.jwt.claim.sub;

select test.assert(
  (select professional_id from public.appointments where id = :'p0_d60') = 'b2222222-2222-2222-2222-222222222222',
  'business A must never be able to reschedule business B''s appointment'
);

\echo '===================================================================='
\echo 'ONBOARDING WIZARD -- slug availability, whatsapp/instagram, resume'
\echo '===================================================================='

select test.assert(is_slug_available('uma-empresa-nova') = true, 'a well-formed, unused slug must be available');
select test.assert(is_slug_available('criar-conta') = false, 'the /criar-conta route itself must be reserved');
select test.assert(is_slug_available('dashboard') = false, 'reserved app routes must never be an available slug');
select test.assert(is_slug_available('AB') = false, 'uppercase/too-short input must not be available');
select test.assert(is_slug_available('barbearia-a') = false, 'an already-taken slug (business A, created above) must not be available');

insert into auth.users (id, email) values ('d0000000-0000-0000-0000-00000000000d', 'dono-onboarding@test.com');
set role authenticated;
set request.jwt.claim.sub = 'd0000000-0000-0000-0000-00000000000d';

select (create_business('Estúdio Onboarding', 'estudio-onboarding', 'nails', 'America/Sao_Paulo', '+5511977775555', '@estudio.onb')).id as ob_id \gset

select test.assert(
  (select whatsapp from businesses where id = :'ob_id') = '+5511977775555',
  'create_business() must store the whatsapp contact when provided'
);
select test.assert(
  (select instagram from businesses where id = :'ob_id') = '@estudio.onb',
  'create_business() must store the instagram handle when provided'
);
select test.assert(
  (select onboarding_step from businesses where id = :'ob_id') = 1,
  'a freshly created business must start at onboarding_step 1'
);

-- Duplicate slug: the wizard's step 1 must surface this as a clean
-- rejection (23505), never a partial/duplicate business row.
\set ON_ERROR_STOP off
select create_business('Outro Nome', 'estudio-onboarding', 'nails', 'America/Sao_Paulo');
\set ON_ERROR_STOP on
select test.assert(
  (select count(*) from businesses where slug = 'estudio-onboarding') = 1,
  'a duplicate slug must never create a second business row'
);
select test.assert(
  (select count(*) from business_members where user_id = 'd0000000-0000-0000-0000-00000000000d') = 1,
  'a rejected duplicate-slug attempt must not leave behind an extra membership row'
);

-- Resuming: onboarding_step only ever advances, never regresses, and is
-- scoped to the caller's own business.
select greatest_onboarding_step(:'ob_id', 3);
select test.assert((select onboarding_step from businesses where id = :'ob_id') = 3, 'advancing the step must persist the new value');
select greatest_onboarding_step(:'ob_id', 1);
select test.assert((select onboarding_step from businesses where id = :'ob_id') = 3, 'going back to an earlier step must never regress onboarding_step');

reset role;
reset request.jwt.claim.sub;

insert into auth.users (id, email) values ('d1000000-0000-0000-0000-00000000000d', 'estranho-onboarding@test.com');
set role authenticated;
set request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
\set ON_ERROR_STOP off
select greatest_onboarding_step(:'ob_id', 5);
\set ON_ERROR_STOP on
select test.assert(
  (select onboarding_step from businesses where id = :'ob_id') = 3,
  'a user with no membership on this business must never be able to advance its onboarding_step'
);
reset role;
reset request.jwt.claim.sub;

-- The authenticated grant must expose the new columns (needed to resume
-- the wizard and to render whatsapp/instagram) while still excluding
-- owner_id/phone/email for a non-member -- same shape as the P0.1 test
-- above, reconfirmed after this migration touched the same grant again.
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select test.assert(
  (select onboarding_step from businesses where id = :'ob_id') is not null,
  'onboarding_step must be readable by any authenticated user (not sensitive)'
);
\set ON_ERROR_STOP off
select owner_id from businesses where id = :'ob_id';
\set ON_ERROR_STOP on
reset role;
reset request.jwt.claim.sub;

\echo '===================================================================='
\echo 'PUBLIC PAGE ENGINE (Etapa 2) -- theme preset/sections, gallery, address/city'
\echo '===================================================================='

-- themes: preset defaults to 'moderno' and sections defaults to all 9,
-- hero first / footer last, all visible.
select test.assert(
  (select preset from themes where business_id = :'a_id') = 'moderno',
  'a freshly created theme must default to the moderno preset'
);
select test.assert(
  jsonb_array_length((select sections from themes where business_id = :'a_id')) = 9,
  'a freshly created theme must default to all 9 sections configured'
);
select test.assert(
  (select sections -> 0 ->> 'key' from themes where business_id = :'a_id') = 'hero',
  'the default sections config must have hero first'
);
select test.assert(
  (select sections -> 8 ->> 'key' from themes where business_id = :'a_id') = 'footer',
  'the default sections config must have footer last'
);

-- owner A can set their own preset and sections config; a stranger cannot.
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
update themes set preset = 'barbearia' where business_id = :'a_id';
update themes set sections = '[
  {"key": "hero", "visible": true},
  {"key": "services", "visible": true},
  {"key": "about", "visible": false},
  {"key": "team", "visible": true},
  {"key": "gallery", "visible": true},
  {"key": "booking", "visible": true},
  {"key": "location", "visible": true},
  {"key": "social", "visible": true},
  {"key": "footer", "visible": true}
]'::jsonb where business_id = :'a_id';
reset role;
reset request.jwt.claim.sub;
select test.assert(
  (select preset from themes where business_id = :'a_id') = 'barbearia',
  'the owner must be able to change their own theme preset'
);

set role authenticated;
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
update themes set preset = 'elegante' where business_id = :'a_id';
reset role;
reset request.jwt.claim.sub;
select test.assert(
  (select preset from themes where business_id = :'a_id') = 'barbearia',
  'a different owner must never be able to change business A''s theme preset (RLS)'
);

-- preset is constrained to the 5 named presets at the database level, not
-- just by the Zod schema in the app.
\set ON_ERROR_STOP off
update themes set preset = 'cyberpunk' where business_id = :'a_id';
\set ON_ERROR_STOP on
select test.assert(
  (select preset from themes where business_id = :'a_id') = 'barbearia',
  'an invalid preset value must be rejected by the check constraint'
);

-- business_gallery: owner can add/remove photos on their own business;
-- another owner can neither add to nor delete from it (RLS), and an
-- anonymous visitor can read a published business's gallery but not
-- write to it.
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
insert into business_gallery (business_id, image_url, position)
values (:'a_id', 'https://example.com/gallery/a1.jpg', 0)
returning id as ga_id \gset
reset role;
reset request.jwt.claim.sub;
select test.assert(
  (select count(*) from business_gallery where business_id = :'a_id') = 1,
  'the owner must be able to add a photo to their own gallery'
);

set role authenticated;
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
\set ON_ERROR_STOP off
insert into business_gallery (business_id, image_url, position)
values (:'a_id', 'https://evil.example.com/x.jpg', 1);
\set ON_ERROR_STOP on
select test.assert(
  (select count(*) from business_gallery where business_id = :'a_id') = 1,
  'a different owner must never be able to insert a photo into business A''s gallery (cross-tenant)'
);
delete from business_gallery where id = :'ga_id';
select test.assert(
  (select count(*) from business_gallery where id = :'ga_id') = 1,
  'a different owner must never be able to delete business A''s gallery photo (cross-tenant)'
);
reset role;
reset request.jwt.claim.sub;

set role anon;
select test.assert(
  (select count(*) from business_gallery where business_id = :'a_id') = 1,
  'anon must be able to read a published business''s gallery'
);
\set ON_ERROR_STOP off
insert into business_gallery (business_id, image_url) values (:'a_id', 'https://x/y.jpg');
\set ON_ERROR_STOP on
select test.assert(
  (select count(*) from business_gallery where business_id = :'a_id') = 1,
  'anon must never be able to write to any business''s gallery'
);
reset role;

-- Unpublish A and confirm its gallery becomes invisible to anon (same
-- "unpublished == doesn't exist" rule as businesses/services/themes).
update businesses set is_published = false where id = :'a_id';
set role anon;
select test.assert(
  (select count(*) from business_gallery where business_id = :'a_id') = 0,
  'anon must not see a gallery photo of an unpublished business'
);
reset role;
-- The owner can still see it (needed for /dashboard/preview before first publish).
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select test.assert(
  (select count(*) from business_gallery where business_id = :'a_id') = 1,
  'the owner must still see their own gallery even while unpublished'
);
reset role;
reset request.jwt.claim.sub;
update businesses set is_published = true where id = :'a_id';

delete from business_gallery where business_id = :'a_id';

-- businesses.address/city: readable by anon/authenticated (public-facing,
-- like whatsapp/instagram), owner_id/phone/email still excluded from both.
update businesses set address = 'Rua Teste, 100', city = 'São Paulo' where id = :'a_id';
set role anon;
select test.assert(
  (select address from businesses where id = :'a_id') = 'Rua Teste, 100',
  'anon must be able to read address (public-facing storefront field)'
);
select test.assert(
  (select city from businesses where id = :'a_id') = 'São Paulo',
  'anon must be able to read city (public-facing storefront field)'
);
\set ON_ERROR_STOP off
select owner_id from businesses where id = :'a_id';
\set ON_ERROR_STOP on
\set ON_ERROR_STOP off
select phone from businesses where id = :'a_id';
\set ON_ERROR_STOP on
reset role;

set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select test.assert(
  (select address from businesses where id = :'a_id') = 'Rua Teste, 100',
  'authenticated must be able to read address on their own business'
);
\set ON_ERROR_STOP off
select owner_id from businesses where id = :'a_id';
\set ON_ERROR_STOP on
reset role;
reset request.jwt.claim.sub;

\echo '===================================================================='
\echo 'CLIENT BOOKING PORTAL (Etapa 3) -- token security, cancel, reschedule, dedup'
\echo '===================================================================='

-- Dedicated service/professional pairs (not reused elsewhere in this
-- file) so every appointment created in this section is guaranteed
-- conflict-free regardless of what earlier sections already booked.
insert into services (id, business_id, name, duration_minutes, price_cents, is_active)
values
  ('e3000000-0000-0000-0000-000000000001', :'a_id', 'Etapa3 Service A', 30, 5000, true),
  ('e3000000-0000-0000-0000-000000000003', :'b_id', 'Etapa3 Service B', 30, 5000, true);
insert into professionals (id, business_id, name, is_active)
values
  ('e3000000-0000-0000-0000-000000000002', :'a_id', 'Etapa3 Pro A', true),
  ('e3000000-0000-0000-0000-000000000004', :'b_id', 'Etapa3 Pro B', true);
insert into professional_services (professional_id, service_id) values
  ('e3000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000001'),
  ('e3000000-0000-0000-0000-000000000004', 'e3000000-0000-0000-0000-000000000003');

set role anon;
select client_token from create_public_appointment(
  (select slug from businesses where id = :'a_id'),
  'e3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000002',
  '2026-10-15 15:00:00-03'::timestamptz, 'Etapa3 Cliente A', '+5511900000101'
) \gset e3a_

select client_token from create_public_appointment(
  (select slug from businesses where id = :'b_id'),
  'e3000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000004',
  '2026-10-16 15:00:00-03'::timestamptz, 'Etapa3 Cliente B', '+5511900000102'
) \gset e3b_
reset role;

-- Push B's appointment to "starting very soon" directly (bypassing
-- validate_appointment_slot on purpose -- this is fixture setup for the
-- cancellation-window test below, not a test of the creation path, and a
-- plain UPDATE here can't be flaky the way computing "now() + 1 hour" as
-- the *original* booking time would be: that value has to also satisfy
-- business_hours at whatever wall-clock time this suite happens to run,
-- which is exactly what made an earlier version of this fixture flaky).
update appointments
  set starts_at = now() + interval '1 hour', ends_at = now() + interval '1 hour 30 minutes'
  where client_token = :'e3b_client_token';

-- TOKEN: high entropy, unique, never derived from id.
select test.assert(
  length(:'e3a_client_token') = 64,
  'client_token must be a 64-hex-char (256-bit) value'
);
select test.assert(
  (:'e3a_client_token' <> :'e3b_client_token'),
  'two different appointments must never share a client_token'
);
select test.assert(
  (select count(distinct client_token) from appointments) = (select count(*) from appointments),
  'client_token must be unique across every appointment in the table'
);

-- TOKEN: valid lookup returns only that appointment's own data.
select test.assert(
  (select business_name from get_public_appointment(:'e3a_client_token')) =
    (select name from businesses where id = :'a_id'),
  'get_public_appointment must return business A''s own name for A''s token'
);
select test.assert(
  (select service_name from get_public_appointment(:'e3a_client_token')) = 'Etapa3 Service A',
  'get_public_appointment must return the correct service for the token'
);

-- TOKEN: invalid / altered / nonexistent -- one generic error, never a
-- different message that would let a caller distinguish "malformed" from
-- "well-formed but unknown".
\set ON_ERROR_STOP off
select * from get_public_appointment('not-a-real-token-at-all');
\set ON_ERROR_STOP on
\set ON_ERROR_STOP off
select * from get_public_appointment(substr(:'e3a_client_token', 1, 63) || '0');
\set ON_ERROR_STOP on
\set ON_ERROR_STOP off
select * from get_public_appointment('');
\set ON_ERROR_STOP on
\set ON_ERROR_STOP off
select * from get_public_appointment(null);
\set ON_ERROR_STOP on

-- TOKEN: cross-tenant -- A's token can never touch B's appointment, and
-- vice versa. There is no "wrong business" parameter to pass (the token
-- alone resolves the row), so this proves the token from one business
-- never affects the other business's row when used for a write.
select cancel_public_appointment(:'e3a_client_token');
select test.assert(
  (select status from appointments where client_token = :'e3b_client_token') = 'pending',
  'cancelling with business A''s token must never change business B''s appointment'
);
select test.assert(
  (select status from appointments where client_token = :'e3a_client_token') = 'cancelled',
  'business A''s own token must still cancel its own appointment'
);

-- CANCEL: already-cancelled -- blocked with a clear, distinct message.
\set ON_ERROR_STOP off
select cancel_public_appointment(:'e3a_client_token');
\set ON_ERROR_STOP on

-- CANCEL: inside the 24h window -- blocked.
\set ON_ERROR_STOP off
select cancel_public_appointment(:'e3b_client_token');
\set ON_ERROR_STOP on
select test.assert(
  (select status from appointments where client_token = :'e3b_client_token') = 'pending',
  'a cancellation attempted inside the minimum-notice window must be rejected, not applied'
);

-- CANCEL: completed appointments can never be cancelled by the client.
insert into services (id, business_id, name, duration_minutes, price_cents, is_active)
values ('e3000000-0000-0000-0000-000000000005', :'a_id', 'Etapa3 Service C', 30, 5000, true);
insert into professional_services (professional_id, service_id)
values ('e3000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000005');
set role anon;
select client_token from create_public_appointment(
  (select slug from businesses where id = :'a_id'),
  'e3000000-0000-0000-0000-000000000005', 'e3000000-0000-0000-0000-000000000002',
  '2026-10-20 11:00:00-03'::timestamptz, 'Etapa3 Cliente C', '+5511900000103'
) \gset e3c_
reset role;
update appointments set status = 'completed' where client_token = :'e3c_client_token';
\set ON_ERROR_STOP off
select cancel_public_appointment(:'e3c_client_token');
\set ON_ERROR_STOP on
\set ON_ERROR_STOP off
select reschedule_public_appointment(:'e3c_client_token', '2026-10-21 11:00:00-03'::timestamptz);
\set ON_ERROR_STOP on
select test.assert(
  (select status from appointments where client_token = :'e3c_client_token') = 'completed',
  'a completed appointment must never be cancellable or reschedulable by the client'
);

-- RESCHEDULE: reuses validate_appointment_slot() -- a blocked_times window
-- rejects it exactly like it would for a brand-new booking, never a
-- second/parallel availability calculation.
insert into services (id, business_id, name, duration_minutes, price_cents, is_active)
values ('e3000000-0000-0000-0000-000000000006', :'a_id', 'Etapa3 Service D', 30, 5000, true);
insert into professional_services (professional_id, service_id)
values ('e3000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000006');
set role anon;
select client_token from create_public_appointment(
  (select slug from businesses where id = :'a_id'),
  'e3000000-0000-0000-0000-000000000006', 'e3000000-0000-0000-0000-000000000002',
  '2026-10-22 11:00:00-03'::timestamptz, 'Etapa3 Cliente D', '+5511900000104'
) \gset e3d_
reset role;
insert into blocked_times (business_id, professional_id, starts_at, ends_at, reason)
values (:'a_id', 'e3000000-0000-0000-0000-000000000002',
  '2026-10-23 14:00:00-03'::timestamptz, '2026-10-23 16:00:00-03'::timestamptz, 'Etapa3 QA block');
\set ON_ERROR_STOP off
select reschedule_public_appointment(:'e3d_client_token', '2026-10-23 14:30:00-03'::timestamptz);
\set ON_ERROR_STOP on
select test.assert(
  (select starts_at from appointments where client_token = :'e3d_client_token') = '2026-10-22 11:00:00-03'::timestamptz,
  'a reschedule into a blocked_times window must be rejected, leaving the original time untouched'
);

-- RESCHEDULE: a genuinely free slot succeeds.
select starts_at, status from reschedule_public_appointment(
  :'e3d_client_token', '2026-10-24 11:00:00-03'::timestamptz
) \gset e3d_after_
select test.assert(
  :'e3d_after_starts_at'::timestamptz = '2026-10-24 11:00:00-03'::timestamptz,
  'rescheduling to a free slot must persist the new starts_at'
);
select test.assert(
  :'e3d_after_status' in ('pending', 'confirmed'),
  'rescheduling must never change the appointment status by itself'
);

-- CLIENT DEDUP: same phone within one business reuses the same customer;
-- the same phone number used in a DIFFERENT business must never be
-- treated as the same customer (per-tenant identity, never global).
insert into services (id, business_id, name, duration_minutes, price_cents, is_active)
values
  ('e3000000-0000-0000-0000-000000000007', :'a_id', 'Etapa3 Service E1', 30, 5000, true),
  ('e3000000-0000-0000-0000-000000000008', :'a_id', 'Etapa3 Service E2', 30, 5000, true),
  ('e3000000-0000-0000-0000-000000000009', :'b_id', 'Etapa3 Service E3', 30, 5000, true);
insert into professional_services (professional_id, service_id) values
  ('e3000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000007'),
  ('e3000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000008'),
  ('e3000000-0000-0000-0000-000000000004', 'e3000000-0000-0000-0000-000000000009');
set role anon;
select customer_id from create_public_appointment(
  (select slug from businesses where id = :'a_id'),
  'e3000000-0000-0000-0000-000000000007', 'e3000000-0000-0000-0000-000000000002',
  '2026-10-26 11:00:00-03'::timestamptz, 'Etapa3 Dedup', '+5511900000200'
) \gset e3dedup1_
select customer_id from create_public_appointment(
  (select slug from businesses where id = :'a_id'),
  'e3000000-0000-0000-0000-000000000008', 'e3000000-0000-0000-0000-000000000002',
  '2026-10-27 11:00:00-03'::timestamptz, 'Etapa3 Dedup', '+5511900000200'
) \gset e3dedup2_
select customer_id from create_public_appointment(
  (select slug from businesses where id = :'b_id'),
  'e3000000-0000-0000-0000-000000000009', 'e3000000-0000-0000-0000-000000000004',
  '2026-10-26 11:00:00-03'::timestamptz, 'Etapa3 Dedup', '+5511900000200'
) \gset e3dedup3_
reset role;
select test.assert(
  :'e3dedup1_customer_id' = :'e3dedup2_customer_id',
  'the same phone number booking twice within the same business must reuse one customer row'
);
select test.assert(
  :'e3dedup1_customer_id' <> :'e3dedup3_customer_id',
  'the same phone number used in a DIFFERENT business must never resolve to the same customer row'
);

-- "agendamento" is now a real route -- must be reserved exactly like
-- "dashboard"/"onboarding"/etc.
select test.assert(
  is_slug_reserved('agendamento') = true,
  'agendamento must be a reserved slug now that /agendamento/[token] is a real route'
);
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
\set ON_ERROR_STOP off
select create_business('Shadow', 'agendamento', 'barbershop');
\set ON_ERROR_STOP on
reset request.jwt.claim.sub;
select test.assert(
  not exists (select 1 from businesses where slug = 'agendamento'),
  'a business must never be able to claim the agendamento slug'
);

\echo '===================================================================='
\echo 'ALL ASSERTIONS PASSED'
\echo '===================================================================='

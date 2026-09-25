-- =========================================================================
-- Billing: turns the `subscriptions` placeholder into a real record of
-- "what plan, what status, controlled by whom" -- and adds the
-- idempotency ledger the billing webhook needs. Nothing here ever grants
-- the client write access: status/period/plan are only ever changed by
-- the webhook handler (service role) or create_business() (SECURITY
-- DEFINER), matching the existing subscriptions_select_owner-only policy.
-- See docs/BILLING.md.
-- =========================================================================

-- plan_id is plain text, not a Postgres enum: plans are defined once in
-- src/lib/plans/config.ts (price, limits, features) and can change/gain a
-- new tier without a migration. This check constraint is a light guard
-- against typos/garbage, not the source of truth -- keep PLAN_IDS in that
-- file and this list in sync.
alter table public.subscriptions
  rename column plan to plan_id;

alter table public.subscriptions
  drop constraint subscriptions_plan_check;

alter table public.subscriptions
  add constraint subscriptions_plan_id_check
  check (plan_id in ('start', 'pro', 'business'));

alter table public.subscriptions
  alter column plan_id set default 'start';

alter table public.subscriptions
  drop constraint subscriptions_status_check;

alter table public.subscriptions
  add constraint subscriptions_status_check
  check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete'));

alter table public.subscriptions
  add column provider text not null default 'local'
    check (provider in ('local', 'mercadopago', 'asaas', 'stripe')),
  add column provider_customer_id text,
  add column provider_subscription_id text,
  add column current_period_start timestamptz,
  add column cancel_at_period_end boolean not null default false;

-- A given provider's subscription id must map to exactly one row here --
-- this is also what the webhook handler upserts against.
create unique index idx_subscriptions_provider_subscription_id
  on public.subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

comment on column public.subscriptions.provider is
  'Billing adapter that owns this subscription (see supabase/functions/_shared/billing or src/lib/billing). ''local'' = no real billing configured yet (dev/trial mode) -- see docs/BILLING.md.';
comment on column public.subscriptions.plan_id is
  'Matches a key in src/lib/plans/config.ts PLANS. Never trust a plan_id the client sends directly for anything paid -- only the webhook handler and create_business() write this column.';

-- =========================================================================
-- billing_webhook_events: idempotency ledger. The webhook handler inserts
-- (provider, provider_event_id) before applying any change; a unique
-- violation means "already processed this event", so the handler can
-- return 200 without touching subscriptions twice for the same event
-- (providers retry on anything other than a fast 2xx).
-- =========================================================================
create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index idx_billing_webhook_events_received_at
  on public.billing_webhook_events (received_at desc);

alter table public.billing_webhook_events enable row level security;
-- No policies for anon/authenticated on purpose: only the webhook route
-- (service role, bypasses RLS entirely) ever touches this table.

-- =========================================================================
-- create_business(): seed every new business with a 'local' subscription
-- on the default plan, in a trial. This is what makes the product usable
-- immediately without any billing provider configured (docs/BILLING.md
-- "modo local/development") -- trialDays here should stay in sync with
-- DEFAULT_PLAN_ID's trialDays in src/lib/plans/config.ts. Redefined only
-- to change the subscriptions insert; the rest of the function body is
-- unchanged from 20250924120005_functions.sql.
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

grant execute on function public.create_business(text, text, text, text) to authenticated;

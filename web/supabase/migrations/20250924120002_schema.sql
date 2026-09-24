-- =========================================================================
-- profiles: 1:1 mirror of auth.users, holds public-safe profile data
-- =========================================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- =========================================================================
-- businesses: one row per tenant
-- =========================================================================
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  segment text not null check (
    segment in (
      'barbershop', 'hair_salon', 'nails', 'aesthetics',
      'tattoo', 'massage', 'personal_trainer', 'other'
    )
  ),
  description text,
  phone text,
  email text,
  timezone text not null default 'America/Sao_Paulo',
  logo_url text,
  cover_url text,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_businesses_owner_id on public.businesses (owner_id);
create index idx_businesses_is_published on public.businesses (is_published);

create trigger trg_businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

-- =========================================================================
-- business_settings: 1:1 operational config per business
-- =========================================================================
create table public.business_settings (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  booking_window_days int not null default 30 check (booking_window_days > 0),
  min_notice_minutes int not null default 60 check (min_notice_minutes >= 0),
  slot_interval_minutes int not null default 30 check (slot_interval_minutes > 0),
  require_customer_phone boolean not null default true,
  allow_same_day_booking boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_business_settings_set_updated_at
  before update on public.business_settings
  for each row execute function public.set_updated_at();

-- =========================================================================
-- business_members: owner/staff membership (future roles ready)
-- =========================================================================
create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create index idx_business_members_business_id on public.business_members (business_id);
create index idx_business_members_user_id on public.business_members (user_id);

-- =========================================================================
-- services
-- =========================================================================
create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  duration_minutes int not null check (duration_minutes > 0),
  price_cents int not null default 0 check (price_cents >= 0),
  is_active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_services_business_id on public.services (business_id);

create trigger trg_services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- =========================================================================
-- professionals
-- =========================================================================
create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  bio text,
  avatar_url text,
  is_active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_professionals_business_id on public.professionals (business_id);

create trigger trg_professionals_set_updated_at
  before update on public.professionals
  for each row execute function public.set_updated_at();

-- =========================================================================
-- professional_services: which professionals perform which services
-- =========================================================================
create table public.professional_services (
  professional_id uuid not null references public.professionals (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  primary key (professional_id, service_id)
);

create index idx_professional_services_service_id on public.professional_services (service_id);

-- =========================================================================
-- business_hours: weekly recurring hours (one shift per weekday)
-- =========================================================================
create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, day_of_week),
  constraint chk_business_hours_range check (is_closed or end_time > start_time)
);

create index idx_business_hours_business_id on public.business_hours (business_id);

create trigger trg_business_hours_set_updated_at
  before update on public.business_hours
  for each row execute function public.set_updated_at();

-- =========================================================================
-- professional_hours: optional per-professional override
-- =========================================================================
create table public.professional_hours (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (professional_id, day_of_week),
  constraint chk_professional_hours_range check (is_closed or end_time > start_time)
);

create index idx_professional_hours_professional_id on public.professional_hours (professional_id);

create trigger trg_professional_hours_set_updated_at
  before update on public.professional_hours
  for each row execute function public.set_updated_at();

-- =========================================================================
-- blocked_times: vacations / breaks / ad-hoc blocks
-- =========================================================================
create table public.blocked_times (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  professional_id uuid references public.professionals (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_blocked_times_range check (ends_at > starts_at)
);

create index idx_blocked_times_business_id on public.blocked_times (business_id);
create index idx_blocked_times_professional_id on public.blocked_times (professional_id);

create trigger trg_blocked_times_set_updated_at
  before update on public.blocked_times
  for each row execute function public.set_updated_at();

-- =========================================================================
-- customers: per-tenant customer records (never shared across businesses)
-- =========================================================================
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, phone)
);

create index idx_customers_business_id on public.customers (business_id);

create trigger trg_customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- =========================================================================
-- appointments
-- =========================================================================
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete restrict,
  service_id uuid not null references public.services (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check (
    status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')
  ),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_appointments_range check (ends_at > starts_at),
  -- Prevents double-booking the same professional at the database level,
  -- closing the race-condition window that app-level checks alone cannot.
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'cancelled')
);

create index idx_appointments_business_id on public.appointments (business_id, starts_at);
create index idx_appointments_professional_id on public.appointments (professional_id, starts_at);
create index idx_appointments_customer_id on public.appointments (customer_id);

create trigger trg_appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- =========================================================================
-- themes: public page visual customization
-- =========================================================================
create table public.themes (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  primary_color text not null default '#111827',
  secondary_color text not null default '#6366f1',
  font text not null default 'inter',
  layout text not null default 'classic' check (layout in ('classic', 'minimal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_themes_set_updated_at
  before update on public.themes
  for each row execute function public.set_updated_at();

-- =========================================================================
-- notifications: in-app notifications for the dashboard
-- =========================================================================
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_business_id on public.notifications (business_id, read_at);

-- =========================================================================
-- subscriptions: SaaS billing placeholder, one per business
-- =========================================================================
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'basic', 'pro')),
  status text not null default 'active' check (
    status in ('active', 'trialing', 'past_due', 'canceled')
  ),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

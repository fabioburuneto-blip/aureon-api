-- =========================================================================
-- Enable RLS everywhere. No table is trusted to the client by default.
-- =========================================================================
alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_settings enable row level security;
alter table public.business_members enable row level security;
alter table public.services enable row level security;
alter table public.professionals enable row level security;
alter table public.professional_services enable row level security;
alter table public.business_hours enable row level security;
alter table public.professional_hours enable row level security;
alter table public.blocked_times enable row level security;
alter table public.customers enable row level security;
alter table public.appointments enable row level security;
alter table public.themes enable row level security;
alter table public.notifications enable row level security;
alter table public.subscriptions enable row level security;

-- =========================================================================
-- profiles: a user can only see/edit their own profile
-- =========================================================================
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

-- =========================================================================
-- businesses
-- =========================================================================
-- Public storefronts are readable by anyone; members can also see their
-- own business even while unpublished (e.g. during onboarding).
create policy "businesses_select_public_or_member" on public.businesses
  for select using (
    is_published = true or public.is_business_member(id)
  );

-- Direct client inserts are never allowed: creation goes exclusively through
-- the public.create_business() SECURITY DEFINER function so a business is
-- always created together with its owner membership, settings and theme.
create policy "businesses_update_owner" on public.businesses
  for update using (public.is_business_owner(id))
  with check (public.is_business_owner(id));

create policy "businesses_delete_owner" on public.businesses
  for delete using (public.is_business_owner(id));

-- =========================================================================
-- business_settings: administrative, owner-only
-- =========================================================================
create policy "business_settings_select_member" on public.business_settings
  for select using (public.is_business_member(business_id));

create policy "business_settings_update_owner" on public.business_settings
  for update using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));

-- =========================================================================
-- business_members: administrative, owner-only writes
-- =========================================================================
create policy "business_members_select_member" on public.business_members
  for select using (public.is_business_member(business_id));

create policy "business_members_insert_owner" on public.business_members
  for insert with check (public.is_business_owner(business_id));

create policy "business_members_update_owner" on public.business_members
  for update using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));

create policy "business_members_delete_owner" on public.business_members
  for delete using (public.is_business_owner(business_id));

-- =========================================================================
-- services: public can browse active services of published businesses;
-- staff+owner manage them (operational access).
-- =========================================================================
create policy "services_select_public_or_member" on public.services
  for select using (
    (
      is_active = true
      and exists (
        select 1 from public.businesses b
        where b.id = services.business_id and b.is_published = true
      )
    )
    or public.is_business_member(business_id)
  );

create policy "services_write_member" on public.services
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- =========================================================================
-- professionals: same visibility shape as services
-- =========================================================================
create policy "professionals_select_public_or_member" on public.professionals
  for select using (
    (
      is_active = true
      and exists (
        select 1 from public.businesses b
        where b.id = professionals.business_id and b.is_published = true
      )
    )
    or public.is_business_member(business_id)
  );

create policy "professionals_write_member" on public.professionals
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- =========================================================================
-- professional_services: visibility follows the professional's business
-- =========================================================================
create policy "professional_services_select_public_or_member" on public.professional_services
  for select using (
    exists (
      select 1
      from public.professionals p
      join public.businesses b on b.id = p.business_id
      where p.id = professional_services.professional_id
        and (b.is_published = true or public.is_business_member(p.business_id))
    )
  );

create policy "professional_services_write_member" on public.professional_services
  for all using (
    exists (
      select 1 from public.professionals p
      where p.id = professional_services.professional_id
        and public.is_business_member(p.business_id)
    )
  )
  with check (
    exists (
      select 1 from public.professionals p
      where p.id = professional_services.professional_id
        and public.is_business_member(p.business_id)
    )
  );

-- =========================================================================
-- business_hours: public can see the opening hours of published businesses
-- =========================================================================
create policy "business_hours_select_public_or_member" on public.business_hours
  for select using (
    exists (
      select 1 from public.businesses b
      where b.id = business_hours.business_id and b.is_published = true
    )
    or public.is_business_member(business_id)
  );

create policy "business_hours_write_member" on public.business_hours
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- =========================================================================
-- professional_hours: internal only, resolved for the public via the
-- get_available_slots() SECURITY DEFINER function instead of direct reads.
-- =========================================================================
create policy "professional_hours_select_member" on public.professional_hours
  for select using (
    exists (
      select 1 from public.professionals p
      where p.id = professional_hours.professional_id
        and public.is_business_member(p.business_id)
    )
  );

create policy "professional_hours_write_member" on public.professional_hours
  for all using (
    exists (
      select 1 from public.professionals p
      where p.id = professional_hours.professional_id
        and public.is_business_member(p.business_id)
    )
  )
  with check (
    exists (
      select 1 from public.professionals p
      where p.id = professional_hours.professional_id
        and public.is_business_member(p.business_id)
    )
  );

-- =========================================================================
-- blocked_times: internal only (never exposed to public clients)
-- =========================================================================
create policy "blocked_times_all_member" on public.blocked_times
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- =========================================================================
-- customers: strictly internal, per tenant. Public bookings are created via
-- the create_public_appointment() SECURITY DEFINER function, which upserts
-- customers without granting the anon role any direct table access.
-- =========================================================================
create policy "customers_all_member" on public.customers
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- =========================================================================
-- appointments: internal only for direct table access. Public booking
-- writes go through create_public_appointment(); staff can also create
-- walk-in appointments directly, always scoped to their own business_id.
-- =========================================================================
create policy "appointments_all_member" on public.appointments
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- =========================================================================
-- themes: public reads them to render the storefront; owner edits them
-- =========================================================================
create policy "themes_select_public_or_member" on public.themes
  for select using (
    exists (
      select 1 from public.businesses b
      where b.id = themes.business_id and b.is_published = true
    )
    or public.is_business_member(business_id)
  );

create policy "themes_update_owner" on public.themes
  for update using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));

-- =========================================================================
-- notifications: internal only
-- =========================================================================
create policy "notifications_select_member" on public.notifications
  for select using (public.is_business_member(business_id));

create policy "notifications_update_member" on public.notifications
  for update using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- =========================================================================
-- subscriptions: owner-visible only; writes are reserved for server-side
-- billing integrations using the service role (no client write policy).
-- =========================================================================
create policy "subscriptions_select_owner" on public.subscriptions
  for select using (public.is_business_owner(business_id));

-- =========================================================================
-- Table-level grants. RLS policies above are the real access-control layer;
-- these grants only let the anon/authenticated roles reach the RLS check in
-- the first place. Supabase projects set equivalent default privileges
-- automatically for new tables, but declaring them here keeps this schema
-- self-contained on any plain Postgres instance.
-- =========================================================================
grant usage on schema public to anon, authenticated;

grant select, insert, update on public.profiles to authenticated;

grant select on public.businesses to anon, authenticated;
grant update, delete on public.businesses to authenticated;

grant select, update on public.business_settings to authenticated;

grant select, insert, update, delete on public.business_members to authenticated;

grant select on public.services to anon, authenticated;
grant insert, update, delete on public.services to authenticated;

grant select on public.professionals to anon, authenticated;
grant insert, update, delete on public.professionals to authenticated;

grant select on public.professional_services to anon, authenticated;
grant insert, update, delete on public.professional_services to authenticated;

grant select on public.business_hours to anon, authenticated;
grant insert, update, delete on public.business_hours to authenticated;

grant select, insert, update, delete on public.professional_hours to authenticated;
grant select, insert, update, delete on public.blocked_times to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;

grant select on public.themes to anon, authenticated;
grant update on public.themes to authenticated;

grant select, update on public.notifications to authenticated;

grant select on public.subscriptions to authenticated;

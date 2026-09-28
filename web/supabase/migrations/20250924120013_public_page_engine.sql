-- =========================================================================
-- Etapa 2: motor de página pública personalizada. Adds what AUDIT-04
-- found missing to make the public page a configurable, section-based
-- storefront instead of one fixed layout: an address/city pair for the
-- Localização section, a named theme preset + a section
-- visibility/order config on `themes`, and a gallery table. Deliberately
-- does NOT touch booking/availability logic, RLS ownership model, or the
-- businesses/themes columns hardened in 20250924120009/20250924120012 --
-- this only widens what an owner can configure about how their own,
-- already-isolated storefront looks.
-- =========================================================================

-- -------------------------------------------------------------------------
-- businesses: address/city, purely informational (Localização section).
-- Neither is sensitive -- same class of data as name/description, meant
-- to be shown to the public, so both join the anon/authenticated safe
-- column grants below exactly like whatsapp/instagram did in Etapa 1.
-- -------------------------------------------------------------------------
alter table public.businesses
  add column address text,
  add column city text;

-- -------------------------------------------------------------------------
-- themes: preset drives the shared token system in
-- src/lib/theme-presets.ts (typography/spacing/radius/card/button/hero
-- composition) -- a name, not free-form styling, so five presets can't
-- drift into six slightly-different bespoke pages. `layout` (classic/
-- minimal) is left in place untouched but is no longer read by the
-- renderer -- dropping a column that existing rows already have is a
-- separate, unnecessary risk for this etapa.
--
-- `sections` is the visibility+order config for the 9-section public
-- page, stored as a JSON array of `{ key, visible }` in display order.
-- Kept as JSONB (not 9 boolean columns + 9 order columns) because the
-- section list is expected to grow (see src/lib/sections.ts) and an array
-- already encodes order for free. It is never trusted blindly on read --
-- src/lib/sections.ts#normalizeSectionsConfig() re-validates shape, fills
-- in any missing section, drops unknown keys and re-pins hero first/
-- footer last/booking visible every time it's read, exactly the same
-- "don't trust stored/foreign shape" posture already used for RPC inputs
-- elsewhere in this schema.
-- -------------------------------------------------------------------------
alter table public.themes
  add column preset text not null default 'moderno'
    check (preset in ('premium', 'moderno', 'minimalista', 'barbearia', 'elegante')),
  add column sections jsonb not null default '[
    {"key": "hero", "visible": true},
    {"key": "about", "visible": true},
    {"key": "services", "visible": true},
    {"key": "team", "visible": true},
    {"key": "gallery", "visible": true},
    {"key": "booking", "visible": true},
    {"key": "location", "visible": true},
    {"key": "social", "visible": true},
    {"key": "footer", "visible": true}
  ]'::jsonb;

-- -------------------------------------------------------------------------
-- business_gallery: a handful of extra storefront photos. Reuses the
-- existing `business-assets` bucket and its is_business_owner()-scoped
-- storage policies unchanged (objects already live under
-- `{business_id}/...`, and those policies don't limit how many objects a
-- business can have under its own folder) -- no storage migration needed.
-- This table is only the ordered list of which uploaded URLs to show and
-- in what order, same relationship services has to `position`.
-- -------------------------------------------------------------------------
create table public.business_gallery (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  image_url text not null check (length(trim(image_url)) > 0),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_business_gallery_business_id on public.business_gallery (business_id, position);

alter table public.business_gallery enable row level security;

-- Public can see a published business's gallery (same condition as
-- services/professionals/themes); members can see their own regardless of
-- publish state (so the personalizacao screen and /dashboard/preview work
-- before first publish).
create policy "business_gallery_select_public_or_member" on public.business_gallery
  for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_gallery.business_id and b.is_published = true
    )
    or public.is_business_member(business_id)
  );

-- Gallery is part of the storefront's visual identity, like logo/cover/
-- theme -- owner-only, not general staff, matching
-- businesses_update_owner/themes_update_owner.
create policy "business_gallery_owner_all" on public.business_gallery
  for all
  using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));

grant select on public.business_gallery to anon, authenticated;
grant insert, update, delete on public.business_gallery to authenticated;

-- -------------------------------------------------------------------------
-- businesses grant (anon/authenticated): re-issued to add address/city to
-- the same safe-column allowlist from 20250924120012_onboarding_wizard.sql
-- -- owner_id/phone/email remain excluded from both roles, unchanged.
-- -------------------------------------------------------------------------
revoke select on public.businesses from anon;
grant select (
  id, name, slug, segment, description, timezone, logo_url, cover_url,
  is_published, created_at, updated_at, whatsapp, instagram, address, city
) on public.businesses to anon;

revoke select on public.businesses from authenticated;
grant select (
  id, name, slug, segment, description, timezone, logo_url, cover_url,
  is_published, created_at, updated_at, whatsapp, instagram, onboarding_step,
  address, city
) on public.businesses to authenticated;

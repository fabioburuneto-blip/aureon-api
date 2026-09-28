-- =========================================================================
-- P0 security fix: 20250924120009_audit_hardening.sql narrowed
-- `businesses` SELECT to a safe column subset for `anon` (owner_id/phone/
-- email are never readable by an anonymous visitor), but never applied the
-- same fix to `authenticated`. The RLS policy
-- `businesses_select_public_or_member` allows reading ANY published
-- business's row (not just the caller's own), so any logged-in user of the
-- platform -- any other business's owner/staff, not just its own members
-- -- could read owner_id/phone/email of every other published business by
-- querying the table directly (e.g. via the browser's own session token
-- against the REST API), even though the app's UI never does this itself.
--
-- Fix mirrors the anon fix exactly: revoke the blanket grant, re-grant
-- only the same safe columns already exposed to anon. A business's own
-- members still need phone/email for the settings screen -- provided
-- separately below via get_business_contact(), which is authorization-
-- checked per business_id instead of relying on a column grant that can't
-- be conditioned on "whose business is this".
-- =========================================================================

revoke select on public.businesses from authenticated;

grant select (
  id, name, slug, segment, description, timezone, logo_url, cover_url,
  is_published, created_at, updated_at
) on public.businesses to authenticated;

-- -------------------------------------------------------------------------
-- get_business_contact: returns phone/email for exactly one business, only
-- when the caller is a member of that business. SECURITY DEFINER so it can
-- read the now-restricted columns; the is_business_member() check inside
-- is what stands in for the column grant an ordinary SELECT can no longer
-- provide for this case.
-- -------------------------------------------------------------------------
create or replace function public.get_business_contact(p_business_id uuid)
returns table (phone text, email text)
language sql
security definer
stable
set search_path = public
as $$
  select b.phone, b.email
  from public.businesses b
  where b.id = p_business_id
    and public.is_business_member(b.id);
$$;

grant execute on function public.get_business_contact(uuid) to authenticated;

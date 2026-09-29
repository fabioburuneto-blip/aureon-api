-- =========================================================================
-- Etapa 4: closes the two gaps ETAPA-4-NOTIFICATIONS-AUDIT.md found in the
-- advanced_notifications plan gate. That gate previously existed only in
-- src/app/dashboard/settings/actions.ts (updateNotificationSettings) --
-- meaning (a) a client could call the Supabase REST API directly against
-- business_settings and bypass it entirely, since the RLS policy on that
-- table only checks tenant ownership, never plan; and (b) even through the
-- legitimate UI, nothing ever re-checked the plan again after the initial
-- toggle, so a delivery enqueued while eligible would still be sent after
-- a downgrade.
--
-- This migration adds exactly one new source of truth for eligibility
-- (is_advanced_notifications_allowed, mirroring src/lib/plans/evaluate.ts
-- byte-for-byte) and uses it in two places: a BEFORE UPDATE trigger on
-- business_settings (closes gap a) and, from the process-notifications
-- Edge Function at send time (closes gap b -- see that function's diff).
-- Nothing here creates a second notification system, a second queue, a
-- new status, or a new trigger on appointments: the existing
-- trg_appointments_notify pipeline is untouched.
-- =========================================================================

-- -------------------------------------------------------------------------
-- is_advanced_notifications_allowed: single source of truth for "can this
-- business use WhatsApp/email notifications right now", callable from SQL
-- (the trigger below) and from the Edge Function (via RPC). Deliberately
-- mirrors isLimitEnforced()/evaluateFeatureAccess() in
-- src/lib/plans/evaluate.ts exactly, including the fail-open policy for
-- any status other than trialing/active (a business with no subscription
-- row, past_due, canceled, or incomplete billing must never be locked out
-- of a feature it already has due to a billing hiccup -- that is an
-- existing, deliberate product decision this migration does not change,
-- only enforces consistently in one more place). The only real gap this
-- closes is plan_id: while status IS enforced (trialing/active), the
-- feature now requires plan_id in ('pro', 'business') to be true at the
-- moment of check, not just at the moment the owner flipped the toggle --
-- so a downgrade from pro to start while still 'active' is caught here.
-- -------------------------------------------------------------------------
create or replace function public.is_advanced_notifications_allowed(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select
        case
          when s.status not in ('trialing', 'active') then true
          when s.plan_id in ('pro', 'business') then true
          else false
        end
      from public.subscriptions s
      where s.business_id = p_business_id
    ),
    -- No subscription row at all: same fail-open policy as
    -- isLimitEnforced() treating a missing/unknown status as unenforced.
    true
  );
$$;

comment on function public.is_advanced_notifications_allowed(uuid) is
  'Mirrors src/lib/plans/evaluate.ts (isLimitEnforced + evaluateFeatureAccess for advanced_notifications). Keep both in sync by hand -- there is no code generation between them.';

grant execute on function public.is_advanced_notifications_allowed(uuid) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- enforce_business_settings_notification_gate: the database-level backstop
-- for the Server Action check in updateNotificationSettings(). Only fires
-- on the off->on transition (matching exactly what the Server Action
-- already checks) so a business that is no longer eligible can still save
-- unrelated settings (e.g. flipping notify_reminder_24h) without being
-- blocked by a whatsapp_enabled/notify_email_enabled value that was
-- already true from before a downgrade -- that already-on case is instead
-- handled at send time by the Edge Function (see is_advanced_notifications_
-- allowed's grant to service_role above), not by refusing every future
-- write to this row.
-- -------------------------------------------------------------------------
create or replace function public.enforce_business_settings_notification_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    (new.whatsapp_enabled and not coalesce(old.whatsapp_enabled, false))
    or (new.notify_email_enabled and not coalesce(old.notify_email_enabled, false))
  ) and not public.is_advanced_notifications_allowed(new.business_id) then
    raise exception 'advanced notifications require an eligible plan (Pro or Business)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_business_settings_notification_gate on public.business_settings;
create trigger trg_business_settings_notification_gate
  before update on public.business_settings
  for each row execute function public.enforce_business_settings_notification_gate();

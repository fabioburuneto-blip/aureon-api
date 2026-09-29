/**
 * Send-time revalidation of the advanced_notifications plan gate (closes
 * the ETAPA-4 audit's second finding: a delivery enqueued while a business
 * was eligible must not still be sent after a downgrade). The actual
 * eligibility decision lives in Postgres (is_advanced_notifications_
 * allowed, see supabase/migrations/20250924120015_notifications_plan_gate.sql,
 * which mirrors src/lib/plans/evaluate.ts) so there is exactly one source
 * of truth -- this module only caches that lookup for the lifetime of one
 * batch run, so a queue full of the same business's deliveries doesn't
 * re-query per row. Runtime-agnostic like the rest of _shared/notifications
 * (no Deno/Node-specific API), so it's testable from Vitest identically to
 * how it runs inside the Edge Function.
 */

export interface EligibilityLookup {
  (businessId: string): Promise<boolean>;
}

export interface EligibilityChecker {
  (businessId: string): Promise<boolean>;
}

/** Wraps a raw lookup (typically a Supabase RPC call) with a per-run cache
 * keyed by business_id, so N deliveries for the same business only trigger
 * one query. */
export function createEligibilityChecker(lookup: EligibilityLookup): EligibilityChecker {
  const cache = new Map<string, Promise<boolean>>();

  return function isEligible(businessId: string): Promise<boolean> {
    let pending = cache.get(businessId);
    if (!pending) {
      pending = lookup(businessId);
      cache.set(businessId, pending);
    }
    return pending;
  };
}

/** The status set to a delivery that a plan gate blocked at send time.
 * Reuses the existing 'failed' status (no new status invented) so it
 * never retries -- a plan-ineligible delivery isn't a transient failure,
 * retrying it wastes a batch slot every run until someone upgrades. */
export const PLAN_INELIGIBLE_ERROR = "plan_ineligible";

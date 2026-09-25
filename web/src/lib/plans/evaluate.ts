import { PLAN_IDS, PLANS, type PlanDefinition, type PlanFeatureKey } from "./config";
import type { SubscriptionStatus } from "@/types/database";

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Subscription states under which plan limits are actually enforced.
 * Everything else (no subscription row at all, past_due, incomplete,
 * canceled) fails OPEN -- billing being unconfigured, mid-setup, or having
 * a hiccup must never lock an owner out of their own dashboard. This is
 * the one place that decision is made; every helper below routes through
 * it instead of re-deriving it.
 */
const ENFORCED_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  "trialing",
  "active",
]);

export function isLimitEnforced(status: SubscriptionStatus | null | undefined): boolean {
  return !!status && ENFORCED_STATUSES.has(status);
}

/** The cheapest plan (in PLAN_IDS order) that grants a given feature --
 * used to write a helpful upgrade message ("disponível a partir do plano
 * X") instead of a bare "not allowed". */
export function cheapestPlanWithFeature(feature: PlanFeatureKey): PlanDefinition | null {
  for (const id of PLAN_IDS) {
    if (PLANS[id].features.includes(feature)) return PLANS[id];
  }
  return null;
}

export function evaluateFeatureAccess(
  plan: PlanDefinition,
  enforced: boolean,
  feature: PlanFeatureKey,
): LimitCheckResult {
  if (!enforced) return { allowed: true };
  if (plan.features.includes(feature)) return { allowed: true };

  const upgrade = cheapestPlanWithFeature(feature);
  return {
    allowed: false,
    reason: upgrade
      ? `Este recurso está disponível a partir do plano ${upgrade.name}.`
      : "Este recurso não está disponível no seu plano.",
  };
}

export function evaluateCountLimit(
  plan: PlanDefinition,
  enforced: boolean,
  limit: number | null,
  currentCount: number,
  noun: { singular: string; plural: string },
): LimitCheckResult {
  if (!enforced || limit === null) return { allowed: true };
  if (currentCount < limit) return { allowed: true };

  return {
    allowed: false,
    reason: `O plano ${plan.name} permite até ${limit} ${limit === 1 ? noun.singular : noun.plural}. Faça upgrade para adicionar mais.`,
  };
}

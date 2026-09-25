import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { DEFAULT_PLAN_ID, getPlan, type PlanFeatureKey } from "./config";
import {
  evaluateCountLimit,
  evaluateFeatureAccess,
  isLimitEnforced,
  type LimitCheckResult,
} from "./evaluate";

export type { LimitCheckResult } from "./evaluate";

async function getEffectivePlan(supabase: SupabaseClient<Database>, businessId: string) {
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan_id, status")
    .eq("business_id", businessId)
    .maybeSingle();

  return {
    plan: getPlan(subscription?.plan_id ?? DEFAULT_PLAN_ID),
    enforced: isLimitEnforced(subscription?.status),
  };
}

/** Gate for a boolean plan feature (e.g. advanced_notifications,
 * custom_domain) -- server actions call this before letting an owner turn
 * on something their plan doesn't include. */
export async function canUseFeature(
  supabase: SupabaseClient<Database>,
  businessId: string,
  feature: PlanFeatureKey,
): Promise<LimitCheckResult> {
  const { plan, enforced } = await getEffectivePlan(supabase, businessId);
  return evaluateFeatureAccess(plan, enforced, feature);
}

export async function canAddProfessional(
  supabase: SupabaseClient<Database>,
  businessId: string,
): Promise<LimitCheckResult> {
  const { plan, enforced } = await getEffectivePlan(supabase, businessId);
  if (!enforced || plan.limits.maxProfessionals === null) return { allowed: true };

  const { count } = await supabase
    .from("professionals")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId);

  return evaluateCountLimit(plan, enforced, plan.limits.maxProfessionals, count ?? 0, {
    singular: "profissional",
    plural: "profissionais",
  });
}

export async function canAddService(
  supabase: SupabaseClient<Database>,
  businessId: string,
): Promise<LimitCheckResult> {
  const { plan, enforced } = await getEffectivePlan(supabase, businessId);
  if (!enforced || plan.limits.maxServices === null) return { allowed: true };

  const { count } = await supabase
    .from("services")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId);

  return evaluateCountLimit(plan, enforced, plan.limits.maxServices, count ?? 0, {
    singular: "serviço",
    plural: "serviços",
  });
}

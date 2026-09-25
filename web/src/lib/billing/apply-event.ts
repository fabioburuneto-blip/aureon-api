import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingProviderName, Database } from "@/types/database";
import type { BillingWebhookEvent } from "./types";
import { isValidPlanId } from "@/lib/plans/config";

export type ApplyEventOutcome = "applied" | "duplicate" | "unmatched";

/**
 * Applies one verified, parsed webhook event to `subscriptions`, using the
 * admin (service-role) client the webhook route already holds. This is
 * the ONLY function in the app that writes status/plan/period columns --
 * everything else only ever reads them.
 *
 * Idempotent by construction: it inserts into `billing_webhook_events`
 * before touching `subscriptions`, and that table's
 * unique(provider, provider_event_id) constraint is what actually enforces
 * "never apply the same event twice", not application logic -- so it
 * holds even under concurrent webhook retries.
 */
export async function applyBillingWebhookEvent(
  supabase: SupabaseClient<Database>,
  provider: BillingProviderName,
  event: BillingWebhookEvent,
): Promise<ApplyEventOutcome> {
  const { error: ledgerError } = await supabase
    .from("billing_webhook_events")
    .insert({ provider, provider_event_id: event.id, event_type: event.type });

  if (ledgerError) {
    if (ledgerError.code === "23505") {
      return "duplicate";
    }
    throw new Error(`billing webhook: failed to record idempotency ledger (${ledgerError.message})`);
  }

  if (!event.providerSubscriptionId) {
    return "unmatched";
  }

  const update: Database["public"]["Tables"]["subscriptions"]["Update"] = {
    provider,
    provider_subscription_id: event.providerSubscriptionId,
    ...(event.status && { status: event.status }),
    // Guard against a provider misconfiguration (e.g. a stray price id in
    // STRIPE_PRICE_IDS) ever writing a plan_id the DB's own check
    // constraint wouldn't otherwise catch until it's too late to explain
    // why -- validate here too, not just at the database layer.
    ...(event.planId && isValidPlanId(event.planId) && { plan_id: event.planId }),
    ...(event.currentPeriodStart && { current_period_start: event.currentPeriodStart }),
    ...(event.currentPeriodEnd && { current_period_end: event.currentPeriodEnd }),
    ...(event.cancelAtPeriodEnd !== null && { cancel_at_period_end: event.cancelAtPeriodEnd }),
    ...(event.providerCustomerId && { provider_customer_id: event.providerCustomerId }),
  };

  // The common case: this subscription already has provider_subscription_id
  // stored (either from a previous event, or from the direct link written
  // right after checkout creation -- see startCheckout() in
  // src/app/dashboard/plano/actions.ts).
  const byProviderId = await supabase
    .from("subscriptions")
    .update(update)
    .eq("provider_subscription_id", event.providerSubscriptionId)
    .select("id");

  if (byProviderId.error) {
    throw new Error(`billing webhook: failed to update subscription (${byProviderId.error.message})`);
  }
  if (byProviderId.data.length > 0) {
    return "applied";
  }

  // First event for a subscription whose id we haven't linked yet (Stripe
  // Checkout in particular: the subscription doesn't exist until checkout
  // completes). Fall back to the business id the provider echoed back via
  // metadata/external_reference at checkout time.
  if (!event.businessId) {
    return "unmatched";
  }

  const byBusinessId = await supabase
    .from("subscriptions")
    .update(update)
    .eq("business_id", event.businessId)
    .select("id");

  if (byBusinessId.error) {
    throw new Error(`billing webhook: failed to update subscription (${byBusinessId.error.message})`);
  }

  return byBusinessId.data.length > 0 ? "applied" : "unmatched";
}

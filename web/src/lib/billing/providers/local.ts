import type {
  BillingProvider,
  BillingWebhookEvent,
  CheckoutSessionInput,
  CheckoutSessionResult,
} from "../types";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_PLAN_ID, isValidPlanId } from "@/lib/plans/config";

const LOCAL_PERIOD_DAYS = 30;

/**
 * The "no real billing provider configured yet" mode -- and the default
 * every business gets from create_business(). There is no external
 * payment step: choosing a plan (or cancelling) takes effect immediately
 * by writing straight to `subscriptions` with the admin client, which is
 * safe here specifically because this class is the trusted, server-only
 * code path standing in for "the webhook said so" (see docs/BILLING.md,
 * "modo local/development"). It never receives real webhooks --
 * verifyWebhookSignature always returns false so nothing can spoof a
 * provider event against a business that hasn't configured real billing.
 */
export class LocalBillingProvider implements BillingProvider {
  readonly provider = "local" as const;

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const planId = isValidPlanId(input.planId) ? input.planId : DEFAULT_PLAN_ID;
    const supabase = createAdminClient();
    const now = new Date();

    const { error } = await supabase
      .from("subscriptions")
      .update({
        provider: "local",
        plan_id: planId,
        status: "active",
        current_period_start: now.toISOString(),
        current_period_end: new Date(
          now.getTime() + LOCAL_PERIOD_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString(),
        cancel_at_period_end: false,
        provider_customer_id: null,
        provider_subscription_id: null,
      })
      .eq("business_id", input.businessId);

    if (error) {
      throw new Error(`local billing: failed to switch plan (${error.message})`);
    }

    // No real checkout page to send the customer to -- the change already
    // happened, so just bounce back to wherever the app asked to return.
    return { checkoutUrl: input.returnUrl };
  }

  async cancelSubscription(input: { businessId: string }): Promise<void> {
    // Dev mode keeps it simple: cancellation is immediate, not scheduled
    // for the end of the current period (there's no real billing cycle to
    // honor here).
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("subscriptions")
      .update({ status: "canceled", cancel_at_period_end: false })
      .eq("business_id", input.businessId)
      .eq("provider", "local");

    if (error) {
      throw new Error(`local billing: failed to cancel (${error.message})`);
    }
  }

  verifyWebhookSignature(): boolean {
    return false;
  }

  async parseWebhookEvent(): Promise<BillingWebhookEvent | null> {
    return null;
  }
}

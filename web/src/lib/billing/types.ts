import type { BillingProviderName, SubscriptionStatus } from "@/types/database";

/**
 * The one abstraction the rest of the app depends on for billing. Nothing
 * outside src/lib/billing/ knows which real provider is wired up --
 * server actions and the webhook route only ever talk to a
 * `BillingProvider`. Adding a fourth provider later means writing one new
 * class here and registering it in getBillingProvider() (src/lib/billing/index.ts);
 * nothing else changes.
 */

export interface CheckoutSessionInput {
  businessId: string;
  planId: string;
  customerEmail: string;
  customerName: string;
  /** Absolute URL the provider should send the customer back to. */
  returnUrl: string;
}

export interface CheckoutSessionResult {
  checkoutUrl: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
}

/**
 * A provider's webhook payload, normalized to the fields
 * applyBillingWebhookEvent() (src/lib/billing/apply-event.ts) needs to
 * update `subscriptions`. `id` is the provider's own event id -- the
 * idempotency key stored in `billing_webhook_events`.
 */
export interface BillingWebhookEvent {
  id: string;
  type: string;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  /** Our own business id, when the provider echoes back the
   * external-reference/metadata set at checkout time. Used to link the
   * very first event for a subscription, before `provider_subscription_id`
   * has been stored on the row yet -- see src/lib/billing/apply-event.ts. */
  businessId: string | null;
  status: SubscriptionStatus | null;
  planId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
}

export interface BillingProvider {
  readonly provider: BillingProviderName;

  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;

  /** `providerSubscriptionId` is null for the 'local' provider (there's
   * nothing external to cancel) -- `businessId` is passed alongside it so
   * that provider can still act by looking up its own row. */
  cancelSubscription(input: {
    businessId: string;
    providerSubscriptionId: string | null;
  }): Promise<void>;

  /** Must run over the RAW (unparsed) request body -- verifying a
   * signature after JSON.parse/stringify round-trips the body can change
   * whitespace/key order and silently break verification. */
  verifyWebhookSignature(rawBody: string, headers: Headers): boolean;

  /** Only ever called after verifyWebhookSignature returns true. Returns
   * null for an event type this provider sends but the app doesn't act on
   * (the webhook route then just 200s without touching subscriptions).
   * Async because some providers (Mercado Pago) only send a thin "this
   * resource changed" ping and require a follow-up API call to learn the
   * actual status -- that call belongs here, not in the webhook route, so
   * the route itself stays provider-agnostic. */
  parseWebhookEvent(
    rawBody: string,
    headers: Headers,
  ): Promise<BillingWebhookEvent | null>;
}

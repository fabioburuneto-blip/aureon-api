import type {
  BillingProvider,
  BillingWebhookEvent,
  CheckoutSessionInput,
  CheckoutSessionResult,
} from "../types";
import { hmacSha256Hex, safeEqual } from "../crypto";
import type { SubscriptionStatus } from "@/types/database";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Stripe Price id (created in the Stripe dashboard/API) for each plan
   * this app sells -- Stripe has no concept of our plan_id strings. */
  priceIdByPlan: Record<string, string>;
  apiBaseUrl?: string;
  /** Reject a webhook whose `t=` timestamp is older than this, to close
   * the replay window even if a signature ever leaked. */
  toleranceSeconds?: number;
}

/**
 * Stripe Checkout Sessions (subscription mode) + Stripe's documented
 * webhook signature scheme: header `Stripe-Signature: t=<unix>,v1=<hex-hmac>`,
 * where the hashed payload is the literal string `${t}.${rawBody}`.
 *
 * The REST calls below use Stripe's plain HTTP API (form-encoded, as
 * Stripe expects) rather than the `stripe` npm SDK, keeping this adapter
 * dependency-free like every other provider in this codebase. They match
 * Stripe's documented shapes but, like the other real adapters here, were
 * never run against a live Stripe account -- verify in test mode first.
 */
export class StripeProvider implements BillingProvider {
  readonly provider = "stripe" as const;

  constructor(private readonly config: StripeConfig) {}

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const priceId = this.config.priceIdByPlan[input.planId];
    if (!priceId) {
      throw new Error(`stripe: no price configured for plan "${input.planId}"`);
    }
    const baseUrl = this.config.apiBaseUrl ?? "https://api.stripe.com/v1";

    const body = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: input.returnUrl,
      cancel_url: input.returnUrl,
      customer_email: input.customerEmail,
      "metadata[business_id]": input.businessId,
      "subscription_data[metadata][business_id]": input.businessId,
    });

    const response = await fetch(`${baseUrl}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`stripe: failed to create checkout session (${response.status})`);
    }

    const data = (await response.json()) as { id: string; url: string; customer?: string };
    return {
      checkoutUrl: data.url,
      providerCustomerId: data.customer,
      providerSubscriptionId: undefined, // only known once checkout completes -- arrives via webhook
    };
  }

  async cancelSubscription(input: { providerSubscriptionId: string | null }): Promise<void> {
    if (!input.providerSubscriptionId) return;
    const baseUrl = this.config.apiBaseUrl ?? "https://api.stripe.com/v1";

    const response = await fetch(`${baseUrl}/subscriptions/${input.providerSubscriptionId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ cancel_at_period_end: "true" }),
    });

    if (!response.ok) {
      throw new Error(`stripe: failed to cancel subscription (${response.status})`);
    }
  }

  verifyWebhookSignature(rawBody: string, headers: Headers): boolean {
    const header = headers.get("stripe-signature");
    if (!header) return false;

    const parts = Object.fromEntries(
      header.split(",").map((part) => {
        const [key, value] = part.split("=");
        return [key, value];
      }),
    );
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) return false;

    const tolerance = this.config.toleranceSeconds ?? 300;
    const age = Math.floor(Date.now() / 1000) - Number(timestamp);
    if (!Number.isFinite(age) || age > tolerance || age < -tolerance) return false;

    const expected = hmacSha256Hex(this.config.webhookSecret, `${timestamp}.${rawBody}`);
    return safeEqual(expected, signature);
  }

  async parseWebhookEvent(rawBody: string): Promise<BillingWebhookEvent | null> {
    let event: {
      id: string;
      type: string;
      data: { object: Record<string, unknown> };
    };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return null;
    }

    if (!event.type.startsWith("customer.subscription.")) {
      return null;
    }

    const sub = event.data.object as {
      id?: string;
      customer?: string;
      status?: string;
      cancel_at_period_end?: boolean;
      current_period_start?: number;
      current_period_end?: number;
      items?: { data?: { price?: { id?: string } }[] };
      metadata?: { business_id?: string };
    };
    if (!sub.id) return null;

    const priceId = sub.items?.data?.[0]?.price?.id;
    const planId = priceId
      ? Object.entries(this.config.priceIdByPlan).find(([, id]) => id === priceId)?.[0]
      : undefined;

    return {
      id: event.id,
      type: event.type,
      providerSubscriptionId: sub.id,
      providerCustomerId: sub.customer ?? null,
      businessId: sub.metadata?.business_id ?? null,
      status: sub.status ? mapStripeStatus(sub.status) : null,
      planId: planId ?? null,
      currentPeriodStart: sub.current_period_start
        ? new Date(sub.current_period_start * 1000).toISOString()
        : null,
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? null,
    };
  }
}

export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
      return "incomplete";
    default:
      return "incomplete";
  }
}

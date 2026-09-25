import type {
  BillingProvider,
  BillingWebhookEvent,
  CheckoutSessionInput,
  CheckoutSessionResult,
} from "../types";
import { safeEqual } from "../crypto";
import type { SubscriptionStatus } from "@/types/database";

export interface AsaasConfig {
  apiKey: string;
  /** Asaas doesn't sign webhooks with HMAC -- authenticity is a static
   * shared token you configure both in the Asaas webhook dashboard and
   * here, sent back on every call in the `asaas-access-token` header. */
  webhookToken: string;
  apiBaseUrl?: string;
}

/**
 * Asaas subscriptions. Unlike Mercado Pago/Stripe, Asaas has no hosted
 * "checkout session" object -- creating a subscription returns billing
 * details (a boleto/pix/card charge) directly, and `invoiceUrl` on the
 * first charge is the closest equivalent to a checkout link. Like the
 * other real adapters here, this matches Asaas's documented API shape but
 * was never run against a live account -- verify in their sandbox first.
 */
export class AsaasProvider implements BillingProvider {
  readonly provider = "asaas" as const;

  constructor(private readonly config: AsaasConfig) {}

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const baseUrl = this.config.apiBaseUrl ?? "https://api.asaas.com/v3";
    const headers = {
      access_token: this.config.apiKey,
      "Content-Type": "application/json",
    };

    const customerResponse = await fetch(`${baseUrl}/customers`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: input.customerName,
        email: input.customerEmail,
        externalReference: input.businessId,
      }),
    });
    if (!customerResponse.ok) {
      throw new Error(`asaas: failed to create customer (${customerResponse.status})`);
    }
    const customer = (await customerResponse.json()) as { id: string };

    const subscriptionResponse = await fetch(`${baseUrl}/subscriptions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        customer: customer.id,
        billingType: "UNDEFINED", // lets the customer pick boleto/pix/card at checkout
        cycle: "MONTHLY",
        description: `Aureon Agenda - plano ${input.planId}`,
        externalReference: input.businessId,
      }),
    });
    if (!subscriptionResponse.ok) {
      throw new Error(`asaas: failed to create subscription (${subscriptionResponse.status})`);
    }
    const subscription = (await subscriptionResponse.json()) as {
      id: string;
      invoiceUrl?: string;
    };

    return {
      checkoutUrl: subscription.invoiceUrl ?? input.returnUrl,
      providerCustomerId: customer.id,
      providerSubscriptionId: subscription.id,
    };
  }

  async cancelSubscription(input: { providerSubscriptionId: string | null }): Promise<void> {
    if (!input.providerSubscriptionId) return;
    const baseUrl = this.config.apiBaseUrl ?? "https://api.asaas.com/v3";

    const response = await fetch(`${baseUrl}/subscriptions/${input.providerSubscriptionId}`, {
      method: "DELETE",
      headers: { access_token: this.config.apiKey },
    });

    if (!response.ok) {
      throw new Error(`asaas: failed to cancel subscription (${response.status})`);
    }
  }

  verifyWebhookSignature(_rawBody: string, headers: Headers): boolean {
    const token = headers.get("asaas-access-token");
    if (!token) return false;
    return safeEqual(token, this.config.webhookToken);
  }

  async parseWebhookEvent(rawBody: string): Promise<BillingWebhookEvent | null> {
    let payload: {
      id?: string;
      event?: string;
      subscription?: string;
      payment?: { subscription?: string; customer?: string; externalReference?: string };
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }

    if (!payload.event?.startsWith("SUBSCRIPTION_") && !payload.event?.startsWith("PAYMENT_")) {
      return null;
    }

    const subscriptionId = payload.subscription ?? payload.payment?.subscription ?? null;
    if (!subscriptionId) return null;

    return {
      id: payload.id ?? `${payload.event}:${subscriptionId}`,
      type: payload.event ?? "unknown",
      providerSubscriptionId: subscriptionId,
      providerCustomerId: payload.payment?.customer ?? null,
      // Asaas's webhook payload doesn't reliably echo externalReference --
      // linking the first event relies on the direct write performed right
      // after createCheckoutSession() in the "start checkout" action
      // instead (see src/lib/billing/apply-event.ts).
      businessId: payload.payment?.externalReference ?? null,
      status: payload.event ? mapAsaasEventToStatus(payload.event) : null,
      planId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: payload.event === "SUBSCRIPTION_DELETED" ? true : null,
    };
  }
}

export function mapAsaasEventToStatus(event: string): SubscriptionStatus | null {
  switch (event) {
    case "SUBSCRIPTION_CREATED":
      return "incomplete";
    case "PAYMENT_CONFIRMED":
    case "PAYMENT_RECEIVED":
      return "active";
    case "PAYMENT_OVERDUE":
      return "past_due";
    case "SUBSCRIPTION_DELETED":
    case "SUBSCRIPTION_INACTIVATED":
      return "canceled";
    default:
      return null;
  }
}

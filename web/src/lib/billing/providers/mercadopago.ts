import type {
  BillingProvider,
  BillingWebhookEvent,
  CheckoutSessionInput,
  CheckoutSessionResult,
} from "../types";
import { hmacSha256Hex, safeEqual } from "../crypto";
import type { SubscriptionStatus } from "@/types/database";

export interface MercadoPagoConfig {
  accessToken: string;
  webhookSecret: string;
  apiBaseUrl?: string;
}

/**
 * Mercado Pago "preapproval" (assinatura recorrente) integration. Webhook
 * signature scheme per Mercado Pago's docs: header `x-signature` carries
 * `ts=<unix-seconds>,v1=<hex-hmac>`, `x-request-id` carries a request id,
 * and the signed manifest is `id:<data.id lowercased>;request-id:<x-request-id>;ts:<ts>;`
 * HMAC-SHA256'd with the integration's webhook secret.
 *
 * createCheckoutSession/cancelSubscription call the real Preapproval API
 * shape but, like every third-party integration in this codebase, were
 * never exercised against a live account -- verify against Mercado Pago's
 * sandbox before relying on them in production (docs/BILLING.md).
 */
export class MercadoPagoProvider implements BillingProvider {
  readonly provider = "mercadopago" as const;

  constructor(private readonly config: MercadoPagoConfig) {}

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const baseUrl = this.config.apiBaseUrl ?? "https://api.mercadopago.com";

    const response = await fetch(`${baseUrl}/preapproval`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reason: `Aureon Agenda - plano ${input.planId}`,
        payer_email: input.customerEmail,
        back_url: input.returnUrl,
        external_reference: input.businessId,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          currency_id: "BRL",
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`mercadopago: failed to create preapproval (${response.status})`);
    }

    const data = (await response.json()) as {
      id: string;
      init_point: string;
      payer_id?: string;
    };

    return {
      checkoutUrl: data.init_point,
      providerSubscriptionId: data.id,
      providerCustomerId: data.payer_id ? String(data.payer_id) : undefined,
    };
  }

  async cancelSubscription(input: { providerSubscriptionId: string | null }): Promise<void> {
    if (!input.providerSubscriptionId) return;
    const baseUrl = this.config.apiBaseUrl ?? "https://api.mercadopago.com";

    const response = await fetch(`${baseUrl}/preapproval/${input.providerSubscriptionId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "cancelled" }),
    });

    if (!response.ok) {
      throw new Error(`mercadopago: failed to cancel preapproval (${response.status})`);
    }
  }

  verifyWebhookSignature(rawBody: string, headers: Headers): boolean {
    const signatureHeader = headers.get("x-signature");
    const requestId = headers.get("x-request-id");
    if (!signatureHeader || !requestId) return false;

    const parts = Object.fromEntries(
      signatureHeader.split(",").map((part) => {
        const [key, value] = part.split("=").map((s) => s.trim());
        return [key, value];
      }),
    );
    const ts = parts.ts;
    const v1 = parts.v1;
    if (!ts || !v1) return false;

    let dataId: string;
    try {
      dataId = String((JSON.parse(rawBody) as { data?: { id?: string } }).data?.id ?? "");
    } catch {
      return false;
    }
    if (!dataId) return false;

    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    const expected = hmacSha256Hex(this.config.webhookSecret, manifest);
    return safeEqual(expected, v1);
  }

  async parseWebhookEvent(rawBody: string): Promise<BillingWebhookEvent | null> {
    let payload: { id?: string; type?: string; action?: string; data?: { id?: string } };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }

    // Only preapproval (subscription) notifications carry the fields
    // applyBillingWebhookEvent() needs -- payment notifications are a
    // separate MP event type this app doesn't act on directly.
    if (payload.type !== "subscription_preapproval" && payload.type !== "preapproval") {
      return null;
    }

    const subscriptionId = payload.data?.id ?? null;
    if (!subscriptionId) return null;

    // The notification itself is just a "this changed" ping -- fetch the
    // current preapproval to learn its actual status/period.
    const baseUrl = this.config.apiBaseUrl ?? "https://api.mercadopago.com";
    const response = await fetch(`${baseUrl}/preapproval/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${this.config.accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`mercadopago: failed to fetch preapproval ${subscriptionId} (${response.status})`);
    }
    const preapproval = (await response.json()) as {
      status?: string;
      payer_id?: string | number;
      external_reference?: string;
      auto_recurring?: { start_date?: string; end_date?: string };
    };

    return {
      id: payload.id ?? `${payload.type}:${subscriptionId}:${payload.action ?? ""}`,
      type: payload.action ?? payload.type ?? "unknown",
      providerSubscriptionId: subscriptionId,
      providerCustomerId: preapproval.payer_id ? String(preapproval.payer_id) : null,
      businessId: preapproval.external_reference ?? null,
      status: preapproval.status ? mapMercadoPagoStatus(preapproval.status) : null,
      planId: null,
      currentPeriodStart: preapproval.auto_recurring?.start_date ?? null,
      currentPeriodEnd: preapproval.auto_recurring?.end_date ?? null,
      cancelAtPeriodEnd: preapproval.status === "cancelled" ? true : null,
    };
  }
}

/** Maps Mercado Pago's preapproval `status` field to this app's internal
 * SubscriptionStatus -- used by the webhook route after it fetches the
 * full preapproval object (see parseWebhookEvent's comment above). */
export function mapMercadoPagoStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "authorized":
      return "active";
    case "paused":
      return "past_due";
    case "cancelled":
      return "canceled";
    case "pending":
      return "incomplete";
    default:
      return "incomplete";
  }
}

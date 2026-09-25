import "server-only";
import type { BillingProvider } from "./types";
import { LocalBillingProvider } from "./providers/local";
import { MercadoPagoProvider } from "./providers/mercadopago";
import { StripeProvider } from "./providers/stripe";
import { AsaasProvider } from "./providers/asaas";

/**
 * Resolves the single active BillingProvider from environment secrets.
 * Everything in the app (server actions, the webhook route) calls this
 * instead of ever importing a concrete provider class directly -- see
 * docs/BILLING.md for exactly which env vars each provider needs.
 *
 * No BILLING_PROVIDER configured (or an unrecognized value) means every
 * business runs on the 'local' provider: the product stays fully usable
 * without any billing integration set up, per the "não bloquear o MVP"
 * requirement.
 */
let cached: BillingProvider | undefined;

export function getBillingProvider(): BillingProvider {
  cached ??= buildBillingProvider();
  return cached;
}

function buildBillingProvider(): BillingProvider {
  switch (process.env.BILLING_PROVIDER) {
    case "mercadopago": {
      const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
      const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
      if (!accessToken || !webhookSecret) {
        throw new Error(
          "BILLING_PROVIDER=mercadopago requires MERCADOPAGO_ACCESS_TOKEN and MERCADOPAGO_WEBHOOK_SECRET. See docs/BILLING.md.",
        );
      }
      return new MercadoPagoProvider({ accessToken, webhookSecret });
    }
    case "stripe": {
      const secretKey = process.env.STRIPE_SECRET_KEY;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secretKey || !webhookSecret) {
        throw new Error(
          "BILLING_PROVIDER=stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. See docs/BILLING.md.",
        );
      }
      return new StripeProvider({
        secretKey,
        webhookSecret,
        priceIdByPlan: parseJsonMap(process.env.STRIPE_PRICE_IDS),
      });
    }
    case "asaas": {
      const apiKey = process.env.ASAAS_API_KEY;
      const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
      if (!apiKey || !webhookToken) {
        throw new Error(
          "BILLING_PROVIDER=asaas requires ASAAS_API_KEY and ASAAS_WEBHOOK_TOKEN. See docs/BILLING.md.",
        );
      }
      return new AsaasProvider({ apiKey, webhookToken });
    }
    default:
      return new LocalBillingProvider();
  }
}

function parseJsonMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Used by the webhook route, which receives the provider name from the
 * URL and must not blindly trust it: a request to
 * /api/webhooks/billing/stripe only gets the real StripeProvider back
 * when BILLING_PROVIDER=stripe is what's actually configured. Anything
 * else fails closed (null) instead of e.g. verifying a Stripe payload
 * against the Mercado Pago adapter.
 */
export function getBillingProviderByName(name: string): BillingProvider | null {
  const active = getBillingProvider();
  return active.provider === name ? active : null;
}

export type { BillingProvider, BillingWebhookEvent, CheckoutSessionInput, CheckoutSessionResult } from "./types";

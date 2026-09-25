import { NextResponse } from "next/server";
import { getBillingProviderByName } from "@/lib/billing";
import { applyBillingWebhookEvent } from "@/lib/billing/apply-event";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Billing webhook endpoint: POST /api/webhooks/billing/{provider}
 * (e.g. /api/webhooks/billing/mercadopago). This is the ONLY way
 * `subscriptions.status/plan_id/current_period_*` change for a paid
 * provider -- see docs/BILLING.md for what to paste into each provider's
 * dashboard.
 *
 * Reads the raw body with request.text() (never request.json() first --
 * signature verification runs over the exact bytes the provider signed;
 * parsing and re-serializing would break it), verifies the signature
 * before doing anything else, and only then hands off to
 * applyBillingWebhookEvent(), which is what actually enforces idempotency.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerName } = await params;
  const billingProvider = getBillingProviderByName(providerName);

  if (!billingProvider) {
    // Either this isn't the provider currently configured via
    // BILLING_PROVIDER, or the URL segment is garbage -- fail closed
    // rather than guessing which adapter to verify against.
    return NextResponse.json({ error: "unknown or inactive provider" }, { status: 404 });
  }

  const rawBody = await request.text();

  if (!billingProvider.verifyWebhookSignature(rawBody, request.headers)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event;
  try {
    event = await billingProvider.parseWebhookEvent(rawBody, request.headers);
  } catch (error) {
    // A provider-side follow-up call failed (e.g. Mercado Pago's
    // preapproval lookup) -- ask the provider to retry rather than
    // silently swallowing the event.
    console.error(`billing webhook (${providerName}): failed to parse event`, error);
    return NextResponse.json({ error: "failed to process event" }, { status: 502 });
  }

  if (!event) {
    // A real event this provider sends but the app doesn't act on --
    // acknowledge so the provider stops retrying.
    return NextResponse.json({ received: true, outcome: "ignored" });
  }

  try {
    const supabase = createAdminClient();
    const outcome = await applyBillingWebhookEvent(supabase, billingProvider.provider, event);
    return NextResponse.json({ received: true, outcome });
  } catch (error) {
    console.error(`billing webhook (${providerName}): failed to apply event`, error);
    return NextResponse.json({ error: "failed to apply event" }, { status: 500 });
  }
}

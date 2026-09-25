"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentBusiness, requireOwner } from "@/lib/auth";
import { getBillingProvider } from "@/lib/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidPlanId } from "@/lib/plans/config";

export async function startCheckoutAction(formData: FormData) {
  const planId = String(formData.get("plan_id") ?? "");
  if (!isValidPlanId(planId)) {
    return;
  }

  const { user, business, role } = await getCurrentBusiness();
  requireOwner(role);

  const provider = getBillingProvider();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const result = await provider.createCheckoutSession({
    businessId: business.id,
    planId,
    customerEmail: business.email ?? user.email ?? "",
    customerName: business.name,
    returnUrl: `${siteUrl}/dashboard/plano`,
  });

  // Some providers (Mercado Pago, Asaas) return a real subscription/
  // customer id synchronously, before any webhook fires. Link it now so
  // the first webhook event (which matches by provider_subscription_id)
  // has something to find. This is a server-initiated write reacting to
  // our own successful call to the provider -- not client-supplied data --
  // so it's fine alongside the "only the webhook writes status/plan/period"
  // rule (see supabase/migrations/20250924120008_billing.sql).
  if (result.providerSubscriptionId || result.providerCustomerId) {
    const admin = createAdminClient();
    await admin
      .from("subscriptions")
      .update({
        provider: provider.provider,
        provider_subscription_id: result.providerSubscriptionId ?? null,
        provider_customer_id: result.providerCustomerId ?? null,
      })
      .eq("business_id", business.id);
  }

  redirect(result.checkoutUrl);
}

export async function cancelSubscriptionAction() {
  const { supabase, business, role } = await getCurrentBusiness();
  requireOwner(role);

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("provider_subscription_id")
    .eq("business_id", business.id)
    .maybeSingle();

  const provider = getBillingProvider();
  await provider.cancelSubscription({
    businessId: business.id,
    providerSubscriptionId: subscription?.provider_subscription_id ?? null,
  });

  revalidatePath("/dashboard/plano");
}

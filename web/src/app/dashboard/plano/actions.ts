"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentBusiness, requireOwner } from "@/lib/auth";
import { getBillingProvider } from "@/lib/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidPlanId } from "@/lib/plans/config";
import { logError } from "@/lib/logger";

export async function startCheckoutAction(formData: FormData) {
  const planId = String(formData.get("plan_id") ?? "");
  if (!isValidPlanId(planId)) {
    return;
  }

  const { supabase, user, business, role } = await getCurrentBusiness();
  requireOwner(role);

  // business.email is no longer part of the businesses SELECT grant for
  // authenticated (see supabase/migrations/
  // 20250924120010_fix_businesses_authenticated_grant.sql) -- fetched
  // separately here, same as settings/page.tsx.
  const { data: contact } = await supabase.rpc("get_business_contact", {
    p_business_id: business.id,
  });

  const provider = getBillingProvider();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  let result;
  try {
    result = await provider.createCheckoutSession({
      businessId: business.id,
      planId,
      customerEmail: contact?.[0]?.email ?? user.email ?? "",
      customerName: business.name,
      returnUrl: `${siteUrl}/dashboard/plano`,
    });
  } catch (err) {
    logError(
      "billing.checkout_session_failed",
      { business_id: business.id, provider: provider.provider, plan_id: planId },
      err,
    );
    throw err;
  }

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
  try {
    await provider.cancelSubscription({
      businessId: business.id,
      providerSubscriptionId: subscription?.provider_subscription_id ?? null,
    });
  } catch (err) {
    logError(
      "billing.cancel_subscription_failed",
      { business_id: business.id, provider: provider.provider },
      err,
    );
    throw err;
  }

  revalidatePath("/dashboard/plano");
}

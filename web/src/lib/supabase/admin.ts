import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Service-role client: bypasses Row Level Security entirely. Reserved for
 * the two places in this app that legitimately need to write data no
 * authenticated user's session is allowed to touch --
 * the billing webhook route (src/app/api/webhooks/billing/[provider]/route.ts)
 * and the 'local' billing provider (src/lib/billing/providers/local.ts).
 *
 * Never call this from anything reachable with a client-supplied session
 * in the loop (a server action triggered by a form submit, a page render
 * for a specific user) -- those must keep using
 * src/lib/supabase/server.ts's cookie-bound client so RLS stays the real
 * enforcement layer. This client is for code that has already established
 * trust some other way (a verified webhook signature).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured -- required for billing webhook/local-provider writes. See docs/BILLING.md.",
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

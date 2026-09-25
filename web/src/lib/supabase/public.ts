import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Anon-key client for public, unauthenticated reads (the /[slug] page and
 * its booking widget's server-side data) -- deliberately NOT bound to
 * request cookies like src/lib/supabase/server.ts. RLS is what protects
 * this data either way (this client is still the anon role, not admin),
 * so nothing about tenant isolation changes; the only difference is that
 * a route using this client doesn't call Next's `cookies()`, so it isn't
 * forced into fully dynamic (uncached) rendering. Never use this where a
 * signed-in user's session/identity actually matters -- use
 * src/lib/supabase/server.ts there.
 */
export function createPublicClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import type { MemberRole } from "@/types/database";

/**
 * Server-side guards for dashboard routes and server actions. These never
 * trust a business_id coming from the client: they always re-derive it from
 * the authenticated session, then rely on RLS as a second, independent
 * enforcement layer for every query that follows.
 */

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return { supabase, user };
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have access to this business.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Resolves the caller's membership + business for a given slug, verifying
 * on the server that the authenticated user actually belongs to it.
 * Throws ForbiddenError instead of trusting anything sent by the client.
 */
export async function requireBusinessAccess(
  businessSlug: string,
  options: { role?: MemberRole } = {},
) {
  const { supabase, user } = await requireUser();

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("*")
    .eq("slug", businessSlug)
    .maybeSingle();

  if (businessError || !business) {
    throw new ForbiddenError("Business not found.");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("business_members")
    .select("role")
    .eq("business_id", business.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError || !membership) {
    throw new ForbiddenError();
  }

  if (options.role === "owner" && membership.role !== "owner") {
    throw new ForbiddenError("Only the business owner can do this.");
  }

  return { supabase, user, business, role: membership.role };
}

/**
 * Resolves the single business the signed-in user manages, used by every
 * /dashboard page (no business id/slug ever comes from the URL or client).
 * Redirects to onboarding when the user has not created a business yet.
 * Wrapped in React's cache() so layout + page both calling this within the
 * same request share one round trip instead of duplicating it.
 */
export const getCurrentBusiness = cache(async () => {
  const { supabase, user } = await requireUser();

  const { data: membership, error: membershipError } = await supabase
    .from("business_members")
    .select("role, business_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    // A real DB error here (vs. a legitimate "no membership yet") would
    // otherwise silently redirect an existing owner to onboarding with no
    // trace of why -- log before falling through to the same redirect.
    logError("auth.membership_lookup_failed", { user_id: user.id, code: membershipError.code }, membershipError);
  }

  if (!membership) {
    redirect("/onboarding");
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", membership.business_id)
    .single();

  if (businessError) {
    logError(
      "auth.business_lookup_failed",
      { user_id: user.id, business_id: membership.business_id, code: businessError.code },
      businessError,
    );
  }

  if (!business) {
    redirect("/onboarding");
  }

  return { supabase, user, business, role: membership.role };
});

/** Throws unless the caller is the business owner. Staff cannot manage
 * administrative resources (business settings, members, theme, billing). */
export function requireOwner(role: MemberRole) {
  if (role !== "owner") {
    throw new ForbiddenError("Only the business owner can do this.");
  }
}

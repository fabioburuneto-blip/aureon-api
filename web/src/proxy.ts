import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { getSubdomainConfig, resolveSubdomainRedirect } from "@/lib/subdomain-routing";

// null (the default) unless NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_AGENDA_URL /
// NEXT_PUBLIC_MARKETING_URL are set to at least two distinct hosts -- see
// docs/ARCHITECTURE.md "Subdomínios". Computed once per server instance,
// not per request: these env vars never change at runtime.
const subdomainConfig = getSubdomainConfig({
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  agendaUrl: process.env.NEXT_PUBLIC_AGENDA_URL,
  marketingUrl: process.env.NEXT_PUBLIC_MARKETING_URL,
});

export function proxy(request: NextRequest) {
  if (subdomainConfig) {
    const redirect = resolveSubdomainRedirect(
      request.nextUrl.hostname,
      request.nextUrl.pathname,
      subdomainConfig,
    );
    if (redirect) {
      const target = new URL(request.nextUrl);
      target.hostname = redirect.host;
      target.pathname = redirect.pathname;
      return NextResponse.redirect(target);
    }
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Skip static assets and image optimization files; run on everything
     * else so the auth session cookie stays fresh across navigation.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

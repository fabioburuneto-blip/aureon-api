/**
 * Platform-level subdomain split (app./agenda./www.), not per-tenant
 * custom domains. See docs/ARCHITECTURE.md "Subdomínios".
 *
 * Split routing only activates once at least two of the three optional
 * NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_AGENDA_URL / NEXT_PUBLIC_MARKETING_URL
 * env vars are set to distinct hosts -- until then (the default, today's
 * single-domain deployment) getSubdomainConfig() returns null and no
 * redirect ever happens, so this is a no-op unless explicitly configured.
 */

export type SubdomainConfig = {
  appHost: string | null;
  agendaHost: string | null;
  marketingHost: string | null;
};

export type SubdomainRedirect = { host: string; pathname: string };

// Routes that belong to the authenticated product, wherever it's hosted.
// Kept in sync with src/lib/slug.ts RESERVED_SLUGS by construction: a
// business slug can never collide with a top-level app route.
const APP_PREFIXES = ["/dashboard", "/login", "/signup", "/onboarding", "/auth"];

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function getSubdomainConfig(env: {
  appUrl?: string;
  agendaUrl?: string;
  marketingUrl?: string;
}): SubdomainConfig | null {
  const appHost = hostOf(env.appUrl);
  const agendaHost = hostOf(env.agendaUrl);
  const marketingHost = hostOf(env.marketingUrl);

  const distinctHosts = new Set(
    [appHost, agendaHost, marketingHost].filter((host): host is string => host !== null),
  );
  if (distinctHosts.size < 2) return null;

  return { appHost, agendaHost, marketingHost };
}

function isAppRoute(pathname: string): boolean {
  return APP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Pure routing decision: given the host a request actually arrived on and
 * the path it asked for, where (if anywhere) should it be redirected.
 * Never touches /api -- webhook providers hit a fixed URL they were
 * configured with, and redirecting a webhook request is more likely to
 * break delivery than help.
 */
export function resolveSubdomainRedirect(
  hostname: string,
  pathname: string,
  config: SubdomainConfig,
): SubdomainRedirect | null {
  if (pathname.startsWith("/api")) return null;

  const isRoot = pathname === "/";

  if (config.agendaHost && hostname === config.agendaHost) {
    if (isRoot && config.marketingHost) return { host: config.marketingHost, pathname: "/" };
    if (isAppRoute(pathname) && config.appHost) return { host: config.appHost, pathname };
    return null; // /{slug} -- what agenda.* is for
  }

  if (config.appHost && hostname === config.appHost) {
    if (isRoot) return { host: config.appHost, pathname: "/dashboard" };
    if (!isAppRoute(pathname) && config.agendaHost) return { host: config.agendaHost, pathname };
    return null;
  }

  if (config.marketingHost && hostname === config.marketingHost) {
    if (isAppRoute(pathname) && config.appHost) return { host: config.appHost, pathname };
    if (!isRoot && config.agendaHost) return { host: config.agendaHost, pathname };
    return null; // "/" -- what www.* is for
  }

  return null;
}

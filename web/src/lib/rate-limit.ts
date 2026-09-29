/**
 * Best-effort, in-process rate limiter for the public client-booking-
 * portal endpoints (src/app/agendamento/[token]/actions.ts and the
 * token lookup in page.tsx) -- the only anon-reachable server code in
 * this app that isn't already protected by an unguessable identifier
 * alone (create_public_appointment/get_available_slots take a
 * business_slug, which is meant to be public; the token endpoints take a
 * 256-bit token, which is the *real* defense against enumeration, but a
 * cheap throttle is still worth having in front of it).
 *
 * KNOWN LIMITATION, documented rather than hidden: this Map lives in one
 * server process's memory. On Vercel/serverless, each function instance
 * (and every cold start) gets its own empty Map, so this does not enforce
 * a global limit across instances or survive a redeploy -- it only stops
 * a single instance from being hammered in a tight loop. A real
 * production rollout with multiple instances needs a shared store
 * (Upstash Redis, Vercel KV) instead. Documented here and in
 * docs/audit/ETAPA-3-REPORT.md rather than left silent.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bounded so a determined attacker cycling through many keys (e.g. many
// tokens/IPs) can't grow this Map without limit between cold starts.
const MAX_TRACKED_KEYS = 5000;

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now > existing.resetAt) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (existing.count >= limit) {
    return false;
  }

  existing.count += 1;
  return true;
}

/** Exposed only for tests -- resets module state between test cases so
 * one test's bucket usage can't leak into another's assertions. */
export function _resetRateLimitBucketsForTests(): void {
  buckets.clear();
}

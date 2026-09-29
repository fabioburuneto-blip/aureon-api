import "server-only";
import { headers } from "next/headers";

/** Best-effort client IP from standard proxy headers (Vercel/most proxies
 * set x-forwarded-for). Falls back to a constant so rate limiting still
 * applies (a shared bucket) rather than silently no-op'ing when the
 * header is absent (e.g. local dev without a proxy in front). Kept apart
 * from src/lib/rate-limit.ts so that module's pure logic stays trivially
 * unit-testable without a Next.js request context. */
export async function getClientIp(): Promise<string> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  const realIp = headerList.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

import 'server-only';
import { headers } from 'next/headers';

/** URL base absoluta do site (necessária para og:image). */
export async function urlBase(): Promise<URL> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return new URL(process.env.NEXT_PUBLIC_SITE_URL);
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return new URL(`${proto}://${host}`);
}

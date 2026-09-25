import type { NextConfig } from "next";

// Logos, cover photos and professional avatars are all served from the
// business-assets Storage bucket (see supabase/migrations/*_storage.sql).
// Without this, next/image refuses to optimize a remote URL it doesn't
// recognize -- the only alternative would be `unoptimized`, which skips
// resizing/caching/format-conversion entirely.
//
// Protocol is read from the URL too, not hardcoded to "https": a hosted
// Supabase project is always https, but `supabase start`'s local dev API
// defaults to plain http://127.0.0.1:54321 -- hardcoding https here would
// make next/image reject every local business's logo/cover with "Invalid
// src prop" the moment local dev pointed at a real local Supabase stack.
function supabaseStorageOrigin(): { protocol: "http" | "https"; hostname: string } | undefined {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return { protocol: url.protocol === "https:" ? "https" : "http", hostname: url.hostname };
  } catch {
    return undefined;
  }
}

const storageOrigin = supabaseStorageOrigin();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: storageOrigin
      ? [
          {
            protocol: storageOrigin.protocol,
            hostname: storageOrigin.hostname,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
    // `supabase start`'s local dev API resolves to 127.0.0.1, which
    // next/image's built-in SSRF guard refuses by default ("hostname
    // resolved to private IP") regardless of remotePatterns -- without
    // this, every business's logo/cover would 400 for any developer
    // running the app locally against a real local Supabase stack.
    // Scoped to development only: production Supabase is always a public
    // https host, so this never weakens the guard where it matters.
    ...(process.env.NODE_ENV === "development" ? { dangerouslyAllowLocalIP: true } : {}),
  },
};

export default nextConfig;

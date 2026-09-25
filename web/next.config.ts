import type { NextConfig } from "next";

// Logos, cover photos and professional avatars are all served from the
// business-assets Storage bucket (see supabase/migrations/*_storage.sql).
// Without this, next/image refuses to optimize a remote URL it doesn't
// recognize -- the only alternative would be `unoptimized`, which skips
// resizing/caching/format-conversion entirely.
function supabaseStorageHostname(): string | undefined {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return undefined;
  }
}

const storageHostname = supabaseStorageHostname();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: storageHostname
      ? [
          {
            protocol: "https",
            hostname: storageHostname,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
};

export default nextConfig;

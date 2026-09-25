import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// Deliberately still using the cookie-bound client (not
// createPublicClient()): sitemap.ts has no dynamic route segment, so
// switching to a cookie-free client would make it eligible for build-time
// static generation -- which would then require real Supabase
// credentials to be present at `next build` time, breaking any build
// environment that doesn't inject them (not guaranteed the same way
// Vercel's runtime env vars are). Crawler traffic on this route is low
// enough that request-time rendering is not worth that tradeoff.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();

  const { data: businesses } = await supabase
    .from("businesses")
    .select("slug, updated_at")
    .eq("is_published", true);

  const businessEntries: MetadataRoute.Sitemap = (businesses ?? []).map(
    (business) => ({
      url: `${siteUrl}/${business.slug}`,
      lastModified: business.updated_at,
      changeFrequency: "daily",
    }),
  );

  return [
    { url: siteUrl, changeFrequency: "monthly" },
    ...businessEntries,
  ];
}

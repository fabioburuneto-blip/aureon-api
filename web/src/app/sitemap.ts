import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

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

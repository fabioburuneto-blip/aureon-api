import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/public";
import { PublicPageRenderer } from "./renderer/public-page-renderer";
import type { PublicPageData } from "./renderer/types";
import type { Metadata } from "next";
import type { Database } from "@/types/database";

// Data here only changes when the owner edits it in the dashboard, and
// every action that does so already calls revalidatePath(`/${slug}`) --
// this is a traffic-driven safety-net TTL on top of that on-demand
// invalidation, not the only thing keeping this page fresh. Only possible
// because getBusinessPageData() below never touches cookies()/headers()
// (see src/lib/supabase/public.ts) -- a route that does either is forced
// into fully dynamic, uncached rendering regardless of this export.
export const revalidate = 60;

// The exact column subset anon has SELECT grant on (see
// supabase/migrations/20250924120013_public_page_engine.sql) -- owner_id/
// phone/email are never readable by an anonymous visitor at the database
// layer, not just because this page happens not to render them. Typing
// the query with .returns<PublicBusinessRow>() instead of trusting the
// (untyped-for-select-strings) hand-written Database type means adding a
// reference to business.email here later is a compile error, not a
// silent runtime undefined.
type PublicBusinessRow = Pick<
  Database["public"]["Tables"]["businesses"]["Row"],
  | "id"
  | "name"
  | "slug"
  | "segment"
  | "description"
  | "timezone"
  | "logo_url"
  | "cover_url"
  | "is_published"
  | "created_at"
  | "updated_at"
  | "whatsapp"
  | "instagram"
  | "address"
  | "city"
>;

async function getBusinessPageData(slug: string): Promise<PublicPageData | null> {
  const supabase = createPublicClient();

  const { data: business } = await supabase
    .from("businesses")
    .select(
      "id, name, slug, segment, description, timezone, logo_url, cover_url, is_published, created_at, updated_at, whatsapp, instagram, address, city",
    )
    .eq("slug", slug)
    .eq("is_published", true)
    .returns<PublicBusinessRow[]>()
    .maybeSingle();

  if (!business) return null;

  const [
    { data: theme },
    { data: services },
    { data: professionals },
    { data: links },
    { data: hours },
    { data: gallery },
  ] = await Promise.all([
    supabase
      .from("themes")
      .select("primary_color, secondary_color, preset, sections")
      .eq("business_id", business.id)
      .maybeSingle(),
    supabase
      .from("services")
      .select("*")
      .eq("business_id", business.id)
      .eq("is_active", true)
      .order("position", { ascending: true }),
    supabase
      .from("professionals")
      .select("*")
      .eq("business_id", business.id)
      .eq("is_active", true)
      .order("position", { ascending: true }),
    supabase
      .from("professional_services")
      .select("professional_id, service_id"),
    supabase
      .from("business_hours")
      .select("*")
      .eq("business_id", business.id)
      .order("day_of_week", { ascending: true }),
    supabase
      .from("business_gallery")
      .select("id, image_url")
      .eq("business_id", business.id)
      .order("position", { ascending: true }),
  ]);

  const servicesByProfessional = new Map<string, string[]>();
  for (const link of links ?? []) {
    const list = servicesByProfessional.get(link.professional_id) ?? [];
    list.push(link.service_id);
    servicesByProfessional.set(link.professional_id, list);
  }

  // business_settings (booking_window_days) is intentionally not readable by
  // anon -- get_available_slots()/create_public_appointment() enforce the
  // real window server-side; the public page only needs a generous UI cap.
  return {
    business,
    theme,
    sections: theme?.sections ?? [],
    services: services ?? [],
    professionals: professionals ?? [],
    servicesByProfessional,
    gallery: gallery ?? [],
    hours: hours ?? [],
  };
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await getBusinessPageData(slug);
  if (!data) return { robots: { index: false, follow: false } };

  const { business } = data;
  const description =
    business.description ??
    (business.city
      ? `Agende um horário com ${business.name} em ${business.city}.`
      : `Agende um horário com ${business.name}.`);
  const images = business.cover_url ? [business.cover_url] : [];

  return {
    title: business.name,
    description,
    alternates: { canonical: `/${business.slug}` },
    openGraph: {
      title: business.name,
      description,
      url: `/${business.slug}`,
      type: "website",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: business.name,
      description,
      images,
    },
  };
}

export default async function BusinessPublicPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const data = await getBusinessPageData(slug);

  if (!data) notFound();

  return <PublicPageRenderer data={data} />;
}

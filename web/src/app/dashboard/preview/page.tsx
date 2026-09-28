import Link from "next/link";
import { getCurrentBusiness } from "@/lib/auth";
import { PublicPageRenderer } from "@/app/[slug]/renderer/public-page-renderer";
import type { PublicPageData } from "@/app/[slug]/renderer/types";
import type { Database } from "@/types/database";

type PreviewBusinessRow = Pick<
  Database["public"]["Tables"]["businesses"]["Row"],
  | "id"
  | "name"
  | "slug"
  | "segment"
  | "description"
  | "timezone"
  | "logo_url"
  | "cover_url"
  | "whatsapp"
  | "instagram"
  | "address"
  | "city"
  | "is_published"
>;

/**
 * Authenticated-only preview of the exact same public-page renderer used
 * by `/[slug]` -- reuses PublicPageRenderer verbatim (no separate markup
 * to drift out of sync). Unlike the real public page, this does not
 * require `is_published = true` (an owner previews before publishing)
 * and always reads the owner's own current data via getCurrentBusiness(),
 * never anon/cache. `previewMode: true` is threaded down to the booking
 * section so the widget never calls create_public_appointment here --
 * see booking-widget.tsx.
 */
export default async function PreviewPage() {
  const { supabase, business } = await getCurrentBusiness();

  const [
    { data: fullBusiness },
    { data: theme },
    { data: services },
    { data: professionals },
    { data: links },
    { data: hours },
    { data: gallery },
  ] = await Promise.all([
    supabase
      .from("businesses")
      .select(
        "id, name, slug, segment, description, timezone, logo_url, cover_url, whatsapp, instagram, address, city, is_published",
      )
      .eq("id", business.id)
      .returns<PreviewBusinessRow[]>()
      .single(),
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

  if (!fullBusiness) return null;

  const servicesByProfessional = new Map<string, string[]>();
  for (const link of links ?? []) {
    const list = servicesByProfessional.get(link.professional_id) ?? [];
    list.push(link.service_id);
    servicesByProfessional.set(link.professional_id, list);
  }

  const data: PublicPageData = {
    business: fullBusiness,
    theme,
    sections: theme?.sections ?? [],
    services: services ?? [],
    professionals: professionals ?? [],
    servicesByProfessional,
    gallery: gallery ?? [],
    hours: hours ?? [],
    previewMode: true,
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 bg-zinc-900 px-4 py-2 text-sm text-white">
        <span>
          Modo de visualização
          {!fullBusiness.is_published && " — sua página ainda não está publicada"}
        </span>
        <div className="flex items-center gap-4">
          <Link href="/dashboard/personalizacao" className="underline">
            Editar personalização
          </Link>
          <Link href="/dashboard" className="underline">
            Voltar ao painel
          </Link>
        </div>
      </div>
      <PublicPageRenderer data={data} />
    </div>
  );
}

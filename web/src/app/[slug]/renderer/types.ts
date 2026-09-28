import type { Database, PublicPageSectionConfig } from "@/types/database";

/**
 * The restricted DTO the public-page renderer accepts. Deliberately not
 * `Database["public"]["Tables"]["businesses"]["Row"]` -- that type still
 * has `owner_id`/`phone`/`email` (never selectable by anon at the
 * database layer, per docs/SECURITY.md, but a TS type doesn't know
 * that). Picking only these fields means a future edit that tries to
 * thread `business.email` through to a section component is a compile
 * error here, not a silent runtime leak of a field nobody meant to show.
 */
export interface PublicPageBusiness {
  id: string;
  name: string;
  slug: string;
  segment: Database["public"]["Tables"]["businesses"]["Row"]["segment"];
  description: string | null;
  timezone: string;
  logo_url: string | null;
  cover_url: string | null;
  whatsapp: string | null;
  instagram: string | null;
  address: string | null;
  city: string | null;
}

export type PublicPageService =
  Database["public"]["Tables"]["services"]["Row"];
export type PublicPageProfessional =
  Database["public"]["Tables"]["professionals"]["Row"];
export type PublicPageHours =
  Database["public"]["Tables"]["business_hours"]["Row"];
export type PublicPageGalleryPhoto = Pick<
  Database["public"]["Tables"]["business_gallery"]["Row"],
  "id" | "image_url"
>;

export interface PublicPageTheme {
  primary_color: string;
  secondary_color: string;
  preset: Database["public"]["Tables"]["themes"]["Row"]["preset"];
}

export interface PublicPageData {
  business: PublicPageBusiness;
  theme: PublicPageTheme | null;
  sections: PublicPageSectionConfig[];
  services: PublicPageService[];
  professionals: PublicPageProfessional[];
  servicesByProfessional: Map<string, string[]>;
  gallery: PublicPageGalleryPhoto[];
  hours: PublicPageHours[];
  /** True only for /dashboard/preview -- the booking section renders the
   * real widget UI (so preview looks/feels exactly like the public page)
   * but never calls create_public_appointment. See booking-widget.tsx's
   * `previewMode` prop. */
  previewMode?: boolean;
}

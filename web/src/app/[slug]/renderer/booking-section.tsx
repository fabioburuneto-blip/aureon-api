import type { ThemeTokens } from "@/lib/theme-presets";
import { SectionHeading, SectionShell } from "./section-shell";
import { BookingWidget } from "../booking-widget";
import type { PublicPageData } from "./types";

/** Wraps the existing BookingWidget unchanged -- this section never
 * reimplements slot calculation or booking creation, both of which stay
 * exactly as validated in the P0 fixes (get_available_slots /
 * create_public_appointment, both SECURITY DEFINER). `previewMode` only
 * ever comes from /dashboard/preview; the public page always renders with
 * it unset, so real visitors get the exact booking flow that existed
 * before Etapa 2. */
export function BookingSection({
  data,
  tokens,
}: {
  data: PublicPageData;
  tokens: ThemeTokens;
}) {
  const { business, services, professionals, servicesByProfessional } = data;
  const primaryColor = data.theme?.primary_color ?? "#111827";

  return (
    <SectionShell tokens={tokens} id="agendamento">
      <SectionHeading tokens={tokens} eyebrow="Agendamento" title="Marque seu horário" />
      <div className="max-w-md">
        <BookingWidget
          businessSlug={business.slug}
          businessName={business.name}
          timezone={business.timezone}
          services={services}
          professionals={professionals}
          servicesByProfessional={servicesByProfessional}
          primaryColor={primaryColor}
          previewMode={data.previewMode}
        />
      </div>
    </SectionShell>
  );
}

import { notFound } from "next/navigation";
import Image from "next/image";
import { createPublicClient } from "@/lib/supabase/public";
import { formatPriceCents, WEEKDAY_LABELS } from "@/lib/format";
import { segmentLabels } from "@/lib/validations";
import { BookingWidget } from "./booking-widget";
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
// supabase/migrations/20250924120009_audit_hardening.sql) -- owner_id/
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
>;

async function getBusinessPageData(slug: string) {
  const supabase = createPublicClient();

  const { data: business } = await supabase
    .from("businesses")
    .select(
      "id, name, slug, segment, description, timezone, logo_url, cover_url, is_published, created_at, updated_at",
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
  ] = await Promise.all([
    supabase
      .from("themes")
      .select("*")
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
  ]);

  // business_settings (booking_window_days) is intentionally not readable by
  // anon -- get_available_slots()/create_public_appointment() enforce the
  // real window server-side; the public page only needs a generous UI cap.
  return {
    business,
    theme,
    services: services ?? [],
    professionals: professionals ?? [],
    links: links ?? [],
    hours: hours ?? [],
  };
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await getBusinessPageData(slug);
  if (!data) return { robots: { index: false, follow: false } };

  const description =
    data.business.description ??
    `Agende um horário com ${data.business.name}.`;
  const images = data.business.cover_url ? [data.business.cover_url] : [];

  return {
    title: data.business.name,
    description,
    alternates: { canonical: `/${data.business.slug}` },
    openGraph: {
      title: data.business.name,
      description,
      url: `/${data.business.slug}`,
      type: "website",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: data.business.name,
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

  const { business, theme, services, professionals, links, hours } = data;

  const servicesByProfessional = new Map<string, string[]>();
  for (const link of links) {
    const list = servicesByProfessional.get(link.professional_id) ?? [];
    list.push(link.service_id);
    servicesByProfessional.set(link.professional_id, list);
  }

  const primaryColor = theme?.primary_color ?? "#111827";

  return (
    <div className="flex flex-1 flex-col bg-white">
      <div
        className="h-40 w-full bg-zinc-200 sm:h-56"
        style={
          business.cover_url
            ? {
                backgroundImage: `url(${business.cover_url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : { backgroundColor: primaryColor }
        }
      />

      <div className="mx-auto -mt-10 w-full max-w-3xl px-4">
        <div className="flex items-end gap-4">
          {business.logo_url ? (
            <Image
              src={business.logo_url}
              alt={business.name}
              width={80}
              height={80}
              className="h-20 w-20 rounded-xl border-4 border-white bg-white object-cover shadow-sm"
            />
          ) : (
            <div
              className="flex h-20 w-20 items-center justify-center rounded-xl border-4 border-white text-2xl font-semibold text-white shadow-sm"
              style={{ backgroundColor: primaryColor }}
            >
              {business.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="pb-1">
            <h1 className="text-2xl font-semibold text-zinc-900">
              {business.name}
            </h1>
            <p className="text-sm text-zinc-500">
              {segmentLabels[business.segment]}
            </p>
          </div>
        </div>

        {business.description && (
          <p className="mt-4 text-sm text-zinc-600">{business.description}</p>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
          <div className="flex flex-col gap-8">
            {professionals.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-medium text-zinc-900">
                  Profissionais
                </h2>
                <div className="flex flex-wrap gap-3">
                  {professionals.map((professional) => (
                    <div
                      key={professional.id}
                      className="flex items-center gap-2 rounded-full border border-zinc-200 py-1.5 pr-4 pl-1.5"
                    >
                      {professional.avatar_url ? (
                        <Image
                          src={professional.avatar_url}
                          alt={professional.name}
                          width={32}
                          height={32}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-sm font-medium text-zinc-600">
                          {professional.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm font-medium text-zinc-800">
                        {professional.name}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-3 text-lg font-medium text-zinc-900">
                Serviços
              </h2>
              {services.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Nenhum serviço disponível no momento.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
                  {services.map((service) => (
                    <li
                      key={service.id}
                      className="flex items-center justify-between p-4"
                    >
                      <div>
                        <p className="font-medium text-zinc-900">
                          {service.name}
                        </p>
                        <p className="text-sm text-zinc-500">
                          {service.duration_minutes} min
                        </p>
                      </div>
                      <span className="font-medium text-zinc-900">
                        {formatPriceCents(service.price_cents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {hours.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-medium text-zinc-900">
                  Horário de funcionamento
                </h2>
                <ul className="text-sm text-zinc-600">
                  {hours.map((h) => (
                    <li
                      key={h.id}
                      className="flex justify-between border-b border-zinc-100 py-1.5 last:border-0"
                    >
                      <span>{WEEKDAY_LABELS[h.day_of_week]}</span>
                      <span>
                        {h.is_closed
                          ? "Fechado"
                          : `${h.start_time.slice(0, 5)} - ${h.end_time.slice(0, 5)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div>
            <BookingWidget
              businessSlug={business.slug}
              timezone={business.timezone}
              services={services}
              professionals={professionals}
              servicesByProfessional={servicesByProfessional}
              primaryColor={primaryColor}
            />
          </div>
        </div>
      </div>

      <footer className="mt-12 border-t border-zinc-200 py-6">
        <p className="text-center text-sm text-zinc-400">
          Agenda por Aureon Agenda
        </p>
      </footer>
    </div>
  );
}

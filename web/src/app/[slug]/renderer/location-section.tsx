import { WEEKDAY_LABELS } from "@/lib/format";
import type { ThemeTokens } from "@/lib/theme-presets";
import { SectionHeading, SectionShell } from "./section-shell";
import type { PublicPageBusiness, PublicPageHours } from "./types";

/** Not one of the 9 named sections on its own, but opening hours are
 * "onde e quando" -- folded into Localização instead of a 10th section
 * (and still rendered even without an address, since every business has
 * hours by the time onboarding's step 3 finishes, long before most set an
 * address). */
export function LocationSection({
  business,
  hours,
  tokens,
}: {
  business: PublicPageBusiness;
  hours: PublicPageHours[];
  tokens: ThemeTokens;
}) {
  const hasAddress = Boolean(business.address || business.city);
  if (!hasAddress && hours.length === 0) return null;

  const mapsQuery = encodeURIComponent(
    [business.address, business.city].filter(Boolean).join(", "),
  );

  return (
    <SectionShell tokens={tokens}>
      <SectionHeading tokens={tokens} eyebrow="Localização" title="Onde e quando estamos" />
      <div className="grid gap-4 sm:grid-cols-2">
        {hasAddress && (
          <div className={`${tokens.cardClassName} p-4 text-sm text-zinc-700`}>
            {business.address && <p>{business.address}</p>}
            {business.city && <p className="text-zinc-500">{business.city}</p>}
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm font-medium underline"
              style={{ color: "var(--brand-primary)" }}
            >
              Ver no mapa
            </a>
          </div>
        )}
        {hours.length > 0 && (
          <div className={`${tokens.cardClassName} p-4 text-sm`}>
            <ul className="divide-y divide-zinc-100">
              {hours.map((h) => (
                <li key={h.id} className="flex justify-between py-1.5 first:pt-0 last:pb-0">
                  <span className="text-zinc-600">{WEEKDAY_LABELS[h.day_of_week]}</span>
                  <span className="text-zinc-900">
                    {h.is_closed ? "Fechado" : `${h.start_time.slice(0, 5)} - ${h.end_time.slice(0, 5)}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SectionShell>
  );
}

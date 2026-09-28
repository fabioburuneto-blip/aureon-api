import { cn } from "@/lib/cn";
import { formatPriceCents } from "@/lib/format";
import type { ThemeTokens } from "@/lib/theme-presets";
import { SectionHeading, SectionShell } from "./section-shell";
import type { PublicPageService } from "./types";

/** Only active services belonging to this business ever reach here (the
 * caller filters is_active=true) -- no internal ids, no cost/margin data,
 * just what a customer needs to choose: name, duration, price. Structured
 * as a list of cards (not a table) so click-to-book can be added to an
 * individual card later without a layout change. */
export function ServicesSection({
  services,
  tokens,
}: {
  services: PublicPageService[];
  tokens: ThemeTokens;
}) {
  return (
    <SectionShell tokens={tokens}>
      <SectionHeading tokens={tokens} eyebrow="Serviços" title="O que oferecemos" />
      {services.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhum serviço disponível no momento.</p>
      ) : (
        <ul className={cn("grid gap-3", tokens.density === "compact" ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
          {services.map((service) => (
            <li
              key={service.id}
              className={cn(tokens.cardClassName, "flex items-center justify-between gap-4 p-4")}
            >
              <div>
                <p className="font-medium text-zinc-900">{service.name}</p>
                {service.description && (
                  <p className="mt-0.5 text-sm text-zinc-500">{service.description}</p>
                )}
                <p className="mt-0.5 text-sm text-zinc-400">{service.duration_minutes} min</p>
              </div>
              <span className="shrink-0 font-medium text-zinc-900">
                {formatPriceCents(service.price_cents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionShell>
  );
}

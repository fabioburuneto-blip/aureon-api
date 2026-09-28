import Image from "next/image";
import { cn } from "@/lib/cn";
import { segmentLabels } from "@/lib/validations";
import type { ThemeTokens } from "@/lib/theme-presets";
import { LogoAvatar } from "./section-shell";
import type { PublicPageBusiness } from "./types";

/**
 * One component, five compositions -- `tokens.heroVariant` picks the
 * branch, everything else (data, CTA, avatar) is shared. This is the
 * section most visibly different between presets, since it's the first
 * thing a visitor sees.
 */
export function HeroSection({
  business,
  tokens,
}: {
  business: PublicPageBusiness;
  tokens: ThemeTokens;
}) {
  const ctaHref = "#agendamento";
  const description = business.description;
  const segment = segmentLabels[business.segment];

  const cta = (
    <a
      href={ctaHref}
      className={cn(tokens.buttonClassName, "inline-flex h-11 items-center justify-center text-white")}
      style={{ backgroundColor: "var(--brand-primary)" }}
    >
      Agendar horário
    </a>
  );

  if (tokens.heroVariant === "overlay") {
    return (
      <div className="relative flex h-[26rem] w-full items-end overflow-hidden">
        {business.cover_url ? (
          <Image
            src={business.cover_url}
            alt=""
            fill
            priority
            className="object-cover"
          />
        ) : (
          <div className="absolute inset-0" style={{ backgroundColor: "var(--brand-primary)" }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className={`relative z-10 mx-auto w-full px-4 pb-10 ${tokens.containerWidthClassName}`}>
          <div className="flex items-end gap-4">
            <LogoAvatar logoUrl={business.logo_url} name={business.name} size={72} rounded={tokens.radiusClass} />
            <div className="pb-1">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-white/70">{segment}</p>
              <h1 className={cn(tokens.fontHeading, tokens.headingWeight, "text-3xl text-white sm:text-4xl")}>
                {business.name}
              </h1>
            </div>
          </div>
          {description && <p className="mt-4 max-w-xl text-sm text-white/90">{description}</p>}
          <div className="mt-6">{cta}</div>
        </div>
      </div>
    );
  }

  if (tokens.heroVariant === "split") {
    return (
      <div className={`mx-auto w-full px-4 pt-10 ${tokens.containerWidthClassName}`}>
        <div className="grid items-center gap-8 sm:grid-cols-2">
          <div>
            <LogoAvatar logoUrl={business.logo_url} name={business.name} size={56} rounded={tokens.radiusClass} />
            <p className={cn(tokens.eyebrowClassName, "mt-4")}>{segment}</p>
            <h1 className={cn(tokens.fontHeading, tokens.headingWeight, tokens.headingTracking, "mt-1 text-3xl text-zinc-900 sm:text-4xl")}>
              {business.name}
            </h1>
            {description && <p className="mt-4 text-sm text-zinc-600">{description}</p>}
            <div className="mt-6">{cta}</div>
          </div>
          <div className={cn("h-56 w-full overflow-hidden sm:h-72", tokens.radiusClass, "relative")}>
            {business.cover_url ? (
              <Image src={business.cover_url} alt="" fill className="object-cover" priority />
            ) : (
              <div className="h-full w-full" style={{ backgroundColor: "var(--brand-secondary)" }} />
            )}
          </div>
        </div>
      </div>
    );
  }

  if (tokens.heroVariant === "bold") {
    return (
      <div className="relative flex min-h-[22rem] w-full flex-col items-center justify-center bg-zinc-900 px-4 text-center">
        {business.cover_url && (
          <Image
            src={business.cover_url}
            alt=""
            fill
            priority
            className="object-cover opacity-30"
          />
        )}
        <div className="relative z-10 flex flex-col items-center">
          <LogoAvatar logoUrl={business.logo_url} name={business.name} size={72} rounded={tokens.radiusClass} />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.3em] text-zinc-400">{segment}</p>
          <h1 className={cn(tokens.fontHeading, tokens.headingWeight, tokens.headingTransform, "mt-1 text-4xl text-white sm:text-5xl")}>
            {business.name}
          </h1>
          {description && <p className="mt-4 max-w-lg text-sm text-zinc-300">{description}</p>}
          <div className="mt-8">{cta}</div>
        </div>
      </div>
    );
  }

  if (tokens.heroVariant === "soft") {
    return (
      <div className="w-full px-4 pt-14" style={{ backgroundColor: "color-mix(in srgb, var(--brand-primary) 8%, white)" }}>
        <div className={`mx-auto flex flex-col items-center pb-14 text-center ${tokens.containerWidthClassName}`}>
          <LogoAvatar logoUrl={business.logo_url} name={business.name} size={80} rounded={tokens.radiusClass} />
          <p className={cn(tokens.eyebrowClassName, "mt-5")}>{segment}</p>
          <h1 className={cn(tokens.fontHeading, tokens.headingWeight, tokens.headingTransform, "mt-1 text-3xl text-zinc-900 sm:text-4xl")}>
            {business.name}
          </h1>
          {description && <p className="mt-4 max-w-md text-sm text-zinc-600">{description}</p>}
          <div className="mt-6">{cta}</div>
        </div>
      </div>
    );
  }

  // "centered" (minimalista): no cover emphasis, tiny avatar, quiet CTA.
  return (
    <div className={`mx-auto w-full px-4 pt-16 pb-4 text-center ${tokens.containerWidthClassName}`}>
      <LogoAvatar logoUrl={business.logo_url} name={business.name} size={48} rounded={tokens.radiusClass} />
      <p className={cn(tokens.eyebrowClassName, "mt-6")}>{segment}</p>
      <h1 className={cn(tokens.fontHeading, tokens.headingWeight, "mt-1 text-2xl text-zinc-900 sm:text-3xl")}>
        {business.name}
      </h1>
      {description && <p className="mx-auto mt-4 max-w-md text-sm text-zinc-500">{description}</p>}
      <div className="mt-6">{cta}</div>
    </div>
  );
}

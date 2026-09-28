import { cn } from "@/lib/cn";
import type { ThemeTokens } from "@/lib/theme-presets";
import { SectionHeading, SectionShell } from "./section-shell";
import type { PublicPageBusiness } from "./types";

export function AboutSection({
  business,
  tokens,
}: {
  business: PublicPageBusiness;
  tokens: ThemeTokens;
}) {
  if (!business.description) return null;

  return (
    <SectionShell tokens={tokens}>
      <SectionHeading tokens={tokens} eyebrow="Sobre" title={`Conheça ${business.name}`} />
      <p className={cn(tokens.fontBody, "max-w-2xl text-sm leading-relaxed text-zinc-600")}>
        {business.description}
      </p>
    </SectionShell>
  );
}

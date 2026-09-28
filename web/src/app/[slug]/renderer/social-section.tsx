import type { ThemeTokens } from "@/lib/theme-presets";
import { SectionHeading, SectionShell } from "./section-shell";
import type { PublicPageBusiness } from "./types";

/** Only whatsapp/instagram -- both already public-facing, validated/
 * normalized on save (src/lib/validations.ts). Links are built from those
 * stored values, never from arbitrary user input at render time. */
export function SocialSection({
  business,
  tokens,
}: {
  business: PublicPageBusiness;
  tokens: ThemeTokens;
}) {
  if (!business.whatsapp && !business.instagram) return null;

  return (
    <SectionShell tokens={tokens}>
      <SectionHeading tokens={tokens} eyebrow="Redes sociais" title="Fale com a gente" />
      <div className="flex flex-wrap gap-3">
        {business.whatsapp && (
          <a
            href={`https://wa.me/${business.whatsapp.replace(/\D/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${tokens.outlineButtonClassName} inline-flex h-11 items-center border-emerald-600 text-emerald-700`}
          >
            WhatsApp
          </a>
        )}
        {business.instagram && (
          <a
            href={`https://instagram.com/${business.instagram}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${tokens.outlineButtonClassName} inline-flex h-11 items-center border-zinc-300 text-zinc-700`}
          >
            @{business.instagram}
          </a>
        )}
      </div>
    </SectionShell>
  );
}

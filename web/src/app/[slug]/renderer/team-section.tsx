import { cn } from "@/lib/cn";
import type { ThemeTokens } from "@/lib/theme-presets";
import { LogoAvatar, SectionHeading, SectionShell } from "./section-shell";
import type { PublicPageProfessional } from "./types";

/** Name, photo (with initials fallback) and bio only -- professionals.phone
 * is never selected by the public-page query in the first place, so there
 * is nothing private for this component to accidentally render. */
export function TeamSection({
  professionals,
  tokens,
}: {
  professionals: PublicPageProfessional[];
  tokens: ThemeTokens;
}) {
  if (professionals.length === 0) return null;

  return (
    <SectionShell tokens={tokens}>
      <SectionHeading tokens={tokens} eyebrow="Equipe" title="Quem vai te atender" />
      <div className={cn("grid gap-4", tokens.density === "spacious" ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
        {professionals.map((professional) => (
          <div key={professional.id} className={cn(tokens.cardClassName, "flex items-center gap-3 p-4")}>
            <LogoAvatar
              logoUrl={professional.avatar_url}
              name={professional.name}
              size={48}
              rounded="rounded-full"
            />
            <div>
              <p className="font-medium text-zinc-900">{professional.name}</p>
              {professional.bio && <p className="text-sm text-zinc-500">{professional.bio}</p>}
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

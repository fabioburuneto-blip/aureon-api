import Image from "next/image";
import { cn } from "@/lib/cn";
import type { ThemeTokens } from "@/lib/theme-presets";
import { SectionHeading, SectionShell } from "./section-shell";
import type { PublicPageGalleryPhoto } from "./types";

export function GallerySection({
  photos,
  businessName,
  tokens,
}: {
  photos: PublicPageGalleryPhoto[];
  businessName: string;
  tokens: ThemeTokens;
}) {
  if (photos.length === 0) return null;

  return (
    <SectionShell tokens={tokens}>
      <SectionHeading tokens={tokens} eyebrow="Galeria" title="Um pouco do nosso espaço" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className={cn(tokens.radiusClass, "relative aspect-square overflow-hidden bg-zinc-100")}
          >
            <Image
              src={photo.image_url}
              alt={businessName}
              fill
              className="object-cover"
              sizes="(min-width: 640px) 33vw, 50vw"
            />
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

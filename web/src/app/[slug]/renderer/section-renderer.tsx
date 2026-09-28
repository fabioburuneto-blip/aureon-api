import type { ReactNode } from "react";
import { normalizeSectionsConfig } from "@/lib/sections";
import type { ThemeTokens } from "@/lib/theme-presets";
import type { PublicPageSectionKey } from "@/types/database";
import { HeroSection } from "./hero-section";
import { AboutSection } from "./about-section";
import { ServicesSection } from "./services-section";
import { TeamSection } from "./team-section";
import { GallerySection } from "./gallery-section";
import { BookingSection } from "./booking-section";
import { LocationSection } from "./location-section";
import { SocialSection } from "./social-section";
import { FooterSection } from "./footer-section";
import type { PublicPageData } from "./types";

/**
 * Single place that maps a section key to a component -- adding a 10th
 * section later means one new entry here plus one new component file,
 * never a change to /[slug]/page.tsx or /dashboard/preview.
 */
export function SectionRenderer({
  data,
  tokens,
}: {
  data: PublicPageData;
  tokens: ThemeTokens;
}) {
  // Defense in depth: re-normalize even though the write path already
  // does -- a row written before this etapa, or edited by hand, must
  // still render something sane rather than crash or silently drop hero/
  // footer/booking.
  const sections = normalizeSectionsConfig(data.sections);

  const renderers: Record<PublicPageSectionKey, () => ReactNode> = {
    hero: () => <HeroSection business={data.business} tokens={tokens} />,
    about: () => <AboutSection business={data.business} tokens={tokens} />,
    services: () => <ServicesSection services={data.services} tokens={tokens} />,
    team: () => <TeamSection professionals={data.professionals} tokens={tokens} />,
    gallery: () => (
      <GallerySection photos={data.gallery} businessName={data.business.name} tokens={tokens} />
    ),
    booking: () => <BookingSection data={data} tokens={tokens} />,
    location: () => (
      <LocationSection business={data.business} hours={data.hours} tokens={tokens} />
    ),
    social: () => <SocialSection business={data.business} tokens={tokens} />,
    footer: () => <FooterSection tokens={tokens} />,
  };

  return (
    <div className={`flex flex-col ${tokens.sectionGapClassName}`}>
      {sections
        .filter((section) => section.visible)
        .map((section) => (
          <div key={section.key}>{renderers[section.key]()}</div>
        ))}
    </div>
  );
}

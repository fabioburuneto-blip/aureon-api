import { resolveThemeTokens, ThemeProvider } from "./theme-provider";
import { SectionRenderer } from "./section-renderer";
import type { PublicPageData } from "./types";

/**
 * The single source of truth for "what does a business's public page look
 * like", used verbatim by both `/[slug]/page.tsx` (real visitors) and
 * `/dashboard/preview` (the signed-in owner). Neither route duplicates
 * any markup -- they only differ in how `PublicPageData` is fetched
 * (public RLS + is_published=true vs. the owner's own session) and
 * whether `previewMode` is set.
 */
export function PublicPageRenderer({ data }: { data: PublicPageData }) {
  const tokens = resolveThemeTokens(data.theme?.preset);

  return (
    <ThemeProvider theme={data.theme}>
      <SectionRenderer data={data} tokens={tokens} />
    </ThemeProvider>
  );
}

export type { PublicPageData } from "./types";

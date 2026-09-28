import type { CSSProperties, ReactNode } from "react";
import { getThemeTokens, type ThemeTokens } from "@/lib/theme-presets";
import type { PublicPageTheme } from "./types";

/**
 * Applies the preset's typography/density tokens as classNames on a
 * wrapper element and the per-business colors as CSS custom properties,
 * so every section component below reads `var(--brand-primary)` /
 * `var(--brand-secondary)` instead of receiving a color prop -- one
 * source of truth for "what does this business look like", shared by the
 * public page and /dashboard/preview.
 */
export function ThemeProvider({
  theme,
  children,
}: {
  theme: PublicPageTheme | null;
  children: ReactNode;
}) {
  const tokens = getThemeTokens(theme?.preset);
  const primary = theme?.primary_color ?? "#111827";
  const secondary = theme?.secondary_color ?? "#6366f1";

  const style: CSSProperties & Record<string, string> = {
    "--brand-primary": primary,
    "--brand-secondary": secondary,
  };

  return (
    <div
      data-preset={tokens.preset}
      style={style}
      className={`flex flex-1 flex-col bg-white ${tokens.fontBody}`}
    >
      {children}
    </div>
  );
}

export function resolveThemeTokens(
  preset: PublicPageTheme["preset"] | undefined | null,
): ThemeTokens {
  return getThemeTokens(preset);
}

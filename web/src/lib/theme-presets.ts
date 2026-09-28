import type { ThemePreset } from "@/types/database";

/**
 * Etapa 2 theme engine: a shared token system, not five separate pages.
 * Every public-page section component reads these tokens (via
 * ThemeProvider) instead of hardcoding any Tailwind class itself -- the
 * same <ServicesSection> renders differently under each preset because
 * the tokens differ, not because there are five ServicesSection
 * implementations. Colors (primary/secondary) stay per-business (the
 * existing `themes.primary_color`/`secondary_color` color pickers);
 * everything here is what differs *between presets* -- typography,
 * density, shape, hero composition -- deliberately using only Tailwind's
 * built-in font-family utilities (font-serif/font-sans/font-mono resolve
 * to system font stacks) so no external font is fetched at build or
 * request time.
 */
export const THEME_PRESET_KEYS = [
  "premium",
  "moderno",
  "minimalista",
  "barbearia",
  "elegante",
] as const satisfies readonly ThemePreset[];

export type HeroVariant = "overlay" | "split" | "centered" | "bold" | "soft";
export type Density = "compact" | "normal" | "spacious";

export interface ThemeTokens {
  preset: ThemePreset;
  label: string;
  description: string;
  fontHeading: string;
  fontBody: string;
  headingWeight: string;
  headingTracking: string;
  headingTransform: string;
  eyebrowClassName: string;
  radiusClass: string;
  cardClassName: string;
  buttonClassName: string;
  outlineButtonClassName: string;
  sectionGapClassName: string;
  sectionPaddingClassName: string;
  containerWidthClassName: string;
  heroVariant: HeroVariant;
  density: Density;
  dividerClassName: string;
}

export const THEME_PRESETS: Record<ThemePreset, ThemeTokens> = {
  premium: {
    preset: "premium",
    label: "Premium",
    description: "Elegante e sofisticado, com tipografia serifada e capa em destaque.",
    fontHeading: "font-serif",
    fontBody: "font-sans",
    headingWeight: "font-semibold",
    headingTracking: "tracking-tight",
    headingTransform: "",
    eyebrowClassName: "text-xs font-medium uppercase tracking-[0.2em] text-zinc-500",
    radiusClass: "rounded-sm",
    cardClassName: "rounded-sm border border-zinc-200 bg-white shadow-lg",
    buttonClassName: "rounded-sm px-6 uppercase tracking-wide text-sm font-medium",
    outlineButtonClassName:
      "rounded-sm border px-6 uppercase tracking-wide text-sm font-medium",
    sectionGapClassName: "gap-16",
    sectionPaddingClassName: "py-16",
    containerWidthClassName: "max-w-5xl",
    heroVariant: "overlay",
    density: "spacious",
    dividerClassName: "border-t border-zinc-200",
  },
  moderno: {
    preset: "moderno",
    label: "Moderno",
    description: "Vibrante e direto ao ponto, com cards arredondados e cores fortes.",
    fontHeading: "font-sans",
    fontBody: "font-sans",
    headingWeight: "font-bold",
    headingTracking: "tracking-tight",
    headingTransform: "",
    eyebrowClassName: "text-xs font-semibold uppercase tracking-wide text-zinc-500",
    radiusClass: "rounded-2xl",
    cardClassName: "rounded-2xl border border-zinc-100 bg-white shadow-md",
    buttonClassName: "rounded-full px-6 text-sm font-semibold",
    outlineButtonClassName: "rounded-full border-2 px-6 text-sm font-semibold",
    sectionGapClassName: "gap-12",
    sectionPaddingClassName: "py-12",
    containerWidthClassName: "max-w-4xl",
    heroVariant: "split",
    density: "normal",
    dividerClassName: "border-t border-zinc-100",
  },
  minimalista: {
    preset: "minimalista",
    label: "Minimalista",
    description: "Muito espaço em branco, sem bordas ou sombras, foco no essencial.",
    fontHeading: "font-sans",
    fontBody: "font-sans",
    headingWeight: "font-medium",
    headingTracking: "tracking-tight",
    headingTransform: "",
    eyebrowClassName: "text-xs font-normal uppercase tracking-widest text-zinc-400",
    radiusClass: "rounded-none",
    cardClassName: "rounded-none border-0 border-b border-zinc-200 bg-transparent shadow-none",
    buttonClassName: "rounded-none px-5 text-sm font-normal",
    outlineButtonClassName: "rounded-none border px-5 text-sm font-normal",
    sectionGapClassName: "gap-20",
    sectionPaddingClassName: "py-20",
    containerWidthClassName: "max-w-3xl",
    heroVariant: "centered",
    density: "spacious",
    dividerClassName: "border-t border-zinc-100",
  },
  barbearia: {
    preset: "barbearia",
    label: "Barbearia",
    description: "Robusto e contrastante, com tipografia pesada e visual escuro.",
    fontHeading: "font-sans",
    fontBody: "font-sans",
    headingWeight: "font-black",
    headingTracking: "tracking-tight",
    headingTransform: "uppercase",
    eyebrowClassName: "text-xs font-bold uppercase tracking-[0.3em] text-zinc-500",
    radiusClass: "rounded-none",
    cardClassName: "rounded-none border-2 border-zinc-900 bg-white shadow-none",
    buttonClassName: "rounded-none px-6 text-sm font-bold uppercase tracking-wide",
    outlineButtonClassName:
      "rounded-none border-2 border-zinc-900 px-6 text-sm font-bold uppercase tracking-wide",
    sectionGapClassName: "gap-10",
    sectionPaddingClassName: "py-10",
    containerWidthClassName: "max-w-4xl",
    heroVariant: "bold",
    density: "compact",
    dividerClassName: "border-t-2 border-zinc-900",
  },
  elegante: {
    preset: "elegante",
    label: "Elegante",
    description: "Suave e delicado, com tons pastel, cantos arredondados e itálico.",
    fontHeading: "font-serif",
    fontBody: "font-sans",
    headingWeight: "font-medium",
    headingTracking: "tracking-normal",
    headingTransform: "italic",
    eyebrowClassName: "text-xs font-medium uppercase tracking-wide text-zinc-400 not-italic",
    radiusClass: "rounded-3xl",
    cardClassName: "rounded-3xl border border-zinc-100 bg-white shadow-sm",
    buttonClassName: "rounded-full px-6 text-sm font-medium",
    outlineButtonClassName: "rounded-full border px-6 text-sm font-medium",
    sectionGapClassName: "gap-14",
    sectionPaddingClassName: "py-14",
    containerWidthClassName: "max-w-3xl",
    heroVariant: "soft",
    density: "spacious",
    dividerClassName: "border-t border-zinc-100",
  },
};

export function getThemeTokens(preset: string | null | undefined): ThemeTokens {
  if (preset && preset in THEME_PRESETS) {
    return THEME_PRESETS[preset as ThemePreset];
  }
  return THEME_PRESETS.moderno;
}

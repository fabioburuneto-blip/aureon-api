import { describe, expect, it } from "vitest";
import { THEME_PRESET_KEYS, THEME_PRESETS, getThemeTokens } from "./theme-presets";

describe("THEME_PRESETS", () => {
  it("has exactly the 5 named presets required by Etapa 2", () => {
    expect(THEME_PRESET_KEYS).toEqual([
      "premium",
      "moderno",
      "minimalista",
      "barbearia",
      "elegante",
    ]);
    expect(Object.keys(THEME_PRESETS).sort()).toEqual(
      [...THEME_PRESET_KEYS].sort(),
    );
  });

  it("gives every preset a self-consistent key", () => {
    for (const key of THEME_PRESET_KEYS) {
      expect(THEME_PRESETS[key].preset).toBe(key);
    }
  });

  it("differs visibly between every pair of presets (no two identical token sets)", () => {
    const serialized = THEME_PRESET_KEYS.map((key) =>
      JSON.stringify(THEME_PRESETS[key]),
    );
    expect(new Set(serialized).size).toBe(THEME_PRESET_KEYS.length);
  });

  it("does not repeat the exact same font/radius/hero combination twice", () => {
    const signatures = THEME_PRESET_KEYS.map((key) => {
      const t = THEME_PRESETS[key];
      return `${t.fontHeading}|${t.radiusClass}|${t.heroVariant}|${t.headingTransform}`;
    });
    expect(new Set(signatures).size).toBe(THEME_PRESET_KEYS.length);
  });
});

describe("getThemeTokens", () => {
  it("resolves a valid preset name", () => {
    expect(getThemeTokens("barbearia").preset).toBe("barbearia");
  });

  it("falls back to 'moderno' for null/unknown input", () => {
    expect(getThemeTokens(null).preset).toBe("moderno");
    expect(getThemeTokens("not-a-real-preset").preset).toBe("moderno");
  });
});

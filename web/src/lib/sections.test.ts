import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECTIONS,
  SECTION_KEYS,
  isSectionLocked,
  isSectionPositionLocked,
  normalizeSectionsConfig,
  reorderSection,
  toggleSection,
} from "./sections";

describe("DEFAULT_SECTIONS", () => {
  it("includes all 9 sections, hero first and footer last, all visible", () => {
    expect(DEFAULT_SECTIONS.map((s) => s.key)).toEqual(SECTION_KEYS);
    expect(DEFAULT_SECTIONS[0]!.key).toBe("hero");
    expect(DEFAULT_SECTIONS.at(-1)!.key).toBe("footer");
    expect(DEFAULT_SECTIONS.every((s) => s.visible)).toBe(true);
  });
});

describe("normalizeSectionsConfig", () => {
  it("returns the default set for garbage input", () => {
    expect(normalizeSectionsConfig(null)).toEqual(DEFAULT_SECTIONS);
    expect(normalizeSectionsConfig(undefined)).toEqual(DEFAULT_SECTIONS);
    expect(normalizeSectionsConfig("not an array")).toEqual(DEFAULT_SECTIONS);
    expect(normalizeSectionsConfig({})).toEqual(DEFAULT_SECTIONS);
  });

  it("drops unknown keys and duplicate keys", () => {
    const result = normalizeSectionsConfig([
      { key: "services", visible: true },
      { key: "services", visible: false },
      { key: "not-a-real-section", visible: true },
    ]);
    expect(result.filter((s) => s.key === "services")).toHaveLength(1);
    expect(result.some((s) => (s.key as string) === "not-a-real-section")).toBe(
      false,
    );
  });

  it("always pins hero first and footer last regardless of input order", () => {
    const result = normalizeSectionsConfig([
      { key: "footer", visible: false },
      { key: "about", visible: true },
      { key: "hero", visible: false },
    ]);
    expect(result[0]!.key).toBe("hero");
    expect(result[0]!.visible).toBe(true);
    expect(result.at(-1)!.key).toBe("footer");
    expect(result.at(-1)!.visible).toBe(true);
  });

  it("forces booking to always be visible even if input says otherwise", () => {
    const result = normalizeSectionsConfig([{ key: "booking", visible: false }]);
    expect(result.find((s) => s.key === "booking")!.visible).toBe(true);
  });

  it("fills in a section missing from a partial/older config", () => {
    const result = normalizeSectionsConfig([{ key: "services", visible: true }]);
    expect(result.map((s) => s.key).sort()).toEqual([...SECTION_KEYS].sort());
  });

  it("is idempotent", () => {
    const once = normalizeSectionsConfig(DEFAULT_SECTIONS);
    const twice = normalizeSectionsConfig(once);
    expect(twice).toEqual(once);
  });
});

describe("toggleSection", () => {
  it("flips visibility for a configurable section", () => {
    const result = toggleSection(DEFAULT_SECTIONS, "gallery");
    expect(result.find((s) => s.key === "gallery")!.visible).toBe(false);
  });

  it("is a no-op for locked sections (hero/booking/footer)", () => {
    expect(toggleSection(DEFAULT_SECTIONS, "hero")).toEqual(DEFAULT_SECTIONS);
    expect(toggleSection(DEFAULT_SECTIONS, "booking")).toEqual(DEFAULT_SECTIONS);
    expect(toggleSection(DEFAULT_SECTIONS, "footer")).toEqual(DEFAULT_SECTIONS);
  });
});

describe("reorderSection", () => {
  it("moves a section up within the movable range", () => {
    // default order: hero, about, services, team, gallery, booking, location, social, footer
    const result = reorderSection(DEFAULT_SECTIONS, "services", "up");
    expect(result.map((s) => s.key)).toEqual([
      "hero",
      "services",
      "about",
      "team",
      "gallery",
      "booking",
      "location",
      "social",
      "footer",
    ]);
  });

  it("moves a section down within the movable range", () => {
    const result = reorderSection(DEFAULT_SECTIONS, "about", "down");
    expect(result.map((s) => s.key)).toEqual([
      "hero",
      "services",
      "about",
      "team",
      "gallery",
      "booking",
      "location",
      "social",
      "footer",
    ]);
  });

  it("never moves a section above hero", () => {
    const result = reorderSection(DEFAULT_SECTIONS, "about", "up");
    expect(result).toEqual(DEFAULT_SECTIONS);
  });

  it("never moves a section below footer", () => {
    const result = reorderSection(DEFAULT_SECTIONS, "social", "down");
    expect(result).toEqual(DEFAULT_SECTIONS);
  });

  it("is a no-op for hero/footer themselves", () => {
    expect(reorderSection(DEFAULT_SECTIONS, "hero", "down")).toEqual(
      DEFAULT_SECTIONS,
    );
    expect(reorderSection(DEFAULT_SECTIONS, "footer", "up")).toEqual(
      DEFAULT_SECTIONS,
    );
  });
});

describe("locking helpers", () => {
  it("isSectionLocked matches hero/booking/footer only", () => {
    for (const key of SECTION_KEYS) {
      const expected = key === "hero" || key === "booking" || key === "footer";
      expect(isSectionLocked(key)).toBe(expected);
    }
  });

  it("isSectionPositionLocked matches hero/footer only", () => {
    for (const key of SECTION_KEYS) {
      const expected = key === "hero" || key === "footer";
      expect(isSectionPositionLocked(key)).toBe(expected);
    }
  });
});

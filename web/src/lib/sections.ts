import type {
  PublicPageSectionConfig,
  PublicPageSectionKey,
} from "@/types/database";

/**
 * Section registry for the public-page engine (Etapa 2). Order in this
 * array is the default display order. `hero` and `footer` are structural
 * (always first/last, always visible) -- see LOCKED_SECTIONS below --
 * `booking` is always visible (the booking funnel is the product's core
 * loop, and hiding it would silently break the storefront) but its
 * position among the others can move. Everything else can be shown/
 * hidden and reordered from /dashboard/personalizacao.
 */
export const SECTION_KEYS = [
  "hero",
  "about",
  "services",
  "team",
  "gallery",
  "booking",
  "location",
  "social",
  "footer",
] as const satisfies readonly PublicPageSectionKey[];

export const SECTION_LABELS: Record<PublicPageSectionKey, string> = {
  hero: "Capa",
  about: "Sobre",
  services: "Serviços",
  team: "Equipe",
  gallery: "Galeria",
  booking: "Agendamento",
  location: "Localização",
  social: "Redes sociais",
  footer: "Rodapé",
};

/** Sections whose visibility can never be turned off. `hero`/`footer` also
 * can never move (see normalizeSectionsConfig). */
const ALWAYS_VISIBLE: ReadonlySet<PublicPageSectionKey> = new Set([
  "hero",
  "booking",
  "footer",
]);

/** Sections that can be hidden and reordered by the owner. */
export const CONFIGURABLE_SECTION_KEYS: PublicPageSectionKey[] =
  SECTION_KEYS.filter((key) => key !== "hero" && key !== "footer");

export const DEFAULT_SECTIONS: PublicPageSectionConfig[] = SECTION_KEYS.map(
  (key) => ({ key, visible: true }),
);

function isSectionKey(value: unknown): value is PublicPageSectionKey {
  return (
    typeof value === "string" &&
    (SECTION_KEYS as readonly string[]).includes(value)
  );
}

/**
 * Never trusts `themes.sections` as stored -- re-validates shape, drops
 * unknown/duplicate keys, fills in any section missing from an older or
 * hand-edited row, and re-pins hero first / footer last / booking visible
 * every time. Used both before persisting a save (personalizacao actions)
 * and again when rendering (SectionRenderer) as defense-in-depth against
 * a malformed or partially-migrated row, the same "don't trust stored
 * shape blindly" posture the rest of this codebase uses for RPC inputs.
 */
export function normalizeSectionsConfig(
  input: unknown,
): PublicPageSectionConfig[] {
  const seen = new Set<PublicPageSectionKey>();
  const middle: PublicPageSectionConfig[] = [];

  if (Array.isArray(input)) {
    for (const entry of input) {
      if (
        entry &&
        typeof entry === "object" &&
        "key" in entry &&
        isSectionKey((entry as { key: unknown }).key)
      ) {
        const key = (entry as { key: PublicPageSectionKey }).key;
        if (key === "hero" || key === "footer" || seen.has(key)) continue;
        seen.add(key);
        const visible = ALWAYS_VISIBLE.has(key)
          ? true
          : Boolean((entry as { visible?: unknown }).visible);
        middle.push({ key, visible });
      }
    }
  }

  for (const key of CONFIGURABLE_SECTION_KEYS) {
    if (!seen.has(key) && key !== "footer") {
      middle.push({ key, visible: true });
    }
  }

  return [
    { key: "hero", visible: true },
    ...middle,
    { key: "footer", visible: true },
  ];
}

/** Flips visibility for a configurable section; no-op for hero/booking/footer. */
export function toggleSection(
  sections: PublicPageSectionConfig[],
  key: PublicPageSectionKey,
): PublicPageSectionConfig[] {
  if (ALWAYS_VISIBLE.has(key)) return sections;
  return sections.map((s) => (s.key === key ? { ...s, visible: !s.visible } : s));
}

/** Moves a configurable section up/down within the movable middle range
 * (never past hero at the start or footer at the end). */
export function reorderSection(
  sections: PublicPageSectionConfig[],
  key: PublicPageSectionKey,
  direction: "up" | "down",
): PublicPageSectionConfig[] {
  if (key === "hero" || key === "footer") return sections;

  const index = sections.findIndex((s) => s.key === key);
  if (index === -1) return sections;

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  const target = sections[targetIndex];
  if (!target || target.key === "hero" || target.key === "footer") {
    return sections;
  }

  const next = [...sections];
  next[index] = sections[targetIndex]!;
  next[targetIndex] = sections[index]!;
  return next;
}

/** True for sections whose visibility toggle should be disabled in the UI
 * (hero/booking/footer are always visible); hero/footer are additionally
 * fixed in position (never shown with reorder controls). */
export function isSectionLocked(key: PublicPageSectionKey): boolean {
  return ALWAYS_VISIBLE.has(key);
}

export function isSectionPositionLocked(key: PublicPageSectionKey): boolean {
  return key === "hero" || key === "footer";
}

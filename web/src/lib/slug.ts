const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Top-level app routes a business slug must never shadow.
const RESERVED_SLUGS = new Set([
  "login",
  "signup",
  "dashboard",
  "onboarding",
  "auth",
  "api",
  "admin",
  "public",
  "assets",
  "static",
]);

/** Normalizes free text into a slug matching the businesses.slug DB constraint. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return (
    SLUG_PATTERN.test(slug) &&
    slug.length >= 3 &&
    slug.length <= 60 &&
    !RESERVED_SLUGS.has(slug)
  );
}

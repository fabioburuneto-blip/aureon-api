import { describe, expect, it } from "vitest";
import { slugify, isValidSlug } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Barbearia do Fábio")).toBe("barbearia-do-fabio");
  });

  it("strips accents", () => {
    expect(slugify("Salão São José")).toBe("salao-sao-jose");
  });

  it("removes invalid characters", () => {
    expect(slugify("Café & Cia!!!")).toBe("cafe-cia");
  });

  it("collapses repeated separators", () => {
    expect(slugify("  multiple   spaces  ")).toBe("multiple-spaces");
  });
});

describe("isValidSlug", () => {
  it("accepts a well-formed slug", () => {
    expect(isValidSlug("barbearia-do-fabio")).toBe(true);
  });

  it("rejects uppercase letters", () => {
    expect(isValidSlug("Barbearia")).toBe(false);
  });

  it("rejects slugs shorter than 3 characters", () => {
    expect(isValidSlug("ab")).toBe(false);
  });

  it("rejects leading/trailing hyphens", () => {
    expect(isValidSlug("-barbearia-")).toBe(false);
  });

  it("rejects reserved app routes", () => {
    expect(isValidSlug("dashboard")).toBe(false);
    expect(isValidSlug("login")).toBe(false);
  });
});

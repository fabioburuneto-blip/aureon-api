import { describe, expect, it } from "vitest";
import { hmacSha256Hex, safeEqual } from "./crypto";

describe("hmacSha256Hex", () => {
  it("is deterministic for the same secret and payload", () => {
    const a = hmacSha256Hex("secret", "payload");
    const b = hmacSha256Hex("secret", "payload");
    expect(a).toBe(b);
  });

  it("changes when the payload changes", () => {
    const a = hmacSha256Hex("secret", "payload-a");
    const b = hmacSha256Hex("secret", "payload-b");
    expect(a).not.toBe(b);
  });

  it("changes when the secret changes", () => {
    const a = hmacSha256Hex("secret-a", "payload");
    const b = hmacSha256Hex("secret-b", "payload");
    expect(a).not.toBe(b);
  });
});

describe("safeEqual", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(safeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false for different lengths without throwing", () => {
    expect(safeEqual("short", "a-much-longer-string")).toBe(false);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { _resetRateLimitBucketsForTests, checkRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetRateLimitBucketsForTests();
  });

  it("allows requests up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("k1", 5, 60_000)).toBe(true);
    }
  });

  it("blocks once the limit is exceeded within the window", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("k2", 5, 60_000);
    }
    expect(checkRateLimit("k2", 5, 60_000)).toBe(false);
  });

  it("tracks separate keys independently", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("k3", 5, 60_000);
    }
    expect(checkRateLimit("k3", 5, 60_000)).toBe(false);
    expect(checkRateLimit("k4", 5, 60_000)).toBe(true);
  });

  it("resets the count after the window elapses", async () => {
    expect(checkRateLimit("k5", 1, 10)).toBe(true);
    expect(checkRateLimit("k5", 1, 10)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(checkRateLimit("k5", 1, 10)).toBe(true);
  });
});

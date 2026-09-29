import { describe, expect, it, vi } from "vitest";
import { createEligibilityChecker } from "./plan-gate";

describe("createEligibilityChecker", () => {
  it("returns the lookup result", async () => {
    const lookup = vi.fn().mockResolvedValue(true);
    const isEligible = createEligibilityChecker(lookup);

    await expect(isEligible("business-1")).resolves.toBe(true);
  });

  it("propagates a blocked result", async () => {
    const lookup = vi.fn().mockResolvedValue(false);
    const isEligible = createEligibilityChecker(lookup);

    await expect(isEligible("business-1")).resolves.toBe(false);
  });

  it("caches per business_id -- only one lookup for repeated calls", async () => {
    const lookup = vi.fn().mockResolvedValue(true);
    const isEligible = createEligibilityChecker(lookup);

    await isEligible("business-1");
    await isEligible("business-1");
    await isEligible("business-1");

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("queries each distinct business_id independently", async () => {
    const lookup = vi.fn(async (businessId: string) => businessId === "eligible-biz");
    const isEligible = createEligibilityChecker(lookup);

    await expect(isEligible("eligible-biz")).resolves.toBe(true);
    await expect(isEligible("ineligible-biz")).resolves.toBe(false);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("does not cache across different checker instances", async () => {
    const lookup = vi.fn().mockResolvedValue(true);
    createEligibilityChecker(lookup);
    const isEligible2 = createEligibilityChecker(lookup);

    await isEligible2("business-1");
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent in-flight lookups for the same business_id", async () => {
    let resolveLookup!: (value: boolean) => void;
    const lookup = vi.fn(
      () => new Promise<boolean>((resolve) => (resolveLookup = resolve)),
    );
    const isEligible = createEligibilityChecker(lookup);

    const first = isEligible("business-1");
    const second = isEligible("business-1");
    resolveLookup(true);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

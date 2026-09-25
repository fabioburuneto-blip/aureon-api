import { describe, expect, it } from "vitest";
import {
  cheapestPlanWithFeature,
  evaluateCountLimit,
  evaluateFeatureAccess,
  isLimitEnforced,
} from "./evaluate";
import { PLANS } from "./config";

describe("isLimitEnforced", () => {
  it("enforces limits while trialing or active", () => {
    expect(isLimitEnforced("trialing")).toBe(true);
    expect(isLimitEnforced("active")).toBe(true);
  });

  it("fails open for every other subscription state, so billing hiccups never lock the MVP", () => {
    expect(isLimitEnforced("past_due")).toBe(false);
    expect(isLimitEnforced("canceled")).toBe(false);
    expect(isLimitEnforced("incomplete")).toBe(false);
    expect(isLimitEnforced(null)).toBe(false);
    expect(isLimitEnforced(undefined)).toBe(false);
  });
});

describe("cheapestPlanWithFeature", () => {
  it("finds the cheapest plan (in PLAN_IDS order) that grants a feature", () => {
    expect(cheapestPlanWithFeature("agenda")?.id).toBe("start");
    expect(cheapestPlanWithFeature("advanced_notifications")?.id).toBe("pro");
    expect(cheapestPlanWithFeature("custom_domain")?.id).toBe("business");
  });

  it("returns null for a feature no plan grants", () => {
    // @ts-expect-error -- deliberately an invalid feature key
    expect(cheapestPlanWithFeature("time_travel")).toBeNull();
  });
});

describe("evaluateFeatureAccess", () => {
  it("allows anything when the subscription state isn't enforced (billing not configured/past_due/etc.)", () => {
    const result = evaluateFeatureAccess(PLANS.start, false, "advanced_notifications");
    expect(result.allowed).toBe(true);
  });

  it("allows a feature the current plan includes", () => {
    const result = evaluateFeatureAccess(PLANS.pro, true, "advanced_notifications");
    expect(result.allowed).toBe(true);
  });

  it("blocks a feature the plan doesn't include, with an upgrade hint naming the right plan", () => {
    const result = evaluateFeatureAccess(PLANS.start, true, "advanced_notifications");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Pro");
  });

  it("blocks custom_domain on start/pro but allows it on business", () => {
    expect(evaluateFeatureAccess(PLANS.start, true, "custom_domain").allowed).toBe(false);
    expect(evaluateFeatureAccess(PLANS.pro, true, "custom_domain").allowed).toBe(false);
    expect(evaluateFeatureAccess(PLANS.business, true, "custom_domain").allowed).toBe(true);
  });
});

describe("evaluateCountLimit", () => {
  const noun = { singular: "profissional", plural: "profissionais" };

  it("allows anything when the subscription state isn't enforced", () => {
    const result = evaluateCountLimit(PLANS.start, false, 1, 99, noun);
    expect(result.allowed).toBe(true);
  });

  it("allows unlimited plans (limit = null) regardless of count", () => {
    const result = evaluateCountLimit(PLANS.business, true, null, 9999, noun);
    expect(result.allowed).toBe(true);
  });

  it("allows adding while under the limit", () => {
    const result = evaluateCountLimit(PLANS.start, true, 1, 0, noun);
    expect(result.allowed).toBe(true);
  });

  it("blocks adding once the count reaches the limit, with a clear reason", () => {
    const result = evaluateCountLimit(PLANS.start, true, 1, 1, noun);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Start");
    expect(result.reason).toContain("1 profissional");
  });

  it("uses the plural noun form once the limit is greater than one", () => {
    const result = evaluateCountLimit(PLANS.pro, true, 5, 5, noun);
    expect(result.reason).toContain("5 profissionais");
  });
});

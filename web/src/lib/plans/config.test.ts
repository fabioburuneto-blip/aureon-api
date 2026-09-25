import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN_ID, getPlan, isValidPlanId, PLAN_IDS, PLANS } from "./config";

describe("plan configuration", () => {
  it("defines every plan listed in PLAN_IDS, each with a matching id", () => {
    for (const id of PLAN_IDS) {
      expect(PLANS[id]).toBeDefined();
      expect(PLANS[id].id).toBe(id);
    }
  });

  it("prices are positive integers (cents)", () => {
    for (const id of PLAN_IDS) {
      expect(Number.isInteger(PLANS[id].priceCents)).toBe(true);
      expect(PLANS[id].priceCents).toBeGreaterThan(0);
    }
  });

  it("prices strictly increase from start to business", () => {
    expect(PLANS.start.priceCents).toBeLessThan(PLANS.pro.priceCents);
    expect(PLANS.pro.priceCents).toBeLessThan(PLANS.business.priceCents);
  });

  it("DEFAULT_PLAN_ID is itself a valid plan id", () => {
    expect(isValidPlanId(DEFAULT_PLAN_ID)).toBe(true);
  });

  it("isValidPlanId rejects garbage", () => {
    expect(isValidPlanId("enterprise")).toBe(false);
    expect(isValidPlanId("")).toBe(false);
  });

  it("getPlan degrades to the default plan for an unknown id instead of throwing", () => {
    expect(getPlan("does-not-exist")).toBe(PLANS[DEFAULT_PLAN_ID]);
  });

  it("getPlan returns the exact plan for a known id", () => {
    expect(getPlan("business")).toBe(PLANS.business);
  });
});

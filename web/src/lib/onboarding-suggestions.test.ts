import { describe, expect, it } from "vitest";
import { SUGGESTED_SERVICES } from "./onboarding-suggestions";
import { businessSegments } from "./validations";

describe("SUGGESTED_SERVICES", () => {
  it("has an entry for every business segment", () => {
    for (const segment of businessSegments) {
      expect(SUGGESTED_SERVICES).toHaveProperty(segment);
    }
  });

  it("suggests Corte/Barba/Corte + Barba for barbershop", () => {
    const names = SUGGESTED_SERVICES.barbershop.map((s) => s.name);
    expect(names).toEqual(["Corte", "Barba", "Corte + Barba"]);
  });

  it("gives every suggested service a positive duration and price", () => {
    for (const services of Object.values(SUGGESTED_SERVICES)) {
      for (const service of services) {
        expect(service.duration_minutes).toBeGreaterThan(0);
        expect(service.price).toBeGreaterThan(0);
      }
    }
  });

  it("leaves 'other' empty (no segment-specific default makes sense)", () => {
    expect(SUGGESTED_SERVICES.other).toEqual([]);
  });
});

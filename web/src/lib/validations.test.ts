import { describe, expect, it } from "vitest";
import {
  createBusinessSchema,
  serviceSchema,
  publicBookingSchema,
} from "./validations";

describe("createBusinessSchema", () => {
  it("accepts a valid payload", () => {
    const result = createBusinessSchema.safeParse({
      name: "Barbearia do Fábio",
      slug: "barbearia-do-fabio",
      segment: "barbershop",
      timezone: "America/Sao_Paulo",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid slug", () => {
    const result = createBusinessSchema.safeParse({
      name: "Barbearia",
      slug: "Barbearia Inválida!",
      segment: "barbershop",
      timezone: "America/Sao_Paulo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown segment", () => {
    const result = createBusinessSchema.safeParse({
      name: "Barbearia",
      slug: "barbearia",
      segment: "not-a-real-segment",
      timezone: "America/Sao_Paulo",
    });
    expect(result.success).toBe(false);
  });
});

describe("serviceSchema", () => {
  it("coerces numeric strings from form data", () => {
    const result = serviceSchema.safeParse({
      name: "Corte",
      duration_minutes: "30",
      price: "50.5",
      is_active: "true",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration_minutes).toBe(30);
      expect(result.data.price).toBe(50.5);
    }
  });

  it("rejects a negative price", () => {
    const result = serviceSchema.safeParse({
      name: "Corte",
      duration_minutes: "30",
      price: "-10",
    });
    expect(result.success).toBe(false);
  });
});

describe("publicBookingSchema", () => {
  it("requires a name and phone", () => {
    const result = publicBookingSchema.safeParse({
      service_id: "11111111-1111-1111-1111-111111111111",
      professional_id: "22222222-2222-2222-2222-222222222222",
      starts_at: new Date().toISOString(),
      customer_name: "A",
      customer_phone: "123",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid booking payload", () => {
    const result = publicBookingSchema.safeParse({
      service_id: "11111111-1111-4111-8111-111111111111",
      professional_id: "22222222-2222-4222-8222-222222222222",
      starts_at: new Date().toISOString(),
      customer_name: "Maria Silva",
      customer_phone: "11999999999",
    });
    expect(result.success).toBe(true);
  });
});

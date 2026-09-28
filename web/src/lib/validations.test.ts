import { describe, expect, it } from "vitest";
import {
  createBusinessSchema,
  serviceSchema,
  publicBookingSchema,
  themeSchema,
  themePresetSchema,
  businessSocialSchema,
  businessLocationSchema,
  sectionsConfigSchema,
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

  it("accepts a payload with no whatsapp/instagram (both optional)", () => {
    const result = createBusinessSchema.safeParse({
      name: "Barbearia",
      slug: "barbearia",
      segment: "barbershop",
      timezone: "America/Sao_Paulo",
    });
    expect(result.success).toBe(true);
  });

  it("normalizes an instagram handle typed with an @", () => {
    const result = createBusinessSchema.safeParse({
      name: "Barbearia",
      slug: "barbearia",
      segment: "barbershop",
      timezone: "America/Sao_Paulo",
      instagram: "@barbearia.oficial",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.instagram).toBe("barbearia.oficial");
    }
  });

  it("normalizes a full instagram profile URL down to the handle", () => {
    const result = createBusinessSchema.safeParse({
      name: "Barbearia",
      slug: "barbearia",
      segment: "barbershop",
      timezone: "America/Sao_Paulo",
      instagram: "https://www.instagram.com/barbearia.oficial/",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.instagram).toBe("barbearia.oficial");
    }
  });

  it("keeps a whatsapp number as-is", () => {
    const result = createBusinessSchema.safeParse({
      name: "Barbearia",
      slug: "barbearia",
      segment: "barbershop",
      timezone: "America/Sao_Paulo",
      whatsapp: "+55 11 99999-9999",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.whatsapp).toBe("+55 11 99999-9999");
    }
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

describe("themeSchema (Etapa 2: no longer takes 'layout')", () => {
  it("accepts just the two colors", () => {
    const result = themeSchema.safeParse({
      primary_color: "#111827",
      secondary_color: "#6366f1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-hex color", () => {
    const result = themeSchema.safeParse({
      primary_color: "blue",
      secondary_color: "#6366f1",
    });
    expect(result.success).toBe(false);
  });
});

describe("themePresetSchema", () => {
  it("accepts each of the 5 named presets", () => {
    for (const preset of ["premium", "moderno", "minimalista", "barbearia", "elegante"]) {
      expect(themePresetSchema.safeParse({ preset }).success).toBe(true);
    }
  });

  it("rejects an unknown preset", () => {
    expect(themePresetSchema.safeParse({ preset: "cyberpunk" }).success).toBe(false);
  });
});

describe("businessSocialSchema", () => {
  it("normalizes an instagram handle the same way createBusinessSchema does", () => {
    const result = businessSocialSchema.safeParse({
      whatsapp: "11999999999",
      instagram: "@minha.loja",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.instagram).toBe("minha.loja");
    }
  });

  it("accepts both fields empty", () => {
    expect(businessSocialSchema.safeParse({}).success).toBe(true);
  });
});

describe("businessLocationSchema", () => {
  it("accepts address and city", () => {
    const result = businessLocationSchema.safeParse({
      address: "Rua Exemplo, 123",
      city: "São Paulo, SP",
    });
    expect(result.success).toBe(true);
  });

  it("accepts both fields empty", () => {
    expect(businessLocationSchema.safeParse({}).success).toBe(true);
  });
});

describe("sectionsConfigSchema", () => {
  it("accepts a valid section list", () => {
    const result = sectionsConfigSchema.safeParse([
      { key: "hero", visible: true },
      { key: "services", visible: false },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown section key", () => {
    const result = sectionsConfigSchema.safeParse([
      { key: "not-a-section", visible: true },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects a non-boolean visible field", () => {
    const result = sectionsConfigSchema.safeParse([
      { key: "hero", visible: "yes" },
    ]);
    expect(result.success).toBe(false);
  });
});

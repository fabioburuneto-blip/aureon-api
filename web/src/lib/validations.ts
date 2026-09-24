import { z } from "zod";
import { isValidSlug } from "@/lib/slug";

export const businessSegments = [
  "barbershop",
  "hair_salon",
  "nails",
  "aesthetics",
  "tattoo",
  "massage",
  "personal_trainer",
  "other",
] as const;

export const segmentLabels: Record<(typeof businessSegments)[number], string> =
  {
    barbershop: "Barbearia",
    hair_salon: "Cabeleireiro(a)",
    nails: "Manicure",
    aesthetics: "Estética",
    tattoo: "Tatuagem",
    massage: "Massagem",
    personal_trainer: "Personal Trainer",
    other: "Outro",
  };

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da empresa").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isValidSlug, "Use apenas letras minúsculas, números e hífens"),
  segment: z.enum(businessSegments),
  timezone: z.string().default("America/Sao_Paulo"),
});

export const serviceSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do serviço").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  duration_minutes: z.coerce
    .number()
    .int()
    .min(5, "Mínimo de 5 minutos")
    .max(600),
  price: z.coerce.number().min(0, "O preço não pode ser negativo"),
  is_active: z.coerce.boolean().default(true),
});

export const professionalSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do profissional").max(120),
  bio: z.string().trim().max(500).optional().or(z.literal("")),
  is_active: z.coerce.boolean().default(true),
  service_ids: z.array(z.string().uuid()).default([]),
});

export const businessHoursSchema = z.object({
  day_of_week: z.coerce.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  is_closed: z.coerce.boolean().default(false),
});

export const blockedTimeSchema = z
  .object({
    professional_id: z.string().uuid().nullable(),
    starts_at: z.string().min(1, "Informe a data/hora de início"),
    ends_at: z.string().min(1, "Informe a data/hora de término"),
    reason: z.string().trim().max(200).optional().or(z.literal("")),
  })
  .refine((data) => new Date(data.ends_at) > new Date(data.starts_at), {
    message: "O término deve ser depois do início",
    path: ["ends_at"],
  });

export const businessSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  timezone: z.string().min(1),
  is_published: z.coerce.boolean(),
});

export const themeSchema = z.object({
  primary_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use um código hexadecimal, ex: #111827"),
  secondary_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use um código hexadecimal, ex: #6366f1"),
  layout: z.enum(["classic", "minimal"]),
});

export const businessImageSchema = z.object({
  kind: z.enum(["logo", "cover"]),
  url: z.string().trim().url(),
});

export const publicBookingSchema = z.object({
  service_id: z.string().uuid(),
  professional_id: z.string().uuid(),
  starts_at: z.string().min(1),
  customer_name: z.string().trim().min(2, "Informe seu nome"),
  customer_phone: z.string().trim().min(8, "Informe um telefone válido"),
  customer_email: z.string().trim().email().optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

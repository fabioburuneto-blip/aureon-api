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
  timezone: z.string().max(60).default("America/Sao_Paulo"),
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
    starts_at: z.string().min(1, "Informe a data/hora de início").max(40),
    ends_at: z.string().min(1, "Informe a data/hora de término").max(40),
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
  email: z.string().trim().max(254).email().optional().or(z.literal("")),
  timezone: z.string().min(1).max(60),
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

export const notificationSettingsSchema = z
  .object({
    whatsapp_enabled: z.coerce.boolean().default(false),
    whatsapp_phone: z.string().trim().max(30).optional().or(z.literal("")),
    notify_email_enabled: z.coerce.boolean().default(false),
    notify_email_address: z
      .string()
      .trim()
      .max(254)
      .email()
      .optional()
      .or(z.literal("")),
    notify_new_appointment: z.coerce.boolean().default(true),
    notify_cancellation: z.coerce.boolean().default(true),
    notify_reschedule: z.coerce.boolean().default(true),
    notify_reminder_24h: z.coerce.boolean().default(true),
    notify_reminder_2h: z.coerce.boolean().default(true),
  })
  .refine(
    (data) => !data.whatsapp_enabled || !!data.whatsapp_phone,
    {
      message: "Informe o número de WhatsApp para ativar o envio",
      path: ["whatsapp_phone"],
    },
  )
  .refine(
    (data) => !data.notify_email_enabled || !!data.notify_email_address,
    {
      message: "Informe o e-mail para ativar o envio",
      path: ["notify_email_address"],
    },
  );

export const businessImageSchema = z.object({
  kind: z.enum(["logo", "cover"]),
  url: z.string().trim().max(2048).url(),
});

export const publicBookingSchema = z.object({
  service_id: z.string().uuid(),
  professional_id: z.string().uuid(),
  starts_at: z.string().min(1).max(40),
  customer_name: z.string().trim().min(2, "Informe seu nome").max(120),
  customer_phone: z
    .string()
    .trim()
    .min(8, "Informe um telefone válido")
    .max(30),
  customer_email: z
    .string()
    .trim()
    .max(254)
    .email()
    .optional()
    .or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

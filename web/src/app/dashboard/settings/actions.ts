"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBusiness, requireOwner } from "@/lib/auth";
import { businessSettingsSchema, notificationSettingsSchema } from "@/lib/validations";
import { canUseFeature } from "@/lib/plans/limits";
import { logError } from "@/lib/logger";

export type SettingsFormState =
  { error?: string; success?: boolean } | undefined;

export async function updateBusinessSettings(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const parsed = businessSettingsSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    timezone: formData.get("timezone"),
    is_published: formData.get("is_published") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business, role } = await getCurrentBusiness();
  requireOwner(role);

  const { error } = await supabase
    .from("businesses")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      timezone: parsed.data.timezone,
      is_published: parsed.data.is_published,
    })
    .eq("id", business.id);

  if (error) {
    logError("business_settings.save_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível salvar as configurações." };
  }

  revalidatePath("/dashboard/settings");
  revalidatePath(`/${business.slug}`);
  return { success: true };
}

export type NotificationSettingsFormState =
  { error?: string; success?: boolean } | undefined;

export async function updateNotificationSettings(
  _prevState: NotificationSettingsFormState,
  formData: FormData,
): Promise<NotificationSettingsFormState> {
  const parsed = notificationSettingsSchema.safeParse({
    whatsapp_enabled: formData.get("whatsapp_enabled") === "on",
    whatsapp_phone: formData.get("whatsapp_phone"),
    notify_email_enabled: formData.get("notify_email_enabled") === "on",
    notify_email_address: formData.get("notify_email_address"),
    notify_new_appointment: formData.get("notify_new_appointment") === "on",
    notify_cancellation: formData.get("notify_cancellation") === "on",
    notify_reschedule: formData.get("notify_reschedule") === "on",
    notify_reminder_24h: formData.get("notify_reminder_24h") === "on",
    notify_reminder_2h: formData.get("notify_reminder_2h") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business, role } = await getCurrentBusiness();
  requireOwner(role);

  if (parsed.data.whatsapp_enabled || parsed.data.notify_email_enabled) {
    const limit = await canUseFeature(supabase, business.id, "advanced_notifications");
    if (!limit.allowed) {
      return { error: limit.reason };
    }
  }

  const { error } = await supabase
    .from("business_settings")
    .update({
      whatsapp_enabled: parsed.data.whatsapp_enabled,
      whatsapp_phone: parsed.data.whatsapp_phone || null,
      notify_email_enabled: parsed.data.notify_email_enabled,
      notify_email_address: parsed.data.notify_email_address || null,
      notify_new_appointment: parsed.data.notify_new_appointment,
      notify_cancellation: parsed.data.notify_cancellation,
      notify_reschedule: parsed.data.notify_reschedule,
      notify_reminder_24h: parsed.data.notify_reminder_24h,
      notify_reminder_2h: parsed.data.notify_reminder_2h,
    })
    .eq("business_id", business.id);

  if (error) {
    logError("notification_settings.save_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível salvar as preferências de notificação." };
  }

  revalidatePath("/dashboard/settings");
  return { success: true };
}

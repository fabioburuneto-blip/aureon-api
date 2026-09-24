"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBusiness, requireOwner } from "@/lib/auth";
import { businessSettingsSchema } from "@/lib/validations";

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
    return { error: "Não foi possível salvar as configurações." };
  }

  revalidatePath("/dashboard/settings");
  revalidatePath(`/${business.slug}`);
  return { success: true };
}

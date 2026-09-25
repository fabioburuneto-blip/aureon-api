"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBusiness, requireOwner } from "@/lib/auth";
import { themeSchema, businessImageSchema } from "@/lib/validations";
import { logError } from "@/lib/logger";

export type CustomizationFormState =
  { error?: string; success?: boolean } | undefined;

export async function updateTheme(
  _prevState: CustomizationFormState,
  formData: FormData,
): Promise<CustomizationFormState> {
  const parsed = themeSchema.safeParse({
    primary_color: formData.get("primary_color"),
    secondary_color: formData.get("secondary_color"),
    layout: formData.get("layout"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business, role } = await getCurrentBusiness();
  requireOwner(role);

  const { error } = await supabase
    .from("themes")
    .update(parsed.data)
    .eq("business_id", business.id);

  if (error) {
    logError("theme.update_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível salvar a personalização." };
  }

  revalidatePath("/dashboard/customization");
  revalidatePath(`/${business.slug}`);
  return { success: true };
}

/**
 * Persists the public URL of a logo/cover image after the browser has
 * already uploaded the file straight to Supabase Storage (see
 * ImageUploader). This action never receives the file itself -- only a
 * URL already scoped to this business's storage folder by RLS.
 */
export async function updateBusinessImage(kind: "logo" | "cover", url: string) {
  const parsed = businessImageSchema.safeParse({ kind, url });
  if (!parsed.success) {
    return { error: "URL de imagem inválida." };
  }

  const { supabase, business, role } = await getCurrentBusiness();
  requireOwner(role);

  const { error } = await supabase
    .from("businesses")
    .update(
      parsed.data.kind === "logo"
        ? { logo_url: parsed.data.url }
        : { cover_url: parsed.data.url },
    )
    .eq("id", business.id);

  if (error) {
    logError("business_image.update_failed", { business_id: business.id, kind, code: error.code }, error);
    return { error: "Não foi possível salvar a imagem." };
  }

  revalidatePath("/dashboard/customization");
  revalidatePath(`/${business.slug}`);
  return { success: true };
}

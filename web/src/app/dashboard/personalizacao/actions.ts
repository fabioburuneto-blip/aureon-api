"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBusiness, requireOwner } from "@/lib/auth";
import {
  themeSchema,
  themePresetSchema,
  businessImageSchema,
  businessGalleryImageSchema,
  businessSocialSchema,
  businessLocationSchema,
  sectionsConfigSchema,
} from "@/lib/validations";
import { normalizeSectionsConfig } from "@/lib/sections";
import { logError } from "@/lib/logger";

export type PersonalizationFormState =
  { error?: string; success?: boolean } | undefined;

function revalidatePersonalization(slug: string) {
  revalidatePath("/dashboard/personalizacao");
  revalidatePath("/dashboard/preview");
  revalidatePath(`/${slug}`);
}

export async function updateThemeColors(
  _prevState: PersonalizationFormState,
  formData: FormData,
): Promise<PersonalizationFormState> {
  const parsed = themeSchema.safeParse({
    primary_color: formData.get("primary_color"),
    secondary_color: formData.get("secondary_color"),
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
    logError("theme.update_colors_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível salvar as cores." };
  }

  revalidatePersonalization(business.slug);
  return { success: true };
}

export async function updateThemePreset(preset: string) {
  const parsed = themePresetSchema.safeParse({ preset });
  if (!parsed.success) {
    return { error: "Tema inválido." };
  }

  const { supabase, business, role } = await getCurrentBusiness();
  requireOwner(role);

  const { error } = await supabase
    .from("themes")
    .update({ preset: parsed.data.preset })
    .eq("business_id", business.id);

  if (error) {
    logError("theme.update_preset_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível salvar o tema." };
  }

  revalidatePersonalization(business.slug);
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

  revalidatePersonalization(business.slug);
  return { success: true };
}

export type DescriptionFormState = { error?: string; success?: boolean } | undefined;

export async function updateDescription(
  _prevState: DescriptionFormState,
  formData: FormData,
): Promise<DescriptionFormState> {
  const description = String(formData.get("description") ?? "").trim();
  if (description.length > 500) {
    return { error: "A descrição deve ter até 500 caracteres." };
  }

  const { supabase, business, role } = await getCurrentBusiness();
  requireOwner(role);

  const { error } = await supabase
    .from("businesses")
    .update({ description: description || null })
    .eq("id", business.id);

  if (error) {
    logError("business.update_description_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível salvar a descrição." };
  }

  revalidatePersonalization(business.slug);
  return { success: true };
}

export async function updateBusinessSocial(
  _prevState: PersonalizationFormState,
  formData: FormData,
): Promise<PersonalizationFormState> {
  const parsed = businessSocialSchema.safeParse({
    whatsapp: formData.get("whatsapp"),
    instagram: formData.get("instagram"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business, role } = await getCurrentBusiness();
  requireOwner(role);

  const { error } = await supabase
    .from("businesses")
    .update({
      whatsapp: parsed.data.whatsapp || null,
      instagram: parsed.data.instagram || null,
    })
    .eq("id", business.id);

  if (error) {
    logError("business.update_social_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível salvar as redes sociais." };
  }

  revalidatePersonalization(business.slug);
  return { success: true };
}

export async function updateBusinessLocation(
  _prevState: PersonalizationFormState,
  formData: FormData,
): Promise<PersonalizationFormState> {
  const parsed = businessLocationSchema.safeParse({
    address: formData.get("address"),
    city: formData.get("city"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business, role } = await getCurrentBusiness();
  requireOwner(role);

  const { error } = await supabase
    .from("businesses")
    .update({
      address: parsed.data.address || null,
      city: parsed.data.city || null,
    })
    .eq("id", business.id);

  if (error) {
    logError("business.update_location_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível salvar a localização." };
  }

  revalidatePersonalization(business.slug);
  return { success: true };
}

export async function updateSectionsConfig(sections: unknown) {
  const parsed = sectionsConfigSchema.safeParse(sections);
  if (!parsed.success) {
    return { error: "Configuração de seções inválida." };
  }

  const { supabase, business, role } = await getCurrentBusiness();
  requireOwner(role);

  const normalized = normalizeSectionsConfig(parsed.data);

  const { error } = await supabase
    .from("themes")
    .update({ sections: normalized })
    .eq("business_id", business.id);

  if (error) {
    logError("theme.update_sections_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível salvar a ordem das seções." };
  }

  revalidatePersonalization(business.slug);
  return { success: true, sections: normalized };
}

const MAX_GALLERY_PHOTOS = 12;

export async function addGalleryPhoto(url: string) {
  const parsed = businessGalleryImageSchema.safeParse({ url });
  if (!parsed.success) {
    return { error: "URL de imagem inválida." };
  }

  const { supabase, business, role } = await getCurrentBusiness();
  requireOwner(role);

  const { count } = await supabase
    .from("business_gallery")
    .select("id", { count: "exact", head: true })
    .eq("business_id", business.id);

  if ((count ?? 0) >= MAX_GALLERY_PHOTOS) {
    return { error: `Limite de ${MAX_GALLERY_PHOTOS} fotos na galeria.` };
  }

  const { data, error } = await supabase
    .from("business_gallery")
    .insert({ business_id: business.id, image_url: parsed.data.url, position: count ?? 0 })
    .select("id, image_url")
    .single();

  if (error) {
    logError("gallery.insert_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível adicionar a foto." };
  }

  revalidatePersonalization(business.slug);
  return { success: true, photo: data };
}

export async function removeGalleryPhoto(photoId: string) {
  const { supabase, business, role } = await getCurrentBusiness();
  requireOwner(role);

  const { error } = await supabase
    .from("business_gallery")
    .delete()
    .eq("id", photoId)
    .eq("business_id", business.id);

  if (error) {
    logError("gallery.delete_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível remover a foto." };
  }

  revalidatePersonalization(business.slug);
  return { success: true };
}

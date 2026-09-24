"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentBusiness } from "@/lib/auth";
import { professionalSchema } from "@/lib/validations";

export type ProfessionalFormState = { error?: string } | undefined;

function parseServiceIds(formData: FormData): string[] {
  return formData.getAll("service_ids").map(String).filter(Boolean);
}

export async function createProfessional(
  _prevState: ProfessionalFormState,
  formData: FormData,
): Promise<ProfessionalFormState> {
  const parsed = professionalSchema.safeParse({
    name: formData.get("name"),
    bio: formData.get("bio"),
    is_active: true,
    service_ids: parseServiceIds(formData),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business } = await getCurrentBusiness();

  const { data: professional, error } = await supabase
    .from("professionals")
    .insert({
      business_id: business.id,
      name: parsed.data.name,
      bio: parsed.data.bio || null,
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !professional) {
    return { error: "Não foi possível salvar o profissional." };
  }

  if (parsed.data.service_ids.length > 0) {
    await supabase.from("professional_services").insert(
      parsed.data.service_ids.map((service_id) => ({
        professional_id: professional.id,
        service_id,
      })),
    );
  }

  revalidatePath("/dashboard/professionals");
}

export async function updateProfessional(
  _prevState: ProfessionalFormState,
  formData: FormData,
): Promise<ProfessionalFormState> {
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Profissional inválido." };

  const parsed = professionalSchema.safeParse({
    name: formData.get("name"),
    bio: formData.get("bio"),
    is_active: formData.get("is_active") === "on",
    service_ids: parseServiceIds(formData),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business } = await getCurrentBusiness();

  const { error } = await supabase
    .from("professionals")
    .update({
      name: parsed.data.name,
      bio: parsed.data.bio || null,
      is_active: parsed.data.is_active,
    })
    .eq("id", id.data)
    .eq("business_id", business.id);

  if (error) {
    return { error: "Não foi possível atualizar o profissional." };
  }

  await supabase
    .from("professional_services")
    .delete()
    .eq("professional_id", id.data);

  if (parsed.data.service_ids.length > 0) {
    await supabase.from("professional_services").insert(
      parsed.data.service_ids.map((service_id) => ({
        professional_id: id.data,
        service_id,
      })),
    );
  }

  revalidatePath("/dashboard/professionals");
}

export type DeleteProfessionalState = { error?: string } | undefined;

export async function deleteProfessional(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const { supabase, business } = await getCurrentBusiness();

  const { error } = await supabase
    .from("professionals")
    .delete()
    .eq("id", id)
    .eq("business_id", business.id);

  if (error) {
    // Likely blocked by existing appointments (ON DELETE RESTRICT).
    await supabase
      .from("professionals")
      .update({ is_active: false })
      .eq("id", id)
      .eq("business_id", business.id);
  }

  revalidatePath("/dashboard/professionals");
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentBusiness } from "@/lib/auth";
import { serviceSchema } from "@/lib/validations";

export type ServiceFormState = { error?: string } | undefined;

export async function createService(
  _prevState: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const parsed = serviceSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    duration_minutes: formData.get("duration_minutes"),
    price: formData.get("price"),
    is_active: true,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business } = await getCurrentBusiness();

  const { error } = await supabase.from("services").insert({
    business_id: business.id,
    name: parsed.data.name,
    description: parsed.data.description || null,
    duration_minutes: parsed.data.duration_minutes,
    price_cents: Math.round(parsed.data.price * 100),
    is_active: true,
  });

  if (error) {
    return { error: "Não foi possível salvar o serviço." };
  }

  revalidatePath("/dashboard/services");
}

export async function updateService(
  _prevState: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Serviço inválido." };

  const parsed = serviceSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    duration_minutes: formData.get("duration_minutes"),
    price: formData.get("price"),
    is_active: formData.get("is_active") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business } = await getCurrentBusiness();

  const { error } = await supabase
    .from("services")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      duration_minutes: parsed.data.duration_minutes,
      price_cents: Math.round(parsed.data.price * 100),
      is_active: parsed.data.is_active,
    })
    .eq("id", id.data)
    .eq("business_id", business.id);

  if (error) {
    return { error: "Não foi possível atualizar o serviço." };
  }

  revalidatePath("/dashboard/services");
}

export async function deleteService(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const { supabase, business } = await getCurrentBusiness();

  await supabase
    .from("services")
    .delete()
    .eq("id", id)
    .eq("business_id", business.id);

  revalidatePath("/dashboard/services");
}

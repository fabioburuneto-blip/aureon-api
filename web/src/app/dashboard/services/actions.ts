"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentBusiness } from "@/lib/auth";
import { serviceSchema } from "@/lib/validations";
import { canAddService } from "@/lib/plans/limits";
import { logError } from "@/lib/logger";

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

  const limit = await canAddService(supabase, business.id);
  if (!limit.allowed) {
    return { error: limit.reason };
  }

  const { error } = await supabase.from("services").insert({
    business_id: business.id,
    name: parsed.data.name,
    description: parsed.data.description || null,
    duration_minutes: parsed.data.duration_minutes,
    price_cents: Math.round(parsed.data.price * 100),
    is_active: true,
  });

  if (error) {
    logError("service.create_failed", { business_id: business.id, code: error.code }, error);
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
    logError("service.update_failed", { business_id: business.id, code: error.code }, error);
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

export async function moveService(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const direction = z.enum(["up", "down"]).parse(formData.get("direction"));
  const { supabase, business } = await getCurrentBusiness();

  const { data: services } = await supabase
    .from("services")
    .select("id")
    .eq("business_id", business.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  const ids = (services ?? []).map((s) => s.id);
  const index = ids.indexOf(id);
  if (index === -1) return;

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= ids.length) return;

  [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];

  // Rewrite every row's position to its new sequential index -- normalizes
  // stale/duplicate positions (e.g. every service still defaulting to 0)
  // instead of only swapping two possibly-equal values.
  await Promise.all(
    ids.map((serviceId, position) =>
      supabase
        .from("services")
        .update({ position })
        .eq("id", serviceId)
        .eq("business_id", business.id),
    ),
  );

  revalidatePath("/dashboard/services");
}

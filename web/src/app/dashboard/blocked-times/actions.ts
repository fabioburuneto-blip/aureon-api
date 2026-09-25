"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentBusiness } from "@/lib/auth";
import { blockedTimeSchema } from "@/lib/validations";
import { logError } from "@/lib/logger";

export type BlockedTimeFormState = { error?: string } | undefined;

export async function createBlockedTime(
  _prevState: BlockedTimeFormState,
  formData: FormData,
): Promise<BlockedTimeFormState> {
  const professionalId = formData.get("professional_id");

  const parsed = blockedTimeSchema.safeParse({
    professional_id: professionalId ? String(professionalId) : null,
    starts_at: formData.get("starts_at"),
    ends_at: formData.get("ends_at"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, business } = await getCurrentBusiness();

  const { error } = await supabase.from("blocked_times").insert({
    business_id: business.id,
    professional_id: parsed.data.professional_id || null,
    starts_at: new Date(parsed.data.starts_at).toISOString(),
    ends_at: new Date(parsed.data.ends_at).toISOString(),
    reason: parsed.data.reason || null,
  });

  if (error) {
    logError("blocked_time.create_failed", { business_id: business.id, code: error.code }, error);
    return { error: "Não foi possível salvar o bloqueio." };
  }

  revalidatePath("/dashboard/blocked-times");
}

export async function deleteBlockedTime(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const { supabase, business } = await getCurrentBusiness();

  await supabase
    .from("blocked_times")
    .delete()
    .eq("id", id)
    .eq("business_id", business.id);

  revalidatePath("/dashboard/blocked-times");
}

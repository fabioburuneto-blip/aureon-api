"use server";

import { revalidatePath } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { publicRescheduleSchema, publicTokenSchema } from "@/lib/validations";
import { logError } from "@/lib/logger";
import { mapPublicAppointmentError } from "./errors";

export type PortalActionState = { error?: string; success?: boolean } | undefined;

// Best-effort per-IP throttle (see src/lib/rate-limit.ts for the honest
// limitation: in-process, resets per instance/cold start). Cancel/
// reschedule are the two writes on an otherwise anonymous, token-gated
// surface -- a tighter limit than a read, since a write is what an
// attacker cycling through guessed tokens would actually want.
const WRITE_LIMIT = 10;
const WRITE_WINDOW_MS = 10 * 60 * 1000;

export async function cancelPublicAppointment(
  _prevState: PortalActionState,
  formData: FormData,
): Promise<PortalActionState> {
  const parsed = publicTokenSchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) {
    return { error: "Este link de agendamento não é válido ou expirou." };
  }

  const ip = await getClientIp();
  if (!checkRateLimit(`cancel:${ip}`, WRITE_LIMIT, WRITE_WINDOW_MS)) {
    return { error: "Muitas tentativas. Tente novamente em alguns minutos." };
  }

  const supabase = createPublicClient();
  const { error } = await supabase.rpc("cancel_public_appointment", {
    p_token: parsed.data.token,
  });

  if (error) {
    // Never log the token itself -- it is the bearer credential for this
    // appointment, same class of secret as a password reset link.
    logError("public_appointment.cancel_failed", { code: error.code }, error);
    return { error: mapPublicAppointmentError(error.message) };
  }

  revalidatePath(`/agendamento/${parsed.data.token}`);
  return { success: true };
}

export async function reschedulePublicAppointment(
  _prevState: PortalActionState,
  formData: FormData,
): Promise<PortalActionState> {
  const parsed = publicRescheduleSchema.safeParse({
    token: formData.get("token"),
    starts_at: formData.get("starts_at"),
  });
  if (!parsed.success) {
    return { error: "Selecione um novo horário." };
  }

  const ip = await getClientIp();
  if (!checkRateLimit(`reschedule:${ip}`, WRITE_LIMIT, WRITE_WINDOW_MS)) {
    return { error: "Muitas tentativas. Tente novamente em alguns minutos." };
  }

  const supabase = createPublicClient();
  const { error } = await supabase.rpc("reschedule_public_appointment", {
    p_token: parsed.data.token,
    p_starts_at: parsed.data.starts_at,
  });

  if (error) {
    logError("public_appointment.reschedule_failed", { code: error.code }, error);
    return { error: mapPublicAppointmentError(error.message) };
  }

  revalidatePath(`/agendamento/${parsed.data.token}`);
  return { success: true };
}
